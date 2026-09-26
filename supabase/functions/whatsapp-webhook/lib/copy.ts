// All the bot's wording lives here, separate from the logic that
// decides when to send it. Edit freely, including the reason and
// platform lists, without touching state-machine.ts.
//
// Rows use ids, not the visible label, as the stored value (see
// REASONS / PLATFORMS below) so relabelling here never breaks old
// records or the export.

export const CONSENT_PROMPT =
  "Namaste. This is SAFAR, a grievance line for gig and platform " +
  "workers. I will ask a few quick questions and help file this with " +
  "Karnataka's IPGRS system. Your name and number stay with our " +
  "research team only.";

export const CONSENT_BUTTON = { id: "consent_yes", title: "Yes, let's go" };

export const REASON_PROMPT = "What would you like to report?";
export const REASON_LIST_BUTTON = "Select a reason";

// Keep in sync with IPGRS's own grievance categories where possible,
// so a filed case maps over without re-categorising by hand.
export const REASONS = [
  { id: "payment_not_received", title: "Payment not received" },
  { id: "account_blocked", title: "Sudden account block" },
  { id: "unsafe_conditions", title: "Unsafe working conditions" },
  { id: "harassment", title: "Harassment or discrimination" },
  { id: "other_reason", title: "Other" },
];

export const PLATFORM_PROMPT = "Which platform is this about?";
export const PLATFORM_LIST_BUTTON = "Select a platform";

export const PLATFORMS = [
  { id: "swiggy", title: "Swiggy" },
  { id: "zomato", title: "Zomato" },
  { id: "rapido", title: "Rapido" },
  { id: "uber", title: "Uber" },
  { id: "ola", title: "Ola" },
  { id: "other_platform", title: "Other" },
];

export const DESCRIPTION_PROMPT =
  "Tell me what happened, in your own words. Type it, or send a " +
  "voice note in Kannada, Hindi, or English, whichever is easier.";

export const DESCRIPTION_NUDGE =
  "You can type a message or send a voice note whenever you're ready.";

export function transcriptConfirmPrompt(translatedText: string) {
  return (
    `Here is what I understood, translated to English: "${translatedText}". ` +
    "Does that sound right?"
  );
}

export const TRANSCRIPT_CONFIRM_YES = {
  id: "description_confirmed",
  title: "Yes, that's right",
};
export const TRANSCRIPT_CONFIRM_REDO = {
  id: "description_redo",
  title: "Let me redo this",
};
export const TRANSCRIPT_REDO_PROMPT =
  "No problem. Send it again, typed or as a voice note.";

export const TRANSCRIPTION_UNAVAILABLE =
  "Got your voice note. Our team will listen to it and add the " +
  "details by hand, since automatic transcription isn't set up yet.";

export const EVIDENCE_PROMPT =
  "Any screenshots as proof, like the app's earnings page or your " +
  "chat with support? Send them now, or skip.";
export const EVIDENCE_SKIP_BUTTON = { id: "evidence_skip", title: "Skip, I don't have any" };
export const EVIDENCE_DONE_BUTTON = { id: "evidence_done", title: "That's all" };
export const EVIDENCE_RECEIVED_NUDGE =
  "Got it. Send more, or tap done when you're finished.";

export function confirmationMessage(referenceCode: string) {
  return (
    `Thank you. Your report is saved as ${referenceCode}. Our team ` +
    "reviews these weekly and will help file eligible cases with " +
    "IPGRS. Message this number anytime to check the status."
  );
}

export const FALLBACK_NUDGE =
  "Sorry, I didn't follow that. Could you try again?";
