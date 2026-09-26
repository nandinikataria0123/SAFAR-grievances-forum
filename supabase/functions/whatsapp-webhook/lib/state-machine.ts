// The conversation flow: one function per stage, each deciding what
// to do with an incoming message and what to send back. This mirrors
// the seven steps in the SAFAR Conversation mockup 1:1. If you change
// the flow, update that mockup too so they don't drift apart.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Grievance, ParsedMessage } from "./types.ts";
import { downloadMedia, sendButtons, sendList, sendText } from "./whatsapp.ts";
import { transcribeAndTranslate } from "./bhashini.ts";
import * as copy from "./copy.ts";

const BUCKET = "evidence";

export async function handleIncomingMessage(
  supabase: SupabaseClient,
  phone: string,
  profileName: string | undefined,
  message: ParsedMessage,
) {
  const { data: existing, error: lookupError } = await supabase
    .from("grievances")
    .select("*")
    .eq("wa_phone_number", phone)
    .neq("stage", "completed")
    .maybeSingle();

  if (lookupError) throw lookupError;

  let grievance = existing as Grievance | null;

  if (!grievance) {
    const { data: created, error: insertError } = await supabase
      .from("grievances")
      .insert({ wa_phone_number: phone, wa_profile_name: profileName ?? null })
      .select()
      .single();
    if (insertError) throw insertError;

    // A freshly created row hasn't been asked anything yet, so the
    // message that triggered it (probably just "hi") isn't a reply to
    // anything. Send the consent prompt and stop; whatever they say
    // next is handled on the following webhook call.
    await sendButtons(phone, copy.CONSENT_PROMPT, [copy.CONSENT_BUTTON]);
    return;
  }

  switch (grievance.stage as Grievance["stage"]) {
    case "awaiting_consent":
      await handleConsent(supabase, grievance, message);
      break;
    case "awaiting_reason":
      await handleReason(supabase, grievance, message);
      break;
    case "awaiting_platform":
      await handlePlatform(supabase, grievance, message);
      break;
    case "awaiting_description":
      await handleDescription(supabase, grievance, message);
      break;
    case "awaiting_description_confirm":
      await handleDescriptionConfirm(supabase, grievance, message);
      break;
    case "awaiting_evidence":
      await handleEvidence(supabase, grievance, message);
      break;
  }
}

async function update(
  supabase: SupabaseClient,
  id: string,
  fields: Record<string, unknown>,
) {
  const { error } = await supabase.from("grievances").update(fields).eq("id", id);
  if (error) throw error;
}

async function sendConfirmPrompt(phone: string, translatedText: string) {
  await sendButtons(phone, copy.transcriptConfirmPrompt(translatedText), [
    copy.TRANSCRIPT_CONFIRM_YES,
    copy.TRANSCRIPT_CONFIRM_REDO,
  ]);
}

async function sendEvidencePrompt(phone: string) {
  await sendButtons(phone, copy.EVIDENCE_PROMPT, [copy.EVIDENCE_SKIP_BUTTON]);
}

async function handleConsent(
  supabase: SupabaseClient,
  g: Grievance,
  msg: ParsedMessage,
) {
  const saidYes =
    (msg.type === "selection" && msg.selectionId === copy.CONSENT_BUTTON.id) ||
    (msg.type === "text" && /^\s*yes\b/i.test(msg.text));

  if (!saidYes) {
    await sendButtons(g.wa_phone_number, copy.CONSENT_PROMPT, [copy.CONSENT_BUTTON]);
    return;
  }

  await update(supabase, g.id, {
    consent_at: new Date().toISOString(),
    stage: "awaiting_reason",
  });
  await sendList(g.wa_phone_number, copy.REASON_PROMPT, copy.REASON_LIST_BUTTON, [
    { title: copy.REASON_LIST_BUTTON, rows: copy.REASONS },
  ]);
}

async function handleReason(
  supabase: SupabaseClient,
  g: Grievance,
  msg: ParsedMessage,
) {
  if (msg.type !== "selection" || !copy.REASONS.some((r) => r.id === msg.selectionId)) {
    await sendList(g.wa_phone_number, copy.REASON_PROMPT, copy.REASON_LIST_BUTTON, [
      { title: copy.REASON_LIST_BUTTON, rows: copy.REASONS },
    ]);
    return;
  }

  await update(supabase, g.id, {
    reason: msg.selectionId,
    stage: "awaiting_platform",
  });
  await sendList(g.wa_phone_number, copy.PLATFORM_PROMPT, copy.PLATFORM_LIST_BUTTON, [
    { title: copy.PLATFORM_LIST_BUTTON, rows: copy.PLATFORMS },
  ]);
}

