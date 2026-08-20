// Lingua Buddy — content script
// A compact floating deck (bottom-right, every tab). Hover to grow it into
// [ language · translate · clipboard ]. Select text + click Translate and the
// deck morphs into one unified black/silver bar showing the result.

(() => {
  if (window.top !== window.self) return; // top frame only, not iframes
  if (window.__linguaBuddyLoaded) return;
  window.__linguaBuddyLoaded = true;

  const LANGS = [
    ["English", "EN"], ["Hindi", "HI"], ["Bengali", "BN"], ["Roman Bengali", "RBN"],
    ["Spanish", "ES"], ["French", "FR"], ["German", "DE"], ["Japanese", "JA"],
    ["Chinese", "ZH"], ["Arabic", "AR"],
  ];
  const MAX_HISTORY = 5;
  const MAX_CLIP = 20;

  let host, root, deck, menu, clipPanel, result, resultText, langLabel, askInput;
  let currentLang = "English";
  let suppressClick = false;
  let lastSelection = "";
  let history = [];
  let clip = [];

  const codeOf = (name) => (LANGS.find((l) => l[0] === name) || ["", "?"])[1];

  // ---- Trusted-Types-safe DOM builder (no innerHTML) ------------------------
  function el(tag, props, children) {
    const n = document.createElement(tag);
    if (props) for (const k in props) {
      const v = props[k];
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v != null) n.setAttribute(k, v);
    }
    if (children != null) (Array.isArray(children) ? children : [children]).forEach((c) => {
      if (c != null) n.appendChild(typeof c === "object" ? c : document.createTextNode(String(c)));
    });
    return n;
  }
  const NS = "http://www.w3.org/2000/svg";
  function icon(parts, w) {
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("fill", "none");
    s.setAttribute("stroke", "currentColor");
    s.setAttribute("stroke-width", w || "1.7");
    s.setAttribute("stroke-linecap", "round");
    s.setAttribute("stroke-linejoin", "round");
    parts.forEach(([t, a]) => {
      const p = document.createElementNS(NS, t);
      for (const k in a) p.setAttribute(k, a[k]);
      s.appendChild(p);
    });
    return s;
  }
  const iGlobe = () => icon([["circle", { cx: 12, cy: 12, r: 9 }], ["path", { d: "M3 12h18" }],
    ["path", { d: "M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" }]]);
  const iClip = () => icon([["rect", { x: 6.5, y: 4.5, width: 11, height: 15, rx: 2 }],
    ["path", { d: "M9.5 4.5h5v2.5h-5z" }], ["path", { d: "M9 11h6M9 14.5h4" }]]);
  const iSend = () => icon([["path", { d: "M4 12h14M12 6l6 6-6 6" }]]);
  const iChevron = () => icon([["path", { d: "M6 9l6 6 6-6" }]], "2");
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); };

  // ---- Build ----------------------------------------------------------------
  function build() {
    host = document.createElement("div");
    host.id = "lingua-buddy-host";
    host.style.all = "initial";
    host.style.position = "fixed";
    host.style.right = "10px"; // near the right edge (full capsule visible)
    host.style.top = "50%";
    host.style.transform = "translateY(-50%)";
    host.style.zIndex = "2147483647";
    root = host.attachShadow({ mode: "open" });

    // Deck segments
    const tip = (t) => el("span", { class: "lb-seg-tip", text: t });
    langLabel = el("span", { class: "lb-lang-code", text: codeOf(currentLang) });
    const langBtn = el("button", { class: "lb-seg lb-lang", title: "Target language", onClick: (e) => { e.stopPropagation(); toggleMenu(); } }, [tip("Change language"), langLabel, el("span", { class: "lb-arrow" }, iChevron())]);
    const transBtn = el("button", { class: "lb-seg lb-trans", title: "Translate selection", onClick: (e) => { e.stopPropagation(); onTranslate(); } }, [tip("Translate"), el("span", { class: "lb-ico" }, iGlobe())]);
    const clipBtn = el("button", { class: "lb-seg lb-clip-btn", title: "Clipboard", onClick: (e) => { e.stopPropagation(); toggleClip(); } }, [tip("Clipboard"), el("span", { class: "lb-ico" }, iClip())]);
    // Vertical stack: language (top) · translate (middle, larger) · clipboard (bottom)
    deck = el("div", { class: "lb-deck", id: "deck" }, [langBtn, transBtn, clipBtn]);

    // Menu (language chooser) + clipboard panel (popups above the deck)
    menu = el("div", { class: "lb-menu", id: "menu", hidden: "" });
    clipPanel = el("div", { class: "lb-clip", id: "clip", hidden: "" });

    // Unified result bar (morph target)
    resultText = el("div", { class: "lb-result-text", text: "" });
    const copyBtn = el("button", { class: "lb-mini", title: "Copy", onClick: () => copyText(resultText.textContent, copyBtn) }, "Copy");
    const gearBtn = el("button", { class: "lb-mini", title: "Settings (API key)", text: "⚙", onClick: () => chrome.runtime.sendMessage({ type: "openOptions" }) });
    const closeBtn = el("button", { class: "lb-mini lb-x", title: "Close", text: "✕", onClick: closeResult });
    askInput = el("input", { class: "lb-ask-input", type: "text", placeholder: "Ask a follow-up…", onKeydown: (e) => { if (e.key === "Enter") onAsk(); } });
    const sendBtn = el("button", { class: "lb-ask-send", title: "Ask", onClick: onAsk }, el("span", { class: "lb-ico" }, iSend()));
    result = el("div", { class: "lb-result", id: "result", hidden: "" }, [
      el("div", { class: "lb-result-top" }, [resultText, copyBtn, gearBtn, closeBtn]),
      el("div", { class: "lb-ask-row" }, [askInput, sendBtn]),
    ]);

    const stack = el("div", { class: "lb-stack" }, [menu, clipPanel, deck, result]);
    const rootWrap = el("div", { class: "lb-root", part: "root" }, stack);

    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      root.adoptedStyleSheets = [sheet];
    } catch (_) {
      root.appendChild(Object.assign(document.createElement("style"), { textContent: CSS }));
    }
    root.appendChild(rootWrap);
    (document.documentElement || document.body).appendChild(host);

    chrome.storage.local.get(["lb_history", "lb_clipboard", "lb_lang", "lb_pos_y"], (d) => {
      if (Array.isArray(d.lb_history)) history = d.lb_history.slice(-MAX_HISTORY);
      if (Array.isArray(d.lb_clipboard)) clip = d.lb_clipboard.slice(0, MAX_CLIP);
      if (d.lb_lang && codeOf(d.lb_lang) !== "?") { currentLang = d.lb_lang; langLabel.textContent = codeOf(currentLang); }
      if (typeof d.lb_pos_y === "number") setTop(d.lb_pos_y);
    });

    makeVerticalDrag(deck);
  }

  // Drag the tab up/down along the right edge (x is fixed to the edge).
  function setTop(y) {
    const h = host.offsetHeight || 58;
    y = Math.max(6, Math.min((window.innerHeight || 800) - h - 6, y));
    host.style.top = y + "px";
    host.style.bottom = "auto";
    host.style.transform = "none";
  }
  // Drag from anywhere on the deck (even over buttons / when open). A press that
  // moves >4px vertically is a drag; a press that doesn't move is a normal click.
  function makeVerticalDrag(el) {
    let pending = false, dragging = false, startY = 0, startTop = 0;
    el.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      pending = true; dragging = false;
      startY = e.clientY;
      startTop = host.getBoundingClientRect().top;
    });
    window.addEventListener("mousemove", (e) => {
      if (!pending) return;
      if (!dragging && Math.abs(e.clientY - startY) < 4) return;
      dragging = true;
      deck.classList.add("dragging");
      setTop(startTop + (e.clientY - startY));
    });
    window.addEventListener("mouseup", () => {
      if (!pending) return;
      pending = false;
      if (dragging) {
        deck.classList.remove("dragging");
        chrome.storage.local.set({ lb_pos_y: parseInt(host.style.top, 10) || 0 });
        suppressClick = true;
        setTimeout(() => (suppressClick = false), 0);
      }
    });
    // Swallow the click that follows a drag so buttons don't fire.
    el.addEventListener("click", (e) => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); } }, true);
  }

  // Keep the deck expanded while a dropdown is open (so it doesn't collapse
  // when the cursor moves off the deck onto the menu).
  function refreshPin() { if (deck) deck.classList.toggle("pinned", (menu && !menu.hidden) || (clipPanel && !clipPanel.hidden)); }

  // ---- Language menu --------------------------------------------------------
  function langEl() { return root.querySelector(".lb-lang"); }
  function hideMenu() { if (menu) menu.hidden = true; const l = langEl(); if (l) l.classList.remove("open"); refreshPin(); }
  function toggleMenu() {
    if (!menu.hidden) { hideMenu(); return; }
    hideClip();
    clear(menu);
    menu.appendChild(el("div", { class: "lb-pop-head", text: "Translate to" }));
    const grid = el("div", { class: "lb-lang-grid" });
    LANGS.forEach(([name, code]) => {
      grid.appendChild(el("button", {
        class: "lb-lang-chip" + (name === currentLang ? " on" : ""),
        onClick: () => {
          currentLang = name;
          langLabel.textContent = code;
          chrome.storage.local.set({ lb_lang: name });
          hideMenu();
        },
      }, [el("span", { class: "lb-lang-c", text: code }), el("span", { text: name })]));
    });
    menu.appendChild(grid);
    menu.hidden = false;
    const l = langEl(); if (l) l.classList.add("open");
    refreshPin();
  }

  // ---- Clipboard ------------------------------------------------------------
  function hideClip() { if (clipPanel) clipPanel.hidden = true; refreshPin(); }
  function toggleClip() {
    if (!clipPanel.hidden) { clipPanel.hidden = true; refreshPin(); return; }
    hideMenu();
    // Always load the latest shared list from storage when opening, so every
    // site/tab shows the same clipboard.
    chrome.storage.local.get("lb_clipboard", (d) => {
      clip = Array.isArray(d.lb_clipboard) ? d.lb_clipboard.slice(0, MAX_CLIP) : [];
      renderClip();
      clipPanel.hidden = false;
      refreshPin();
    });
  }
  function snippet(s) { s = (s || "").replace(/\s+/g, " ").trim(); return s.length > 42 ? s.slice(0, 42) + "…" : s; }
  function saveClip(label, text) {
    text = (text || "").trim();
    if (!text) return;
    // Storage-authoritative read-modify-write so concurrent tabs never clobber
    // each other. Move-to-top dedupe: re-copying existing text just bumps it up.
    chrome.storage.local.get("lb_clipboard", (d) => {
      let list = Array.isArray(d.lb_clipboard) ? d.lb_clipboard : [];
      list = list.filter((it) => it && it.text !== text);
      list.unshift({ label, text, ts: Date.now() });
      list = list.slice(0, MAX_CLIP);
      clip = list;
      chrome.storage.local.set({ lb_clipboard: list });
      if (clipPanel && !clipPanel.hidden) renderClip();
    });
  }
  function copyText(text, btn) {
    navigator.clipboard.writeText(text).then(
      () => {
        const o = btn.textContent;
        btn.textContent = "✓";
        btn.style.transform = "scale(1.18)";
        setTimeout(() => { btn.style.transform = ""; }, 160);
        setTimeout(() => (btn.textContent = o), 1100);
      },
      () => (btn.textContent = "✕")
    );
  }
  function renderClip() {
    clear(clipPanel);
    const refreshBtn = el("button", { class: "lb-mini", title: "Refresh from clipboard history", text: "⟳", onClick: () => {
      chrome.storage.local.get("lb_clipboard", (d) => { clip = Array.isArray(d.lb_clipboard) ? d.lb_clipboard.slice(0, MAX_CLIP) : []; renderClip(); });
    } });
    const clearBtn = el("button", { class: "lb-mini", text: "Clear", onClick: () => { clip = []; chrome.storage.local.set({ lb_clipboard: clip }); renderClip(); } });
    const x = el("button", { class: "lb-mini lb-x", text: "✕", onClick: hideClip });
    clipPanel.appendChild(el("div", { class: "lb-pop-head lb-clip-head" }, [el("span", { text: `Last ${MAX_CLIP}` }), el("span", { class: "lb-clip-actions" }, [refreshBtn, clearBtn, x])]));
    if (!clip.length) { clipPanel.appendChild(el("div", { class: "lb-clip-empty", text: "Copy any text (Cmd/Ctrl+C) and it appears here." })); return; }
    clip.forEach((item) => {
      const c = el("button", { class: "lb-mini", text: "Copy" });
      c.addEventListener("click", () => copyText(item.text, c));
      clipPanel.appendChild(el("div", { class: "lb-clip-item" }, [
        el("div", { class: "lb-clip-info" }, [el("div", { class: "lb-clip-text", text: item.text })]),
        c,
      ]));
    });
  }

  // ---- Result (unified bar) -------------------------------------------------
  function openResult() { hideMenu(); hideClip(); deck.hidden = true; result.hidden = false; }
  function closeResult() { result.hidden = true; deck.hidden = false; resultText.textContent = ""; }
  function showResult(text, loading) { result.classList.toggle("loading", !!loading); resultText.textContent = text; }

  function onTranslate() {
    const sel = (lastSelection || "").trim();
    openResult();
    if (!sel) { showResult("Select some text on the page, then tap Translate. Or just ask below 👇", false); setTimeout(() => askInput.focus(), 60); return; }
    showResult("…", true);
    chrome.runtime.sendMessage({ type: "translate", text: sel, targetLang: currentLang }, (resp) => {
      handled(resp);
    });
  }
  function onAsk() {
    const q = askInput.value.trim();
    if (!q) return;
    askInput.value = "";
    openResult();
    showResult("…", true);
    chrome.runtime.sendMessage({ type: "ask", question: q, context: lastSelection || "", history }, (resp) => {
      if (handled(resp)) {
        history.push({ role: "user", content: q });
        history.push({ role: "assistant", content: resp.text });
        history = history.slice(-MAX_HISTORY);
        chrome.storage.local.set({ lb_history: history });
      }
    });
  }
  function handled(resp) {
    if (chrome.runtime.lastError) { showResult("⚠️ " + chrome.runtime.lastError.message, false); return false; }
    if (!resp) { showResult("⚠️ No response.", false); return false; }
    if (resp.ok) { showResult(resp.text, false); return true; }
    showResult("⚠️ " + resp.error, false); return false;
  }

  // ---- Selection + copy tracking --------------------------------------------
  document.addEventListener("mouseup", (e) => {
    if (host && host.contains(e.target)) return;
    setTimeout(() => { const t = window.getSelection ? window.getSelection().toString().trim() : ""; if (t) lastSelection = t; }, 10);
  }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { hideMenu(); hideClip(); } }, true);
  document.addEventListener("mousedown", (e) => {
    if (!host || host.contains(e.target)) return;
    if (menu && !menu.hidden) hideMenu();
    if (clipPanel && !clipPanel.hidden) hideClip();
  }, true);
  document.addEventListener("copy", (e) => {
    if (host && host.contains(document.activeElement)) return;
    const fallback = getCopiedText(e); // capture synchronously, before selection can clear
    // The real system clipboard is most reliable (covers inputs & contenteditable);
    // fall back to the captured selection if reading it isn't permitted.
    setTimeout(() => {
      if (navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText().then(
          (t) => saveClip("📄 Copied", t && t.trim() ? t : fallback),
          () => saveClip("📄 Copied", fallback)
        );
      } else {
        saveClip("📄 Copied", fallback);
      }
    }, 0);
  }, true);

  // Keep every tab in sync — clipboard, language and memory are shared via
  // chrome.storage, so react to changes made in other tabs instead of each tab
  // holding a stale copy that clobbers the others on the next write.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.lb_clipboard) {
      const v = changes.lb_clipboard.newValue;
      clip = Array.isArray(v) ? v.slice(0, MAX_CLIP) : [];
      if (clipPanel && !clipPanel.hidden) renderClip();
    }
    if (changes.lb_history && Array.isArray(changes.lb_history.newValue)) {
      history = changes.lb_history.newValue.slice(-MAX_HISTORY);
    }
    if (changes.lb_lang && changes.lb_lang.newValue && codeOf(changes.lb_lang.newValue) !== "?") {
      currentLang = changes.lb_lang.newValue;
      if (langLabel) langLabel.textContent = codeOf(currentLang);
    }
  });

  // Best-effort read of what the user just copied, from any source.
  function getCopiedText(e) {
    const ae = document.activeElement;
    try {
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA") && ae.selectionStart != null) {
        const v = String(ae.value).slice(ae.selectionStart, ae.selectionEnd);
        if (v.trim()) return v;
      }
    } catch (_) {}
    const sel = window.getSelection ? window.getSelection().toString() : "";
    if (sel.trim()) return sel;
    try {
      const c = e && e.clipboardData && e.clipboardData.getData("text/plain");
      if (c && c.trim()) return c;
    } catch (_) {}
    return "";
  }

  // ---- Styles ---------------------------------------------------------------
  const CSS = `
    :host { all: initial; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif !important;
      --capsule-width: 10px; --capsule-height: 50px; --capsule-border: 1.5px;
      --capsule-color: rgba(170,170,178,.78); --capsule-color-hover: rgba(216,218,226,.98); }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    button { font: inherit; color: inherit; background: none; border: none; cursor: pointer; padding: 0; }
    .lb-stack { position: relative; display: flex; flex-direction: column; align-items: flex-end; }

    /* ===== Capsule / Deck ===== */
    /* Default: the vertical capsule OUTLINE — transparent, thin silver stroke, crisp */
    .lb-deck { position: relative; box-sizing: border-box; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 0;
      width: var(--capsule-width); height: var(--capsule-height);
      background: transparent; border: var(--capsule-border) solid var(--capsule-color);
      border-radius: 9999px; cursor: pointer; user-select: none;
      transform-origin: center center; will-change: transform;
      transition: transform .55s cubic-bezier(.16,1,.3,1), border-color .3s ease,
        width .42s cubic-bezier(.2,1,.25,1), height .42s cubic-bezier(.2,1,.25,1),
        gap .42s cubic-bezier(.2,1,.25,1), border-width .3s ease; }
    /* Invisible hit-area around the capsule so hover triggers reliably (no flicker).
       Extends the pointer target without changing the visible outline. */
    .lb-deck::before { content: ""; position: absolute; inset: -12px -14px; border-radius: 9999px; }
    /* Resting capsule fill: 50%-transparent grey (cleared when expanded) */
    .lb-deck:not(:hover):not(.pinned) { background: rgba(132,132,140,.5); }
    /* Hover / pinned: expand into the button deck (container goes invisible, buttons separate).
       Fixed height (not auto) so the box never collapses mid-transition and drops :hover. */
    .lb-deck:hover, .lb-deck.pinned { width: 56px; height: 152px; gap: 10px;
      border-color: transparent; border-width: 0; border-radius: 18px; cursor: grab; }
    .lb-deck:not(:hover):not(.pinned) .lb-seg { height: 0; width: 0; opacity: 0; transform: scale(.3); pointer-events: none; }
    /* Keep the capsule while dragging, even though the pointer is over it */
    .lb-deck.dragging { width: var(--capsule-width) !important; height: var(--capsule-height) !important;
      gap: 0 !important; border: var(--capsule-border) solid var(--capsule-color-hover) !important;
      border-radius: 9999px !important; background: rgba(132,132,140,.5) !important; cursor: grabbing; }
    .lb-deck.dragging .lb-seg { height: 0 !important; width: 0 !important; opacity: 0 !important; pointer-events: none; }

    /* Per-button label — appears to the left only when that button is hovered */
    .lb-seg-tip { position: absolute; right: calc(100% + 10px); top: 50%; white-space: nowrap;
      background: rgba(16,16,20,.96); border: 1px solid rgba(255,255,255,.1); color: #f0eff6;
      font-size: 12px; font-weight: 500; padding: 5px 10px; border-radius: 9px;
      box-shadow: 0 5px 16px rgba(0,0,0,.45); pointer-events: none; opacity: 0;
      transform: translateY(-50%) translateX(6px);
      transition: opacity .2s ease, transform .25s cubic-bezier(.2,1,.25,1); }
    .lb-seg:hover .lb-seg-tip { opacity: 1; transform: translateY(-50%) translateX(0); }

    /* Each button is its own closed, separated shape */
    .lb-seg { position: relative; display: flex; align-items: center; justify-content: center; color: #f0eff6; cursor: pointer;
      background: rgba(18,18,22,.92); border: 1px solid rgba(255,255,255,.10); flex: none;
      box-shadow: 0 5px 16px rgba(0,0,0,.42);
      backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
      transition: background .18s ease, height .35s cubic-bezier(.2,1,.25,1),
        width .35s cubic-bezier(.2,1,.25,1), opacity .3s ease, transform .35s cubic-bezier(.2,1,.25,1); }
    .lb-seg:hover { background: rgba(42,42,50,.95); }
    .lb-deck:hover .lb-seg:active, .lb-deck.pinned .lb-seg:active { transform: scale(.9); }
    .lb-ico { width: 18px; height: 18px; display: block; }

    /* Language (top) — small pill with code + arrow */
    .lb-lang { gap: 3px; height: 32px; padding: 0 11px; border-radius: 999px; }
    .lb-lang-code { font-size: 12px; font-weight: 700; letter-spacing: .02em; }
    /* Arrow is hidden by default; it reveals only when the language button is hovered (or the menu is open) */
    .lb-arrow { width: 13px; height: 13px; display: block; max-width: 0; opacity: 0; overflow: hidden;
      transition: max-width .25s cubic-bezier(.2,1,.25,1), opacity .2s ease, transform .3s ease; }
    .lb-lang:hover .lb-arrow, .lb-lang.open .lb-arrow { max-width: 13px; opacity: .7; }
    .lb-lang.open .lb-arrow { transform: rotate(180deg); }
    /* Translate (middle) — the big circle */
    .lb-trans { width: 48px; height: 48px; border-radius: 50%; }
    .lb-trans .lb-ico { width: 22px; height: 22px; }
    /* Clipboard (bottom) — small circle */
    .lb-clip-btn { width: 36px; height: 36px; border-radius: 50%; }
    .lb-clip-btn .lb-ico { width: 17px; height: 17px; }

    /* ===== Popups (menu / clipboard) above the deck ===== */
    .lb-menu, .lb-clip { position: absolute; right: calc(100% + 12px); top: 50%; transform: translateY(-50%);
      width: 264px; background: #0a0a0d; border: 1px solid rgba(255,255,255,.1); border-radius: 18px; padding: 12px;
      box-shadow: 0 16px 44px rgba(0,0,0,.55); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
      color: #fff; animation: lb-pop .22s cubic-bezier(.2,1,.25,1); }
    @keyframes lb-pop { from { opacity: 0; transform: translate(8px, -50%); } to { opacity: 1; transform: translateY(-50%); } }
    .lb-pop-head { font-size: 10.5px; letter-spacing: .16em; text-transform: uppercase; color: #7d7d8a;
      padding: 2px 4px 10px; display: flex; align-items: center; justify-content: space-between; }
    .lb-lang-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .lb-lang-chip { display: flex; align-items: center; gap: 8px; padding: 9px 10px; border-radius: 11px;
      background: #16161b; border: 1px solid rgba(255,255,255,.06); color: #eee; font-size: 13px; text-align: left; }
    .lb-lang-chip:hover { background: #23232c; }
    .lb-lang-chip.on { background: #2b2540; border-color: rgba(150,120,255,.5); }
    .lb-lang-c { font-size: 10px; font-weight: 700; color: #9a90ff; width: 20px; }

    /* ===== Clipboard list ===== */
    .lb-clip { width: 300px; max-height: 320px; overflow-y: auto; }
    .lb-clip-head { position: sticky; top: -12px; background: #0a0a0d; z-index: 1; }
    .lb-clip-actions { display: flex; gap: 6px; }
    .lb-clip-empty { font-size: 12.5px; color: #85858f; padding: 10px 4px; }
    .lb-clip-item { display: flex; gap: 8px; align-items: flex-start; padding: 9px 6px;
      border-top: 1px solid rgba(255,255,255,.06); border-radius: 8px;
      transition: background .15s ease; animation: lb-item-in .28s cubic-bezier(.2,1,.25,1) both; }
    .lb-clip-item:hover { background: rgba(255,255,255,.05); }
    @keyframes lb-item-in { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
    .lb-clip-info { flex: 1; min-width: 0; }
    .lb-clip-label { font-size: 10.5px; color: #9a90ff; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .lb-clip-text { font-size: 13px; line-height: 1.35; color: #e9e9ef; word-break: break-word;
      display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }

    .lb-mini { font-size: 12px; color: #cfcfe0; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1);
      border-radius: 8px; padding: 5px 10px; flex: none;
      transition: background .15s ease, color .15s ease, transform .14s cubic-bezier(.2,1.4,.4,1); }
    .lb-mini:hover { background: rgba(255,255,255,.14); color: #fff; transform: translateY(-1px); }
    .lb-mini:active { transform: scale(.9); }
    .lb-x { padding: 5px 9px; }

    /* ===== Unified result bar (morph) ===== */
    .lb-result { width: 340px; background: #0a0a0d; border: 1.4px solid rgba(198,200,210,.55);
      border-radius: 22px; padding: 14px 15px; color: #fff; box-shadow: 0 16px 46px rgba(0,0,0,.6);
      backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
      display: flex; flex-direction: column; gap: 11px; animation: lb-morph .34s cubic-bezier(.2,1,.25,1); }
    @keyframes lb-morph { from { opacity: 0; transform: translateY(6px) scale(.94); } to { opacity: 1; transform: none; } }
    .lb-result-top { display: flex; align-items: flex-start; gap: 8px; }
    .lb-result-text { flex: 1; font-size: 14.5px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; min-height: 20px; }
    .lb-result.loading .lb-result-text { color: #8f8f9c; }
    .lb-ask-row { display: flex; align-items: center; gap: 8px; border-top: 1px solid rgba(255,255,255,.08); padding-top: 10px; }
    .lb-ask-input { flex: 1; background: transparent; border: none; outline: none; color: #fff; font-size: 13.5px; padding: 4px 2px; }
    .lb-ask-input::placeholder { color: #74747f; }
    .lb-ask-send { width: 30px; height: 30px; border-radius: 50%; background: #fff; color: #0a0a0d;
      display: flex; align-items: center; justify-content: center; flex: none;
      transition: background .15s ease, transform .14s cubic-bezier(.2,1.4,.4,1); }
    .lb-ask-send:hover { background: #d8d8e6; transform: scale(1.08); }
    .lb-ask-send:active { transform: scale(.9); }
    .lb-ask-send .lb-ico { width: 16px; height: 16px; }

    @media (prefers-reduced-motion: reduce) { * { transition-duration: .001ms !important; animation-duration: .001ms !important; } }
  `;

  try { build(); } catch (err) { console.error("[LinguaBuddy] build failed:", err); }
})();
