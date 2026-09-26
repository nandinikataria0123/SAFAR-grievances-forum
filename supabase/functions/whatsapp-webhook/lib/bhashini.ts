// Bhashini ASR (speech to text) + translation, chained into one call:
// audio in a worker's language in, English text out.
//
// Bhashini uses a two-step "pipeline" pattern: ask its config service
// which models and endpoint to use, then send the audio to that
// endpoint. The shape below matches ULCA's documented pipeline API as
// of early 2026 (bhashini.gov.in). Verify this against the live docs
// once you have real credentials. It has changed before and it can
// change again; the useful thing to preserve if it does is the
// two-call shape (getModelsPipeline, then the returned callbackUrl).
//
// If Bhashini isn't configured, or the call fails, this returns null
// rather than throwing, so a voice note still gets saved with its
// audio file even if the transcript has to be filled in by hand.

const ULCA_CONFIG_URL =
  "https://meity-auth.ulcacontrib.org/ulca/apis/v0/model/getModelsPipeline";

// A fixed pipeline id Bhashini publishes for ASR + translation chains.
// Confirm this is still current when you set up real credentials;
// their docs list the active pipeline ids.
const PIPELINE_ID = "64392f96daac500b55c543cd";

interface TranscribeResult {
  originalText: string;
  translatedText: string;
}

function isConfigured() {
  return Boolean(
    Deno.env.get("BHASHINI_USER_ID") &&
      Deno.env.get("BHASHINI_API_KEY") &&
      Deno.env.get("BHASHINI_AUTH_TOKEN"),
  );
}

export async function transcribeAndTranslate(
  audioBytes: Uint8Array,
  sourceLang?: string,
): Promise<TranscribeResult | null> {
  if (!isConfigured()) {
    console.warn("Bhashini not configured, skipping transcription.");
    return null;
  }

  const lang = sourceLang || Deno.env.get("BHASHINI_SOURCE_LANG") || "hi";
  const userId = Deno.env.get("BHASHINI_USER_ID")!;
  const apiKey = Deno.env.get("BHASHINI_API_KEY")!;
  const authToken = Deno.env.get("BHASHINI_AUTH_TOKEN")!;

  try {
    // Step 1: ask which ASR + translation service to call, and how.
    const configRes = await fetch(ULCA_CONFIG_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        userID: userId,
        ulcaApiKey: apiKey,
      },
      body: JSON.stringify({
        pipelineTasks: [
          { taskType: "asr", config: { language: { sourceLanguage: lang } } },
          {
            taskType: "translation",
            config: {
              language: { sourceLanguage: lang, targetLanguage: "en" },
            },
          },
        ],
        pipelineRequestConfig: { pipelineId: PIPELINE_ID },
      }),
    });

    if (!configRes.ok) {
      console.error("Bhashini config call failed", configRes.status);
      return null;
    }

    const config = await configRes.json();
    const callbackUrl = config?.pipelineInferenceAPIEndPoint?.callbackUrl;
    const inferenceApiKey =
      config?.pipelineInferenceAPIEndPoint?.inferenceApiKey?.value;
    const asrServiceId =
      config?.pipelineResponseConfig?.[0]?.config?.[0]?.serviceId;
    const translationServiceId =
      config?.pipelineResponseConfig?.[1]?.config?.[0]?.serviceId;

    if (!callbackUrl || !inferenceApiKey) {
      console.error("Bhashini config response missing endpoint/key", config);
      return null;
    }

    // Step 2: send the audio through that pipeline.
    const audioBase64 = base64Encode(audioBytes);
    const inferRes = await fetch(callbackUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: inferenceApiKey,
      },
      body: JSON.stringify({
        pipelineTasks: [
          {
            taskType: "asr",
            config: { language: { sourceLanguage: lang }, serviceId: asrServiceId },
          },
          {
            taskType: "translation",
            config: {
              language: { sourceLanguage: lang, targetLanguage: "en" },
              serviceId: translationServiceId,
            },
          },
        ],
        inputData: { audio: [{ audioContent: audioBase64 }] },
      }),
    });

    if (!inferRes.ok) {
      console.error("Bhashini inference call failed", inferRes.status);
      return null;
    }

    const result = await inferRes.json();
    const originalText = result?.pipelineResponse?.[0]?.output?.[0]?.source;
    const translatedText = result?.pipelineResponse?.[1]?.output?.[0]?.target;

    if (!originalText || !translatedText) {
      console.error("Bhashini response missing text", result);
      return null;
    }

    return { originalText, translatedText };
  } catch (err) {
    console.error("Bhashini call threw", err);
    return null;
  }
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
