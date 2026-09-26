export type Stage =
  | "awaiting_consent"
  | "awaiting_reason"
  | "awaiting_platform"
  | "awaiting_description"
  | "awaiting_description_confirm"
  | "awaiting_evidence"
  | "completed";

export interface Grievance {
  id: string;
  wa_phone_number: string;
  wa_profile_name: string | null;
  reference_code: string;
  stage: Stage;
  consent_at: string | null;
  reason: string | null;
  platform: string | null;
  description_original: string | null;
  description_language: string | null;
  description_translated: string | null;
  description_confirmed: boolean;
  audio_url: string | null;
  evidence_urls: string[];
  status: string;
  created_at: string;
  updated_at: string;
}

// A normalised view of whatever shape Meta sent us, so the state
// machine doesn't need to know about WhatsApp's raw payload format.
export type ParsedMessage =
  | { type: "text"; text: string }
  | { type: "selection"; selectionId: string; selectionTitle: string }
  | { type: "audio"; mediaId: string; mimeType: string }
  | { type: "image"; mediaId: string; mimeType: string }
  | { type: "unsupported" };
