/* =========================================================================
 * Подготовка — приложение для подготовки к зачётам.
 * Чистый JavaScript, без сборки. Прогресс и пользовательские предметы
 * хранятся в localStorage браузера.
 * ========================================================================= */
(function () {
  "use strict";

  // ----------------------------- Хранилище ------------------------------
  const LS = {
    progress: "podg.progress.v1", // { [subjId]: { [qKey]: "new"|"learning"|"learned" } }
    answers: "podg.answers.v1", // переопределения кратких ответов: { [subjId]: { [qKey]: "текст" } }
    fulls: "podg.fulls.v1", // переопределения развёрнутых ответов: { [subjId]: { [qKey]: "текст" } }
    userSubjects: "podg.subjects.v1", // массив пользовательских предметов
    streak: "podg.streak.v1", // { last: "YYYY-MM-DD", count: N }
    achievements: "podg.ach.v1", // { [id]: true }
    theme: "podg.theme.v1",
  };

  const read = (k, def) => {
    try {
      const v = localStorage.getItem(k);
      return v ? JSON.parse(v) : def;
    } catch (e) {
      return def;
    }
  };
  const write = (k, v) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {
      console.warn("Не удалось сохранить", k, e);
    }
  };

  // ------------------------------- Утилиты ------------------------------
  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = (h * 33) ^ str.charCodeAt(i);
    return "q" + (h >>> 0).toString(36);
  }
  const todayStr = () => new Date().toISOString().slice(0, 10);
  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    if (attrs)
      for (const k in attrs) {
        if (k === "class") e.className = attrs[k];
        else if (k === "html") e.innerHTML = attrs[k];
        else if (k.startsWith("on") && typeof attrs[k] === "function")
          e.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] != null) e.setAttribute(k, attrs[k]);
      }
    (children || []).forEach((c) => {
      if (c == null) return;
      e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return e;
  }
  function escapeHtml(s) {
    return (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
  // Мини-разметка: **жирный**, строки "- "/"• " -> список, пустая строка -> абзац.
  function renderMarkup(text) {
    const safe = escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    const blocks = safe.split(/\n\s*\n/);
    return blocks
      .map((block) => {
        // В пределах блока: строки-пункты ("- "/"• ") группируются в <ul>,
        // остальные строки — в абзацы <p> (даже если перемешаны с заголовком).
        const lines = block.split(/\n/).filter((l) => l.trim() !== "");
        let html = "";
        let para = [];
        let list = [];
        const flushPara = () => {
          if (para.length) {
            html += "<p>" + para.join("<br>") + "</p>";
            para = [];
          }
        };
        const flushList = () => {
          if (list.length) {
            html += "<ul>" + list.map((li) => "<li>" + li + "</li>").join("") + "</ul>";
            list = [];
          }
        };
        lines.forEach((l) => {
          if (/^\s*[-•]\s+/.test(l)) {
            flushPara();
            list.push(l.replace(/^\s*[-•]\s+/, ""));
          } else {
            flushList();
            para.push(l);
          }
        });
        flushList();
        flushPara();
        return html;
      })
      .join("");
  }

  // ---------------------------- Данные/модель ---------------------------
  function allSubjects() {
    const builtins = (window.Podgotovka && window.Podgotovka.getBuiltins()) || [];
    const users = read(LS.userSubjects, []);
    return builtins.concat(users);
  }
  function getSubject(id) {
    return allSubjects().find((s) => s.id === id);
  }
  // Плоский список вопросов с применёнными переопределениями ответов.
  function flatQuestions(subject) {
    const overrides = read(LS.answers, {})[subject.id] || {};
    const fullOverrides = read(LS.fulls, {})[subject.id] || {};
    const out = [];
    subject.tickets.forEach((t) => {
      t.questions.forEach((q) => {
        const key = hash(q.q);
        out.push({
          key,
          ticket: t.title,
          q: q.q,
          a: overrides[key] != null ? overrides[key] : q.a,
          full: fullOverrides[key] != null ? fullOverrides[key] : (q.full || ""),
        });
      });
    });
    return out;
  }
  function subjStats(subject) {
    const qs = flatQuestions(subject);
    const prog = read(LS.progress, {})[subject.id] || {};
    let learned = 0,
      learning = 0,
      filled = 0;
    qs.forEach((q) => {
      const st = prog[q.key] || "new";
      if (st === "learned") learned++;
      else if (st === "learning") learning++;
      if (q.a && q.a.trim()) filled++;
    });
    return { total: qs.length, learned, learning, filled, empty: qs.length - filled };
  }

  function setStatus(subjId, key, status) {
    const all = read(LS.progress, {});
    all[subjId] = all[subjId] || {};
    if (status === "new") delete all[subjId][key];
    else all[subjId][key] = status;
    write(LS.progress, all);
    bumpStreak();
  }
  function getStatus(subjId, key) {
    return (read(LS.progress, {})[subjId] || {})[key] || "new";
  }
  function setAnswer(subjId, key, text) {
    const all = read(LS.answers, {});
    all[subjId] = all[subjId] || {};
    all[subjId][key] = text;
    write(LS.answers, all);
  }
  function setFull(subjId, key, text) {
    const all = read(LS.fulls, {});
    all[subjId] = all[subjId] || {};
    all[subjId][key] = text;
    write(LS.fulls, all);
  }

  // ------------------------------ Стрик/мотивация -----------------------
  function bumpStreak() {
    const s = read(LS.streak, { last: null, count: 0 });
    const t = todayStr();
    if (s.last === t) return s;
    const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    s.count = s.last === yesterday ? s.count + 1 : 1;
    s.last = t;
    write(LS.streak, s);
    return s;
  }
  function getStreak() {
    const s = read(LS.streak, { last: null, count: 0 });
    if (s.last !== todayStr() && s.last !== new Date(Date.now() - 864e5).toISOString().slice(0, 10)) {
      return { last: s.last, count: 0 };
    }
    return s;
  }

  const MOTIVATION = [
    "Маленький шаг сегодня — уверенность на зачёте завтра. 💪",
    "Ты уже ближе к цели, чем час назад.",
    "Знание одного билета — минус один повод волноваться.",
    "Повторение — путь от «слышал» к «знаю».",
    "Лучшее время начать — сейчас. Второе лучшее — тоже сейчас. 🚀",
    "Каждый отмеченный вопрос приближает зачёт «автоматом».",
    "Спокойствие на зачёте = подготовка накануне.",
    "Ты справляешься. Продолжай в том же духе! ✨",
  ];
  function motivation() {
    return MOTIVATION[Math.floor(Math.random() * MOTIVATION.length)];
  }

  const ACHIEVEMENTS = [
    { id: "first", title: "Первый шаг", desc: "Изучен первый ответ", test: (g) => g.totalLearned >= 1 },
    { id: "ten", title: "Разогрев", desc: "Изучено 10 ответов", test: (g) => g.totalLearned >= 10 },
    { id: "subject", title: "Предмет закрыт", desc: "Один предмет выучен на 100%", test: (g) => g.anyComplete },
    { id: "streak3", title: "Серия 3 дня", desc: "Занимаешься 3 дня подряд", test: (g) => g.streak >= 3 },
    { id: "streak7", title: "Неделя силы", desc: "7 дней подряд", test: (g) => g.streak >= 7 },
    { id: "half", title: "Экватор", desc: "Половина всех ответов изучена", test: (g) => g.ratio >= 0.5 },
  ];
  function checkAchievements() {
    const subjects = allSubjects();
    let totalLearned = 0,
      total = 0,
      anyComplete = false;
    subjects.forEach((s) => {
      const st = subjStats(s);
      totalLearned += st.learned;
      total += st.total;
      if (st.total > 0 && st.learned === st.total) anyComplete = true;
    });
    const g = {
      totalLearned,
      total,
      ratio: total ? totalLearned / total : 0,
      anyComplete,
      streak: getStreak().count,
    };
    const have = read(LS.achievements, {});
    const newly = [];
    ACHIEVEMENTS.forEach((a) => {
      if (!have[a.id] && a.test(g)) {
        have[a.id] = true;
        newly.push(a);
      }
    });
    if (newly.length) write(LS.achievements, have);
    return newly;
  }
  function toast(text) {
    const t = el("div", { class: "toast" }, [text]);
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => {
      t.classList.remove("show");
      setTimeout(() => t.remove(), 400);
    }, 3200);
  }
  function celebrate() {
    checkAchievements().forEach((a) => toast("🏆 Достижение: " + a.title + " — " + a.desc));
  }

  // --------------------------- Компоненты UI ----------------------------
  function progressRing(pct, size) {
    size = size || 64;
    const r = size / 2 - 6;
    const c = 2 * Math.PI * r;
    const off = c * (1 - pct / 100);
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);
    svg.setAttribute("class", "ring");
    const mk = (cls) => {
      const ci = document.createElementNS(ns, "circle");
      ci.setAttribute("cx", size / 2);
      ci.setAttribute("cy", size / 2);
      ci.setAttribute("r", r);
      ci.setAttribute("fill", "none");
      ci.setAttribute("stroke-width", 6);
      ci.setAttribute("class", cls);
      return ci;
    };
    const bg = mk("ring-bg");
    const fg = mk("ring-fg");
    fg.setAttribute("stroke-dasharray", c);
    fg.setAttribute("stroke-dashoffset", off);
    fg.setAttribute("transform", `rotate(-90 ${size / 2} ${size / 2})`);
    svg.appendChild(bg);
    svg.appendChild(fg);
    const txt = document.createElementNS(ns, "text");
    txt.setAttribute("x", "50%");
    txt.setAttribute("y", "50%");
    txt.setAttribute("class", "ring-txt");
    txt.textContent = Math.round(pct) + "%";
    svg.appendChild(txt);
    return svg;
  }

  // ------------------------------- Роутер -------------------------------
  const app = document.getElementById("app");
  const state = { view: "home", subjectId: null, studyIndex: 0, filter: "all", query: "" };

  function navigate(view, params) {
    Object.assign(state, { view }, params || {});
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function render() {
    app.innerHTML = "";
    app.appendChild(header());
    let body;
    if (state.view === "home") body = viewHome();
    else if (state.view === "subject") body = viewSubject();
    else if (state.view === "study") body = viewStudy();
    else if (state.view === "editor") body = viewEditor();
    else body = viewHome();
    app.appendChild(body);
    celebrate();
  }

  // ------------------------------- Шапка --------------------------------
  function header() {
    const streak = getStreak();
    const back =
      state.view !== "home"
        ? el("button", { class: "btn ghost", onclick: () => navigate("home") }, ["← На главную"])
        : null;
    const themeBtn = el(
      "button",
      {
        class: "btn ghost icon",
        title: "Сменить тему",
        onclick: () => {
          const cur = document.documentElement.getAttribute("data-theme");
          const next = cur === "dark" ? "light" : "dark";
          document.documentElement.setAttribute("data-theme", next);
          write(LS.theme, next);
        },
      },
      ["🌓"]
    );
    return el("header", { class: "topbar" }, [
      el("div", { class: "brand", onclick: () => navigate("home") }, [
        el("span", { class: "logo" }, ["🎓"]),
        el("span", null, ["Подготовка"]),
      ]),
      el("div", { class: "spacer" }),
      back,
      streak.count > 0
        ? el("div", { class: "streak", title: "Дней подряд" }, ["🔥 " + streak.count])
        : null,
      themeBtn,
    ]);
  }

  // ------------------------------- Главная ------------------------------
  function viewHome() {
    const subjects = allSubjects();
    let gLearned = 0,
      gTotal = 0;
    subjects.forEach((s) => {
      const st = subjStats(s);
      gLearned += st.learned;
      gTotal += st.total;
    });
    const pct = gTotal ? (gLearned / gTotal) * 100 : 0;

    const wrap = el("main", { class: "container" }, []);

    // Геро-блок с общим прогрессом и мотивацией
    wrap.appendChild(
      el("section", { class: "hero card" }, [
        progressRing(pct, 96),
        el("div", { class: "hero-text" }, [
          el("h1", null, ["Готовимся к зачёту"]),
          el("p", { class: "muted" }, [
            gTotal
              ? `Изучено ${gLearned} из ${gTotal} ответов по всем предметам.`
              : "Добавьте предмет и вопросы — и начнём!",
          ]),
          el("p", { class: "motivation" }, [motivation()]),
        ]),
      ])
    );

    wrap.appendChild(
      el("div", { class: "row-head" }, [
        el("h2", null, ["Предметы"]),
        el("button", { class: "btn primary", onclick: () => navigate("editor", { subjectId: null }) }, [
          "＋ Добавить предмет",
        ]),
      ])
    );

    const grid = el("div", { class: "grid" }, []);
    if (!subjects.length) {
      grid.appendChild(
        el("div", { class: "empty card" }, [
          "Пока нет предметов. Нажмите «Добавить предмет», чтобы загрузить свои вопросы.",
        ])
      );
    }
    subjects.forEach((s) => {
      const st = subjStats(s);
      const p = st.total ? (st.learned / st.total) * 100 : 0;
      grid.appendChild(
        el(
          "div",
          { class: "card subject-card", onclick: () => navigate("subject", { subjectId: s.id }) },
          [
            el("div", { class: "subject-top" }, [
              el("span", { class: "subject-emoji" }, [s.emoji || "📚"]),
              progressRing(p, 56),
            ]),
            el("h3", null, [s.title]),
            s.description ? el("p", { class: "muted small" }, [s.description]) : null,
            el("div", { class: "chips" }, [
              el("span", { class: "chip" }, [st.total + " вопросов"]),
              el("span", { class: "chip ok" }, ["✓ " + st.learned]),
              st.empty > 0 ? el("span", { class: "chip warn" }, ["⚠ без ответа: " + st.empty]) : null,
              !s.builtin ? el("span", { class: "chip" }, ["свой"]) : null,
            ]),
          ]
        )
      );
    });
    wrap.appendChild(grid);

    // Достижения
    const have = read(LS.achievements, {});
    wrap.appendChild(
      el("div", { class: "row-head" }, [el("h2", null, ["Достижения"])])
    );
    const achGrid = el("div", { class: "ach-grid" }, []);
    ACHIEVEMENTS.forEach((a) => {
      achGrid.appendChild(
        el("div", { class: "ach " + (have[a.id] ? "got" : "locked") }, [
          el("div", { class: "ach-ic" }, [have[a.id] ? "🏆" : "🔒"]),
          el("div", null, [el("strong", null, [a.title]), el("div", { class: "small muted" }, [a.desc])]),
        ])
      );
    });
    wrap.appendChild(achGrid);
    return wrap;
  }

  // ---------------------------- Вид предмета ----------------------------
  function viewSubject() {
    const s = getSubject(state.subjectId);
    if (!s) return el("main", { class: "container" }, ["Предмет не найден."]);
    const qs = flatQuestions(s);
    const st = subjStats(s);
    const pct = st.total ? (st.learned / st.total) * 100 : 0;

    const wrap = el("main", { class: "container" }, []);

    wrap.appendChild(
      el("section", { class: "subject-header card" }, [
        progressRing(pct, 80),
        el("div", { class: "hero-text" }, [
          el("h1", null, [s.emoji + " " + s.title]),
          el("p", { class: "muted" }, [
            `Изучено ${st.learned} из ${st.total} • в процессе ${st.learning} • без ответа ${st.empty}`,
          ]),
          el("div", { class: "btn-row" }, [
            el(
              "button",
              {
                class: "btn primary",
                onclick: () => navigate("study", { subjectId: s.id, studyIndex: firstUnlearned(s) }),
              },
              ["▶ Режим изучения"]
            ),
            el(
              "button",
              { class: "btn", onclick: () => navigate("editor", { subjectId: s.id }) },
              ["✎ Редактировать / вопросы"]
            ),
          ]),
        ]),
      ])
    );

    // Проверка заполненности
    if (st.empty > 0) {
      wrap.appendChild(
        el("div", { class: "banner warn" }, [
          `⚠ ${st.empty} вопрос(ов) без ответа. Откройте «Редактировать», чтобы заполнить — иначе изучать будет нечего.`,
        ])
      );
    } else {
      wrap.appendChild(
        el("div", { class: "banner ok" }, ["✓ Все вопросы заполнены ответами — можно учить."])
      );
    }

    // Фильтр и поиск
    const filterBar = el("div", { class: "filter-bar" }, [
      el("input", {
        class: "search",
        type: "search",
        placeholder: "Поиск по вопросам…",
        value: state.query,
        oninput: (e) => {
          state.query = e.target.value;
          renderList();
        },
      }),
      filterBtn("all", "Все"),
      filterBtn("new", "Новые"),
      filterBtn("learning", "Учу"),
      filterBtn("learned", "Готово"),
      filterBtn("empty", "Без ответа"),
    ]);
    wrap.appendChild(filterBar);

    const listEl = el("div", { class: "qlist" }, []);
    wrap.appendChild(listEl);

    function filterBtn(val, label) {
      return el(
        "button",
        {
          class: "btn chip-btn" + (state.filter === val ? " active" : ""),
          onclick: () => {
            state.filter = val;
            render();
          },
        },
        [label]
      );
    }

    function renderList() {
      listEl.innerHTML = "";
      let lastTicket = null;
      const q = state.query.trim().toLowerCase();
      let shown = 0;
      qs.forEach((item, idx) => {
        const status = getStatus(s.id, item.key);
        const empty = !item.a || !item.a.trim();
        if (state.filter === "empty" && !empty) return;
        if (["new", "learning", "learned"].includes(state.filter) && status !== state.filter) return;
        if (q && !(item.q.toLowerCase().includes(q) || (item.a || "").toLowerCase().includes(q))) return;
        if (item.ticket !== lastTicket) {
          listEl.appendChild(el("div", { class: "ticket-sep" }, [item.ticket]));
          lastTicket = item.ticket;
        }
        shown++;
        listEl.appendChild(questionRow(s, item, idx, status, empty));
      });
      if (!shown) listEl.appendChild(el("div", { class: "empty" }, ["Ничего не найдено."]));
    }
    renderList();
    return wrap;
  }

  function questionRow(s, item, idx, status, empty) {
    const dotClass = empty ? "dot empty" : "dot " + status;
    const row = el("div", { class: "qrow" }, []);
    const head = el("div", { class: "qrow-head" }, [
      el("span", { class: dotClass, title: statusLabel(status) }, []),
      el("span", { class: "qtext" }, [item.q]),
      el("span", { class: "qmeta" }, [empty ? "нет ответа" : statusLabel(status)]),
    ]);
    const body = el("div", { class: "qrow-body" }, []);
    let open = false;
    head.addEventListener("click", () => {
      open = !open;
      if (open) {
        body.innerHTML = "";
        body.appendChild(el("div", { class: "level-tag" }, ["📌 Кратко — главные тезисы"]));
        body.appendChild(
          el("div", { class: "answer", html: empty ? "<p class='muted'>Ответ ещё не заполнен.</p>" : renderMarkup(item.a) })
        );
        // уровень сложнее: развёрнутый ответ
        if (item.full && item.full.trim()) {
          const fullBox = el("div", { class: "full-box" }, []);
          let fullOpen = false;
          const toggle = el(
            "button",
            { class: "btn level-btn" },
            ["🎓 Уровень сложнее: развёрнутый ответ"]
          );
          toggle.addEventListener("click", () => {
            fullOpen = !fullOpen;
            fullBox.innerHTML = "";
            if (fullOpen) {
              toggle.textContent = "▲ Свернуть развёрнутый ответ";
              fullBox.appendChild(el("div", { class: "level-tag hard" }, ["🎓 Развёрнутый ответ на весь вопрос билета"]));
              fullBox.appendChild(el("div", { class: "answer", html: renderMarkup(item.full) }));
            } else {
              toggle.textContent = "🎓 Уровень сложнее: развёрнутый ответ";
            }
          });
          body.appendChild(toggle);
          body.appendChild(fullBox);
        }
        body.appendChild(
          el("div", { class: "btn-row" }, [
            el("button", { class: "btn primary", onclick: () => navigate("study", { subjectId: s.id, studyIndex: idx }) }, [
              "Учить с этого",
            ]),
            statusButton(s, item, "learned", "✓ Выучил"),
            statusButton(s, item, "learning", "↻ Повторить"),
          ])
        );
        body.classList.add("show");
      } else {
        body.classList.remove("show");
        body.innerHTML = "";
      }
    });
    row.appendChild(head);
    row.appendChild(body);
    return row;
  }

  function statusButton(s, item, status, label) {
    return el(
      "button",
      {
        class: "btn small",
        onclick: () => {
          setStatus(s.id, item.key, status);
          render();
        },
      },
      [label]
    );
  }
  function statusLabel(st) {
    return { new: "новый", learning: "учу", learned: "готово" }[st] || st;
  }
  function firstUnlearned(s) {
    const qs = flatQuestions(s);
    const i = qs.findIndex((q) => getStatus(s.id, q.key) !== "learned" && q.a && q.a.trim());
    return i < 0 ? 0 : i;
  }

  // --------------------------- Режим изучения ---------------------------
  function viewStudy() {
    const s = getSubject(state.subjectId);
    if (!s) return el("main", { class: "container" }, ["Предмет не найден."]);
    const qs = flatQuestions(s);
    if (!qs.length) return el("main", { class: "container" }, ["Нет вопросов."]);
    let i = Math.max(0, Math.min(state.studyIndex, qs.length - 1));
    const item = qs[i];
    const status = getStatus(s.id, item.key);
    const empty = !item.a || !item.a.trim();

    const wrap = el("main", { class: "container study" }, []);
    const st = subjStats(s);

    wrap.appendChild(
      el("div", { class: "study-top" }, [
        el("div", { class: "study-progress" }, [
          el("div", { class: "bar" }, [
            el("div", { class: "bar-fill", style: `width:${((i + 1) / qs.length) * 100}%` }, []),
          ]),
          el("span", { class: "small muted" }, [`Вопрос ${i + 1} из ${qs.length} • ${item.ticket}`]),
        ]),
      ])
    );

    const card = el("div", { class: "flashcard card" }, []);
    let revealed = false;
    let showFull = false;
    function paintCard() {
      card.innerHTML = "";
      card.appendChild(el("div", { class: "fc-status " + status }, [statusLabel(status)]));
      card.appendChild(el("div", { class: "fc-q" }, [item.q]));
      if (!revealed) {
        card.appendChild(
          el("button", { class: "btn primary big", onclick: () => { revealed = true; paintCard(); } }, [
            "Показать ответ",
          ])
        );
        card.appendChild(el("p", { class: "small muted hint" }, ["Сначала попробуйте ответить сами 😉"]));
      } else {
        card.appendChild(el("div", { class: "level-tag" }, ["📌 Кратко — главные тезисы"]));
        card.appendChild(
          el("div", { class: "answer", html: empty ? "<p class='muted'>Ответ не заполнен. Откройте редактор.</p>" : renderMarkup(item.a) })
        );
        if (item.full && item.full.trim()) {
          if (!showFull) {
            card.appendChild(
              el("button", { class: "btn level-btn", onclick: () => { showFull = true; paintCard(); } }, [
                "🎓 Уровень сложнее: развёрнутый ответ",
              ])
            );
          } else {
            card.appendChild(el("div", { class: "level-tag hard" }, ["🎓 Развёрнутый ответ на весь вопрос билета"]));
            card.appendChild(el("div", { class: "answer", html: renderMarkup(item.full) }));
          }
        }
      }
    }
    paintCard();
    wrap.appendChild(card);

    function go(delta) {
      state.studyIndex = i + delta;
      if (state.studyIndex < 0) state.studyIndex = 0;
      if (state.studyIndex >= qs.length) {
        // финиш
        finishStudy(s);
        return;
      }
      navigate("study", { subjectId: s.id, studyIndex: state.studyIndex });
    }

    wrap.appendChild(
      el("div", { class: "study-actions" }, [
        el("button", { class: "btn", onclick: () => go(-1), disabled: i === 0 ? "" : null }, ["← Назад"]),
        el(
          "button",
          {
            class: "btn warn-btn",
            onclick: () => {
              setStatus(s.id, item.key, "learning");
              toast("Отложено на повтор ↻");
              go(1);
            },
          },
          ["↻ Повторить позже"]
        ),
        el(
          "button",
          {
            class: "btn primary",
            onclick: () => {
              setStatus(s.id, item.key, "learned");
              toast("Отлично! +1 выучен ✓");
              go(1);
            },
          },
          ["✓ Выучил, дальше →"]
        ),
      ])
    );

    wrap.appendChild(
      el("p", { class: "small muted center" }, [
        `В этом предмете выучено ${st.learned} из ${st.total}.`,
      ])
    );
    return wrap;
  }

  function finishStudy(s) {
    const st = subjStats(s);
    app.innerHTML = "";
    app.appendChild(header());
    const done = st.learned === st.total && st.total > 0;
    const wrap = el("main", { class: "container" }, [
      el("section", { class: "hero card center-col" }, [
        el("div", { class: "big-emoji" }, [done ? "🎉" : "👏"]),
        el("h1", null, [done ? "Предмет пройден!" : "Сессия завершена"]),
        el("p", { class: "muted" }, [
          done
            ? "Вы изучили все ответы. Так держать — зачёт не страшен!"
            : `Изучено ${st.learned} из ${st.total}. Отличная работа, продолжайте!`,
        ]),
        el("p", { class: "motivation" }, [motivation()]),
        el("div", { class: "btn-row center" }, [
          st.learned < st.total
            ? el("button", { class: "btn primary", onclick: () => navigate("study", { subjectId: s.id, studyIndex: firstUnlearned(s) }) }, [
                "Продолжить изучение",
              ])
            : null,
          el("button", { class: "btn", onclick: () => navigate("subject", { subjectId: s.id }) }, ["К списку вопросов"]),
          el("button", { class: "btn ghost", onclick: () => navigate("home") }, ["На главную"]),
        ]),
      ]),
    ]);
    app.appendChild(wrap);
    celebrate();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ------------------------------ Редактор ------------------------------
  function viewEditor() {
    const editingId = state.subjectId;
    const existing = editingId ? getSubject(editingId) : null;
    const isBuiltin = existing && existing.builtin;

    const wrap = el("main", { class: "container" }, []);
    wrap.appendChild(el("h1", null, [existing ? "Редактирование: " + existing.title : "Новый предмет"]));

    if (isBuiltin) {
      wrap.appendChild(
        el("div", { class: "banner" }, [
          "Это встроенный предмет. Вопросы менять нельзя, но вы можете заполнять и править ответы — они сохранятся в браузере.",
        ])
      );
      // редактирование ответов встроенного предмета (краткий + развёрнутый)
      const qs = flatQuestions(existing);
      qs.forEach((item) => {
        const ta = el("textarea", { class: "ta", rows: 5 }, [item.a || ""]);
        ta.value = item.a || "";
        const taFull = el("textarea", { class: "ta", rows: 6 }, [item.full || ""]);
        taFull.value = item.full || "";
        wrap.appendChild(
          el("div", { class: "edit-q card" }, [
            el("label", null, [item.ticket + " — " + item.q]),
            el("div", { class: "small muted" }, ["📌 Кратко — тезисы:"]),
            ta,
            el("div", { class: "small muted" }, ["🎓 Развёрнутый ответ (уровень сложнее):"]),
            taFull,
            el("div", { class: "btn-row" }, [
              el(
                "button",
                {
                  class: "btn primary small",
                  onclick: () => {
                    setAnswer(existing.id, item.key, ta.value);
                    setFull(existing.id, item.key, taFull.value);
                    toast("Сохранено ✓");
                  },
                },
                ["Сохранить"]
              ),
            ]),
          ])
        );
      });
      wrap.appendChild(
        el("div", { class: "btn-row" }, [
          el("button", { class: "btn", onclick: () => navigate("subject", { subjectId: existing.id }) }, [
            "Готово",
          ]),
        ])
      );
      return wrap;
    }

    // Создание/редактирование пользовательского предмета
    wrap.appendChild(
      el("div", { class: "banner" }, [
        "Вставьте список вопросов (по одному в строке). Ответы можно заполнить здесь или позже. " +
          "Поддерживается формат «Билет № N» — такие строки станут заголовками разделов.",
      ])
    );

    const titleInp = el("input", { class: "inp", placeholder: "Название предмета, напр. «Философия»" });
    const emojiInp = el("input", { class: "inp emoji-inp", placeholder: "📚", maxlength: 4 });
    if (existing) {
      titleInp.value = existing.title;
      emojiInp.value = existing.emoji;
    }

    wrap.appendChild(
      el("div", { class: "form-row" }, [
        el("div", { class: "grow" }, [el("label", null, ["Название"]), titleInp]),
        el("div", null, [el("label", null, ["Иконка"]), emojiInp]),
      ])
    );

    // Способ ввода вопросов: массовая вставка
    const bulk = el("textarea", {
      class: "ta",
      rows: 10,
      placeholder:
        "Билет № 1\nПервый вопрос билета\nВторой вопрос билета\nБилет № 2\nЕщё вопрос…",
    });
    if (existing) {
      const lines = [];
      existing.tickets.forEach((t) => {
        lines.push(t.title);
        t.questions.forEach((q) => lines.push(q.q));
      });
      bulk.value = lines.join("\n");
    }
    wrap.appendChild(
      el("div", null, [el("label", null, ["Вопросы (по строкам)"]), bulk])
    );

    wrap.appendChild(
      el("div", { class: "btn-row" }, [
        el(
          "button",
          {
            class: "btn primary",
            onclick: () => {
              const title = titleInp.value.trim();
              if (!title) {
                toast("Введите название предмета");
                return;
              }
              const subj = parseBulk(title, emojiInp.value.trim() || "📚", bulk.value, existing);
              saveUserSubject(subj);
              toast("Предмет сохранён ✓");
              navigate("subject", { subjectId: subj.id });
            },
          },
          [existing ? "Сохранить изменения" : "Создать предмет"]
        ),
        el(
          "button",
          {
            class: "btn",
            onclick: () => {
              // экспорт JSON
              const title = titleInp.value.trim() || "subject";
              const subj = parseBulk(title, emojiInp.value.trim() || "📚", bulk.value, existing);
              const blob = new Blob([JSON.stringify(subj, null, 2)], { type: "application/json" });
              const a = el("a", { href: URL.createObjectURL(blob), download: subj.id + ".json" }, []);
              a.click();
            },
          },
          ["⬇ Экспорт JSON"]
        ),
        existing
          ? el(
              "button",
              {
                class: "btn danger",
                onclick: () => {
                  if (confirm("Удалить предмет «" + existing.title + "» и его прогресс?")) {
                    deleteUserSubject(existing.id);
                    navigate("home");
                  }
                },
              },
              ["🗑 Удалить"]
            )
          : null,
        el("button", { class: "btn ghost", onclick: () => navigate("home") }, ["Отмена"]),
      ])
    );

    // Импорт JSON-файла
    const file = el("input", { type: "file", accept: ".json", class: "hidden-file" });
    file.addEventListener("change", () => {
      const f = file.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const obj = JSON.parse(reader.result);
          obj.id = obj.id || "subj-" + Date.now();
          obj.builtin = false;
          saveUserSubject(normalizeUser(obj));
          toast("Импортировано ✓");
          navigate("subject", { subjectId: obj.id });
        } catch (e) {
          toast("Ошибка чтения файла");
        }
      };
      reader.readAsText(f);
    });
    wrap.appendChild(
      el("div", { class: "import-row" }, [
        el("span", { class: "muted small" }, ["Или импортируйте готовый предмет: "]),
        el("button", { class: "btn small", onclick: () => file.click() }, ["⬆ Импорт JSON"]),
        file,
      ])
    );

    return wrap;
  }

  function parseBulk(title, emoji, text, existing) {
    const id = existing && !existing.builtin ? existing.id : "subj-" + slug(title) + "-" + Date.now().toString(36);
    const oldAnswers = {};
    if (existing) flatQuestions(existing).forEach((q) => (oldAnswers[hash(q.q)] = q.a));
    const tickets = [];
    let cur = null;
    text.split(/\n/).forEach((raw) => {
      const line = raw.trim();
      if (!line) return;
      if (/^билет\s*№?\s*\d+/i.test(line) || /^раздел/i.test(line) || /^тема/i.test(line)) {
        cur = { title: line, questions: [] };
        tickets.push(cur);
      } else {
        if (!cur) {
          cur = { title: "Вопросы", questions: [] };
          tickets.push(cur);
        }
        cur.questions.push({ q: line, a: oldAnswers[hash(line)] || "" });
      }
    });
    return { id, title, emoji, description: "", tickets, builtin: false };
  }
  function normalizeUser(obj) {
    return {
      id: obj.id,
      title: obj.title || "Без названия",
      emoji: obj.emoji || "📚",
      description: obj.description || "",
      builtin: false,
      tickets: (obj.tickets || []).map((t, i) => ({
        title: t.title || "Раздел " + (i + 1),
        questions: (t.questions || []).map((q) => ({ q: (q.q || "").trim(), a: (q.a || "").trim() })),
      })),
    };
  }
  function slug(s) {
    return s.toLowerCase().replace(/[^a-zа-я0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 20) || "x";
  }
  function saveUserSubject(subj) {
    const list = read(LS.userSubjects, []);
    const i = list.findIndex((x) => x.id === subj.id);
    if (i >= 0) list[i] = subj;
    else list.push(subj);
    write(LS.userSubjects, list);
  }
  function deleteUserSubject(id) {
    write(LS.userSubjects, read(LS.userSubjects, []).filter((x) => x.id !== id));
    const prog = read(LS.progress, {});
    delete prog[id];
    write(LS.progress, prog);
    const ans = read(LS.answers, {});
    delete ans[id];
    write(LS.answers, ans);
  }

  // ------------------------------- Запуск -------------------------------
  const savedTheme = read(LS.theme, null);
  if (savedTheme) document.documentElement.setAttribute("data-theme", savedTheme);
  render();
})();
