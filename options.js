const keyEl = document.getElementById("key");
const modelEl = document.getElementById("model");
const statusEl = document.getElementById("status");

chrome.storage.local.get(["groqApiKey", "groqModel"], (data) => {
  if (data.groqApiKey) keyEl.value = data.groqApiKey;
  if (data.groqModel) modelEl.value = data.groqModel;
});

document.getElementById("save").addEventListener("click", () => {
  chrome.storage.local.set(
    { groqApiKey: keyEl.value.trim(), groqModel: modelEl.value },
    () => {
      statusEl.textContent = "✓ Saved";
      setTimeout(() => (statusEl.textContent = ""), 1800);
    }
  );
});
