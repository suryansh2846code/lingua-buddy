# Lingua Buddy

A minimal on-page translator for Chrome. A slim silver **capsule** rides the
right edge of every tab; hover it and it unfolds into three controls —
**language**, **translate**, and **clipboard**. Select text, translate it, and
the capsule morphs into a unified bar with the result. Powered by the
[Groq](https://groq.com) chat API.

## Features

- **Capsule deck** — a transparent, draggable capsule fixed to the right edge.
  Hover to expand into language / translate / clipboard; drag it up and down.
- **Translate a selection** into any of 9 languages; the deck morphs into a
  result bar with a **Copy** button and a **follow-up ask** input.
- **Ask** quick questions with short rolling memory (last 5 messages).
- **Clipboard** — your last 10 results (translations, answers, and anything you
  copy with Cmd/Ctrl+C), each with one-click Copy.
- **Works on locked-down sites** — CSP- and Trusted-Types-safe rendering.
- Language, position, memory, and clipboard all persist across reloads.

## Setup

1. Get a free API key at <https://console.groq.com/keys>.
2. Go to `chrome://extensions`, enable **Developer mode** (top right).
3. Click **Load unpacked** and pick this `lingua-buddy` folder.
4. Click the extension icon → **Settings**, paste your Groq key, and Save.
   The key is stored in `chrome.storage.local` (your browser only).

## Use

1. On any page, **hover the capsule** on the right edge — it unfolds.
2. Pick a target **language** (top), then **select text** and click the middle
   **Translate** button. The deck morphs into the result bar.
3. Type in the **"Ask a follow-up…"** field to ask about the selection.
4. Open the **clipboard** (bottom) for your last 10 results; **Copy** any one.
5. **Drag** the capsule vertically to reposition it.

## Configuration

The capsule is sized by CSS variables on the shadow host (in `content.js`):

```css
--capsule-width   --capsule-height   --capsule-border
--capsule-color   --capsule-color-hover
```

Default model is `openai/gpt-oss-120b` (change it in **Settings**). Requests use
`reasoning_effort: "low"` so the reasoning model doesn't starve the answer.

## Security

No API key is committed to this repository. Provide your own via **Settings**;
it never leaves your browser. Never hardcode a key in `background.js`.
