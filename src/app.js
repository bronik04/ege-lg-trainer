// Интерфейс тренажёра. Чистая логика — в logic.mjs (при сборке она стоит выше в том же скрипте).
// Весь текст из банка выводится через textContent: разметку из данных страница не исполняет.

(function () {
  'use strict';

  const DATA = JSON.parse(document.getElementById('trainer-data').textContent);
  const questions = DATA.questions;
  const topics = DATA.topics;
  const rules = DATA.rules;
  const checks = DATA.ruleChecks;
  const byId = new Map(questions.map((q) => [q.id, q]));
  const topicsById = new Map(topics.map((t) => [t.id, t]));
  const rulesById = new Map(rules.map((r) => [r.id, r]));
  const checksById = new Map(checks.map((c) => [c.id, c]));
  const origins = [...new Set(questions.map((q) => q.origin))];
  const ORIGIN_NAMES = { fipi: 'Банк ФИПИ', generated: 'Новые задания', hsk: 'HSK 4' };
  const SOLO_STEM = new Set([15, 19]);
  const FILTERS_KEY = 'ege-lg-trainer:filters';
  const THEME_KEY = 'ege-lg-trainer:theme';

  // ---------- хранилище ----------

  const storage = {
    get(key) {
      try { return window.localStorage.getItem(key); } catch { return null; }
    },
    set(key, value) {
      try { window.localStorage.setItem(key, value); return true; } catch { return false; }
    },
    remove(key) {
      try { window.localStorage.removeItem(key); } catch { /* недоступно — нечего удалять */ }
    },
  };

  const storedText = storage.get(PROGRESS_KEY);
  const storedVersion = progressVersion(storedText);
  // Прогресс записан более новой страницей (например, выкладку откатили или в другой вкладке уже
  // новая выкладка) — не трогаем его: ни ответами, ни сбросом, ни загрузкой файла.
  const newer = (text) => {
    const version = progressVersion(text);
    return version !== null && version > PROGRESS_VERSION;
  };
  let progressLocked = newer(storedText);
  // Перед переносом на новую структуру — копия как была, на случай ошибки в переносе.
  if (storedVersion !== null && storedVersion < PROGRESS_VERSION && !storage.get(`${PROGRESS_KEY}:v${storedVersion}`)) {
    storage.set(`${PROGRESS_KEY}:v${storedVersion}`, storedText);
  }
  const loaded = parseProgress(storedText);
  let progress = pruneProgress(loaded, questions);
  let storageOk = !progressLocked;
  function save() {
    commitClock();
    if (!progressLocked && newer(storage.get(PROGRESS_KEY))) lockProgress();
    if (progressLocked) return;
    storageOk = storage.set(PROGRESS_KEY, JSON.stringify(progress));
  }

  function lockProgress() {
    progressLocked = true;
    storageOk = false;
  }
  const now = () => new Date().toISOString();

  // ---------- время варианта ----------
  // Часы идут, только пока открыт незавершённый вариант и страница видна: перерыв на день
  // не съедает минуты. clock — текущий отрезок: с какого момента и для какого варианта.
  let clock = null;
  let clockSaved = 0;
  let lastTick = 0;
  const timed = (v) => v && !v.finishedAt && Number.isFinite(v.elapsedMs);
  const isCurrent = (v) => timed(v) && clock && v.startedAt === clock.startedAt;

  function variantElapsed() {
    const v = progress.variant;
    if (!v) return 0;
    return (v.elapsedMs || 0) + (isCurrent(v) ? Date.now() - clock.since : 0);
  }

  // Переносит набежавшее до момента t время в сессию варианта — перед каждым сохранением.
  function commitClock(t = Date.now()) {
    if (!clock) return;
    const v = progress.variant;
    if (isCurrent(v) && t > clock.since) progress = { ...progress, variant: { ...v, elapsedMs: v.elapsedMs + (t - clock.since) } };
    clock = { ...clock, since: Math.max(clock.since, t) };
  }

  // Запись без действия ученика (табло, скрытие, закрытие): только время варианта поверх
  // того, что лежит в хранилище, — ответы из другой вкладки не затираются.
  function saveClock() {
    commitClock();
    clockSaved = Date.now();
    const v = progress.variant;
    if (progressLocked || !timed(v)) return;
    let raw;
    try {
      raw = JSON.parse(storage.get(PROGRESS_KEY));
    } catch {
      return;
    }
    const stored = raw && raw.version === PROGRESS_VERSION ? raw.variant : null;
    if (!stored || stored.finishedAt || stored.startedAt !== v.startedAt) return;
    stored.elapsedMs = Math.max(Number.isFinite(stored.elapsedMs) ? stored.elapsedMs : 0, v.elapsedMs);
    storage.set(PROGRESS_KEY, JSON.stringify(raw));
  }

  function syncClock() {
    const v = progress.variant;
    const running = route().name === 'variant' && timed(v) && !pendingVariant
      && document.visibilityState === 'visible';
    if (running && !isCurrent(v)) {
      clock = { since: Date.now(), startedAt: v.startedAt };
      clockSaved = Date.now();
    }
    if (!running && clock) {
      saveClock();
      clock = null;
    }
  }

  function paintClock(node) {
    const state = clockState(variantElapsed());
    node.textContent = state.over ? `время вышло · ${state.text}` : `осталось ${state.text}`;
    node.classList.toggle('over', state.over);
  }

  function loadFilters() {
    const empty = { topics: [], tasks: [], rules: [], origins: [], state: 'all', size: '10' };
    try {
      const raw = JSON.parse(storage.get(FILTERS_KEY) || 'null');
      if (!raw || typeof raw !== 'object') return empty;
      return fitRules({
        topics: Array.isArray(raw.topics) ? raw.topics.filter((t) => topicsById.has(t)) : [],
        tasks: Array.isArray(raw.tasks) ? raw.tasks.filter((n) => TASK_NUMBERS.includes(n)) : [],
        rules: Array.isArray(raw.rules) ? raw.rules.filter((r) => rulesById.has(r)) : [],
        origins: Array.isArray(raw.origins) ? raw.origins.filter((o) => origins.includes(o)) : [],
        state: ['all', 'new', 'done', 'review', 'mistakes'].includes(raw.state) ? raw.state : 'all',
        size: ['5', '10', '20', 'all'].includes(raw.size) ? raw.size : '10',
      }, questions);
    } catch {
      return empty;
    }
  }
  let filters = loadFilters();
  function saveFilters() {
    storage.set(FILTERS_KEY, JSON.stringify(filters));
  }

  // Проверка правил не сохраняется между перезагрузками: это короткая разминка.
  let checkSession = null;
  let variantConfirm = false;
  let resetConfirm = false;
  let transferNotice = null; // итог загрузки файла прогресса, виден на экране банка
  let shareNotice = prunedNotice(loaded, progress); // что открыто по ссылке учителя; показывается один раз
  let shareOpen = null; // какой блок «Ссылка…» раскрыт: setup, round или variant
  let pendingVariant = null; // вариант из ссылки ждёт решения: поверх незавершённого своего
  const BANK_FILTERS = { task: '', topic: '', state: 'all', origin: '' };
  let bankFilters = { ...BANK_FILTERS };

  // ---------- DOM ----------

  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (value === true) node.setAttribute(key, '');
      else node.setAttribute(key, String(value));
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  const view = document.getElementById('view');

  function plural(n, one, few, many) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
  }
  const tasksWord = (n) => `${n} ${plural(n, 'задание', 'задания', 'заданий')}`;
  const questionsWord = (n) => `${n} ${plural(n, 'вопрос', 'вопроса', 'вопросов')}`;

  // ---------- маршруты ----------

  function route() {
    const [path, query = ''] = (location.hash || '#/rules').split('?');
    const parts = path.replace(/^#\/?/, '').split('/');
    let arg = null;
    try {
      arg = parts[1] ? decodeURIComponent(parts[1]) : null;
    } catch {
      arg = parts[1]; // испорченный адрес: покажем «не найдено», а не пустой экран
    }
    return { name: parts[0] || 'rules', arg, query };
  }

  function go(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  function render(focus = true) {
    const active = document.activeElement;
    const activeKey = active && active.dataset ? active.dataset.key : null;
    let { name, arg, query } = route();
    if (query && (name === 'practice' || name === 'variant')) {
      openShared(name, query);
      ({ name, arg } = route());
    }
    document.querySelectorAll('[data-tab]').forEach((tab) => {
      const active = tab.dataset.tab === name;
      if (active) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    });
    view.replaceChildren();
    if (name !== 'bank') transferNotice = null;
    if (name !== 'variant') pendingVariant = null;
    if (name === 'rules' && arg) renderRule(arg);
    else if (name === 'rules') renderRules();
    else if (name === 'check') renderCheck();
    else if (name === 'practice') renderPractice();
    else if (name === 'variant') renderVariant();
    else if (name === 'bank') renderBank();
    else if (name === 'teacher') renderTeacher();
    else if (name === 'help') renderHelp();
    else renderRules();
    if (shareNotice) {
      const node = el('p', { class: shareNotice.warn ? 'notice warn' : 'notice', id: 'shareNotice', role: 'status', text: shareNotice.text });
      const title = view.querySelector('h2');
      if (title) title.after(node);
      else view.prepend(node);
      shareNotice = null;
    }
    if (progressLocked) {
      view.append(el('p', { class: 'notice warn small', id: 'progressLocked', text: 'Прогресс сохранён более новой версией тренажёра. Обновите страницу — иначе новые ответы не сохранятся.' }));
    } else if (!storageOk) {
      view.append(el('p', { class: 'notice warn small', text: 'Браузер не даёт сохранить прогресс: он пропадёт после перезагрузки страницы.' }));
    }
    if (focus) {
      // Новый экран — с начала страницы: на телефоне сверху выход и деления раунда.
      window.scrollTo(0, 0);
      const target = view.querySelector('[data-focus]') || view;
      target.focus({ preventScroll: true });
    } else if (activeKey) {
      const same = [...view.querySelectorAll('[data-key]')].find((node) => node.dataset.key === activeKey);
      if (same) same.focus();
    }
    syncClock();
    const clockNode = document.getElementById('variantClock');
    if (clockNode) paintClock(clockNode);
  }

  // ---------- общие части ----------

  // «Перечитайте правило» — к ошибкам раунда или варианта. Без ошибок — пустой фрагмент:
  // null штатный view.append напечатал бы словом «null».
  function ruleAdvice(items) {
    const ids = rulesForMistakes(items, byId, new Set(rulesById.keys()));
    if (!ids.length) return document.createDocumentFragment();
    const links = ids.flatMap((id, i) => [i ? ', ' : '', el('a', { href: `#/rules/${encodeURIComponent(id)}`, text: rulesById.get(id).title })]);
    return el('p', { class: 'notice advice', id: 'ruleAdvice' }, 'Перечитайте правило: ', ...links, '.');
  }

  // Работа над ошибками: правило коротко, под ним задания — ваш ответ, верный и почему.
  // Повтор — только ошибки этого правила.
  function mistakeWork(items, { id, open = true }) {
    const groups = groupMistakesByRule(items, byId, new Set(rulesById.keys()));
    if (!groups.length) return document.createDocumentFragment();
    const entries = groups.flatMap((g) => g.entries);
    const skipped = entries.filter((e) => e.chosen == null).length;
    // Иероглифы — шрифтом кайшу; буквы порядка (№26), тоны (№15) и числа (№19) — обычным.
    const answer = (text) => (/[\u3400-\u9fff]/.test(text) ? el('span', { class: 'zh', lang: 'zh', text }) : el('b', { text }));
    const zh = (text) => el('span', { class: 'zh', lang: 'zh', text });
    return el('details', { class: 'mistakes', id, open },
      el('summary', { text: `Работа над ошибками · ${entries.length - skipped}` + (skipped ? ` · без ответа ${skipped}` : '') }),
      groups.map((g) => {
        const rule = g.ruleId ? rulesById.get(g.ruleId) : null;
        return el('section', { class: 'mistake-group' },
          el('h3', {}, rule ? el('a', { href: `#/rules/${encodeURIComponent(rule.id)}`, text: rule.title }) : 'Без правила',
            ` · ${g.entries.length}`),
          rule && rule.summary ? el('p', { class: 'small muted', text: rule.summary }) : null,
          el('ul', { class: 'mistake-list' }, g.entries.map((entry) => {
            const q = byId.get(entry.id);
            const e = explainChoice(q, entry.chosen);
            const why = entry.chosen == null ? e.correctExplanation : e.chosenExplanation;
            // №26: верный порядок собранным предложением — буквы сами по себе ничего не объясняют.
            const sentence = q.fragments ? assembledOrder(q) : '';
            return el('li', {},
              zh(`${q.taskNumber}. ${q.stem.replace(/\s+/g, ' ')}` + (q.taskNumber === 15 ? ' — тоны' : '')),
              el('span', { class: 'small' }, entry.chosen == null ? 'без ответа' : ['ваш ответ: ', answer(e.chosenText)],
                ' → верно: ', answer(e.correctText)),
              sentence ? el('span', { class: 'small' }, 'верный порядок: ', zh(sentence)) : null,
              why ? el('span', { class: 'small muted', text: why }) : null);
          })),
          el('button', {
            class: 'button ghost', type: 'button',
            'aria-label': `Повторить задания правила «${rule ? rule.title : 'без правила'}» · ${g.entries.length}`,
            onclick: () => startRound(shuffle(g.entries.map((x) => x.id))),
          }, `Повторить задания этого правила · ${g.entries.length}`));
      }));
  }

  // Ссылка учителя: открыть подборку, раунд из тех же заданий или тот же вариант.
  // Адрес сразу заменяется обычным, чтобы перезагрузка не открывала ссылку повторно.
  function openShared(name, query) {
    const link = parseShareQuery(query, { topicIds: new Set(topicsById.keys()), origins, questionIds: new Set(byId.keys()), ruleIds: new Set(rulesById.keys()) });
    let target = `#/${name}`;
    if (name === 'variant') {
      if (link.kind === 'ids' && isVariant(link.ids, byId)) {
        const action = linkAction(progress.variant, link.ids);
        if (action === 'ask') pendingVariant = link.ids;
        else if (action === 'start') startLinkedVariant(link.ids);
        else shareNotice = { warn: false, text: SAME_LINK.variant[action] };
      } else {
        shareNotice = { warn: true, text: 'Вариант из ссылки не открыть: части его заданий больше нет в банке. Соберите новый вариант.' };
      }
    } else if (link.kind === 'ids') {
      const action = link.ids.length ? linkAction(progress.round, link.ids) : null;
      if (action === 'continue' || action === 'result') {
        shareNotice = { warn: false, text: SAME_LINK.round[action] };
      } else if (action) {
        progress = { ...progress, round: startSession(link.ids, now()) };
        save();
        if (link.missing) shareNotice = { warn: true, text: `Из ссылки не найдено в банке: ${tasksWord(link.missing)}. Раунд собран из остальных.` };
      } else {
        shareNotice = { warn: true, text: 'Заданий из ссылки больше нет в банке. Выберите подборку сами.' };
        target = '#/practice/setup';
      }
    } else {
      filters = { ...filters, ...link.filters, state: 'all' };
      // Ссылка только с правилами: отмечаются их номера, иначе правила под оглавлением не видны.
      if (filters.rules.length && !filters.tasks.length) filters.tasks = ruleTasks(filters.rules, questions);
      filters = fitRules(filters, questions);
      saveFilters();
      const gone = [
        link.missing ? (link.missing === 1 ? 'одной темы' : `${link.missing} тем`) : '',
        link.missingRules ? (link.missingRules === 1 ? 'одного правила' : `${link.missingRules} правил`) : '',
      ].filter(Boolean).join(' и ');
      shareNotice = gone
        ? { warn: true, text: `Подборка открыта по ссылке, но ${gone} из неё на сайте больше нет — выбраны остальные.` }
        : { warn: false, text: 'Подборка открыта по ссылке: темы, номера и размер раунда уже выбраны.' };
      target = '#/practice/setup';
    }
    window.history.replaceState(null, '', target);
  }

  // Ученик вернулся по той же ссылке: работа не начинается заново.
  const SAME_LINK = {
    variant: {
      continue: 'Этот вариант вы уже начали — продолжайте с того же места.',
      result: 'Этот вариант вы уже решили — ниже итог и отчёт учителю. Решить ещё раз — «Решить этот вариант заново».',
    },
    round: {
      continue: 'Эти задания вы уже начали — продолжайте с того же места.',
      result: 'Эти задания вы уже решили — ниже итог и отчёт учителю. Решить ещё раз — «Решить эти задания заново».',
    },
  };

  function startLinkedVariant(ids) {
    progress = { ...progress, variant: startVariant(ids, now()) };
    variantConfirm = false;
    save();
  }

  const pageUrl = (hash) => `${location.href.split('#')[0]}${hash}`;

  // Раскрывающийся блок со ссылкой и кнопкой «Скопировать».
  function shareToggle(key, label, url, note, disabled = false) {
    const button = el('button', {
      class: 'button ghost', type: 'button', id: `share-${key}`, disabled, 'aria-expanded': String(shareOpen === key),
      onclick: () => { shareOpen = shareOpen === key ? null : key; render(false); },
      dataset: { key: `share:${key}` },
    }, label);
    if (shareOpen !== key || disabled) return { button, box: null };
    const input = el('input', { class: 'share-url', type: 'text', readonly: true, value: url, 'aria-label': 'Ссылка', onfocus: (e) => e.target.select() });
    const status = el('span', { class: 'small muted', 'aria-live': 'polite' });
    const box = el('div', { class: 'share', id: 'shareBox' },
      el('p', { class: 'small', text: note }),
      el('div', { class: 'share-row' }, input,
        el('button', {
          class: 'button', type: 'button', id: 'copyLink',
          onclick: async () => {
            try {
              await navigator.clipboard.writeText(url);
              status.textContent = 'Ссылка скопирована.';
            } catch {
              input.focus();
              status.textContent = 'Скопируйте выделенную ссылку вручную.';
            }
          },
        }, 'Скопировать')),
      status);
    return { button, box };
  }

  // Отчёт учителю: имя, читаемый текст и код для страницы учителя. Имя хранится только в этом
  // браузере и уходит лишь в сообщение, которое ученик отправит сам.
  const STUDENT_KEY = 'ege-lg-trainer:student';
  const topicTitle = (id) => (topicsById.get(id) || {}).title || id;

  function reportToggle(key, report) {
    const open = `report-${key}`;
    const button = el('button', {
      class: 'button ghost', type: 'button', id: `report-${key}`, 'aria-expanded': String(shareOpen === open),
      dataset: { key: `share:${open}` },
      onclick: () => { shareOpen = shareOpen === open ? null : open; render(false); },
    }, 'Отчёт учителю');
    if (shareOpen !== open) return { button, box: null };
    const name = el('input', { class: 'share-url', type: 'text', id: 'studentName', autocomplete: 'name', value: storage.get(STUDENT_KEY) || '', dataset: { key: 'report:name' } });
    const text = el('textarea', { class: 'report-text', id: 'reportText', readonly: true, rows: 8, 'aria-label': 'Текст отчёта' });
    const status = el('span', { class: 'small muted', 'aria-live': 'polite' });
    const fill = () => { text.value = reportText({ ...report, name: name.value.trim() }, byId, topicTitle); };
    name.addEventListener('input', () => { storage.set(STUDENT_KEY, name.value.trim()); fill(); });
    fill();
    const named = () => {
      if (name.value.trim()) return true;
      status.textContent = 'Впишите имя — иначе учитель не поймёт, чей это отчёт.';
      name.focus();
      return false;
    };
    const copy = el('button', {
      class: 'button', type: 'button', id: 'copyReport',
      onclick: async () => {
        if (!named()) return;
        try {
          await navigator.clipboard.writeText(text.value);
          status.textContent = 'Отчёт скопирован — вставьте его в сообщение учителю.';
        } catch {
          text.focus();
          text.select();
          status.textContent = 'Скопируйте выделенный текст вручную.';
        }
      },
    }, 'Скопировать');
    // На телефоне — сразу в мессенджер через меню «Поделиться».
    const share = navigator.share ? el('button', {
      class: 'button ghost', type: 'button',
      onclick: async () => {
        if (!named()) return;
        try {
          await navigator.share({ text: text.value });
        } catch (error) {
          if (error && error.name !== 'AbortError') status.textContent = 'Не удалось поделиться — нажмите «Скопировать».';
        }
      },
    }, 'Поделиться') : null;
    const box = el('div', { class: 'share', id: 'reportBox' },
      el('p', { class: 'small', text: 'Отправьте этот текст учителю в мессенджере. Имя видит только тот, кому вы его пошлёте; на сайте оно хранится лишь в этом браузере.' }),
      el('label', { class: 'field' }, 'Имя и фамилия', name),
      text,
      el('div', { class: 'share-row' }, copy, share),
      status);
    return { button, box };
  }

  const sessionAnswers = (session) => session.ids.map((id) => session.answers[id] ?? null);

  // Из начатой сессии ушли снятые с публикации задания — ученик узнаёт об этом один раз.
  function prunedNotice(before, after) {
    const changed = (kind) => before[kind] && !before[kind].finishedAt && before[kind] !== after[kind];
    if (changed('variant')) {
      const replaced = after.variant && after.variant.ids.length === before.variant.ids.length;
      return { warn: true, text: replaced
        ? 'Часть заданий сняли с сайта на исправление: в начатом варианте их места заняли другие задания тех же номеров.'
        : 'Часть заданий сняли с сайта на исправление, а других заданий тех же номеров на сайте нет — в начатом варианте этих позиций пока нет.' };
    }
    if (changed('round')) return { warn: true, text: 'Часть заданий начатого раунда сняли с сайта на исправление — раунд продолжается без них.' };
    return null;
  }

  function originLabel(q) {
    if (q.origin === 'fipi') return q.sourceRef && q.sourceRef.fipiId ? `Банк ФИПИ · ${q.sourceRef.fipiId}` : 'Банк ФИПИ';
    if (q.origin === 'hsk') {
      const ref = q.sourceRef || {};
      return ref.paper && ref.number ? `HSK 4 · ${ref.paper}, №${ref.number}` : 'HSK 4';
    }
    return 'Новое задание';
  }

  function questionPills(q) {
    return el('div', { class: 'pills' },
      el('span', { class: 'pill task' }, 'Задание ', el('span', { class: 'cellnum', text: String(q.taskNumber) })),
      q.topicIds.map((id) => topicsById.get(id)).filter(Boolean).map((t) => el('span', { class: 'pill quiet', text: t.title })),
      el('span', { class: 'pill quiet', text: originLabel(q) }),
      q.draft ? el('span', { class: 'pill draft', text: 'черновик' }) : null);
  }

  // Красная галочка учителя у клетки: рисуется штрихом.
  function tickMark() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'tick');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M3 11 L8 16 L18 3');
    path.setAttribute('pathLength', '1');
    svg.append(path);
    return svg;
  }

  // Пропуск — клетка 田字格. Ответ ученика вписан синим; после проверки — галочка
  // или зачёркнутое и верный ответ над клеткой красной ручкой.
  function blankNode(cells, { written, state, fix }) {
    const chars = written ? [...written.replace(/\s+/g, '')] : [];
    let label = 'пропуск';
    if (state === 'right' && written) label = `пропуск: верно, ${written}`;
    else if (state === 'wrong' && written && fix) label = `пропуск: выбрано ${written}, верно ${fix}`;
    else if (state === 'wrong' && fix) label = `пропуск: верно ${fix}`;
    else if (state === 'wrong' && written) label = `пропуск: выбрано ${written}, неверно`;
    else if (written) label = `пропуск, вписано: ${written}`;
    // Подпись русская внутри китайского предложения — lang='ru', вписанное — снова zh.
    const box = el('span', { class: ['tz', written ? 'written' : '', state || ''].filter(Boolean).join(' '), role: 'img', lang: 'ru', 'aria-label': label });
    if (cells === 0 || chars.length > cells) {
      box.append(el('span', { class: 'c long' }, written ? el('span', { class: 'ink', lang: 'zh', text: written }) : null));
    } else {
      for (let i = 0; i < cells; i += 1) box.append(el('span', { class: 'c' }, chars[i] ? el('span', { class: 'ink', lang: 'zh', text: chars[i] }) : null));
    }
    if (state === 'right' && written) box.append(tickMark());
    if (fix) box.append(el('span', { class: 'fix', lang: 'zh', 'aria-hidden': 'true', text: fix }));
    return box;
  }

  // Предложение с пропусками-клетками. selected — выбранный вариант, reveal — после проверки.
  function sentenceNode(item, text, cls, { selected, reveal }) {
    const cells = blankCells(item);
    const chosen = selected == null ? null : blankFill(item, selected);
    const right = reveal ? blankFill(item, item.correctOptionId) : null;
    const correct = selected != null && selected === item.correctOptionId;
    let index = 0;
    return el('p', { class: cls, lang: 'zh' }, stemSegments(text).map((part) => {
      if (!part.blank) return part.text;
      const i = index;
      index += 1;
      return blankNode(cells[i], {
        written: chosen ? chosen[i] : null,
        state: reveal ? (correct ? 'right' : 'wrong') : null,
        fix: reveal && !correct && right ? right[i] : null,
      });
    }));
  }

  function stemNode(q, state) {
    if (q.taskNumber === 26 && q.fragments) {
      return el('ol', { class: 'fragments' },
        q.fragments.map((f) => el('li', {}, el('b', { text: f.id }), el('span', { text: f.text }))));
    }
    return sentenceNode(q, q.stem, SOLO_STEM.has(q.taskNumber) ? 'stem solo' : 'stem', state);
  }

  // Карточка вопроса: задание ЕГЭ или вопрос по правилу. reveal — показать верный/неверный.
  // hint — что делает Enter; null — Enter ничего не делает, undefined — без подсказки клавиш
  // (она видна только при мыши и клавиатуре).
  function questionCard(item, { kind, selected, reveal, onChoose, heading, hint }) {
    const card = el('article', { class: 'question', dataset: { card: '1' } });
    if (kind === 'exam') card.append(questionPills(item));
    else {
      card.append(el('div', { class: 'pills' },
        item.ruleIds.map((id) => rulesById.get(id)).filter(Boolean).map((r) => el('span', { class: 'pill quiet', text: r.title })),
        item.draft ? el('span', { class: 'pill draft', text: 'черновик' }) : null));
    }
    card.append(el('p', { class: 'instruction', tabindex: '-1', dataset: { focus: '1' }, text: heading || item.prompt }));
    if (kind === 'exam') card.append(stemNode(item, { selected, reveal }));
    else if (item.sentence) {
      card.append(sentenceNode(item, item.sentence, 'stem', { selected, reveal }));
      if (item.sentenceRu) card.append(el('p', { class: 'stem-ru', text: item.sentenceRu }));
    }
    // В ряд — только короткие варианты; союзы №27 с «……» в узкой колонке рвались бы посередине.
    const short = item.options.every((o) => o.text.length <= 12 && !o.text.includes('…'));
    const list = el('div', { class: short ? 'options row' : 'options', role: 'group', 'aria-label': 'Варианты ответа' });
    item.options.forEach((o, i) => {
      let cls = 'option';
      if (reveal && o.id === item.correctOptionId) cls += ' correct';
      else if (reveal && o.id === selected) cls += ' wrong';
      else if (!reveal && o.id === selected) cls += ' selected';
      list.append(el('button', {
        class: cls,
        type: 'button',
        disabled: reveal,
        'aria-pressed': o.id === selected ? 'true' : 'false',
        dataset: { option: String(i + 1) },
        onclick: () => onChoose(o.id),
      }, el('span', { class: 'num', text: String(i + 1) }),
      // Тоны «2-4-2», числа и «CAB» — не китайский текст: свой шрифт и lang.
      isChinese(o.text) ? el('span', { class: 'text', lang: 'zh', text: o.text }) : el('span', { class: 'text plain', lang: 'ru', text: o.text })));
    });
    card.append(list);
    if (hint !== undefined) {
      card.append(el('p', { class: 'keys' }, 'Клавиши: ', el('kbd', { text: '1' }), '–', el('kbd', { text: String(item.options.length) }), ' — ответ',
        hint ? [', ', el('kbd', { text: 'Enter' }), ` — ${hint}`] : null));
    }
    return card;
  }

  function ruleNote(ruleIds, contrast) {
    const box = el('div', { class: 'rule-note' });
    const linked = ruleIds.map((id) => rulesById.get(id)).filter(Boolean);
    linked.forEach((r) => {
      box.append(el('p', {}, 'Правило: ',
        el('a', { href: `#/rules/${encodeURIComponent(r.id)}`, text: r.title })));
    });
    const example = contrast || (linked[0] && linked[0].contrast);
    if (example && example.pair) {
      box.append(el('p', { class: 'small muted', text: 'Сравните:' }));
      example.pair.forEach((p) => box.append(el('p', {}, el('span', { class: 'zh', lang: 'zh', text: p.zh }), ` — ${p.ru}`)));
      if (example.note) box.append(el('p', { class: 'small', text: example.note }));
    } else if (example && example.zh) {
      box.append(el('p', {}, 'Сравните: ', el('span', { class: 'zh', lang: 'zh', text: example.zh }), ` — ${example.ru}`));
    }
    return box;
  }

  // Разбор: сначала почему выбранный вариант не подходит, потом верный ответ, правило и контраст.
  function feedback(item, optionId) {
    const e = explainChoice(item, optionId);
    const box = el('section', { class: 'feedback', 'aria-live': 'polite' });
    if (optionId == null) {
      box.append(el('div', { class: 'verdict ok' },
        el('h3', {}, 'Верный ответ: ', el('span', { class: 'zh', lang: 'zh', text: e.correctText })),
        el('p', { text: e.correctExplanation })));
    } else if (e.correct) {
      box.append(el('div', { class: 'verdict ok' },
        el('h3', {}, 'Верно: ', el('span', { class: 'zh', lang: 'zh', text: e.correctText })),
        el('p', { text: e.correctExplanation })));
    } else {
      box.append(el('div', { class: 'verdict bad' },
        el('h3', {}, 'Почему не ', el('span', { class: 'zh', lang: 'zh', text: e.chosenText })),
        el('p', { text: e.chosenExplanation })));
      box.append(el('div', { class: 'verdict ok' },
        el('h3', {}, 'Верный ответ: ', el('span', { class: 'zh', lang: 'zh', text: e.correctText })),
        el('p', { text: e.correctExplanation })));
    }
    box.append(ruleNote(item.ruleIds, item.contrast));
    if (e.others.length) {
      box.append(el('details', { class: 'others' },
        el('summary', { text: 'Остальные варианты' }),
        el('ul', {}, e.others.map((o) => el('li', {}, el('span', { class: 'zh', lang: 'zh', text: o.text }), ` — ${o.explanation}`)))));
    }
    const report = reportUrl(DATA.meta.issuesUrl, item, optionId);
    if (report) {
      box.append(el('p', { class: 'report' },
        'Нашли ошибку в задании или разборе? ',
        el('a', { href: report, target: '_blank', rel: 'noopener', text: 'Сообщить на GitHub (новая вкладка)' }),
        el('span', { class: 'muted', text: ' — нужен аккаунт, сообщение увидят все' })));
    }
    return box;
  }

  // Счёт на итоге: «7 из 10», процент выполнения и подпись. Запятая — для чтеца экрана.
  function scoreLine(score, total, caption) {
    return el('p', { class: 'score' }, el('b', { text: `${score} из ${total}` }),
      el('b', { class: 'percent' }, el('span', { class: 'sr', text: ', ' }), `${percent(score, total)} %`),
      el('span', { class: 'muted', text: caption }));
  }

  function progressLine(label, right) {
    return el('div', { class: 'progress' }, el('span', { text: label }), el('span', {}, right));
  }

  // Верх раунда и проверки правила: выход, деления по заданиям (нефрит — верно, красное —
  // ошибка, синее — текущее) и строка счёта. Длинный раунд — сплошная полоска.
  function sessionBar({ exit, marks, index, label, right }) {
    const bar = el('div', { class: 'session-bar' },
      el('a', { class: 'exit', href: exit, 'aria-label': 'Выйти', title: 'Выйти', text: '✕' }));
    if (marks.length <= 30) {
      bar.append(el('div', { class: 'ticks', 'aria-hidden': 'true' },
        marks.map((m, i) => el('i', { class: m || (i === index ? 'now' : null) }))));
    } else {
      const done = marks.filter(Boolean).length;
      bar.append(el('div', { class: 'track', 'aria-hidden': 'true' },
        el('div', { class: 'fill', style: `width:${Math.round((done / marks.length) * 100)}%` })));
    }
    return el('div', { class: 'quiz-top' }, bar, progressLine(label, right));
  }

  const markOf = (answer, correctId) => (answer === undefined || answer === null ? null : answer === correctId ? 'ok' : 'bad');
  const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // После ответа предложение с исправлением красной ручкой не уходит с экрана: ученик видит, что
  // не так. Начало разбора не помещается под вариантами — страница сдвигается ровно настолько,
  // чтобы его показать, но не дальше, чем до предложения у верхнего края. Остальное разбора
  // ученик прокрутит сам. Фокус — на «Дальше» без прокрутки к ней: Enter ведёт дальше.
  function afterAnswer() {
    const card = view.querySelector('[data-card]');
    const box = view.querySelector('.feedback');
    const dock = view.querySelector('.dock');
    const sticky = Boolean(dock) && getComputedStyle(dock).position === 'sticky';
    if (card && box) {
      const anchor = card.querySelector('.stem') || card.querySelector('.fragments') || card.querySelector('.instruction');
      const visibleBottom = window.innerHeight - (sticky ? dock.getBoundingClientRect().height : 0);
      const head = box.getBoundingClientRect().top + 56; // заголовок разбора и первая строка
      const delta = Math.min(anchor.getBoundingClientRect().top - 12, head - visibleBottom);
      if (delta > 0) window.scrollBy({ top: delta, behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
    const next = view.querySelector('[data-enter]');
    if (next) next.focus({ preventScroll: true });
  }

  function emptyBank() {
    return el('div', { class: 'empty' },
      el('strong', { text: 'Проверенных заданий пока нет.' }),
      'Задания появятся здесь, когда автор примет их разборы. Пока можно читать правила.');
  }

  // ---------- правила ----------

  function renderRules() {
    view.append(el('h2', { tabindex: '-1', dataset: { focus: '1' }, text: 'Правила' }),
      el('p', { class: 'lead', text: 'Короткое объяснение, контрастные примеры и типичная ошибка. После правила — вопрос на понимание и задания ЕГЭ по той же теме.' }));
    if (!rules.length) {
      view.append(el('div', { class: 'empty' }, el('strong', { text: 'Карточек правил пока нет.' }),
        'Они появятся после проверки автором.'));
      return;
    }
    if (checks.length) {
      view.append(el('button', { class: 'all-checks', type: 'button', onclick: () => startChecks(checks.map((c) => c.id), null) },
        'Проверить себя по всем правилам', el('span', { text: `${questionsWord(checks.length)} →` })));
    }
    // Оглавление по номерам заданий: темы с одним набором номеров — одна строка.
    const rows = new Map();
    for (const topic of topics) {
      const topicRules = rules.filter((r) => r.topicIds.includes(topic.id));
      if (!topicRules.length) continue;
      const key = topic.taskNumbers.join('·');
      if (!rows.has(key)) rows.set(key, { numbers: topic.taskNumbers, titles: [], rules: [] });
      const row = rows.get(key);
      row.titles.push(topic.title);
      for (const r of topicRules) if (!row.rules.includes(r)) row.rules.push(r);
    }
    const first = (row) => (row.numbers.length ? Math.min(...row.numbers) : Infinity);
    view.append(el('ul', { class: 'index' }, [...rows.values()].sort((a, b) => first(a) - first(b)).map((row) => el('li', {},
      el('span', { class: 'cellnum' }, el('span', { class: 'sr', text: 'Задание ' }), row.numbers.join('·') || '—'),
      el('div', {},
        el('h3', { text: row.titles.join(' · ') }),
        row.rules.map((r) => el('a', { class: 'rule-card', href: `#/rules/${encodeURIComponent(r.id)}` },
          r.title, r.draft ? el('span', { class: 'pill draft', text: 'черновик' }) : null)))))));
  }

  function renderRule(id) {
    const rule = rulesById.get(id);
    if (!rule) {
      view.append(el('h2', { tabindex: '-1', dataset: { focus: '1' }, text: 'Правило не найдено' }),
        el('p', {}, el('a', { class: 'back', href: '#/rules', text: '← Все правила' })));
      return;
    }
    const ruleChecks = checks.filter((c) => c.ruleIds.includes(id));
    const ruleQuestions = questions.filter((q) => (q.ruleIds || []).includes(id));
    const taskNumbers = [...new Set(rule.topicIds.flatMap((t) => (topicsById.get(t) || { taskNumbers: [] }).taskNumbers))];
    const detail = el('article', { class: 'rule-detail' },
      el('a', { class: 'back', href: '#/rules', text: '← Все правила' }),
      el('h2', { tabindex: '-1', dataset: { focus: '1' }, text: rule.title }),
      el('div', { class: 'pills' },
        taskNumbers.length ? el('span', { class: 'pill task' }, 'Задание ', el('span', { class: 'cellnum', text: taskNumbers.join('·') })) : null,
        rule.topicIds.map((t) => topicsById.get(t)).filter(Boolean).map((t) => el('span', { class: 'pill quiet', text: t.title })),
        rule.draft ? el('span', { class: 'pill draft', text: 'черновик' }) : null),
      el('p', { text: rule.summary }),
      el('p', { class: 'section-title', text: 'Когда употребляется' }),
      el('ul', { class: 'usage' }, rule.usage.map((u) => el('li', { text: u }))),
      el('p', { class: 'section-title', text: 'Примеры' }),
      el('ul', { class: 'examples' }, rule.examples.map((ex) => el('li', {},
        el('span', { class: 'zh', lang: 'zh', text: ex.zh }), el('span', { class: 'ru', text: ex.ru })))),
      el('p', { class: 'section-title', text: 'Сравните' }),
      el('div', { class: 'contrast' }, rule.contrast.pair.map((p) => el('div', {},
        el('span', { class: 'zh', lang: 'zh', text: p.zh }), el('span', { class: 'muted', text: p.ru })))),
      el('p', { text: rule.contrast.note }),
      el('p', { class: 'section-title', text: 'Типичная ошибка' }),
      el('p', { class: 'mistake', text: rule.mistake }));
    const actions = el('div', { class: 'actions' });
    if (ruleChecks.length) {
      actions.append(el('button', { class: 'button', type: 'button', onclick: () => startChecks(ruleChecks.map((c) => c.id), id) },
        `Проверить правило · ${questionsWord(ruleChecks.length)}`));
    }
    actions.append(el('button', {
      class: 'button alt', type: 'button', disabled: !ruleQuestions.length,
      // Задания именно этого правила: его номера отмечены, правило выбрано под оглавлением.
      onclick: () => {
        filters = { ...filters, topics: [], tasks: ruleTasks([id], questions), rules: [id], state: 'all' };
        saveFilters();
        go('#/practice');
      },
    }, ruleQuestions.length ? `Задания ЕГЭ по правилу · ${tasksWord(ruleQuestions.length)}` : 'Заданий ЕГЭ по правилу пока нет'));
    detail.append(actions);
    view.append(detail);
  }

  function startChecks(ids, ruleId) {
    checkSession = { ...startSession(shuffle(ids), now()), ruleId };
    go('#/check');
  }

  function renderCheck() {
    if (!checkSession) {
      go('#/rules');
      return;
    }
    const s = checkSession;
    const back = s.ruleId ? `#/rules/${encodeURIComponent(s.ruleId)}` : '#/rules';
    const answered = Object.keys(s.answers).length;
    const correctCount = s.ids.filter((id) => s.answers[id] === checksById.get(id).correctOptionId).length;
    if (s.finishedAt) {
      view.append(el('h2', { tabindex: '-1', dataset: { focus: '1' }, text: `Проверка правила: ${correctCount} из ${s.ids.length} · ${percent(correctCount, s.ids.length)} %` }),
        el('p', { class: 'lead', text: correctCount === s.ids.length ? 'Правило усвоено — можно переходить к заданиям ЕГЭ.' : 'Перечитайте карточку правила и попробуйте ещё раз.' }),
        el('div', { class: 'actions' },
          el('a', { class: 'button', href: back, text: s.ruleId ? 'К правилу' : 'К правилам' }),
          el('button', { class: 'button alt', type: 'button', onclick: () => startChecks(s.ids, s.ruleId) }, 'Пройти ещё раз')));
      return;
    }
    const id = s.ids[s.index];
    const item = checksById.get(id);
    const chosen = s.answers[id];
    view.append(sessionBar({
      exit: back, index: s.index, label: `Вопрос ${s.index + 1} из ${s.ids.length}`, right: `верно: ${correctCount}`,
      marks: s.ids.map((x) => markOf(s.answers[x], checksById.get(x).correctOptionId)),
    }));
    view.append(questionCard(item, {
      kind: 'check',
      selected: chosen,
      reveal: chosen !== undefined,
      hint: 'дальше',
      onChoose: (optionId) => {
        if (checkSession.answers[id] !== undefined) return;
        checkSession = answerSession(checkSession, id, optionId);
        progress = recordAnswer(progress, 'checks', id, optionId, optionId === item.correctOptionId, now());
        save();
        render(false);
        afterAnswer();
      },
    }));
    if (chosen !== undefined) {
      view.append(feedback(item, chosen));
      const last = s.index === s.ids.length - 1;
      view.append(el('div', { class: 'actions dock' },
        el('button', {
          class: 'button', type: 'button', dataset: { enter: '1' },
          onclick: () => {
            checkSession = last ? { ...checkSession, finishedAt: now() } : moveSession(checkSession, checkSession.index + 1);
            render();
          },
        }, last ? 'Итог' : 'Дальше')));
    }
  }

  // ---------- практика ----------

  function chipGroup(legend, items, selected, onToggle, id) {
    return el('fieldset', { class: 'filter', id },
      el('legend', { text: legend }),
      el('div', { class: 'chips' }, items.map((it) => el('label', { class: 'chip' },
        el('input', { type: 'checkbox', checked: selected.includes(it.value), dataset: { key: `${legend}:${it.value}` }, onchange: () => onToggle(it.value) }),
        el('span', {}, it.label, it.count !== undefined ? el('small', { text: String(it.count) }) : null)))));
  }

  function toggle(list, value) {
    return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
  }

  // Оглавление по номерам: номер в клетке, тема номера, число заданий. Тема с карточки
  // правила или из старой ссылки (filters.topics) только сужает: номер без неё не нажать.
  function taskContents() {
    const rows = TASK_NUMBERS.map((n) => {
      const own = questions.filter((q) => q.taskNumber === n);
      const topic = topics.find((t) => t.taskNumbers.includes(n));
      const count = filterQuestions(own, { topics: filters.topics }, progress).length;
      return { n, title: topic ? topic.title : `Задание ${n}`, total: own.length, count };
    }).filter((r) => r.total > 0);
    const focus = filters.topics.length
      ? el('p', { class: 'topic-focus', id: 'topicFocus' },
        el('span', {}, filters.topics.length > 1 ? 'Только темы: ' : 'Только тема: ', el('b', { text: filters.topics.map(topicTitle).join(', ') })),
        el('button', {
          class: 'button ghost', type: 'button',
          onclick: () => {
            filters = { ...filters, topics: [] };
            saveFilters();
            render(false);
            const first = view.querySelector('.task-row input');
            if (first) first.focus();
          },
        }, el('span', { 'aria-hidden': 'true', text: '✕' }), ' Снять тему'))
      : null;
    return el('fieldset', { class: 'filter' },
      el('legend', { text: 'Задания' }),
      focus,
      el('div', { class: 'contents' }, rows.map((r) => {
        const checked = filters.tasks.includes(r.n);
        return el('label', { class: 'task-row' },
          el('input', {
            type: 'checkbox', checked, disabled: !checked && !r.count, dataset: { key: `Задания:${r.n}` },
            onchange: () => {
              filters = fitRules({ ...filters, tasks: toggle(filters.tasks, r.n) }, questions);
              saveFilters();
              render(false);
              // Снятый номер без заданий темы стал недоступен — фокус на «Снять тему», а не в никуда.
              const same = view.querySelector(`input[data-key="Задания:${r.n}"]`);
              const off = view.querySelector('#topicFocus button');
              if (same && same.disabled && off) off.focus();
            },
          }),
          el('span', {},
            el('span', { class: 'cellnum' }, el('span', { class: 'sr', text: 'Задание ' }), String(r.n)),
            el('span', { class: 'task-title', text: r.title }),
            el('small', {}, String(r.count), el('span', { class: 'sr', text: ` ${plural(r.count, 'задание', 'задания', 'заданий')}` }))));
      })));
  }

  // Грамматика: правила отмеченных номеров — по порядку номеров, с числом заданий. Правило
  // уточняет номер (у №22 — 就/才, 又/再/还 и т. д.); без отмеченного номера — подсказка.
  function grammarFilter() {
    const numbers = [...filters.tasks].sort((a, b) => a - b);
    const shown = [];
    for (const n of numbers) {
      for (const r of rules) {
        if (!shown.includes(r) && questions.some((q) => q.taskNumber === n && (q.ruleIds || []).includes(r.id))) shown.push(r);
      }
    }
    const items = shown
      .map((r) => ({ value: r.id, label: r.title, count: filterQuestions(questions, { topics: filters.topics, tasks: filters.tasks, rules: [r.id] }, progress).length }))
      .filter((it) => it.count || filters.rules.includes(it.value));
    if (!items.length) {
      return el('fieldset', { class: 'filter', id: 'grammar' }, el('legend', { text: 'Грамматика' }),
        el('p', { class: 'small muted hint', text: numbers.length
          ? 'У отмеченных номеров правил пока нет.'
          : 'Отметьте номер — здесь появятся его правила, чтобы взять задания только на одно из них.' }));
    }
    return chipGroup('Грамматика', items, filters.rules, (v) => { filters.rules = toggle(filters.rules, v); saveFilters(); render(false); }, 'grammar');
  }

  function renderPractice() {
    const round = progress.round;
    if (round && !round.finishedAt && route().arg !== 'setup') {
      renderRound();
      return;
    }
    if (round && round.finishedAt && route().arg !== 'setup') {
      renderRoundResult();
      return;
    }
    view.append(el('h2', { tabindex: '-1', dataset: { focus: '1' }, text: 'Практика ЕГЭ' }),
      el('p', { class: 'lead', text: 'Задания из банка с разбором сразу после ответа. Отметьте номера — или ничего, чтобы взять все.' }));
    if (!questions.length) {
      view.append(emptyBank());
      return;
    }
    view.append(taskContents(), grammarFilter());
    if (origins.length > 1) {
      view.append(chipGroup('Источник', origins.map((o) => ({ value: o, label: ORIGIN_NAMES[o] || o, count: questions.filter((q) => q.origin === o).length })),
        filters.origins, (v) => { filters.origins = toggle(filters.origins, v); saveFilters(); render(false); }));
    }
    const stateSelect = el('select', { id: 'stateFilter', dataset: { key: 'state' }, onchange: (e) => { filters.state = e.target.value; saveFilters(); render(false); } },
      [['all', 'Все'], ['new', 'Новые'], ['done', 'Уже решённые'], ['review', 'На повторение'], ['mistakes', 'Ошибки']].map(([v, label]) => el('option', { value: v, selected: filters.state === v, text: label })));
    const sizeSelect = el('select', { id: 'roundSize', dataset: { key: 'size' }, onchange: (e) => { filters.size = e.target.value; saveFilters(); render(false); } },
      [['5', '5 заданий'], ['10', '10 заданий'], ['20', '20 заданий'], ['all', 'Все доступные']].map(([v, label]) => el('option', { value: v, selected: filters.size === v, text: label })));
    view.append(el('div', { class: 'filters-row' },
      el('label', { class: 'field' }, 'Какие задания', stateSelect),
      el('label', { class: 'field' }, 'Размер раунда', sizeSelect)));
    const available = filterQuestions(questions, filters, progress, now());
    const roundSize = filters.size === 'all' ? available.length : Math.min(Number(filters.size), available.length);
    view.append(el('p', { class: 'notice', id: 'available', 'aria-live': 'polite' },
      available.length
        ? `Доступно: ${tasksWord(available.length)}. В раунд попадёт ${roundSize}.`
        : filters.state === 'mistakes' ? 'Ошибок с такими фильтрами нет.'
          : filters.state === 'done' ? 'Решённых с такими фильтрами пока нет.'
            : filters.state === 'review' ? 'Повторять пока нечего: ошибок нет, а исправленные ещё не подошли к сроку.'
              : 'С такими фильтрами заданий нет — снимите часть фильтров.'));
    const actions = el('div', { class: 'actions' },
      el('button', {
        class: 'button', type: 'button', id: 'startRound', disabled: !available.length, dataset: { enter: '1' },
        onclick: () => startRound(pickRound(available, filters.size).map((q) => q.id)),
      }, 'Начать раунд'),
      el('button', {
        class: 'button ghost', type: 'button',
        onclick: () => { filters = { ...filters, topics: [], tasks: [], rules: [], origins: [], state: 'all' }; saveFilters(); render(false); },
      }, 'Сбросить фильтры'));
    if (round && !round.finishedAt) {
      actions.append(el('a', { class: 'button alt', href: '#/practice', text: `Продолжить раунд · ${Object.keys(round.answers).length} из ${round.ids.length}` }));
    }
    const share = shareToggle('setup', 'Ссылка на подборку', pageUrl(`#/practice?${shareQuery(filters)}`),
      'По ссылке откроется эта подборка: номера, правила, источник и размер раунда. Задания каждому выпадут свои. Чтобы у всех были одни и те же задания, пройдите раунд и возьмите ссылку на его итоге.',
      !available.length);
    actions.append(share.button);
    view.append(actions);
    if (share.box) view.append(share.box);
  }

  function startRound(ids) {
    if (!ids.length) return;
    shareOpen = null; // блок ссылки или отчёта прошлого итога в новом раунде не открывается сам
    progress = { ...progress, round: startSession(ids, now()) };
    save();
    go('#/practice');
  }

  function renderRound() {
    const round = progress.round;
    const id = round.ids[round.index];
    const q = byId.get(id);
    const answered = round.ids.filter((x) => round.answers[x] !== undefined);
    const correct = answered.filter((x) => round.answers[x] === byId.get(x).correctOptionId).length;
    const chosen = round.answers[id];
    view.append(sessionBar({
      exit: '#/practice/setup', index: round.index, label: `Задание ${round.index + 1} из ${round.ids.length}`, right: `верно: ${correct}`,
      marks: round.ids.map((x) => markOf(round.answers[x], byId.get(x).correctOptionId)),
    }));
    view.append(questionCard(q, {
      kind: 'exam',
      selected: chosen,
      reveal: chosen !== undefined,
      hint: 'дальше',
      onChoose: (optionId) => {
        if (progress.round.answers[id] !== undefined) return;
        progress = recordAnswer({ ...progress, round: answerSession(progress.round, id, optionId) },
          'questions', id, optionId, grade(q, optionId).correct, now());
        save();
        render(false);
        afterAnswer();
      },
    }));
    if (chosen !== undefined) {
      view.append(feedback(q, chosen));
      const last = round.index === round.ids.length - 1;
      view.append(el('div', { class: 'actions dock' }, el('button', {
        class: 'button', type: 'button', dataset: { enter: '1' },
        onclick: () => {
          progress = { ...progress, round: last ? { ...progress.round, finishedAt: now() } : moveSession(progress.round, progress.round.index + 1) };
          save();
          render();
        },
      }, last ? 'Итог раунда' : 'Дальше')));
    }
  }

  function resultList(ids, answers) {
    return el('ul', { class: 'results' }, ids.map((id) => {
      const q = byId.get(id);
      const chosen = answers[id];
      const ok = chosen !== undefined && chosen !== null && chosen === q.correctOptionId;
      const body = el('div', { class: 'body' });
      const item = el('details', {
        ontoggle: (e) => {
          if (!e.target.open || body.childElementCount) return;
          body.append(questionCard(q, { kind: 'exam', selected: chosen, reveal: true, onChoose: () => {} }));
          if (chosen == null) body.append(el('p', { class: 'notice warn', text: 'Ответа не было.' }));
          body.append(feedback(q, chosen == null ? null : chosen));
        },
      },
      el('summary', {},
        el('span', { class: 'n cellnum', text: String(q.taskNumber) }),
        el('span', { class: 'zh', lang: 'zh', text: q.stem.replace(/\s+/g, ' ') }),
        el('span', { class: ok ? 'ok-mark' : 'bad-mark', text: ok ? 'верно' : chosen == null ? 'без ответа' : 'ошибка' })),
      body);
      return el('li', {}, item);
    }));
  }

  function renderRoundResult() {
    const round = progress.round;
    const result = scoreSession(round, byId);
    const wrong = result.items.filter((i) => !i.correct).map((i) => i.id);
    view.append(el('h2', { tabindex: '-1', dataset: { focus: '1' }, text: 'Раунд окончен' }),
      scoreLine(result.score, result.total, 'верных ответов'),
      ruleAdvice(result.items),
      mistakeWork(result.items, { id: 'roundMistakes' }),
      resultList(round.ids, round.answers));
    const share = shareToggle('round', 'Ссылка на эти задания', pageUrl(`#/practice?${idsQuery(round.ids)}`),
      `По ссылке откроется раунд из этих же заданий (${round.ids.length}) в том же порядке — одинаковый для всех, кто её получит.`);
    // Код отчёта держит не больше REPORT_MAX_TASKS заданий: учитель большой раунд не прочитал бы.
    const report = round.ids.length <= REPORT_MAX_TASKS
      ? reportToggle('round', { kind: 'round', at: round.finishedAt || now(), ids: round.ids, answers: sessionAnswers(round),
        score: result.score, total: result.total })
      : { button: null, box: el('p', { class: 'small muted', id: 'reportTooBig', text: `Отчёт учителю — для раунда до ${REPORT_MAX_TASKS} заданий, а в этом ${round.ids.length}. Для отчёта соберите раунд поменьше.` }) };
    view.append(el('div', { class: 'actions' },
      wrong.length ? el('button', { class: 'button', type: 'button', onclick: () => startRound(shuffle(wrong)) }, `Повторить ошибки раунда · ${wrong.length}`) : null,
      el('a', { class: wrong.length ? 'button alt' : 'button', href: '#/practice/setup', text: 'Новый раунд' }),
      el('button', { class: 'button ghost', type: 'button', id: 'restartRound', onclick: () => startRound(round.ids) }, 'Решить эти задания заново'),
      report.button,
      share.button));
    if (report.box) view.append(report.box);
    if (share.box) view.append(share.box);
  }

  // ---------- полный вариант ----------

  function sheet(session, { reveal, onPick }) {
    return el('ol', { class: 'sheet', 'aria-label': 'Бланк ответов' }, session.ids.map((id, i) => {
      const q = byId.get(id);
      const chosen = session.answers[id];
      const digit = chosen == null ? '' : String(q.options.findIndex((o) => o.id === chosen) + 1);
      let cls = 'cell';
      if (reveal) cls += chosen === q.correctOptionId ? ' good' : ' bad';
      else if (i === session.index) cls += ' current';
      const label = `Задание ${q.taskNumber}: ${chosen == null ? 'без ответа' : `ответ ${digit}`}` +
        (reveal ? (chosen === q.correctOptionId ? ', верно' : ', неверно') : '');
      return el('li', {}, el('button', {
        class: cls, type: 'button', 'aria-label': label, 'aria-current': !reveal && i === session.index ? 'step' : null,
        onclick: () => onPick(i),
      }, el('span', { class: 'pos', text: String(q.taskNumber) }), el('span', { class: 'mark', text: reveal && chosen == null ? '—' : digit })));
    }));
  }

  function renderVariant() {
    // Пока висел вопрос, другая вкладка могла изменить свой вариант. Тот же вариант, что в ссылке, —
    // спрашивать не о чем; свой стёрли (сброс) — открыть вариант из ссылки. Свой завершили —
    // вопрос остаётся: сам вариант из ссылки поверх итога не открывается, итог и отчёт целы.
    if (pendingVariant) {
      const action = linkAction(progress.variant, pendingVariant);
      if (action === 'continue' || action === 'result') {
        pendingVariant = null;
      } else if (!progress.variant) {
        startLinkedVariant(pendingVariant);
        pendingVariant = null;
      }
    }
    const v = progress.variant;
    if (pendingVariant) {
      const answered = Object.values(v.answers).filter((x) => x != null).length;
      const text = v.finishedAt
        ? 'Свой вариант вы уже завершили. Если открыть вариант из ссылки, итог своего и отчёт по нему пропадут с этой страницы (счёт останется в «Прошлых вариантах»).'
        : `У вас есть незавершённый вариант: отвечено ${answered} из ${v.ids.length}. Если открыть вариант из ссылки, эти ответы пропадут.`;
      view.append(el('h2', { tabindex: '-1', dataset: { focus: '1' }, text: 'Вариант по ссылке' }),
        el('p', { class: 'notice warn', id: 'pendingVariant', text }),
        el('div', { class: 'actions' },
          el('button', {
            class: 'button', type: 'button', id: 'openLinkedVariant',
            onclick: () => { startLinkedVariant(pendingVariant); pendingVariant = null; render(); },
          }, 'Открыть вариант из ссылки'),
          el('button', { class: 'button ghost', type: 'button', id: 'keepOwnVariant', onclick: () => { pendingVariant = null; render(); } },
            v.finishedAt ? 'Показать итог своего' : 'Продолжить свой')));
      return;
    }
    if (v && !v.finishedAt) {
      renderVariantRun();
      return;
    }
    view.append(el('h2', { tabindex: '-1', dataset: { focus: '1' }, text: 'Полный вариант' }),
      el('p', { class: 'lead', text: `Тринадцать заданий, по одному на каждую позицию 15–27, в порядке раздела 3 экзамена. Ответы можно менять до конца; разбор — после завершения. На раздел рекомендовано ${VARIANT_MINUTES} минут: часы идут, только пока вариант открыт.` }));
    const attempt = buildVariant(questions);
    const actions = el('div', { class: 'actions' });
    if (attempt.ok) {
      // После результата Enter не должен сразу собирать новый вариант и стирать разбор.
      actions.append(el('button', {
        class: 'button', type: 'button', id: 'buildVariant', dataset: v && v.finishedAt ? {} : { enter: '1' },
        onclick: () => {
          const fresh = buildVariant(questions);
          progress = { ...progress, variant: startVariant(fresh.ids, now()) };
          variantConfirm = false;
          save();
          render();
        },
      }, v && v.finishedAt ? 'Собрать новый вариант' : 'Собрать вариант'));
    } else {
      view.append(el('p', { class: 'notice warn', id: 'variantMissing' },
        questions.length
          ? `Вариант пока не собрать: нет проверенных заданий для ${attempt.missing.length === 1 ? 'позиции' : 'позиций'} ${attempt.missing.join(', ')}.`
          : 'Вариант пока не собрать: проверенных заданий ещё нет.'));
    }
    if (v && v.finishedAt) renderVariantResult(v, actions);
    else view.append(actions);
    const history = progress.history.filter((h) => h.kind === 'variant').slice(-5).reverse();
    if (history.length > 1) {
      view.append(el('p', { class: 'section-title', text: 'Прошлые варианты' }),
        el('ul', { class: 'usage' }, history.map((h) => el('li', { text: `${new Date(h.at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })} — ${h.score} из ${h.total}${Number.isFinite(h.timeMs) ? ` · ${formatClock(h.timeMs)}` : ''}` }))));
    }
  }

  function renderVariantRun() {
    const v = progress.variant;
    const id = v.ids[v.index];
    const q = byId.get(id);
    const answered = v.ids.filter((x) => v.answers[x] != null).length;
    // role="timer" не зачитывается диктором каждую секунду; подпись — рекомендованное время.
    const clockNode = Number.isFinite(v.elapsedMs)
      ? el('span', { class: 'clock', id: 'variantClock', role: 'timer', title: `Рекомендовано ${VARIANT_MINUTES} минут на раздел 3` })
      : null;
    view.append(el('h2', { class: 'sr-title', tabindex: '-1', text: 'Полный вариант' }),
      progressLine(`Позиция ${q.taskNumber} · ${v.index + 1} из ${v.ids.length}`,
        [el('span', { class: 'nowrap', text: `отвечено: ${answered}` }), clockNode ? ' · ' : '', clockNode]),
      sheet(v, { reveal: false, onPick: (i) => { progress = { ...progress, variant: moveSession(progress.variant, i) }; save(); render(); } }),
      questionCard(q, {
        kind: 'exam',
        selected: v.answers[id],
        reveal: false,
        hint: v.index === v.ids.length - 1 ? null : 'следующая позиция',
        onChoose: (optionId) => {
          progress = { ...progress, variant: answerSession(progress.variant, id, optionId) };
          variantConfirm = false;
          save();
          render(false);
          // Фокус на «Дальше»: Enter ведёт к следующей позиции, цифры по-прежнему меняют ответ.
          // Страницу к кнопке не двигаем: задание с выбранным ответом остаётся на экране.
          const next = view.querySelector('[data-enter]') || view.querySelector('#finishVariant');
          if (next) next.focus({ preventScroll: true });
        },
      }));
    const last = v.index === v.ids.length - 1;
    const missing = unansweredPositions(v, byId);
    const finishButton = el('button', {
      class: last ? 'button' : 'button ghost', type: 'button', id: 'finishVariant',
      onclick: () => {
        if (missing.length && !variantConfirm) {
          variantConfirm = true;
          render(false);
          const confirm = view.querySelector('#confirmFinish');
          if (confirm) confirm.focus();
          return;
        }
        finish();
      },
    }, 'Завершить вариант');
    // На последней позиции «Завершить» — главная кнопка панели, на остальных — обычная под заданием.
    if (!last) view.append(el('div', { class: 'actions' }, finishButton));
    if (variantConfirm && missing.length) {
      view.append(el('div', { class: 'notice warn' },
        `Без ответа: ${missing.join(', ')}. Эти задания будут засчитаны как неверные.`,
        el('div', { class: 'actions' },
          el('button', { class: 'button', type: 'button', id: 'confirmFinish', onclick: finish }, 'Всё равно завершить'),
          el('button', { class: 'button ghost', type: 'button', onclick: () => { variantConfirm = false; render(false); } }, 'Вернуться к заданиям'))));
    }
    view.append(el('div', { class: 'actions dock' },
      // Сессия — из progress, а не v с прошлой отрисовки: табло между ними дописывает время.
      el('button', { class: 'button ghost', type: 'button', disabled: v.index === 0, onclick: () => { progress = { ...progress, variant: moveSession(progress.variant, progress.variant.index - 1) }; save(); render(); } }, '← Назад'),
      last ? finishButton : el('button', { class: 'button', type: 'button', dataset: { enter: '1' }, onclick: () => { progress = { ...progress, variant: moveSession(progress.variant, progress.variant.index + 1) }; save(); render(); } }, 'Дальше →')));
    function finish() {
      commitClock();
      progress = finishVariant(progress, byId, now());
      variantConfirm = false;
      save();
      render();
    }
  }

  function renderVariantResult(v, actions) {
    const result = scoreSession(v, byId);
    const wrong = result.items.filter((i) => !i.correct).map((i) => i.id);
    if (wrong.length) {
      actions.append(el('button', { class: 'button alt', type: 'button', onclick: () => startRound(wrong) }, `Повторить ошибки варианта · ${wrong.length}`));
    }
    // Задание варианта сняли с сайта и заменить нечем: решить заново и поделиться можно только полным.
    const complete = isVariant(v.ids, byId);
    if (complete) {
      actions.append(el('button', {
        class: 'button ghost', type: 'button', id: 'restartVariant',
        onclick: () => { startLinkedVariant(v.ids); render(); },
      }, 'Решить этот вариант заново'));
    }
    const share = complete
      ? shareToggle('variant', 'Ссылка на этот вариант', pageUrl(`#/variant?${idsQuery(v.ids)}`),
        'По ссылке откроется этот же вариант — те же 13 заданий. Удобно, чтобы весь класс решал одно и то же.')
      : { button: null, box: el('p', { class: 'small muted', id: 'variantIncomplete', text: 'Часть заданий этого варианта сняли с сайта на исправление: решить его заново и поделиться ссылкой нельзя — соберите новый.' }) };
    const report = reportToggle('variant', { kind: 'variant', at: v.finishedAt, timeMs: (v.result || {}).timeMs, ids: v.ids, answers: sessionAnswers(v),
      score: result.score, total: result.total });
    // null — кнопки нет: штатный append напечатал бы его словом «null».
    actions.append(...[report.button, share.button].filter(Boolean));
    view.append(el('p', { class: 'section-title', text: 'Результат последнего варианта' }),
      scoreLine(result.score, result.total, 'первичных баллов за раздел 3'),
      Number.isFinite(v.result && v.result.timeMs)
        ? el('p', { class: v.result.timeMs > VARIANT_MINUTES * 60000 ? 'small variant-time over' : 'small variant-time', id: 'variantTime', text: `Время: ${formatClock(v.result.timeMs)} · рекомендовано ${VARIANT_MINUTES}:00` })
        : document.createDocumentFragment(),
      ruleAdvice(result.items),
      mistakeWork(result.items, { id: 'variantMistakes' }),
      sheet(v, { reveal: true, onPick: (i) => {
        // Только позиции варианта: у раскрытого разбора есть свой вложенный details.
        const items = view.querySelectorAll('.results > li > details');
        if (items[i]) { items[i].open = true; items[i].querySelector('summary').focus(); }
      } }),
      actions);
    // Закрытый блок ссылки — null: штатный append напечатал бы его словом «null».
    if (report.box) view.append(report.box);
    if (share.box) view.append(share.box);
    view.append(el('p', { class: 'section-title', text: 'Разбор по позициям' }),
      resultList(v.ids, v.answers));
  }

  // ---------- учителю: сводка отчётов ----------

  let teacherText = ''; // вставленные отчёты — только в памяти страницы, никуда не уходят

  function classNodes(text) {
    const { reports, broken } = decodeReports(text);
    if (!reports.length) {
      return [el('p', { class: 'small muted', id: 'classEmpty', text: broken
        ? `Кодов не прочитано: ${broken}. Попросите ученика прислать отчёт заново.`
        : 'Отчётов пока нет: вставьте сообщения учеников выше.' })];
    }
    const s = classSummary(reports, byId);
    const when = (at) => (Number.isNaN(Date.parse(at)) ? '' : new Date(at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }));
    const table = el('table', { class: 'class-table', id: 'classTable' },
      el('thead', {}, el('tr', {}, ['Ученик', 'Что', 'Когда', 'Результат', 'Время', 'Ошибки (номера)'].map((h) => el('th', { scope: 'col', text: h })))),
      el('tbody', {}, s.rows.map((r) => el('tr', {},
        el('td', { text: r.name || '(без имени)' }),
        el('td', { text: r.kind === 'variant' ? 'Вариант' : 'Раунд' }),
        el('td', { text: when(r.at) }),
        el('td', { text: `${r.score} из ${r.total}` + (r.reported ? ` (у ученика ${r.reported.score} из ${r.reported.total})` : '') }),
        el('td', { text: Number.isFinite(r.timeMs) ? formatClock(r.timeMs) : '—' }),
        el('td', { text: r.wrongTasks.join(', ') || '—' })))));
    return [
      el('p', { class: 'score' }, el('b', { text: String(reports.length) }),
        el('span', { class: 'muted', text: plural(reports.length, 'отчёт', 'отчёта', 'отчётов') + (broken ? ` · не прочитано ${broken}` : '') })),
      // Таблица шире телефона прокручивается внутри рамки — и с клавиатуры тоже.
      el('div', { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': 'Таблица класса' }, table),
      s.rows.some((r) => r.reported) ? el('p', { class: 'small muted', text: 'Счёт в скобках — как видел ученик: с тех пор в банке сняли задание или поправили ключ.' }) : null,
      s.byTask.length ? el('p', { class: 'section-title', text: 'Где ошибаются' }) : null,
      s.byTask.length ? el('ul', { class: 'usage', id: 'classByTask' }, s.byTask.map((t) => el('li', { text: `№${t.taskNumber} — ошибок ${t.wrong} из ${t.total}` }))) : null,
      s.byTopic.length ? el('p', { class: 'section-title', text: 'Темы с ошибками' }) : null,
      s.byTopic.length ? el('ul', { class: 'usage', id: 'classByTopic' }, s.byTopic.slice(0, 8).map((t) => {
        const topicRules = rules.filter((r) => r.topicIds.includes(t.topicId));
        return el('li', {}, el('b', { text: topicTitle(t.topicId) }), ` — ошибок ${t.wrong}`,
          topicRules.length ? ' · правило: ' : '',
          topicRules.flatMap((r, i) => [i ? ', ' : '', el('a', { href: `#/rules/${encodeURIComponent(r.id)}`, text: r.title })]));
      })) : null,
      s.unknown ? el('p', { class: 'small muted', text: `Заданий нет в нынешнем банке: ${s.unknown} — они не посчитаны.` }) : null,
    ].filter(Boolean);
  }

  function renderTeacher() {
    view.append(el('h2', { tabindex: '-1', dataset: { focus: '1' }, text: 'Результаты класса' }),
      el('p', { class: 'lead', text: 'Вставьте сюда сообщения учеников с отчётами — можно все сразу, как есть из мессенджера. Страница найдёт в них коды и сведёт результаты. Ничего никуда не отправляется.' }));
    const input = el('textarea', { class: 'report-text', id: 'reportsInput', rows: 8, placeholder: 'Отчёт: ЕГЭ, китайский, задания 15–27…', dataset: { key: 'teacher:input' } });
    input.value = teacherText;
    // Диктору — только короткая строка итога, а не вся таблица на каждое нажатие клавиши.
    const status = el('p', { class: 'sr-title', role: 'status', id: 'classStatus' });
    const out = el('div', { id: 'classSummary' });
    const update = () => {
      teacherText = input.value;
      const { reports, broken } = decodeReports(teacherText);
      status.textContent = `${reports.length} ${plural(reports.length, 'отчёт', 'отчёта', 'отчётов')}` + (broken ? `, не прочитано ${broken}` : '');
      out.replaceChildren(...classNodes(teacherText));
    };
    input.addEventListener('input', update);
    view.append(el('label', { class: 'field' }, 'Сообщения учеников', input), status, out);
    update();
  }

  // ---------- справка ----------

  function renderHelp() {
    const sources = ['открытый банк ФИПИ'];
    if (origins.includes('generated')) sources.push('новые задания в том же формате');
    if (origins.includes('hsk')) sources.push('задания HSK 4 (источник указан у задания)');
    const sourceNote = sources.length > 1 ? `${sources.slice(0, -1).join(', ')} и ${sources[sources.length - 1]}` : sources[0];
    const count = questions.length
      ? `${tasksWord(questions.length)} · ${rules.length} ${plural(rules.length, 'правило', 'правила', 'правил')}`
      : 'Банк готовится';
    view.append(el('h2', { tabindex: '-1', dataset: { focus: '1' }, text: 'Справка' }),
      el('p', { class: 'lead', text: 'Правило, короткая проверка, задания из банка ФИПИ и полный вариант раздела 3. Ошибку здесь разбирают на том варианте, который вы выбрали.' }),
      el('section', { class: 'help' },
        el('p', { class: 'section-title', text: 'Задания' }),
        el('p', {}, el('span', { id: 'bankCount', text: count }),
          `. Задания — ${sourceNote}, формат ЕГЭ ${DATA.meta.formatYear}. Разборы и правила проверены автором тренажёра.`),
        el('p', { class: 'section-title', text: 'Прогресс' }),
        el('p', { text: 'Прогресс хранится только в этом браузере на этом устройстве. Перенести его на другое устройство можно файлом: «Банк» → «Сохранить в файл».' }),
        el('p', { class: 'section-title', text: 'Клавиши' }),
        el('p', {}, el('kbd', { text: '1' }), '–', el('kbd', { text: '4' }), ' — выбрать ответ, ', el('kbd', { text: 'Enter' }), ' — дальше.'),
        el('p', { class: 'section-title', text: 'Учителю' }),
        el('p', { text: 'Ссылку на подборку, на задания раунда или на вариант можно взять в практике и на итоге: по ней ученики получат то же самое. С итога ученик отправляет отчёт учителю, а отчёты всего класса сводятся в одну таблицу.' }),
        el('p', {}, el('a', { href: '#/teacher', text: 'Учителю: сводка отчётов учеников' }))));
  }

  // ---------- банк и ошибки ----------

  function renderBank() {
    view.append(el('h2', { tabindex: '-1', dataset: { focus: '1' }, text: 'Банк и ошибки' }));
    if (!questions.length) {
      view.append(el('p', { class: 'lead', text: 'Все проверенные задания с источником и вашим результатом.' }), emptyBank());
      return;
    }
    const at = now();
    const stateOf = new Map(questions.map((q) => [q.id, answerState(progress, 'questions', q.id, at)]));
    const count = (s) => [...stateOf.values()].filter((x) => x === s).length;
    const mistakes = questions.filter((q) => stateOf.get(q.id) === 'mistake');
    const due = questions.filter((q) => stateOf.get(q.id) === 'due');
    view.append(el('p', { class: 'lead', text: 'Все проверенные задания с источником и вашим результатом. Ошибкой считается задание, на которое последний ответ был неверным. Исправленная ошибка возвращается на повтор через 1, 3 и 7 дней.' }),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('b', { text: String(questions.length) }), el('span', { text: 'в банке' })),
        el('div', { class: 'stat' }, el('b', { text: String(count('solved')) }), el('span', { text: 'решено верно' })),
        el('div', { class: 'stat' }, el('b', { text: String(count('due')) }), el('span', { text: 'пора повторить' })),
        el('div', { class: 'stat' }, el('b', { text: String(count('mistake')) }), el('span', { text: 'ошибки' })),
        el('div', { class: 'stat' }, el('b', { text: String(count('new')) }), el('span', { text: 'ещё не решались' }))),
      el('div', { class: 'actions' },
        el('button', { class: 'button', type: 'button', id: 'repeatMistakes', disabled: !mistakes.length, onclick: () => startRound(shuffle(mistakes.map((q) => q.id))) },
          mistakes.length ? `Повторить ошибки · ${mistakes.length}` : 'Ошибок нет'),
        due.length ? el('button', { class: 'button alt', type: 'button', id: 'repeatDue', onclick: () => startRound(shuffle(due.map((q) => q.id))) }, `Пора повторить · ${due.length}`) : null));
    const weak = weakTopics(questions, progress).filter((w) => topicsById.has(w.topicId));
    if (weak.length) {
      view.append(el('p', { class: 'section-title', text: 'Слабые темы' }),
        el('ul', { class: 'usage weak', id: 'weakTopics' }, weak.map((w) => {
          const topicRules = rules.filter((r) => r.topicIds.includes(w.topicId));
          return el('li', {},
            el('b', { text: topicsById.get(w.topicId).title }), ` — ошибок: ${w.count}`,
            topicRules.length ? ' · правило: ' : '',
            topicRules.flatMap((r, i) => [i ? ', ' : '', el('a', { href: `#/rules/${encodeURIComponent(r.id)}`, text: r.title })]));
        })));
    }
    // Все текущие ошибки по правилам — свёрнуто: список бывает длинным.
    view.append(mistakeWork(mistakes.map((q) => ({ id: q.id, chosen: progress.questions[q.id].last.optionId, correct: false })),
      { id: 'bankMistakes', open: false }));

    const select = (label, key, items) => el('label', { class: 'field' }, label,
      el('select', { dataset: { key: `bank:${key}` }, onchange: (e) => { bankFilters = { ...bankFilters, [key]: e.target.value }; render(false); } },
        items.map(([v, text]) => el('option', { value: v, selected: bankFilters[key] === v, text }))));
    const row = el('div', { class: 'filters-row' },
      select('Номер', 'task', [['', 'Все номера'], ...TASK_NUMBERS.filter((n) => questions.some((q) => q.taskNumber === n)).map((n) => [String(n), `Задание ${n}`])]),
      select('Тема', 'topic', [['', 'Все темы'], ...topics.filter((t) => questions.some((q) => q.topicIds.includes(t.id))).map((t) => [t.id, t.title])]),
      select('Результат', 'state', [['all', 'Любой'], ['new', 'Не решались'], ['mistake', 'Ошибки'], ['due', 'Пора повторить'], ['solved', 'Решено верно']]));
    if (origins.length > 1) row.append(select('Источник', 'origin', [['', 'Все'], ...origins.map((o) => [o, ORIGIN_NAMES[o] || o])]));
    const dirty = Object.keys(BANK_FILTERS).some((k) => bankFilters[k] !== BANK_FILTERS[k]);
    row.append(el('button', {
      class: 'button ghost', type: 'button', id: 'resetBankFilters', disabled: !dirty,
      onclick: () => {
        bankFilters = { ...BANK_FILTERS };
        render(false);
        // Кнопка стала недоступна — фокус на первом поле, а не в никуда.
        view.querySelector('select[data-key="bank:task"]').focus();
      },
    }, 'Сбросить фильтры'));
    view.append(el('div', { class: 'section-title', text: 'Задания' }), row);

    const shown = questions.filter((q) => (!bankFilters.task || q.taskNumber === Number(bankFilters.task))
      && (!bankFilters.topic || q.topicIds.includes(bankFilters.topic))
      && (!bankFilters.origin || q.origin === bankFilters.origin)
      && (bankFilters.state === 'all' || stateOf.get(q.id) === bankFilters.state));
    const STATE_TEXT = { new: 'не решалось', mistake: 'ошибка', due: 'повторить', solved: 'верно' };
    view.append(el('p', { class: 'small muted', 'aria-live': 'polite', text: `Показано: ${tasksWord(shown.length)}` }),
      el('ul', { class: 'bank-list' }, shown.map((q) => {
        const state = stateOf.get(q.id);
        return el('li', {}, el('button', { class: 'bank-item', type: 'button', onclick: () => startRound([q.id]) },
          el('span', { class: 'n cellnum', text: String(q.taskNumber) }),
          el('span', {},
            el('span', { class: 'zh', lang: 'zh', text: q.stem.replace(/\s+/g, ' ') }),
            el('span', { class: 'meta', text: `${q.topicIds.map((t) => (topicsById.get(t) || {}).title).filter(Boolean).join(', ')} · ${originLabel(q)}${q.draft ? ' · черновик' : ''}` })),
          el('span', { class: `state ${state}`, text: STATE_TEXT[state] })));
      })));

    view.append(el('p', { class: 'section-title', text: 'Прогресс' }),
      el('p', { class: 'small muted', text: 'Прогресс хранится только в этом браузере на этом устройстве. Чтобы продолжить на другом устройстве, сохраните его в файл и загрузите там: ответы объединятся, по каждому заданию останется последний.' }));
    const fileInput = el('input', {
      type: 'file', accept: '.json,application/json', hidden: true, id: 'progressFile',
      onchange: (e) => importProgress(e.target.files[0]),
    });
    view.append(el('div', { class: 'actions' },
      el('button', { class: 'button ghost', type: 'button', id: 'exportProgress', disabled: progressLocked, dataset: { key: 'progress:export' }, onclick: downloadProgress }, 'Сохранить в файл'),
      el('button', { class: 'button ghost', type: 'button', id: 'importProgress', disabled: progressLocked, dataset: { key: 'progress:import' }, onclick: () => fileInput.click() }, 'Загрузить из файла'),
      fileInput));
    if (transferNotice) {
      view.append(el('p', { class: transferNotice.ok ? 'notice' : 'notice warn', role: 'status', id: 'transferNotice', text: transferNotice.text }));
    }
    const reset = el('div', { class: 'actions' });
    if (!resetConfirm) {
      reset.append(el('button', { class: 'button ghost danger', type: 'button', id: 'resetProgress', disabled: progressLocked, onclick: () => { resetConfirm = true; render(false); } }, 'Сбросить прогресс'));
    } else {
      reset.append(el('span', { class: 'notice warn', text: 'Ответы, ошибки и результаты вариантов будут удалены.' }),
        el('button', { class: 'button danger ghost', type: 'button', id: 'confirmReset', onclick: () => {
          // Вкладка могла пропустить запись новой версии (bfcache) — проверить хранилище перед удалением.
          if (progressLocked || newer(storage.get(PROGRESS_KEY))) {
            lockProgress();
            resetConfirm = false;
            render(false);
            return;
          }
          progress = emptyProgress();
          storage.remove(PROGRESS_KEY);
          resetConfirm = false;
          transferNotice = null;
          render(false);
        } }, 'Удалить прогресс'),
        el('button', { class: 'button ghost', type: 'button', onclick: () => { resetConfirm = false; render(false); } }, 'Отмена'));
    }
    view.append(reset);
  }

  function downloadProgress() {
    if (progressLocked) return; // прогресс новой версии страница не прочитала — выгружать нечего
    const at = now();
    const url = URL.createObjectURL(new Blob([exportProgress(progress, at)], { type: 'application/json' }));
    const link = el('a', { href: url, download: `ege-lg-trainer-progress-${at.slice(0, 10)}.json` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const FILE_ERRORS = {
    'not-json': 'Файл не прочитан: это не файл прогресса тренажёра.',
    'not-progress': 'Это не файл прогресса тренажёра. Нужен файл, сохранённый кнопкой «Сохранить в файл».',
    version: 'Файл сохранён другой версией тренажёра и сюда не подходит.',
  };

  async function importProgress(file) {
    if (!file || progressLocked) return;
    let result;
    try {
      result = readProgressFile(await file.text());
    } catch {
      result = { ok: false, reason: 'not-json' };
    }
    if (result.ok) {
      try {
        progress = pruneProgress(mergeProgress(progress, result.progress), questions);
      } catch {
        result = { ok: false, reason: 'not-progress' };
      }
    }
    if (result.ok) {
      save();
      const count = Object.keys(result.progress.questions).length;
      transferNotice = storageOk
        ? { ok: true, text: `Прогресс из файла объединён с этим браузером. В файле ответы на ${tasksWord(count)}.` }
        : { ok: false, text: progressLocked
          ? 'Прогресс из файла не сохранён: в этом браузере прогресс более новой версии тренажёра — обновите страницу.'
          : 'Прогресс из файла не сохранён: браузер не даёт записать.' };
    } else {
      transferNotice = { ok: false, text: FILE_ERRORS[result.reason] };
    }
    render(false);
  }

  // ---------- клавиатура, тема, запуск ----------

  document.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const tag = (event.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (/^[1-4]$/.test(event.key)) {
      const button = view.querySelector(`[data-card] .option[data-option="${event.key}"]:not(:disabled)`);
      if (button) {
        event.preventDefault();
        button.click();
      }
      return;
    }
    if (event.key === 'Enter' && tag !== 'button' && tag !== 'a' && tag !== 'summary') {
      const next = view.querySelector('[data-enter]:not(:disabled)');
      if (next) {
        event.preventDefault();
        next.click();
      }
    }
  });

  const themeLabel = document.getElementById('themeLabel');
  // Кнопка-переключатель «Тёмная тема»: подпись постоянная, состояние — в aria-pressed.
  function syncTheme() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const toggle = document.getElementById('themeToggle');
    themeLabel.textContent = 'Тёмная тема';
    toggle.setAttribute('aria-pressed', String(dark));
    toggle.title = dark ? 'Включить светлую тему' : 'Включить тёмную тему';
    // Строка браузера — цвета бумаги выбранной темы, а не темы системы.
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.setAttribute('content', dark ? '#1B2338' : '#F2F4EF'));
  }
  document.getElementById('themeToggle').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    storage.set(THEME_KEY, next);
    syncTheme();
  });
  syncTheme();

  document.getElementById('reviewBanner').hidden = !DATA.meta.drafts;

  // Ссылка «К содержимому» переводит фокус, а не меняет маршрут.
  document.querySelector('.skip').addEventListener('click', (event) => {
    event.preventDefault();
    view.focus();
  });
  // Работа без сети (только опубликованная страница по http): кэш страницы и шрифтов.
  if (DATA.meta.offline && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }
  window.addEventListener('hashchange', () => {
    if (location.hash && !location.hash.startsWith('#/')) return;
    shareOpen = null;
    render();
  });
  // Часы варианта: пауза, пока страница скрыта; раз в секунду — табло, раз в полминуты — запись.
  document.addEventListener('visibilitychange', syncClock);
  window.addEventListener('pagehide', () => { if (clock) saveClock(); });
  setInterval(() => {
    const t = Date.now();
    // Тик пропал больше чем на 5 с (сон, перевод часов) — это пауза, а не время варианта.
    if (clock && lastTick && t - lastTick > 5000) {
      commitClock(lastTick);
      clock = { ...clock, since: t };
    }
    lastTick = t;
    if (!clock) return;
    const node = document.getElementById('variantClock');
    if (node) paintClock(node);
    if (t - clockSaved > 30000) saveClock();
  }, 1000);

  // Другая вкладка записала прогресс — берём его: иначе следующее действие здесь вернуло бы
  // старое. Время того же варианта не убывает.
  window.addEventListener('storage', (event) => {
    if (event.key !== PROGRESS_KEY || progressLocked) return;
    if (newer(event.newValue)) {
      lockProgress();
      render(false);
      return;
    }
    commitClock();
    let incoming = pruneProgress(parseProgress(event.newValue), questions);
    const mine = progress.variant;
    const theirs = incoming.variant;
    if (timed(mine) && theirs && theirs.startedAt === mine.startedAt && !(theirs.elapsedMs >= mine.elapsedMs)) {
      incoming = { ...incoming, variant: { ...theirs, elapsedMs: mine.elapsedMs } };
    }
    progress = incoming;
    render(false);
  });
  render(false);
})();
