// Lingua Buddy — popup clipboard manager
// Add / copy / delete snippets stored in chrome.storage.local (lb_clipboard).
// The on-page capsule reads the same list for quick access while browsing.

const MAX = 20;
const listEl = document.getElementById("list");
const textEl = document.getElementById("text");
const countEl = document.getElementById("count");

function render(items) {
  items = Array.isArray(items) ? items : [];
  countEl.textContent = items.length ? `Saved · ${items.length}/${MAX}` : "Saved";
  listEl.textContent = "";
  if (!items.length) {
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent = "No snippets yet. Add one above.";
    listEl.appendChild(e);
    return;
  }
  items.forEach((it) => {
    const row = document.createElement("div");
    row.className = "row";

    const txt = document.createElement("div");
    txt.className = "txt";
    txt.textContent = it.text;

    const copy = document.createElement("button");
    copy.className = "mini";
    copy.textContent = "Copy";
    copy.addEventListener("click", () => {
      navigator.clipboard.writeText(it.text).then(() => {
        copy.textContent = "✓";
        setTimeout(() => (copy.textContent = "Copy"), 1000);
      });
    });

    const del = document.createElement("button");
    del.className = "mini del";
    del.textContent = "Delete";
    del.addEventListener("click", () => remove(it.text));

    const acts = document.createElement("div");
    acts.className = "acts";
    acts.append(copy, del);
    row.append(txt, acts);
    listEl.appendChild(row);
  });
}

function load() {
  chrome.storage.local.get("lb_clipboard", (d) => render(d.lb_clipboard));
}

function add() {
  const t = textEl.value.trim();
  if (!t) return;
  chrome.storage.local.get("lb_clipboard", (d) => {
    let list = Array.isArray(d.lb_clipboard) ? d.lb_clipboard : [];
    list = list.filter((it) => it && it.text !== t); // move-to-top dedupe
    list.unshift({ label: "🗒️ Saved", text: t, ts: Date.now() });
    list = list.slice(0, MAX);
    chrome.storage.local.set({ lb_clipboard: list }, () => {
      textEl.value = "";
      textEl.focus();
      render(list);
    });
  });
}

function remove(text) {
  chrome.storage.local.get("lb_clipboard", (d) => {
    const list = (Array.isArray(d.lb_clipboard) ? d.lb_clipboard : []).filter((it) => it && it.text !== text);
    chrome.storage.local.set({ lb_clipboard: list }, () => render(list));
  });
}

document.getElementById("add").addEventListener("click", add);
textEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); add(); }
});
document.getElementById("opts").addEventListener("click", () => chrome.runtime.openOptionsPage());

// Stay in sync if the list changes elsewhere (e.g. deleted from a page capsule).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.lb_clipboard) render(changes.lb_clipboard.newValue);
});

load();
