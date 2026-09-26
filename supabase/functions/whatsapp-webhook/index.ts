// Entry point for the WhatsApp Cloud API webhook. Meta calls this
// twice: once with GET, to verify the endpoint when you first set up
// the webhook in the Meta dashboard, and then with POST for every
// message, delivery status, and read receipt afterwards.
//
// Deploy: supabase functions deploy whatsapp-webhook --no-verify-jwt
// (--no-verify-jwt because Meta calls this directly, not through
// Supabase auth)

import { getSupabaseClient } from "./lib/supabase-client.ts";
import { verifySignature } from "./lib/whatsapp.ts";
import { handleIncomingMessage } from "./lib/state-machine.ts";
import type { ParsedMessage } from "./lib/types.ts";

Deno.serve(async (req) => {
  if (req.method === "GET") {
    return handleVerification(req);
  }

  if (req.method === "POST") {
    return handleIncoming(req);
  }

  return new Response("Method not allowed", { status: 405 });
});

function handleVerification(req: Request): Response {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const expected = Deno.env.get("META_VERIFY_TOKEN");

  if (mode === "subscribe" && token && expected && token === expected) {
    return new Response(challenge ?? "", { status: 200 });
  }

  return new Response("Forbidden", { status: 403 });
}

async function handleIncoming(req: Request): Promise<Response> {
  const rawBody = await req.text();

  const signatureOk = await verifySignature(
    rawBody,
    req.headers.get("x-hub-signature-256"),
  );
  if (!signatureOk) {
    console.error("Webhook signature check failed");
    return new Response("Forbidden", { status: 403 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  // Meta expects a fast 200 regardless of what's inside, or it starts
  // retrying and eventually disables the webhook. Do the real work,
  // but never let it turn into a non-200 response.
  try {
    await processPayload(payload);
  } catch (err) {
    console.error("Error processing webhook payload", err);
  }

  return new Response("OK", { status: 200 });
}

async function processPayload(payload: unknown) {
  // deno-lint-ignore no-explicit-any
  const value = (payload as any)?.entry?.[0]?.changes?.[0]?.value;
  const message = value?.messages?.[0];

  // No "messages" array means this is a status update (sent/delivered/
  // read) rather than an incoming message. Nothing to do.
  if (!message) return;

  const phone: string = message.from;
  const profileName: string | undefined = value?.contacts?.[0]?.profile?.name;
  const parsed = parseMessage(message);

  if (parsed.type === "unsupported") {
    console.warn("Unsupported message type from", phone, message.type);
    return;
  }

  const supabase = getSupabaseClient();
  await handleIncomingMessage(supabase, phone, profileName, parsed);
}

// deno-lint-ignore no-explicit-any
function parseMessage(message: any): ParsedMessage {
  switch (message.type) {
    case "text":
      return { type: "text", text: message.text?.body ?? "" };

    case "interactive": {
      const interactive = message.interactive;
      if (interactive?.type === "button_reply") {
        return {
          type: "selection",
          selectionId: interactive.button_reply.id,
          selectionTitle: interactive.button_reply.title,
        };
      }
      if (interactive?.type === "list_reply") {
        return {
          type: "selection",
          selectionId: interactive.list_reply.id,
          selectionTitle: interactive.list_reply.title,
        };
      }
      return { type: "unsupported" };
    }

    case "audio":
      return {
        type: "audio",
        mediaId: message.audio.id,
        mimeType: message.audio.mime_type,
      };

    case "image":
      return {
        type: "image",
        mediaId: message.image.id,
        mimeType: message.image.mime_type,
      };

    default:
      return { type: "unsupported" };
  }
}
