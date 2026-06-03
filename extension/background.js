// Сервис-воркер (Manifest V3, type: module).
// Отвечает за контекстное меню и потоковый вызов Claude API.

const DEFAULTS = {
  apiKey: "",
  model: "claude-sonnet-4-6",
  maxTokens: 1500,
};

const MENU_ID = "podgotovka-analyze";

const SYSTEM_PROMPT = [
  "Ты — опытный преподаватель-репетитор и помощник для подготовки к тестам.",
  "Тебе присылают текст вопроса (часто с вариантами ответа). Твоя задача —",
  "не просто назвать правильный ответ, а ПОДРОБНО разобрать каждый вариант так,",
  "чтобы студент понял материал и сам научился приходить к ответу.",
  "",
  "Формат ответа (Markdown, на языке вопроса; если язык неясен — по-русски):",
  "1. **Суть вопроса** — 1–2 предложения, что именно спрашивают.",
  "2. **Разбор вариантов** — пройди по КАЖДОМУ варианту. Для каждого:",
  "   напиши, верный он или нет, и объясни ПОЧЕМУ (факты, логика, типичные ловушки).",
  "   Если варианты не даны в тексте — разбери ключевые возможные ответы.",
  "3. **Правильный ответ** — чётко укажи его и дай краткое итоговое обоснование.",
  "4. **Как запомнить** — короткая подсказка/мнемоника или ключевая мысль.",
  "",
  "Будь точным и честным. Если не уверен — так и скажи и объясни сомнение.",
  "Не выдумывай факты.",
].join("\n");

async function getSettings() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

// ── Контекстное меню ─────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Разобрать вопрос (Подготовка)",
    contexts: ["selection"],
  });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "openOptions") chrome.runtime.openOptionsPage();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID && tab?.id && info.selectionText) {
    chrome.tabs.sendMessage(tab.id, {
      type: "analyzeSelection",
      text: info.selectionText,
    });
  }
});

// ── Потоковый разбор через Claude API ────────────────────────────────────────
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "analyze") return;

  port.onMessage.addListener(async (msg) => {
    if (msg?.type !== "analyze") return;
    const question = (msg.text || "").trim();
    if (!question) {
      port.postMessage({ type: "error", error: "Пустой текст вопроса." });
      return;
    }
    try {
      await streamAnalysis(question, port);
    } catch (err) {
      port.postMessage({ type: "error", error: String(err?.message || err) });
    }
  });
});

async function streamAnalysis(question, port) {
  const { apiKey, model, maxTokens } = await getSettings();
  if (!apiKey) {
    port.postMessage({
      type: "error",
      error: "Не задан API-ключ. Откройте настройки расширения и вставьте ключ Claude API.",
    });
    return;
  }

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      stream: true,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content:
            "Разбери этот вопрос теста и его варианты ответа:\n\n" + question,
        },
      ],
    }),
  });

  if (!resp.ok || !resp.body) {
    let detail = "HTTP " + resp.status;
    try {
      const data = await resp.json();
      detail = data?.error?.message || detail;
    } catch (_) {}
    port.postMessage({ type: "error", error: "Ошибка API: " + detail });
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE: события разделены пустой строкой; данные — в строках "data: {...}".
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";

    for (const evt of events) {
      for (const line of evt.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let json;
        try {
          json = JSON.parse(payload);
        } catch (_) {
          continue;
        }
        if (json.type === "content_block_delta" && json.delta?.text) {
          port.postMessage({ type: "delta", text: json.delta.text });
        } else if (json.type === "error") {
          port.postMessage({
            type: "error",
            error: json.error?.message || "Ошибка потока.",
          });
          return;
        }
      }
    }
  }

  port.postMessage({ type: "done" });
}