async function handlePlatform(
  supabase: SupabaseClient,
  g: Grievance,
  msg: ParsedMessage,
) {
  if (msg.type !== "selection" || !copy.PLATFORMS.some((p) => p.id === msg.selectionId)) {
    await sendList(g.wa_phone_number, copy.PLATFORM_PROMPT, copy.PLATFORM_LIST_BUTTON, [
      { title: copy.PLATFORM_LIST_BUTTON, rows: copy.PLATFORMS },
    ]);
    return;
  }

  await update(supabase, g.id, {
    platform: msg.selectionId,
    stage: "awaiting_description",
  });
  await sendText(g.wa_phone_number, copy.DESCRIPTION_PROMPT);
}

async function handleDescription(
  supabase: SupabaseClient,
  g: Grievance,
  msg: ParsedMessage,
) {
  if (msg.type === "text") {
    // Typed directly: no transcription needed, but still confirmed
    // before moving on, in case of a typo or second thoughts.
    await update(supabase, g.id, {
      description_original: msg.text,
      description_language: "typed",
      description_translated: msg.text,
      stage: "awaiting_description_confirm",
    });
    await sendConfirmPrompt(g.wa_phone_number, msg.text);
    return;
  }

  if (msg.type === "audio") {
    const { bytes, mimeType } = await downloadMedia(msg.mediaId);

    const path = `${g.id}/voice-note-${Date.now()}.ogg`;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: mimeType, upsert: true });
    if (uploadError) throw uploadError;

    const transcript = await transcribeAndTranslate(bytes);

    if (!transcript) {
      await update(supabase, g.id, {
        audio_url: path,
        description_original: "[voice note, needs manual transcription]",
        description_translated: "[voice note, needs manual transcription]",
        description_language: "unknown",
        stage: "awaiting_evidence",
      });
      await sendText(g.wa_phone_number, copy.TRANSCRIPTION_UNAVAILABLE);
      await sendEvidencePrompt(g.wa_phone_number);
      return;
    }

    await update(supabase, g.id, {
      audio_url: path,
      description_original: transcript.originalText,
      description_translated: transcript.translatedText,
      description_language: "auto-detected",
      stage: "awaiting_description_confirm",
    });
    await sendConfirmPrompt(g.wa_phone_number, transcript.translatedText);
    return;
  }

  await sendText(g.wa_phone_number, copy.DESCRIPTION_NUDGE);
}

async function handleDescriptionConfirm(
  supabase: SupabaseClient,
  g: Grievance,
  msg: ParsedMessage,
) {
  const confirmed =
    msg.type === "selection" && msg.selectionId === copy.TRANSCRIPT_CONFIRM_YES.id;
  const redo =
    msg.type === "selection" && msg.selectionId === copy.TRANSCRIPT_CONFIRM_REDO.id;

  if (confirmed) {
    await update(supabase, g.id, {
      description_confirmed: true,
      stage: "awaiting_evidence",
    });
    await sendEvidencePrompt(g.wa_phone_number);
    return;
  }

  if (redo) {
    await update(supabase, g.id, {
      description_original: null,
      description_translated: null,
      description_language: null,
      stage: "awaiting_description",
    });
    await sendText(g.wa_phone_number, copy.TRANSCRIPT_REDO_PROMPT);
    return;
  }

  await sendConfirmPrompt(g.wa_phone_number, g.description_translated ?? "");
}

async function handleEvidence(
  supabase: SupabaseClient,
  g: Grievance,
  msg: ParsedMessage,
) {
  const done =
    (msg.type === "selection" &&
      (msg.selectionId === copy.EVIDENCE_SKIP_BUTTON.id ||
        msg.selectionId === copy.EVIDENCE_DONE_BUTTON.id)) ||
    (msg.type === "text" && /^\s*(skip|done)\b/i.test(msg.text));

  if (done) {
    await update(supabase, g.id, { stage: "completed" });
    await sendText(g.wa_phone_number, copy.confirmationMessage(g.reference_code));
    return;
  }

  if (msg.type === "image") {
    const { bytes, mimeType } = await downloadMedia(msg.mediaId);
    const ext = mimeType.includes("png") ? "png" : "jpg";
    const path = `${g.id}/evidence-${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: mimeType, upsert: true });
    if (uploadError) throw uploadError;

    const updatedUrls = [...(g.evidence_urls ?? []), path];
    await update(supabase, g.id, { evidence_urls: updatedUrls });

    await sendButtons(g.wa_phone_number, copy.EVIDENCE_RECEIVED_NUDGE, [
      copy.EVIDENCE_DONE_BUTTON,
    ]);
    return;
  }

  await sendEvidencePrompt(g.wa_phone_number);
}
