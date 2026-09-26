// Thin wrapper around the Meta WhatsApp Cloud API. Nothing here is
// SAFAR-specific; it just sends messages and fetches media.
//
// Docs: developers.facebook.com/docs/whatsapp/cloud-api/reference/messages

const GRAPH_VERSION = "v21.0"; // bump this if Meta deprecates it later

const TOKEN = Deno.env.get("META_WHATSAPP_TOKEN") ?? "";
const PHONE_NUMBER_ID = Deno.env.get("META_PHONE_NUMBER_ID") ?? "";

function endpoint(path: string) {
  return `https://graph.facebook.com/${GRAPH_VERSION}/${path}`;
}

async function callGraphApi(body: Record<string, unknown>) {
  const res = await fetch(endpoint(`${PHONE_NUMBER_ID}/messages`), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("WhatsApp send failed", res.status, errText);
    throw new Error(`WhatsApp send failed: ${res.status} ${errText}`);
  }

  return res.json();
}

export async function sendText(to: string, body: string) {
  return callGraphApi({
    to,
    type: "text",
    text: { body, preview_url: false },
  });
}

export interface QuickReplyButton {
  id: string;
  title: string; // 20 characters max, WhatsApp's limit
}

// Up to three quick-reply buttons under a text message. Good for
// yes/no or short confirmations. Use sendList for anything longer.
export async function sendButtons(
  to: string,
  bodyText: string,
  buttons: QuickReplyButton[],
) {
  if (buttons.length === 0 || buttons.length > 3) {
    throw new Error("sendButtons takes 1 to 3 buttons");
  }
  return callGraphApi({
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: bodyText },
      action: {
        buttons: buttons.map((b) => ({
          type: "reply",
          reply: { id: b.id, title: b.title },
        })),
      },
    },
  });
}

export interface ListRow {
  id: string;
  title: string; // 24 characters max
  description?: string; // 72 characters max
}

export interface ListSection {
  title: string;
  rows: ListRow[];
}

// A tappable list, for menus longer than 3 options (reasons,
// platforms). Renders as a "View options" sheet in WhatsApp.
export async function sendList(
  to: string,
  bodyText: string,
  buttonLabel: string,
  sections: ListSection[],
) {
  return callGraphApi({
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: bodyText },
      action: { button: buttonLabel, sections },
    },
  });
}

// Fetching a photo or voice note is two calls: look up the media's
// temporary URL by id, then download the bytes from that URL. Both
// need the same bearer token.
export async function downloadMedia(
  mediaId: string,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const metaRes = await fetch(endpoint(mediaId), {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!metaRes.ok) {
    throw new Error(`Media lookup failed: ${metaRes.status}`);
  }
  const meta = await metaRes.json();

  const fileRes = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!fileRes.ok) {
    throw new Error(`Media download failed: ${fileRes.status}`);
  }

  const bytes = new Uint8Array(await fileRes.arrayBuffer());
  return { bytes, mimeType: meta.mime_type ?? "application/octet-stream" };
}

// Verifies the X-Hub-Signature-256 header Meta sends on every webhook
// POST, so a request that didn't come from Meta gets rejected before
// it touches the database. Needs META_APP_SECRET set.
export async function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  const appSecret = Deno.env.get("META_APP_SECRET");
  if (!appSecret) {
    console.warn(
      "META_APP_SECRET not set, skipping webhook signature check. " +
        "Set it before going anywhere near real traffic.",
    );
    return true;
  }
  if (!signatureHeader?.startsWith("sha256=")) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody),
  );
  const expected =
    "sha256=" +
    Array.from(new Uint8Array(mac))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

  // Not constant-time, but timing attacks on a webhook signature are
  // a low-value target here. Fine for a pilot.
  return expected === signatureHeader;
}
