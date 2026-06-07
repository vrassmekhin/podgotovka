/*
 * Реестр предметов (Subject Registry)
 * -----------------------------------
 * Это «точка расширения» приложения. Чтобы добавить новый встроенный предмет,
 * НЕ нужно менять код приложения — достаточно:
 *   1) создать файл data/<имя-предмета>.js;
 *   2) вызвать в нём Podgotovka.register({...});
 *   3) подключить файл в index.html одной строкой <script>.
 *
 * Пользователь также может добавлять предметы прямо в интерфейсе
 * (они хранятся в браузере и не требуют правки файлов).
 *
 * Формат предмета:
 * {
 *   id:        "history-rossii",          // уникальный идентификатор
 *   title:     "История России",          // название
 *   emoji:     "📜",                       // иконка (необязательно)
 *   description: "Зачёт по билетам",       // краткое описание (необязательно)
 *   tickets: [                             // билеты (необязательно — для группировки)
 *     {
 *       title: "Билет № 1",
 *       questions: [
 *         { q: "Текст вопроса", a: "Краткие тезисы для запоминания", full: "Развёрнутый полный ответ (уровень сложнее)" },
 *         ...
 *       ]
 *     },
 *     ...
 *   ]
 * }
 *
 * Допускается и «плоский» формат без билетов — просто questions: [...].
 */
(function (global) {
  const builtinSubjects = [];

  global.Podgotovka = {
    /** Регистрирует встроенный предмет. */
    register(subject) {
      if (!subject || !subject.id || !subject.title) {
        console.warn("Podgotovka.register: предмету нужны id и title", subject);
        return;
      }
      // нормализуем: вопросы могут лежать в tickets или в questions
      builtinSubjects.push(normalize(subject));
    },
    /** Возвращает копию списка встроенных предметов. */
    getBuiltins() {
      return builtinSubjects.map((s) => JSON.parse(JSON.stringify(s)));
    },
  };

  function normalize(subject) {
    const tickets = [];
    if (Array.isArray(subject.tickets)) {
      subject.tickets.forEach((t, ti) => {
        tickets.push({
          title: t.title || `Раздел ${ti + 1}`,
          questions: (t.questions || []).map((q) => ({
            q: (q.q || "").trim(),
            a: (q.a || "").trim(),
            full: (q.full || "").trim(),
          })),
        });
      });
    }
    if (Array.isArray(subject.questions)) {
      tickets.push({
        title: subject.ticketsTitle || "Вопросы",
        questions: subject.questions.map((q) => ({
          q: (q.q || "").trim(),
          a: (q.a || "").trim(),
          full: (q.full || "").trim(),
        })),
      });
    }
    return {
      id: subject.id,
      title: subject.title,
      emoji: subject.emoji || "📚",
      description: subject.description || "",
      tickets,
      builtin: true,
    };
  }
})(window);
