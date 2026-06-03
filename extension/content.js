// Content-script: плавающая кнопка при выделении текста + выезжающая панель
// разбора. Всё изолировано в Shadow DOM, чтобы стили страницы ничего не ломали.
(() => {
  if (window.__podgotovkaInjected) return;
  window.__podgotovkaInjected = true;

  const PANEL_STYLES = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .pdg-btn {
      position: fixed; z-index: 2147483646;
      display: inline-flex; align-items: center; gap: 6px;
      padding: 7px 11px; border: none; border-radius: 8px;
      background: #4f46e5; color: #fff; cursor: pointer;
      font: 600 13px/1.2 -apple-system, system-ui, "Segoe UI", Roboto, sans-serif;
      box-shadow: 0 4px 14px rgba(0,0,0,.25);
    }
    .pdg-btn:hover { background: #4338ca; }
    .pdg-panel {
      position: fixed; top: 16px; right: 16px; z-index: 2147483647;
      width: 420px; max-width: calc(100vw - 32px);
      max-height: calc(100vh - 32px);
      display: flex; flex-direction: column;
      background: #ffffff; color: #1f2330;
      border: 1px solid #e3e6ef; border-radius: 14px;
      box-shadow: 0 18px 50px rgba(20,22,40,.30);
      font: 14px/1.55 -apple-system, system-ui, "Segoe UI", Roboto, sans-serif;
      overflow: hidden;
    }
    @media (prefers-color-scheme: dark) {
      .pdg-panel { background: #1b1d27; color: #e7e9f2; border-color: #2c2f3d; }
      .pdg-head { background: #20232f; border-color: #2c2f3d; }
      .pdg-q { background: #20232f; border-color: #2c2f3d; color: #aab0c4; }
      .pdg-icon:hover { background: #2c2f3d; }
      .pdg-body code { background: #2c2f3d; }
    }
    .pdg-head {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 12px; cursor: move;
      background: #f6f7fb; border-bottom: 1px solid #e3e6ef;
    }
    .pdg-title { font-weight: 700; font-size: 13px; flex: 1; }
    .pdg-icon {
      border: none; background: transparent; cursor: pointer;
      width: 28px; height: 28px; border-radius: 7px; font-size: 15px;
      color: inherit; display: inline-flex; align-items: center; justify-content: center;
    }
    .pdg-icon:hover { background: #e9ebf4; }
    .pdg-q {
      margin: 10px 12px 0; padding: 8px 10px; font-size: 12.5px;
      background: #f6f7fb; border: 1px solid #e3e6ef; border-radius: 8px;
      color: #555c72; max-height: 84px; overflow: auto; white-space: pre-wrap;
    }
    .pdg-body { padding: 12px; overflow: auto; }
    .pdg-body h3 { font-size: 14.5px; margin: 14px 0 6px; }
    .pdg-body h3:first-child { margin-top: 0; }
    .pdg-body p { margin: 0 0 9px; }
    .pdg-body ul { margin: 0 0 9px; padding-left: 20px; }
    .pdg-body li { margin: 2px 0; }
    .pdg-body strong { font-weight: 700; }
    .pdg-body code {
      background: #eef0f7; padding: 1px 5px; border-radius: 5px;
      font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12.5px;
    }
    .pdg-status { color: #8a90a6; font-size: 12.5px; }
    .pdg-error {
      color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca;
      padding: 9px 11px; border-radius: 8px;
    }
    .pdg-error a { color: #b91c1c; font-weight: 600; }
    .pdg-cursor::after {
      content: "▍"; color: #4f46e5; animation: pdg-blink 1s steps(2) infinite;
    }
    @keyframes pdg-blink { 50% { opacity: 0; } }
  `;

  let host = null;
  let root = null;
  let panelEl = null;
  let bodyEl = null;
  let floatBtn = null;
  let activePort = null;
  let lastQuestion = "";

  function ensureHost() {
    if (host) return;
    host = document.createElement("div");
    host.id = "podgotovka-host";
    root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = PANEL_STYLES;
    root.appendChild(style);
    document.documentElement.appendChild(host);
  }

  // ── Плавающая кнопка при выделении ─────────────────────────────────────────
  function removeFloatBtn() {
    if (floatBtn) {
      floatBtn.remove();
      floatBtn = null;
    }
  }

  document.addEventListener("mouseup", (e) => {
    // не реагируем на клики внутри нашей панели
    if (e.target && e.target.closest && e.target.closest("#podgotovka-host"))
      return;
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel ? sel.toString().trim() : "";
      if (text.length < 3) {
        removeFloatBtn();
        return;
      }
      const range = sel.getRangeAt(0).getBoundingClientRect();
      ensureHost();
      removeFloatBtn();
      floatBtn = document.createElement("button");
      floatBtn.className = "pdg-btn";
      floatBtn.textContent = "🎓 Разобрать вопрос";
      const top = Math.min(range.bottom + 8, window.innerHeight - 44);
      const left = Math.min(range.left, window.innerWidth - 190);
      floatBtn.style.top = Math.max(8, top) + "px";
      floatBtn.style.left = Math.max(8, left) + "px";
      floatBtn.addEventListener("mousedown", (ev) => ev.preventDefault());
      floatBtn.addEventListener("click", () => {
        removeFloatBtn();
        analyze(text);
      });
      root.appendChild(floatBtn);
    }, 10);
  });

  document.addEventListener("mousedown", (e) => {
    if (e.target && e.target.closest && e.target.closest("#podgotovka-host"))
      return;
    removeFloatBtn();
  });

  // ── Сообщение из контекстного меню ─────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "analyzeSelection" && msg.text) {
      analyze(msg.text);
    }
  });

  // ── Панель разбора ─────────────────────────────────────────────────────────
  function buildPanel() {
    ensureHost();
    if (panelEl) panelEl.remove();
    panelEl = document.createElement("div");
    panelEl.className = "pdg-panel";
    panelEl.innerHTML = `
      <div class="pdg-head">
        <span class="pdg-title">🎓 Разбор вопроса</span>
        <button class="pdg-icon" data-act="copy" title="Скопировать разбор">⧉</button>
        <button class="pdg-icon" data-act="retry" title="Разобрать заново">↻</button>
        <button class="pdg-icon" data-act="close" title="Закрыть">✕</button>
      </div>
      <div class="pdg-q"></div>
      <div class="pdg-body"></div>
    `;
    root.appendChild(panelEl);
    bodyEl = panelEl.querySelector(".pdg-body");

    panelEl.querySelector('[data-act="close"]').addEventListener("click", closePanel);
    panelEl.querySelector('[data-act="retry"]').addEventListener("click", () => {
      if (lastQuestion) analyze(lastQuestion);
    });
    panelEl.querySelector('[data-act="copy"]').addEventListener("click", () => {
      navigator.clipboard?.writeText(bodyEl.dataset.raw || bodyEl.textContent || "");
    });
    makeDraggable(panelEl, panelEl.querySelector(".pdg-head"));
  }

  function closePanel() {
    if (activePort) {
      try { activePort.disconnect(); } catch (_) {}
      activePort = null;
    }
    if (panelEl) {
      panelEl.remove();
      panelEl = null;
    }
  }

  function makeDraggable(el, handle) {
    let sx, sy, ox, oy, dragging = false;
    handle.addEventListener("mousedown", (e) => {
      if (e.target.closest(".pdg-icon")) return;
      dragging = true;
      const r = el.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      el.style.right = "auto";
      e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      el.style.left = Math.max(4, ox + e.clientX - sx) + "px";
      el.style.top = Math.max(4, oy + e.clientY - sy) + "px";
    });
    document.addEventListener("mouseup", () => { dragging = false; });
  }

  // ── Запуск разбора ─────────────────────────────────────────────────────────
  function analyze(text) {
    lastQuestion = text;
    buildPanel();
    panelEl.querySelector(".pdg-q").textContent = text;
    bodyEl.dataset.raw = "";
    bodyEl.innerHTML = '<p class="pdg-status">Думаю над разбором…</p>';

    if (activePort) {
      try { activePort.disconnect(); } catch (_) {}
    }
    let acc = "";
    let started = false;
    const port = chrome.runtime.connect({ name: "analyze" });
    activePort = port;

    port.onMessage.addListener((m) => {
      if (m.type === "delta") {
        if (!started) { started = true; acc = ""; }
        acc += m.text;
        bodyEl.dataset.raw = acc;
        bodyEl.innerHTML = renderMarkdown(acc);
        bodyEl.classList.add("pdg-cursor");
      } else if (m.type === "done") {
        bodyEl.classList.remove("pdg-cursor");
        if (!acc.trim()) bodyEl.innerHTML = '<p class="pdg-status">Пустой ответ.</p>';
      } else if (m.type === "error") {
        bodyEl.classList.remove("pdg-cursor");
        renderError(m.error);
      }
    });
    port.onDisconnect.addListener(() => {
      bodyEl?.classList.remove("pdg-cursor");
    });
    port.postMessage({ type: "analyze", text });
  }

  function renderError(message) {
    const needsKey = /API-ключ|API key|x-api-key|ключ/i.test(message || "");
    bodyEl.innerHTML =
      '<div class="pdg-error">' +
      escapeHtml(message || "Неизвестная ошибка.") +
      (needsKey
        ? '<br><br><a href="#" data-act="opt">→ Открыть настройки расширения</a>'
        : "") +
      "</div>";
    const opt = bodyEl.querySelector('[data-act="opt"]');
    if (opt) {
      opt.addEventListener("click", (e) => {
        e.preventDefault();
        chrome.runtime.sendMessage({ type: "openOptions" }).catch(() => {});
      });
    }
  }

  // ── Минимальный Markdown → HTML (жирный, списки, заголовки, код) ────────────
  function escapeHtml(s) {
    return s
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function inline(s) {
    return escapeHtml(s)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  }
  function renderMarkdown(md) {
    const lines = md.replace(/\r/g, "").split("\n");
    let html = "";
    let list = false;
    const closeList = () => { if (list) { html += "</ul>"; list = false; } };
    for (let raw of lines) {
      const line = raw.replace(/\s+$/g, "");
      if (!line.trim()) { closeList(); continue; }
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) { closeList(); html += "<h3>" + inline(h[2]) + "</h3>"; continue; }
      const li = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
      if (li) {
        if (!list) { html += "<ul>"; list = true; }
        html += "<li>" + inline(li[1]) + "</li>";
        continue;
      }
      closeList();
      html += "<p>" + inline(line.trim()) + "</p>";
    }
    closeList();
    return html;
  }
})();
