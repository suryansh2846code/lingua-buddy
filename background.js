// Lingua Buddy — service worker
// Handles all Groq API calls (translate + ask) on behalf of the content script.

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-oss-120b";

// Optional personal fallback key. Leave empty and set your key in the Settings
// page (stored in chrome.storage.local) — never commit a real key here.
const FALLBACK_API_KEY = "";

// --- Groq call --------------------------------------------------------------
async function callGroq(messages) {
  const { groqApiKey, groqModel } = await chrome.storage.local.get(["groqApiKey", "groqModel"]);
  const key = groqApiKey || FALLBACK_API_KEY;
  if (!key) {
    throw new Error("No Groq API key set. Click the extension icon → Options and paste your key.");
  }
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: groqModel || DEFAULT_MODEL,
      messages,
      temperature: 0.2,
      max_tokens: 1024,
    }),
  });

  if (!res.ok) {
    let detail = "";
    try {
      const err = await res.json();
      detail = err?.error?.message || JSON.stringify(err);
    } catch (_) {
      detail = await res.text();
    }
    throw new Error(`Groq error ${res.status}: ${detail}`);
  }

  const data = await res.json();
  return data?.choices?.[0]?.message?.content?.trim() || "(empty reply)";
}

// --- Message router ---------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "translate") {
    const sys =
      "You are a precise translation engine. Translate the user's text into " +
      `${msg.targetLang}. Reply with ONLY the translation — no quotes, no notes, ` +
      "no explanations. Preserve line breaks and tone.";
    callGroq([
      { role: "system", content: sys },
      { role: "user", content: msg.text },
    ])
      .then((out) => sendResponse({ ok: true, text: out }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true; // async
  }

  if (msg.type === "ask") {
    const sys =
      "You are Lingua Buddy, a friendly, concise assistant living on the user's " +
      "screen. Answer briefly (a few sentences max unless asked for detail). If the " +
      "user selected some text as context, use it. Earlier messages are prior turns " +
      "of this same conversation — stay consistent with them.";
    const userContent = msg.context
      ? `Selected text:\n"""${msg.context}"""\n\nQuestion: ${msg.question}`
      : msg.question;
    const history = Array.isArray(msg.history) ? msg.history : [];
    callGroq([
      { role: "system", content: sys },
      ...history,
      { role: "user", content: userContent },
    ])
      .then((out) => sendResponse({ ok: true, text: out }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true; // async
  }

  return false;
});
