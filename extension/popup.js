chrome.storage.local.get({ apiKey: "" }).then(({ apiKey }) => {
  const badge = document.getElementById("badge");
  if (apiKey) {
    badge.textContent = "Ключ задан ✓";
    badge.className = "badge ok";
  } else {
    badge.textContent = "Ключ не задан";
    badge.className = "badge no";
  }
});

document.getElementById("opt").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});
