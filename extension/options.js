const DEFAULTS = {
  apiKey: "",
  model: "claude-sonnet-4-6",
  maxTokens: 1500,
};

const $ = (id) => document.getElementById(id);

function setStatus(text, cls) {
  const el = $("status");
  el.textContent = text;
  el.className = cls || "";
}

async function load() {
  const s = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
  $("apiKey").value = s.apiKey;
  $("model").value = s.model;
  $("maxTokens").value = s.maxTokens;
}

async function save() {
  const maxTokens = Math.min(4000, Math.max(300, parseInt($("maxTokens").value, 10) || 1500));
  await chrome.storage.local.set({
    apiKey: $("apiKey").value.trim(),
    model: $("model").value,
    maxTokens,
  });
  $("maxTokens").value = maxTokens;
  setStatus("Сохранено ✓", "ok");
  setTimeout(() => setStatus(""), 2500);
}

async function test() {
  const apiKey = $("apiKey").value.trim();
  if (!apiKey) {
    setStatus("Введите ключ", "err");
    return;
  }
  setStatus("Проверяю…");
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: $("model").value,
        max_tokens: 8,
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    if (resp.ok) {
      setStatus("Ключ работает ✓", "ok");
    } else {
      const data = await resp.json().catch(() => ({}));
      setStatus("Ошибка: " + (data?.error?.message || "HTTP " + resp.status), "err");
    }
  } catch (e) {
    setStatus("Сеть недоступна: " + e.message, "err");
  }
}

$("save").addEventListener("click", save);
$("test").addEventListener("click", test);
load();
