// Интерфейс тренажёра. Чистая логика — в logic.mjs (при сборке она стоит выше в том же скрипте).
// Весь текст из банка выводится через textContent: разметку из данных страница не исполняет.

(function () {
  'use strict';

  const DATA = JSON.parse(document.getElementById('trainer-data').textContent);
  // Слова тренировки тонов: у всех одно и то же приходит один раз (toneBase). Это вопросы того же вида, что
  // задания №15 (origin 'words'): практика берёт их как задания, а вкладка «Тоны» — только их.
  const toneQuestions = (DATA.tones || []).map((q) => ({ ...DATA.toneBase, ...q }));
  const questions = [...DATA.questions, ...toneQuestions];
  const topics = DATA.topics;
  const rules = DATA.rules;
  const checks = DATA.ruleChecks;
  const byId = new Map(questions.map((q) => [q.id, q]));
  const itemById = byId;
  const allItems = questions;
  const olympiad = DATA.vsosh;
  const olympiadCards = vsoshCards(olympiad);
  const olympiadById = new Map(olympiadCards.map((card) => [card.id, card]));
  const olympiadTopics = new Map((olympiad?.topics ?? []).map((topic) => [topic.id, topic.label]));
  const olympiadSources = new Map((olympiad?.sources ?? []).map((source) => [source.id, source]));
  const topicsById = new Map(topics.map((t) => [t.id, t]));
  const rulesById = new Map(rules.map((r) => [r.id, r]));
  const checksById = new Map(checks.map((c) => [c.id, c]));
  const origins = [...new Set(questions.map((q) => q.origin))];
  const ORIGIN_NAMES = { fipi: 'Банк ФИПИ', generated: 'Новые задания', hsk: 'HSK 4', words: 'Слова HSK 1–4' };
  const TONE_FILTERS_KEY = 'ege-lg-trainer:tones-filters';
  const SOLO_STEM = new Set([15, 19]);
  const FILTERS_KEY = 'ege-lg-trainer:filters';
  const TRAINING_DEFAULT_KEY = 'ege-lg-trainer:training-default';
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
  let progress = pruneProgress(loaded, allItems);
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

  // Один раз меняем прежний выбор обоих разделов; затем уважаем сохранённый режим.
  const migrateToTraining = storage.get(TRAINING_DEFAULT_KEY) !== '1';
  function loadFilters() {
    const empty = { topics: [], tasks: [], rules: [], origins: [], state: 'all', size: '10', roundType: 'training' };
    try {
      const raw = JSON.parse(storage.get(FILTERS_KEY) || 'null');
      if (!raw || typeof raw !== 'object') return empty;
      return fitRules({
        topics: Array.isArray(raw.topics) ? raw.topics.filter((t) => topicsById.has(t)) : [],
        tasks: Array.isArray(raw.tasks) ? raw.tasks.filter((n) => TASK_NUMBERS.includes(n)) : [],
        rules: Array.isArray(raw.rules) ? raw.rules.filter((r) => rulesById.has(r)) : [],
        origins: Array.isArray(raw.origins) ? raw.origins.filter((o) => origins.includes(o)) : [],
        state: ['all', 'new', 'done', 'review', 'mistakes'].includes(raw.state) ? raw.state : 'all',
        size: roundSize(raw.size) || '10',
        roundType: !migrateToTraining && raw.roundType === 'test' ? 'test' : 'training',
      }, questions);
    } catch {
      return empty;
    }
  }
  let filters = loadFilters();
  function saveFilters() {
    return storage.set(FILTERS_KEY, JSON.stringify(filters));
  }

  // Настройка раунда тонов хранится отдельно от практики: уровни HSK, длина слова, состояние, размер.
  function loadToneFilters() {
    const empty = { levels: [], lengths: [], state: 'all', size: '10', roundType: 'training' };
    try {
      const raw = JSON.parse(storage.get(TONE_FILTERS_KEY) || 'null');
      if (!raw || typeof raw !== 'object') return empty;
      return {
        levels: Array.isArray(raw.levels) ? raw.levels.filter((n) => TONE_LEVELS.includes(n)) : [],
        lengths: Array.isArray(raw.lengths) ? raw.lengths.filter((n) => TONE_LENGTHS.includes(n)) : [],
        state: ['all', 'new', 'done', 'review', 'mistakes'].includes(raw.state) ? raw.state : 'all',
        size: roundSize(raw.size) || '10',
        roundType: !migrateToTraining && raw.roundType === 'test' ? 'test' : 'training',
      };
    } catch {
      return empty;
    }
  }
  let toneFilters = loadToneFilters();
  function saveToneFilters() {
    return storage.set(TONE_FILTERS_KEY, JSON.stringify(toneFilters));
  }
  if (migrateToTraining) {
    const practiceSaved = saveFilters();
    const tonesSaved = saveToneFilters();
    if (practiceSaved && tonesSaved) storage.set(TRAINING_DEFAULT_KEY, '1');
  }

  // Проверка правил не сохраняется между перезагрузками: это короткая разминка.
  let checkSession = null;
  let variantConfirm = false;
  let resetConfirm = false;
  let transferNotice = null; // итог загрузки файла прогресса, виден на экране банка
  let shareNotice = prunedNotice(loaded, progress); // что открыто по ссылке учителя; показывается один раз
  let shareOpen = null; // какой блок «Ссылка…» раскрыт: setup, round или variant
  let practiceSourcesOpen = false;
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

  // Новый экран — с начала страницы: на телефоне сверху выход и деления раунда. Плавная прокрутка
  // прошлого экрана может ещё идти (пробел по разбору или сдвиг к нему после ответа, а сразу за
  // ними Enter), и Chrome доводит её на новом экране: одного сброса мало. Поэтому ещё
  // HOLD_TOP_MS страница на каждом шаге прокрутки возвращается к началу. Ученик сам листает,
  // кликает, жмёт клавишу или отвечает — удержание снимается сразу, его прокрутку не перебиваем.
  // Конец по scrollend не годится: Chrome шлёт его после каждого сброса, пока прокрутка идёт.
  const HOLD_TOP_MS = 400;
  let releaseTop = null; // снимает удержание начала страницы

  function holdTop() {
    if (releaseTop) releaseTop();
    window.scrollTo(0, 0);
    const keep = () => { if (window.scrollY) window.scrollTo(0, 0); };
    const user = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
    const timer = setTimeout(release, HOLD_TOP_MS);
    function release() {
      clearTimeout(timer);
      window.removeEventListener('scroll', keep);
      user.forEach((type) => window.removeEventListener(type, release, true));
      releaseTop = null;
    }
    window.addEventListener('scroll', keep);
    // В фазе перехвата: Enter, который открыл этот экран, её уже прошёл и удержание не снимет.
    user.forEach((type) => window.addEventListener(type, release, { capture: true, passive: true }));
    releaseTop = release;
  }

  // data-key элемента под последним касанием или щелчком: на iPhone касание флажка не даёт ему фокус.
  let touchedKey = null;
  document.addEventListener('pointerdown', (event) => {
    const node = event.target.closest && (event.target.closest('[data-key]') || (event.target.closest('label') || { querySelector: () => null }).querySelector('[data-key]'));
    touchedKey = node ? node.dataset.key : null;
  }, true);
  const keyed = (key) => [...view.querySelectorAll('[data-key]')].find((node) => node.dataset.key === key);

  function render(focus = true) {
    const active = document.activeElement;
    const activeKey = active && active.dataset ? active.dataset.key : null;
    // Перерисовка на месте не сдвигает нажатое под пальцем: строка «Следующего раунда» выше
    // флажков меняет высоту, а прокрутка остаётся прежней. Запоминаем, где было нажатое.
    const anchorKey = focus ? null : activeKey || touchedKey;
    const anchorNode = anchorKey ? keyed(anchorKey) : null;
    const anchorTop = anchorNode ? anchorNode.getBoundingClientRect().top : null;
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
    const olympiadMode = name === 'vsosh' && olympiadCards.length > 0;
    document.getElementById('egeSubtitle').hidden = olympiadMode;
    document.getElementById('vsoshSubtitle').hidden = !olympiadMode;
    view.replaceChildren();
    view.classList.remove('practice-setup');
    startBarText = null;
    if (name !== 'bank') transferNotice = null;
    if (name !== 'variant') pendingVariant = null;
    if (name === 'rules' && arg) renderRule(arg);
    else if (name === 'rules') renderRules();
    else if (name === 'check') renderCheck();
    else if (name === 'practice') renderPractice();
    else if (olympiadMode) renderVsosh(arg);
    else if (name === 'tones') renderTones();
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
    if (!olympiadMode && progressLocked) {
      view.append(el('p', { class: 'notice warn small', id: 'progressLocked', text: 'Прогресс сохранён более новой версией тренажёра. Обновите страницу — иначе новые ответы не сохранятся.' }));
    } else if (!olympiadMode && !storageOk) {
      view.append(el('p', { class: 'notice warn small', text: 'Браузер не даёт сохранить прогресс: он пропадёт после перезагрузки страницы.' }));
    }
    if (focus) {
      holdTop();
      const target = view.querySelector('[data-focus]') || view;
      target.focus({ preventScroll: true });
    } else {
      const same = activeKey ? keyed(activeKey) : null;
      if (same) same.focus({ preventScroll: true });
      const anchor = anchorKey ? keyed(anchorKey) : null;
      if (anchor && anchorTop !== null) {
        const shift = anchor.getBoundingClientRect().top - anchorTop;
        if (shift) window.scrollBy(0, shift);
      }
    }
    view.classList.toggle('has-start-bar', Boolean(document.getElementById('startBar')));
    syncStartBar();
    syncClock();
    const clockNode = document.getElementById('variantClock');
    if (clockNode) paintClock(clockNode);
  }

  // ---------- общие части ----------

  // «Перечитайте правило» — к ошибкам раунда или варианта. Без ошибок — пустой фрагмент:
  // null штатный view.append напечатал бы словом «null».
  function ruleAdvice(items) {
    const ids = rulesForMistakes(items, itemById, new Set(rulesById.keys()));
    if (!ids.length) return document.createDocumentFragment();
    const links = ids.flatMap((id, i) => [i ? ', ' : '', el('a', { href: `#/rules/${encodeURIComponent(id)}`, text: rulesById.get(id).title })]);
    return el('p', { class: 'notice advice', id: 'ruleAdvice' }, 'Перечитайте правило: ', ...links, '.');
  }

  // Название номера — тема из оглавления практики.
  function taskTitle(n) {
    const topic = topics.find((t) => t.taskNumbers.includes(n));
    return topic ? topic.title : `Задание ${n}`;
  }

  // Номер в клетке бланка; чтец экрана слышит «Задание 22».
  const cellnum = (n) => el('span', { class: 'cellnum' }, el('span', { class: 'sr', text: 'Задание ' }), String(n));

  // Сводка итога раунда по номерам: номер, его тема, сколько ошибок из скольких заданий.
  // Раунд одного номера — без сводки: она повторила бы общий счёт.
  function taskScore(items) {
    const rows = scoreByTask(items, itemById);
    if (rows.length < 2) return document.createDocumentFragment();
    return el('section', { class: 'by-task', 'aria-labelledby': 'byTaskTitle' },
      el('h3', { id: 'byTaskTitle', text: 'По номерам' }),
      el('ul', { id: 'roundByTask' }, rows.map((r) => el('li', { class: r.wrong ? 'bad' : 'ok' },
        cellnum(r.taskNumber),
        el('span', { class: 'title', text: taskTitle(r.taskNumber) }),
        el('span', { class: 'count', text: `ошибок ${r.wrong} из ${r.total}` })))));
  }

  // Работа над ошибками: по номерам в порядке экзамена; у задания — его правило, ваш ответ,
  // верный и почему. Повтор — только ошибки этого номера.
  function mistakeWork(items, { id, open = true, mode = null, roundType = 'test' }) {
    const groups = groupMistakesByTask(items, itemById);
    if (!groups.length) return document.createDocumentFragment();
    const entries = groups.flatMap((g) => g.entries);
    const skipped = entries.filter((e) => e.chosen == null).length;
    // Иероглифы — шрифтом кайшу; буквы порядка (№26), тоны (№15) и числа (№19) — обычным.
    const answer = (text) => (/[\u3400-\u9fff]/.test(text) ? el('span', { class: 'zh', lang: 'zh', text }) : el('b', { text }));
    const zh = (text) => el('span', { class: 'zh', lang: 'zh', text });
    return el('details', { class: 'mistakes', id, open },
      el('summary', { text: `Работа над ошибками · ${entries.length - skipped}` + (skipped ? ` · без ответа ${skipped}` : '') }),
      groups.map((g) => el('section', { class: 'mistake-group' },
        el('h3', {}, cellnum(g.taskNumber), ` ${taskTitle(g.taskNumber)} · ${g.entries.length}`),
        el('ul', { class: 'mistake-list' }, g.entries.map((entry) => {
          const q = itemById.get(entry.id);
          const e = explainChoice(q, entry.chosen);
          const why = entry.chosen == null ? e.correctExplanation : e.chosenExplanation;
          // №26: верный порядок собранным предложением — буквы сами по себе ничего не объясняют.
          const sentence = q.fragments ? assembledOrder(q) : '';
          const rules = (q.ruleIds || []).filter((r) => rulesById.has(r)).map((r) => rulesById.get(r));
          return el('li', {},
            zh(q.stem.replace(/\s+/g, ' ') + (q.taskNumber === 15 ? ' — тоны' : '')),
            rules.length ? el('span', { class: 'small mistake-rule' }, rules.length > 1 ? 'правила: ' : 'правило: ',
              rules.flatMap((r, i) => [i ? ', ' : '', el('a', { href: `#/rules/${encodeURIComponent(r.id)}`, text: r.title })])) : null,
            el('span', { class: 'small' }, entry.chosen == null ? 'без ответа' : ['ваш ответ: ', answer(e.chosenText)],
              ' → верно: ', answer(e.correctText)),
            sentence ? el('span', { class: 'small' }, 'верный порядок: ', zh(sentence)) : null,
            why ? el('span', { class: 'small muted', text: why }) : null);
        })),
        el('button', {
          class: 'button ghost', type: 'button',
          onclick: () => startRound(shuffle(g.entries.map((x) => x.id)), mode, roundType),
        }, `Повторить ошибки №${g.taskNumber} · ${g.entries.length}`))));
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
      const action = link.ids.length ? linkAction(progress.round, link.ids, link.roundType) : null;
      if (action === 'continue' || action === 'result') {
        shareNotice = { warn: false, text: SAME_LINK.round[action] };
      } else if (action) {
        progress = { ...progress, round: startSession(link.ids, now(), null, link.roundType) };
        save();
        if (link.missing) shareNotice = { warn: true, text: `Из ссылки не найдено в банке: ${tasksWord(link.missing)}. Раунд собран из остальных.` };
      } else {
        shareNotice = { warn: true, text: 'Заданий из ссылки больше нет в банке. Выберите подборку сами.' };
        target = '#/practice/setup';
      }
    } else {
      filters = { ...filters, ...link.filters, state: 'all', roundType: link.filters.roundType || 'test' };
      // Ссылка только с правилами: отмечаются их номера, иначе правила под оглавлением не видны.
      if (filters.rules.length && !filters.tasks.length) filters.tasks = ruleTasks(filters.rules, questions);
      // Правило без заданий в номерах ссылки (их сняли с сайта) тоже не выбрано — ученик узнает.
      const asked = filters.rules.length;
      filters = fitRules(filters, questions);
      const missingRules = link.missingRules + asked - filters.rules.length;
      saveFilters();
      const gone = [
        link.missing ? (link.missing === 1 ? 'одной темы' : `${link.missing} тем`) : '',
        missingRules ? (missingRules === 1 ? 'одного правила' : `${missingRules} правил`) : '',
      ].filter(Boolean).join(' и ');
      shareNotice = gone
        ? { warn: true, text: `Подборка открыта по ссылке, но ${gone} из неё на сайте больше нет — выбраны остальные.` }
        : { warn: false, text: 'Подборка открыта по ссылке: фильтры и размер раунда уже выбраны.' };
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
              await navigator.clipboard.writeText(input.value); // размер раунда меняет ссылку на месте
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

  const sessionAnswers = (session) => initialRoundIds(session).map((id) => session.answers[id] ?? null);

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
    if (q.origin === 'words') return `Слово HSK ${q.level}`;
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

  // Пропуск — клетка 田字格. До ответа — всегда одна клетка: ширина не подсказывает, сколько
  // знаков вписать. Ответ ученика вписан синим и раздвигает пропуск по числу знаков; после
  // проверки — галочка или зачёркнутое и верный ответ над клеткой красной ручкой.
  function blankNode({ written, state, fix }) {
    const chars = written ? [...written.replace(/\s+/g, '')] : [];
    let label = 'пропуск';
    if (state === 'right' && written) label = `пропуск: верно, ${written}`;
    else if (state === 'wrong' && written && fix) label = `пропуск: выбрано ${written}, верно ${fix}`;
    else if (state === 'wrong' && fix) label = `пропуск: верно ${fix}`;
    else if (state === 'wrong' && written) label = `пропуск: выбрано ${written}, неверно`;
    else if (written) label = `пропуск, вписано: ${written}`;
    // Подпись русская внутри китайского предложения — lang='ru', вписанное — снова zh.
    const box = el('span', { class: ['tz', written ? 'written' : '', state || ''].filter(Boolean).join(' '), role: 'img', lang: 'ru', 'aria-label': label });
    // Ответы в банке — до трёх знаков; что длиннее четырёх, вписывается в одну вытянутую клетку.
    if (chars.length > 4) {
      box.append(el('span', { class: 'c long' }, el('span', { class: 'ink', lang: 'zh', text: written })));
    } else {
      for (let i = 0; i < Math.max(1, chars.length); i += 1) box.append(el('span', { class: 'c' }, chars[i] ? el('span', { class: 'ink', lang: 'zh', text: chars[i] }) : null));
    }
    if (state === 'right' && written) box.append(tickMark());
    if (fix) box.append(el('span', { class: 'fix', lang: 'zh', 'aria-hidden': 'true', text: fix }));
    return box;
  }

  // Пропуски текста text по порядку: возвращает функцию, которая превращает куски stemSegments
  // в текст и клетки. Куски можно отдавать частями (формулировка вопроса режется на русское и
  // китайское) — счёт пропусков сквозной. selected — выбранный вариант, reveal — после проверки.
  function blankCells(item, text, { selected, reveal }) {
    const chosen = selected == null ? null : blankFill(item, selected, text);
    const right = reveal ? blankFill(item, item.correctOptionId, text) : null;
    const correct = selected != null && selected === item.correctOptionId;
    let index = 0;
    return (parts) => parts.map((part) => {
      if (!part.blank) return part.text;
      const i = index;
      index += 1;
      return blankNode({
        written: chosen ? chosen[i] : null,
        state: reveal ? (correct ? 'right' : 'wrong') : null,
        fix: reveal && !correct && right ? right[i] : null,
      });
    });
  }

  // Предложение с пропусками-клетками.
  function sentenceNode(item, text, cls, state) {
    return el('p', { class: cls, lang: 'zh' }, blankCells(item, text, state)(stemSegments(text)));
  }

  function stemNode(q, state) {
    if (q.taskNumber === 26 && q.fragments) {
      return el('ol', { class: 'fragments' },
        q.fragments.map((f) => el('li', {}, el('b', { text: f.id }), el('span', { text: f.text }))));
    }
    return sentenceNode(q, q.stem, SOLO_STEM.has(q.taskNumber) ? 'stem solo' : 'stem', state);
  }

  // Карточка вопроса: задание ЕГЭ или вопрос по правилу. reveal — показать верный/неверный.
  // hint — что делают Enter и пробел; null — они ничего не делают, undefined — без подсказки клавиш
  // (она видна только при мыши и клавиатуре).
  function questionCard(item, { kind, selected, reveal, onChoose, heading, hint }) {
    const card = el('article', { class: 'question', dataset: { card: '1' } });
    if (kind === 'exam') card.append(questionPills(item));
    else {
      card.append(el('div', { class: 'pills' },
        item.ruleIds.map((id) => rulesById.get(id)).filter(Boolean).map((r) => el('span', { class: 'pill quiet', text: r.title })),
        item.draft ? el('span', { class: 'pill draft', text: 'черновик' }) : null));
    }
    // Китайское внутри формулировки вопроса по правилу — крупнее русского текста; предложение
    // — своей строкой размером с условие задания, пропуск в нём — клетка, как в условии.
    // Клетки — только в китайских кусках (их и считает blankFill) и не у задания ЕГЭ: его
    // пропуск — в условии под формулировкой.
    const runs = chineseRuns(heading || item.prompt);
    const zh = kind === 'exam' ? '' : runs.filter((r) => r.zh).map((r) => r.text).join(' ');
    const cells = blankCells(item, zh, { selected, reveal });
    card.append(el('p', { class: 'instruction', tabindex: '-1', dataset: { focus: '1' } },
      runs.map((r) => {
        if (!r.zh) return r.text;
        const parts = zh ? stemSegments(r.text) : [{ text: r.text }];
        const cls = ['prompt-zh', r.line ? 'line' : '', parts.some((p) => p.blank) ? 'blanks' : ''].filter(Boolean).join(' ');
        return el('span', { class: cls, lang: 'zh' }, cells(parts));
      })));
    if (kind === 'exam') card.append(stemNode(item, { selected, reveal }));
    else if (item.sentence) {
      card.append(sentenceNode(item, item.sentence, 'stem', { selected, reveal }));
      if (item.sentenceRu) card.append(el('p', { class: 'stem-ru', text: item.sentenceRu }));
    }
    card.append(optionButtons(item, { selected, reveal, onChoose }));
    if (hint !== undefined) {
      card.append(el('p', { class: 'keys' }, 'Клавиши: ', el('kbd', { text: '1' }), '–', el('kbd', { text: String(item.options.length) }), ' — ответ',
        hint ? [', ', el('kbd', { text: 'Enter' }), ' или ', el('kbd', { text: 'Space' }), ` — ${hint}`] : null));
    }
    return card;
  }

  function optionButtons(item, { selected, reveal, onChoose, labels = false }) {
    // В ряд — только короткие варианты; союзы №27 с «……» в узкой колонке рвались бы посередине.
    const short = item.options.every((o) => o.text.length <= 12 && !o.text.includes('…'));
    // Числа и тоны — не китайский текст: свой ряд, без переноса внутри варианта.
    const plain = item.options.every((o) => !isChinese(o.text));
    const list = el('div', { class: ['options', short ? 'row' : '', short && plain ? 'plain' : ''].filter(Boolean).join(' '), role: 'group', 'aria-label': 'Варианты ответа' });
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
      }, el('span', { class: 'num', text: labels ? o.id : String(i + 1) }),
      // Тоны «2-4-2», числа и «CAB» — не китайский текст: свой шрифт и lang.
      isChinese(o.text) ? el('span', { class: 'text', lang: 'zh', text: o.text }) : el('span', { class: 'text plain', lang: 'ru', text: o.text })));
    });
    return list;
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
    // tabindex — фокус после ответа, когда «Дальше» за краем экрана, а начало разбора на нём
    // (focusAfterAnswer).
    const box = el('section', { class: 'feedback', 'aria-live': 'polite', tabindex: '-1' });
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
  function sessionBar({ exit, marks, index, label, right, useTicks = marks.length <= 30 }) {
    const bar = el('div', { class: 'session-bar' },
      el('a', { class: 'exit', href: exit, 'aria-label': 'Выйти', title: 'Выйти', text: '✕' }));
    if (useTicks) {
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

  // Панель с «Дальше» липкая (телефон) — или null.
  function stickyDock() {
    const dock = view.querySelector('.dock');
    return dock && getComputedStyle(dock).position === 'sticky' ? dock : null;
  }

  // После ответа предложение с исправлением красной ручкой не уходит с экрана: ученик видит, что
  // не так. Начало разбора не помещается под вариантами — страница сдвигается ровно настолько,
  // чтобы его показать, но не дальше, чем до предложения у верхнего края. Предложение уже за
  // верхним краем (ученик докрутил до вариантов) — страница возвращает его. Остальное разбора
  // ученик прокрутит сам.
  function afterAnswer() {
    const card = view.querySelector('[data-card]');
    const box = view.querySelector('.feedback');
    const dock = stickyDock();
    let delta = 0;
    const y0 = window.scrollY;
    if (releaseTop) releaseTop(); // сдвиг к разбору важнее начала страницы (holdTop)
    if (card && box) {
      const anchor = card.querySelector('.stem') || card.querySelector('.fragments') || card.querySelector('.instruction');
      const visibleBottom = window.innerHeight - (dock ? dock.getBoundingClientRect().height : 0);
      // Заголовок разбора и первая строка — около трёх с половиной строк шрифта разбора.
      const head = box.getBoundingClientRect().top + 3.5 * parseFloat(getComputedStyle(box).fontSize);
      const top = anchor.getBoundingClientRect().top - 12;
      delta = top < 0 ? top : Math.max(0, Math.min(top, head - visibleBottom));
      if (delta) window.scrollBy({ top: delta, behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
    // Без анимации сдвиг уже сделан, плавный ещё впереди: фокусу важен только оставшийся.
    focusAfterAnswer(delta - (window.scrollY - y0));
  }

  // Фокус после ответа — без прокрутки; delta — сдвиг страницы, который ещё впереди. На «Дальше» —
  // только если её видно (липкая панель на телефоне или кнопка на экране после сдвига). Иначе
  // фокус на разборе, если его начало на экране, а нет (низкий экран: сдвиг дошёл до предложения
  // у верхнего края) или разбора нет (полный вариант) — на условии. Enter и пробел всё равно
  // ведут дальше: их ловит общий обработчик клавиш; разбор листают стрелки и PageDown.
  function focusAfterAnswer(delta = 0) {
    const next = view.querySelector('[data-enter]') || view.querySelector('#finishVariant');
    const box = view.querySelector('.feedback');
    const top = (node) => node.getBoundingClientRect().top - delta;
    const seen = (node) => top(node) >= 0 && node.getBoundingClientRect().bottom - delta <= window.innerHeight;
    let target = view.querySelector('[data-card] .instruction');
    if (next && (stickyDock() || seen(next))) target = next;
    else if (box && top(box) < window.innerHeight) target = box;
    if (target) target.focus({ preventScroll: true });
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
        filters = { ...filters, topics: [], tasks: ruleTasks([id], questions), rules: [id], origins: [], state: 'all' };
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
          class: 'button', type: 'button', dataset: { enter: '1', space: '1' },
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
      const count = filterQuestions(own, { topics: filters.topics }, progress).length;
      return { n, title: taskTitle(n), total: own.length, count };
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
            cellnum(r.n),
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
    // Счёт — задания правила в отмеченных номерах (и в теме из старой ссылки), как счёт оглавления.
    const base = filterQuestions(questions, { topics: filters.topics, tasks: filters.tasks }, progress);
    const items = shown
      .map((r) => ({ value: r.id, label: r.title, count: base.filter((q) => (q.ruleIds || []).includes(r.id)).length }))
      .filter((it) => it.count || filters.rules.includes(it.value));
    if (!items.length) {
      let hint = 'Отметьте номер — здесь появятся его правила, чтобы взять задания только на одно из них.';
      if (numbers.length) hint = filters.topics.length ? 'В выбранной теме у отмеченных номеров правил нет.' : 'У отмеченных номеров правил пока нет.';
      return el('fieldset', { class: 'filter', id: 'grammar' }, el('legend', { text: 'Грамматика' }),
        el('p', { class: 'small muted hint', text: hint }));
    }
    return chipGroup('Грамматика', items, filters.rules, (v) => { filters.rules = toggle(filters.rules, v); saveFilters(); render(false); }, 'grammar');
  }

  // Телефон: «Начать раунд» стоит наверху, в «Следующем раунде». Ученик листает настройки — кнопка
  // уходит за верхний край, и у нижнего края её повторяет панель с числом заданий в раунде, чтобы
  // не листать обратно. Панель показывает syncStartBar: на прокрутке, при смене размера окна и
  // когда меняется размер раунда.
  const onPhone = () => window.matchMedia('(max-width: 720px)').matches;
  let startBarText = null; // () => подпись панели; null — на экране панели нет

  function startBar(button, text) {
    startBarText = text;
    return el('div', { class: 'start-bar', id: 'startBar' },
      el('p', { id: 'startBarText' }),
      el('button', { class: 'button', type: 'button', id: 'barStart', disabled: button.disabled, onclick: () => button.click() }, 'Начать раунд'));
  }

  function syncStartBar() {
    const bar = document.getElementById('startBar');
    if (!bar) return;
    const real = view.querySelector('#startRound, #startTones');
    document.getElementById('startBarText').textContent = startBarText ? startBarText() : '';
    let shown = false;
    if (real && onPhone()) {
      const viewport = window.visualViewport;
      const visibleBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
      const rect = real.getBoundingClientRect();
      shown = rect.bottom < 0 || rect.top > visibleBottom - bar.offsetHeight;
    }
    bar.classList.toggle('is-shown', shown);
  }

  // Состояние ответов: общий список для практики и тонов (подпись в «Следующем раунде» — его же).
  const STATE_OPTIONS = [['all', 'Все'], ['new', 'Только новые'], ['done', 'Уже решённые'], ['review', 'На повторение'], ['mistakes', 'Ошибки']];
  const STATE_HELP = {
    all: 'И новые, и уже решённые задания.',
    new: 'Задания, на которые вы ещё ни разу не отвечали. Ответ с ошибкой тоже считается попыткой.',
    done: 'Хотя бы одна попытка ответа, включая неверные.',
    review: 'Ошибки и задания, у которых подошёл срок повторения.',
    mistakes: 'Задания, на которые последний ответ был неверным.',
  };
  // В строке «Следующего раунда» состояние — с «только»: «Новые задания · новые» читалось бы как повтор.
  const STATE_SUMMARY = { new: 'только новые', done: 'только решённые', review: 'на повторение', mistakes: 'только ошибки' };

  function roundStateControl(legend, state, onChange) {
    return el('fieldset', { class: 'filter', id: 'stateFilter', 'aria-describedby': 'stateHelp' },
      el('legend', { text: legend }),
      el('div', { class: 'chips' }, STATE_OPTIONS.map(([value, label]) => el('label', { class: 'chip' },
        el('input', {
          type: 'radio', name: 'roundState', value, checked: state === value, dataset: { key: `state:${value}` },
          onchange: () => onChange(value),
        }),
        el('span', { text: label })))),
      el('p', { class: 'small muted', id: 'stateHelp', text: STATE_HELP[state] }));
  }

  function roundModeControl(settings, persist) {
    return el('fieldset', { class: 'filter round-type', id: 'roundTypeFilter' },
      el('legend', { text: 'Режим' }),
      el('div', { class: 'chips mode-options' }, [['test', 'Тест'], ['training', 'Тренировка']].map(([value, label]) =>
        el('label', { class: 'chip' },
          el('input', { type: 'radio', name: 'roundType', value, checked: settings.roundType === value,
            dataset: { key: `roundType:${value}` },
            onchange: () => { settings.roundType = value; persist(); render(false); } }),
          el('span', { text: label })))));
  }

  const trainingHint = (unit = 'заданий') => el('p', { class: 'small muted training-hint',
    text: `Каждая ошибка вернётся один раз: через пять других ${unit} или в конце раунда.` });

  function practiceIcon(kind) {
    const ns = 'http://www.w3.org/2000/svg';
    const icon = document.createElementNS(ns, 'svg');
    const size = kind === 'link' ? 16 : 14;
    for (const [key, value] of Object.entries({ class: 'practice-icon', width: size, height: size,
      viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7',
      'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) icon.setAttribute(key, value);
    const paths = kind === 'link'
      ? ['M10 13a5 5 0 0 0 7.1 0l3-3a5 5 0 0 0-7.1-7.1l-1.7 1.7', 'M14 11a5 5 0 0 0-7.1 0l-3 3a5 5 0 0 0 7.1 7.1l1.7-1.7']
      : ['m6 9 6 6 6-6'];
    for (const d of paths) {
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', d);
      icon.append(path);
    }
    return icon;
  }

  function practiceStateControl() {
    const labels = { all: 'Все задания', new: 'Новые', done: 'Решённые' };
    return el('fieldset', { class: 'filter', id: 'stateFilter' },
      el('legend', { id: 'stateLegend', text: 'Какие задания' }),
      el('div', { class: 'practice-select' },
        el('select', {
          'aria-labelledby': 'stateLegend', 'aria-describedby': 'stateHelp', dataset: { key: 'state' },
          onchange: (event) => { filters.state = event.target.value; saveFilters(); render(false); },
        }, STATE_OPTIONS.map(([value, label]) => el('option', { value, selected: filters.state === value, text: labels[value] || label }))),
        practiceIcon('chevron')),
      el('p', { class: 'sr', id: 'stateHelp', text: STATE_HELP[filters.state] }));
  }

  // «Следующий раунд» — первым на экране, как в тренажёре по лингвострановедению: что войдёт в
  // раунд одной строкой, сколько заданий и кнопка; настройки — ниже. Ушла кнопка за верхний край
  // (настройки листают на телефоне) — у нижнего края её повторяет панель (startBar).
  function nextRound({ summary, notice, start, resume, warning, compact = false, detail }) {
    if (compact) {
      return el('section', { class: 'next practice-next', 'aria-label': 'Следующий раунд' },
        el('div', { class: 'practice-heading' },
          el('h2', { class: 'next-summary', id: 'nextSummary', tabindex: '-1', dataset: { focus: '1' }, text: summary }),
          notice, detail),
        el('div', { class: 'actions' }, start, resume),
        warning);
    }
    return el('section', { class: 'next', 'aria-label': 'Следующий раунд' },
      el('p', { class: 'next-summary', id: 'nextSummary', text: summary }),
      notice,
      warning,
      el('div', { class: 'actions' }, start, resume),
      start.disabled ? null : el('p', { class: 'keys' }, el('kbd', { text: 'Enter' }), ' — начать раунд'));
  }

  // Части через « · »: в названиях правил свои запятые. Два правила и больше — числом.
  function practiceSummary() {
    const tasks = [...filters.tasks].sort((a, b) => a - b);
    const topics = filters.topics.map(topicTitle);
    const parts = [];
    if (tasks.length) parts.push(`${tasks.length === 1 ? 'Задание' : 'Задания'} ${tasks.join(', ')}`);
    if (topics.length) parts.push(`${tasks.length ? 'т' : 'Т'}${topics.length === 1 ? 'ема' : 'емы'}: ${topics.join('; ')}`);
    if (!parts.length) parts.push(`Все задания ${TASK_NUMBERS[0]}–${TASK_NUMBERS[TASK_NUMBERS.length - 1]}`);
    const ruleTitles = filters.rules.map((id) => rulesById.get(id)).filter(Boolean).map((r) => r.title);
    if (ruleTitles.length === 1) parts.push(`правило: ${ruleTitles[0]}`);
    else if (ruleTitles.length) parts.push(`${ruleTitles.length} ${plural(ruleTitles.length, 'правило', 'правила', 'правил')}`);
    if (filters.origins.length) parts.push(filters.origins.map((o) => ORIGIN_NAMES[o] || o).join(', '));
    if (STATE_SUMMARY[filters.state]) parts.push(STATE_SUMMARY[filters.state]);
    return parts.join(' · ');
  }

  function toneSummary() {
    const levels = [...toneFilters.levels].sort((a, b) => a - b);
    const lengths = [...toneFilters.lengths].sort((a, b) => a - b);
    const parts = [levels.length ? `HSK ${levels.join(', ')}` : 'Все уровни HSK 1–4'];
    parts.push(lengths.length ? `${lengths.join(' и ')} иероглифа` : 'слова из 2–3 иероглифов');
    if (STATE_SUMMARY[toneFilters.state]) parts.push(STATE_SUMMARY[toneFilters.state]);
    return parts.join(' · ');
  }

  function renderPractice() {
    // Круг тонов идёт на своей вкладке: «Практика» его не открывает и не продолжает.
    const round = isTonesRound(progress.round) ? null : progress.round;
    if (round && !round.finishedAt && route().arg !== 'setup') {
      renderRound();
      return;
    }
    if (round && round.finishedAt && route().arg !== 'setup') {
      renderRoundResult();
      return;
    }
    view.classList.add('practice-setup');
    if (!questions.length) {
      view.append(el('h2', { tabindex: '-1', dataset: { focus: '1' }, text: 'Практика ЕГЭ' }), emptyBank());
      return;
    }
    const available = filterQuestions(questions, filters, progress, now());
    const size = roundSizeControl(available.length);
    size.node.append(el('div', { class: 'practice-size-body' }, size.node.querySelector('.chips'), size.node.querySelector('.size-own')));
    const unfinishedTones = isTonesRound(progress.round) && !progress.round.finishedAt && Object.keys(progress.round.answers).length;
    const start = el('button', {
      class: 'button', type: 'button', id: 'startRound', disabled: !available.length, dataset: { enter: '1' },
      // Поле применяется и здесь: если касание кнопки не увело из него фокус (iPhone).
      onclick: () => { size.commit(); startRound(pickRound(available, filters.size).map((q) => q.id)); },
    }, 'Начать раунд');
    view.append(nextRound({
      compact: true,
      summary: practiceSummary(),
      notice: el('p', { class: 'sr', id: 'available', 'aria-live': 'polite', text: availableText(available.length) }),
      detail: el('p', { class: 'practice-available', id: 'practiceAvailable', 'aria-hidden': 'true', text: practiceAvailableText(available.length) }),
      warning: unfinishedTones ? el('p', { class: 'notice warn small', id: 'replaceWarning', text: 'У вас начат раунд тонов. Новый раунд практики заменит его: вернуться к тонам будет нельзя.' }) : null,
      start,
      resume: round && !round.finishedAt ? el('a', { class: 'button alt', href: '#/practice', text: `Продолжить раунд · ${roundAnswerCount(round)} из ${round.ids.length + (round.retryQueue?.length || 0)}` }) : null,
    }));
    view.append(el('div', { class: 'practice-settings' }, roundModeControl(filters, saveFilters), practiceStateControl(), size.node));
    if (filters.roundType === 'training') view.append(trainingHint());
    const contents = taskContents();
    contents.classList.add('practice-contents');
    view.append(contents);
    const grammar = grammarFilter();
    if (grammar.querySelector('.chips')) view.append(grammar);
    const secondary = el('div', { class: 'practice-secondary' });
    if (origins.length > 1) {
      const sourceLabel = filters.origins.length === 0 ? 'все'
        : filters.origins.length === 1 ? (ORIGIN_NAMES[filters.origins[0]] || filters.origins[0]) : `${filters.origins.length} выбрано`;
      secondary.append(el('details', {
        class: 'practice-sources', open: practiceSourcesOpen,
        ontoggle: (event) => { practiceSourcesOpen = event.currentTarget.open; },
      },
      el('summary', {}, el('span', { text: `Источники: ${sourceLabel}` }), practiceIcon('chevron')),
      chipGroup('Источник', origins.map((o) => ({ value: o, label: ORIGIN_NAMES[o] || o, count: questions.filter((q) => q.origin === o).length })),
        filters.origins, (v) => { practiceSourcesOpen = true; filters.origins = toggle(filters.origins, v); saveFilters(); render(false); })));
    }
    const hasFilters = filters.topics.length || filters.tasks.length || filters.rules.length || filters.origins.length || filters.state !== 'all';
    const actions = el('div', { class: 'actions practice-service' },
      hasFilters ? el('button', {
        class: 'button ghost', type: 'button',
        title: 'Снять выбор номеров, правил, источников и результатов. Размер раунда сохранится.',
        onclick: () => { filters = { ...filters, topics: [], tasks: [], rules: [], origins: [], state: 'all' }; saveFilters(); render(false); },
      }, 'Снять фильтры') : null);
    const share = shareToggle('setup', 'Поделиться настройками', pageUrl(`#/practice?${shareQuery(filters)}`),
      'По ссылке откроются выбранные номера, правила, источники и размер раунда. Случайные задания у каждого будут свои.',
      !available.length);
    share.button.prepend(practiceIcon('link'));
    actions.append(share.button);
    secondary.append(actions);
    view.append(secondary);
    if (share.box) view.append(share.box);
    view.append(startBar(start,
      () => (available.length ? `В раунд: ${tasksWord(roundCount(filters.size, available.length))}${unfinishedTones ? ' · заменит начатый круг тонов' : ''}` : 'Заданий нет')));
  }

  function practiceAvailableText(count) {
    if (!count) return availableText(count);
    return `${tasksWord(roundCount(filters.size, count))} в раунде · ${count.toLocaleString('ru-RU')} доступно`;
  }

  function availableText(count) {
    if (count) {
      const size = roundCount(filters.size, count);
      const report = size > REPORT_MAX_TASKS ? ` Отчёт учителю — только для раунда до ${REPORT_MAX_TASKS} заданий.` : '';
      return `Доступно: ${tasksWord(count)}. В раунд попадёт ${size}.${report}`;
    }
    if (filters.state === 'mistakes') return 'Ошибок с такими фильтрами нет.';
    if (filters.state === 'done') return 'Решённых с такими фильтрами пока нет.';
    if (filters.state === 'review') return 'Повторять пока нечего: ошибок нет, а исправленные ещё не подошли к сроку.';
    if (filters.state === 'new') return 'Новых заданий с такими фильтрами не осталось. Выберите «Все» или измените фильтры.';
    return 'С такими фильтрами заданий нет — снимите часть фильтров.';
  }

  // Размер раунда: быстрые числа и своё число с клавиатуры (Enter, уход из поля, стрелки) или
  // кнопками ±. Меняется на месте, без перерисовки: поле применяет число, когда фокус уходит, —
  // щелчок, который его увёл («Начать раунд», «+»), не должен попасть в уже снятую кнопку.
  const ROUND_PRESETS = [['5', '5'], ['10', '10'], ['15', '15'], ['20', '20'], ['30', '30'], ['all', 'все']];
  function roundSizeControl(available, scope = { filters, save: saveFilters, text: availableText, share: true }) {
    const field = el('input', {
      id: 'roundSize', class: 'size-input', type: 'text', inputmode: 'numeric', autocomplete: 'off',
      'aria-describedby': 'available', dataset: { key: 'size' },
    });
    const less = el('button', { class: 'button ghost size-step', type: 'button', id: 'roundLess', 'aria-label': 'На одно задание меньше', dataset: { key: 'size:less' }, text: '−' });
    const more = el('button', { class: 'button ghost size-step', type: 'button', id: 'roundMore', 'aria-label': 'На одно задание больше', dataset: { key: 'size:more' }, text: '+' });
    const presets = ROUND_PRESETS.map(([value]) => el('input', {
      type: 'radio', name: 'roundPreset', value, dataset: { key: `Размер:${value}` }, onchange: () => set(value),
    }));
    let shown = '';
    // Упёршаяся кнопка — aria-disabled, а не disabled: она не срабатывает, но держит фокус.
    // Иначе фокус пришлось бы переносить, и пробел ушёл бы в поле, а на телефоне открылась бы клавиатура.
    const off = (button) => button.getAttribute('aria-disabled') === 'true';
    function sync() {
      const count = roundCount(scope.filters.size, available);
      shown = scope.filters.size === 'all' ? (available ? String(available) : '') : scope.filters.size;
      field.value = shown;
      for (const preset of presets) preset.checked = preset.value === scope.filters.size;
      less.setAttribute('aria-disabled', String(count <= 1));
      more.setAttribute('aria-disabled', String(count >= Math.min(available, ROUND_SIZE_MAX)));
    }
    function set(value) {
      scope.filters.size = value;
      scope.save();
      sync();
      const notice = document.getElementById('available');
      if (notice) notice.textContent = scope.text(available);
      const detail = document.getElementById('practiceAvailable');
      if (detail) detail.textContent = (scope.detail || practiceAvailableText)(available);
      syncStartBar();
      const link = document.querySelector('#shareBox .share-url');
      if (link && scope.share && shareOpen === 'setup') link.value = pageUrl(`#/practice?${shareQuery(filters)}`);
    }
    // Вписанное применяется; не число — в поле возвращается прежнее.
    function commit() {
      if (!field.isConnected) return;
      const next = field.value.trim() === shown ? null : typedRoundSize(field.value);
      if (next === null) field.value = shown;
      else set(next);
    }
    function step(delta) {
      commit();
      if (!off(delta > 0 ? more : less)) set(stepRoundSize(scope.filters.size, available, delta));
    }
    less.addEventListener('click', () => step(-1));
    more.addEventListener('click', () => step(1));
    // Щелчок или Tab выделяют число целиком: новое печатается поверх. Без preventDefault
    // отпускание кнопки мыши снимает выделение.
    let fresh = false;
    field.addEventListener('focus', () => { field.select(); fresh = true; });
    field.addEventListener('mouseup', (e) => { if (fresh) e.preventDefault(); fresh = false; });
    field.addEventListener('blur', () => { fresh = false; commit(); });
    field.addEventListener('keydown', (e) => {
      fresh = false;
      if (e.isComposing) return; // Enter подтверждает набор в китайской раскладке, а не число
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
        field.select();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        step(e.key === 'ArrowUp' ? 1 : -1);
      }
    });
    sync();
    const node = el('fieldset', { class: 'filter size-filter', id: 'roundSizeBox' },
      el('legend', { text: 'Размер раунда' }),
      el('div', { class: 'chips' }, presets.map((input, i) => el('label', { class: 'chip' }, input, el('span', { text: ROUND_PRESETS[i][1] })))),
      el('div', { class: 'size-own' },
        el('label', { for: 'roundSize', text: 'Своё число' }),
        el('div', { class: 'stepper' }, less, field, more)));
    return { node, commit };
  }

  // Круг тренировки тонов (mode 'tones') идёт в той же сессии раунда, но на своей вкладке.
  const roundHome = (round) => (isTonesRound(round) ? '#/tones' : '#/practice');

  function startRound(ids, mode = null, roundType = null) {
    if (!ids.length) return;
    shareOpen = null; // блок ссылки или отчёта прошлого итога в новом раунде не открывается сам
    const type = roundType || (mode === TONES_MODE ? toneFilters.roundType : filters.roundType);
    progress = { ...progress, round: startSession(ids, now(), mode, type) };
    save();
    go(mode === TONES_MODE ? '#/tones' : '#/practice');
  }

  function renderRound() {
    const round = progress.round;
    const id = round.ids[round.index];
    const q = itemById.get(id);
    const training = isTrainingRound(round);
    const originals = initialRoundIds(round);
    const answered = originals.filter((x) => round.answers[x] !== undefined);
    const correct = answered.filter((x) => round.answers[x] === itemById.get(x).correctOptionId).length;
    const chosen = roundAnswer(round);
    const tones = isTonesRound(round);
    const pending = training ? round.retryQueue.length : 0;
    const marks = round.ids.map((x, i) => markOf(roundAnswer(round, i), itemById.get(x).correctOptionId));
    marks.push(...Array(pending).fill(null));
    view.append(sessionBar({
      exit: `${roundHome(round)}/setup`, index: round.index, label: `${tones ? 'Слово' : 'Задание'} ${round.index + 1} из ${marks.length}`,
      right: training ? `с первого раза: ${correct} из ${originals.length}` : `верно: ${correct}`,
      marks, useTicks: originals.length <= 30,
    }));
    if (training) view.append(el('p', { class: 'pills round-mode-status' },
      el('span', { class: 'pill quiet', text: 'Тренировка' }),
      round.ids.slice(0, round.index).includes(id) ? el('span', { class: 'pill quiet repeat-mark', text: 'Повтор ошибки' }) : null));
    view.append(questionCard(q, {
      kind: 'exam',
      selected: chosen,
      reveal: chosen !== undefined,
      hint: 'дальше',
      onChoose: (optionId) => {
        if (progress.round.index !== round.index || progress.round.ids[progress.round.index] !== id || roundAnswer(progress.round) !== undefined) return;
        progress = recordAnswer({ ...progress, round: answerRound(progress.round, optionId, grade(q, optionId).correct) },
          'questions', id, optionId, grade(q, optionId).correct, now());
        save();
        render(false);
        afterAnswer();
      },
    }));
    if (chosen !== undefined) {
      view.append(feedback(q, chosen));
      const last = round.index === round.ids.length - 1 && !pending;
      view.append(el('div', { class: 'actions dock' }, el('button', {
        class: 'button', type: 'button', dataset: { enter: '1', space: '1' },
        onclick: () => {
          progress = { ...progress, round: advanceRound(progress.round, now()) };
          save();
          render();
        },
      }, last ? 'Итог раунда' : round.index === round.ids.length - 1 && pending ? 'Повторить ошибку' : 'Дальше')));
    }
  }

  function resultList(ids, answers, repeats = {}) {
    return el('ul', { class: 'results' }, ids.map((id) => {
      const q = itemById.get(id);
      const chosen = answers[id];
      const ok = chosen !== undefined && chosen !== null && chosen === q.correctOptionId;
      const retried = Object.hasOwn(repeats, id);
      const corrected = retried && repeats[id] === q.correctOptionId;
      const body = el('div', { class: 'body' });
      const item = el('details', {
        ontoggle: (e) => {
          if (!e.target.open || body.childElementCount) return;
          if (retried) body.append(el('p', { class: 'small muted', text: `На повторе: ${optionText(q, repeats[id])} — ${corrected ? 'верно' : 'ошибка'}. Ниже — разбор первой попытки.` }));
          body.append(questionCard(q, { kind: 'exam', selected: chosen, reveal: true, onChoose: () => {} }));
          if (chosen == null) body.append(el('p', { class: 'notice warn', text: 'Ответа не было.' }));
          body.append(feedback(q, chosen == null ? null : chosen));
        },
      },
      el('summary', {},
        el('span', { class: 'n cellnum', text: String(q.taskNumber) }),
        el('span', { class: 'zh', lang: 'zh', text: q.stem.replace(/\s+/g, ' ') }),
        el('span', { class: ok || corrected ? 'ok-mark' : 'bad-mark', text: corrected ? 'исправлено' : ok ? 'верно' : chosen == null ? 'без ответа' : retried ? 'снова ошибка' : 'ошибка' })),
      body);
      return el('li', {}, item);
    }));
  }

  function renderRoundResult() {
    const round = progress.round;
    const result = scoreSession(round, itemById);
    const wrong = result.items.filter((i) => !i.correct).map((i) => i.id);
    const tones = isTonesRound(round);
    const mode = tones ? TONES_MODE : null;
    const training = isTrainingRound(round);
    const roundType = training ? 'training' : 'test';
    const ids = initialRoundIds(round);
    const retries = training ? trainingResult(round, itemById) : null;
    view.append(el('h2', { tabindex: '-1', dataset: { focus: '1' }, text: training ? 'Тренировка окончена' : 'Раунд окончен' }),
      scoreLine(result.score, result.total, training ? 'верных с первой попытки' : 'верных ответов'));
    if (training) view.append(el('p', { class: 'training-result', id: 'trainingResult',
      text: `Повторов: ${retries.repeated} · исправлено: ${retries.corrected} · осталось ошибок: ${retries.remaining}.` }));
    // Слова тренировки тонов учитель по ID не разберёт: ни ссылки, ни отчёта у такого раунда нет.
    const share = tones ? { button: null, box: null }
      : shareToggle('round', 'Ссылка на эти задания', pageUrl(`#/practice?${idsQuery(ids, roundType)}`),
        `По ссылке откроется раунд из этих же заданий (${ids.length}) в том же порядке — одинаковый для всех, кто её получит.`);
    // Код отчёта держит не больше REPORT_MAX_TASKS заданий: учитель большой раунд не прочитал бы.
    const report = tones ? { button: null, box: null } : ids.length <= REPORT_MAX_TASKS
      ? reportToggle('round', { kind: 'round', at: round.finishedAt || now(), ids, answers: sessionAnswers(round),
        score: result.score, total: result.total })
      : { button: null, box: el('p', { class: 'small muted', id: 'reportTooBig', text: `Отчёт учителю — для раунда до ${REPORT_MAX_TASKS} заданий, а в этом ${ids.length}. Для отчёта соберите раунд поменьше.` }) };
    view.append(el('div', { class: 'actions result-actions' },
      wrong.length ? el('button', { class: 'button', type: 'button', onclick: () => startRound(shuffle(wrong), mode, roundType) }, `Повторить ошибки ${training ? 'первой попытки' : 'раунда'} · ${wrong.length}`) : null,
      el('a', { class: wrong.length ? 'button alt' : 'button', href: `${roundHome(round)}/setup`, text: 'Новый раунд' }),
      el('button', { class: 'button ghost', type: 'button', id: 'restartRound', onclick: () => startRound(ids, mode, roundType) }, tones ? 'Решить эти слова заново' : 'Решить эти задания заново'),
      report.button,
      share.button,
      el('a', { class: 'button ghost', href: '#/rules', text: 'На главную' })));
    if (report.box) view.append(report.box);
    if (share.box) view.append(share.box);
    view.append(taskScore(result.items), ruleAdvice(result.items),
      mistakeWork(result.items, { id: 'roundMistakes', mode, roundType }),
      resultList(ids, round.answers, retries ? retries.repeats : {}));
  }

  // ---------- практика ВсОШ ----------

  const VSOSH_SESSION_KEY = 'ege-lg-trainer:vsosh-session';
  const vsoshStages = { regional: 'Региональный этап', final: 'Заключительный этап' };

  function readVsoshState() {
    const empty = { topics: [], size: '10', roundType: 'training', round: null, draft: null };
    try {
      const raw = JSON.parse(window.sessionStorage.getItem(VSOSH_SESSION_KEY));
      const topics = Array.isArray(raw?.topics) ? [...new Set(raw.topics.filter((id) => olympiadTopics.has(id)))] : [];
      const restored = restoreVsoshRound(raw?.round, olympiadById, now());
      const round = restored?.round ?? null;
      const draft = restored?.draft ?? raw?.draft;
      const card = round && olympiadById.get(round.ids[round.index]);
      return {
        topics, round, size: roundSize(raw?.size) || empty.size,
        roundType: raw?.roundType === 'test' ? 'test' : 'training',
        draft: card?.context && !round.finishedAt && roundAnswer(round) === undefined
          && validVsoshChoices(card, draft, true) ? draft : null,
      };
    } catch {
      return empty;
    }
  }

  const vsoshState = readVsoshState();
  function saveVsosh() {
    // Вкладки браузера могут решать разные раунды. Перезагрузка текущей вкладки сохраняет выбор.
    try { window.sessionStorage.setItem(VSOSH_SESSION_KEY, JSON.stringify(vsoshState)); } catch { /* продолжим в памяти */ }
  }

  function vsoshPool() {
    return olympiadCards.filter((card) => !vsoshState.topics.length
      || card.questions.some((q) => vsoshState.topics.includes(q.topicId)));
  }

  function startVsosh(ids, type = vsoshState.roundType) {
    if (!ids.length) return;
    vsoshState.round = startSession(ids, now(), 'vsosh', type);
    vsoshState.draft = null;
    saveVsosh();
    go('#/vsosh');
  }

  const cardsWord = (n) => `${n} ${plural(n, 'карточка', 'карточки', 'карточек')}`;

  function renderVsoshSetup() {
    view.classList.add('practice-setup');
    const available = vsoshPool();
    const count = available.length;
    const countText = () => cardsWord(roundCount(vsoshState.size, count));
    const detail = () => count ? `${countText()} в раунде · ${count} доступно` : 'По выбранным темам карточек нет.';
    const size = roundSizeControl(count, { filters: vsoshState, save: saveVsosh, text: detail, detail, share: false });
    size.node.append(el('div', { class: 'practice-size-body' }, size.node.querySelector('.chips'), size.node.querySelector('.size-own')));
    const start = el('button', {
      class: 'button', type: 'button', id: 'startRound', disabled: !count, dataset: { enter: '1' },
      onclick: () => {
        size.commit();
        startVsosh(shuffle(available).slice(0, roundCount(vsoshState.size, count)).map((card) => card.id));
      },
    }, 'Начать раунд');
    const round = vsoshState.round;
    const topics = vsoshState.topics.map((id) => olympiadTopics.get(id));
    const summary = topics.length ? topics.join(' · ') : 'Все темы ВсОШ';
    view.append(nextRound({
      compact: true, summary, start,
      notice: el('p', { class: 'sr', id: 'available', 'aria-live': 'polite', text: detail() }),
      detail: el('p', { class: 'practice-available', id: 'practiceAvailable', 'aria-hidden': 'true', text: detail() }),
      resume: round && !round.finishedAt ? el('a', { class: 'button alt', href: '#/vsosh',
        text: `Продолжить раунд · ${roundAnswerCount(round)} из ${round.ids.length + (round.retryQueue?.length || 0)}` }) : null,
    }));
    view.append(el('div', { class: 'practice-settings vsosh-settings' }, roundModeControl(vsoshState, saveVsosh), size.node));
    if (vsoshState.roundType === 'training') view.append(trainingHint('карточек'));
    view.append(chipGroup('Темы', [...olympiadTopics].map(([value, label]) => ({ value, label })), vsoshState.topics,
      (value) => {
        vsoshState.topics = toggle(vsoshState.topics, value);
        saveVsosh();
        render(false);
      }, 'vsoshTopics'));
    if (topics.length) view.append(el('div', { class: 'actions practice-service' },
      el('button', { class: 'button ghost', type: 'button', onclick: () => {
        vsoshState.topics = [];
        saveVsosh();
        render(false);
        view.querySelector('#vsoshTopics input').focus();
      } }, 'Снять фильтры')));
    view.append(startBar(start, () => count ? `В раунд: ${countText()}` : 'Карточек нет'));
  }

  function vsoshChoice(question, option, step, index, select) {
    const correct = option.id === question.correctId;
    const chosen = option.id === step.choices[index];
    const state = step.checked ? (correct ? ' correct' : chosen ? ' wrong' : '') : '';
    const chinese = isChinese(option.text);
    return el('label', { class: `option vsosh-choice${state}` },
      el('input', { type: 'radio', name: `vsosh-${question.id}`, checked: chosen, onchange: () => select(index, option.id) }),
      el('span', { class: 'num', text: option.id }),
      el('span', { class: chinese ? 'text' : 'text plain', lang: chinese ? 'zh' : 'ru', text: option.text }));
  }

  function vsoshOptions(question, step, index, select) {
    return el('fieldset', { class: 'vsosh-options', disabled: step.checked },
      el('legend', { text: `Пропуск ${question.gapNumber}` }),
      el('div', { class: 'options' }, question.options.map((option) => vsoshChoice(question, option, step, index, select))));
  }

  function vsoshStem(question, step, select) {
    if (question.kind === 'wordPlacement') {
      return el('fieldset', { class: 'vsosh-placement', disabled: step.checked },
        el('legend', { class: 'sr', text: 'Место для слова' }),
        el('p', { class: 'stem', lang: 'zh' },
          question.stem.split(/(\{\{[A-D]\}\}[，。！？；：、]?)/g).map((part, index) => {
            if (index % 2 === 0) return part;
            const letter = part[2];
            const correct = letter === question.correctId;
            const chosen = letter === step.choices[0];
            const state = step.checked ? (correct ? ' correct' : chosen ? ' wrong' : '') : '';
            return el('span', { class: 'vsosh-position-token' },
              el('button', { class: `vsosh-place${state}`, type: 'button', disabled: step.checked,
                'aria-pressed': String(chosen), dataset: { option: String(question.options.findIndex((o) => o.id === letter) + 1) },
                onclick: () => select(0, letter) },
              el('span', { class: 'num', text: letter }),
              step.checked && correct ? el('span', { lang: 'zh', text: question.insertionText }) : null),
              part.slice(5));
          })));
    }
    if (question.emphasis) {
      const { start, length } = question.emphasis;
      return el('p', { class: 'stem', lang: 'zh' }, question.stem.slice(0, start),
        el('u', { text: question.stem.slice(start, start + length) }), question.stem.slice(start + length));
    }
    const stem = question.stem.replace(/…+|\.{3,}/g, '___');
    const show = step.checked ? step.choices[0] : null;
    const format = ['stroke-count', 'tone-pattern', 'chengyu'].includes(question.topicId) ? 'stem solo' : 'stem';
    return sentenceNode({ ...question, correctOptionId: question.correctId }, stem, format, { selected: show, reveal: step.checked });
  }

  function vsoshPassage(card, step) {
    const byNumber = new Map(card.questions.map((q, index) => [String(q.gapNumber), { q, index }]));
    return el('div', { class: 'vsosh-passage', lang: 'zh' }, card.context.text.split('\n').map((paragraph) =>
      el('p', {}, paragraph.split(/\{\{(\d+)\}\}/g).map((part, index) => {
        if (index % 2 === 0) return part;
        const { q, index: gap } = byNumber.get(part);
        const correct = step.choices[gap] === q.correctId;
        return el('span', {
          class: `vsosh-gap${step.checked ? (correct ? ' correct' : ' wrong') : ''}`,
          lang: step.checked ? 'zh' : 'ru',
          text: step.checked ? optionText(q, q.correctId) : part,
        });
      }))));
  }

  function vsoshScore(card, answer) {
    return card.questions.filter((q, index) => answer?.[index] === q.correctId).length;
  }

  function vsoshSourceLink(source, question) {
    const url = source?.taskUrl || source?.archiveUrl || source?.publicationUrl;
    if (!url || !/^https?:\/\//i.test(url)) return null;
    const page = source.taskUrl && question.taskPages?.[0];
    const label = source.taskUrl ? 'Бланк' : source.archiveUrl ? 'Комплект в ZIP' : 'Публикация';
    return el('a', { href: page ? `${url}#page=${page}` : url, target: '_blank', rel: 'noopener', text: label });
  }

  function vsoshFeedback(card, step, source) {
    const q = card.questions[0];
    const key = (item) => {
      const value = item.insertionText || optionText(item, item.correctId);
      return [item.correctId, ' ', el('span', { lang: isChinese(value) ? 'zh' : 'ru', text: value })];
    };
    const note = card.context?.editorNote || q.editorNote;
    const link = vsoshSourceLink(source, q);
    const headingId = `vsosh-verdict-${card.id}`;
    const box = el('section', { class: 'feedback vsosh-feedback', tabindex: '-1', 'aria-labelledby': headingId,
      'aria-live': card.context ? null : 'polite' });
    if (card.context) {
      box.append(el('h3', { id: headingId, text: `Верных ответов ${vsoshScore(card, step.choices)} из ${card.questions.length}` }),
        el('ul', {}, card.questions.map((item, index) => {
          const correct = step.choices[index] === item.correctId;
          return el('li', { class: 'vsosh-answer' }, `№ ${item.gapNumber} · `,
            el('b', { class: correct ? 'ok-mark' : 'bad-mark', text: correct ? 'Верно' : 'Ошибка' }),
            correct ? ' · ' : '. Верный ответ ', key(item));
        })));
    } else {
      const correct = step.choices[0] === q.correctId;
      box.append(el('div', { class: `verdict ${correct ? 'ok' : 'bad'}` },
        el('h3', { class: 'vsosh-answer', id: headingId }, correct ? 'Верно · ' : 'Ошибка. Верный ответ ', key(q))));
    }
    if (note) box.append(el('p', { class: 'small muted', text: note }));
    if (link) box.append(el('p', { class: 'small' }, link));
    return box;
  }

  function vsoshQuestion(card, step, select) {
    const question = card.questions[0];
    const source = olympiadSources.get(question.sourceId);
    const article = el('article', { class: 'question vsosh-card', dataset: { card: '1' } },
      el('div', { class: 'pills' },
        el('span', { class: 'pill task', text: card.context
          ? `№ ${question.taskNumber}–${card.questions.at(-1).taskNumber}` : `№ ${question.taskNumber}` }),
        el('span', { class: 'pill quiet', text: olympiadTopics.get(question.topicId) }),
        source ? el('span', { class: 'pill quiet', text: `${vsoshStages[source.stage]} · ${source.season.replace(/\/(\d{2})(\d{2})$/, '/$2')}` }) : null),
      el('p', { class: 'instruction', tabindex: '-1', dataset: { focus: '1' } },
        question.prompt, question.insertionText ? [' ', el('b', { lang: 'zh', text: question.insertionText })] : null));
    if (card.context) {
      article.append(vsoshPassage(card, step),
        el('div', { class: 'vsosh-groups' }, card.questions.map((q, index) => vsoshOptions(q, step, index, select))));
    } else {
      article.append(vsoshStem(question, step, select));
      if (question.kind !== 'wordPlacement') article.append(optionButtons({ ...question, correctOptionId: question.correctId },
        { selected: step.choices[0], reveal: step.checked, labels: true, onChoose: (id) => select(0, id) }));
    }
    return article;
  }

  function renderVsoshRound(round) {
    const id = round.ids[round.index];
    const card = olympiadById.get(id);
    const answer = roundAnswer(round);
    const step = { checked: answer !== undefined,
      choices: answer !== undefined ? [...answer] : vsoshState.draft ?? card.questions.map(() => null) };
    const multiple = Boolean(card.context) && card.questions.length > 1;
    const training = isTrainingRound(round);
    const pending = training ? round.retryQueue.length : 0;
    const originals = initialRoundIds(round);
    const score = originals.reduce((sum, id) => sum + vsoshScore(olympiadById.get(id), round.answers[id]), 0);
    const total = originals.reduce((sum, id) => sum + olympiadById.get(id).questions.length, 0);
    const marks = round.ids.map((id, i) => markOf(roundAnswer(round, i), olympiadById.get(id).correctOptionId));
    marks.push(...Array(pending).fill(null));
    view.append(sessionBar({
      exit: '#/vsosh/setup', index: round.index, marks, label: `Карточка ${round.index + 1} из ${marks.length}`,
      right: training ? `с первого раза: ${score} из ${total}` : `верно: ${score}`, useTicks: originals.length <= 30,
    }));
    if (training) view.append(el('p', { class: 'pills round-mode-status' },
      el('span', { class: 'pill quiet', text: 'Тренировка' }),
      round.ids.indexOf(id) < round.index ? el('span', { class: 'pill quiet repeat-mark', text: 'Повтор ошибки' }) : null));

    function submit() {
      if (vsoshState.round !== round || step.checked || step.choices.includes(null)) return;
      const chosen = step.choices.join('');
      vsoshState.round = answerRound(round, chosen, chosen === card.correctOptionId);
      vsoshState.draft = null;
      saveVsosh();
      render(false);
      if (multiple) view.querySelector('.vsosh-feedback').focus();
      else afterAnswer();
    }
    const check = multiple && !step.checked ? el('button', {
      class: 'button', type: 'button', disabled: step.choices.includes(null), onclick: submit,
    }, 'Проверить ответы') : null;
    view.append(vsoshQuestion(card, step, (index, option) => {
      step.choices[index] = option;
      if (!multiple) {
        submit();
        return;
      }
      vsoshState.draft = step.choices;
      saveVsosh();
      check.disabled = step.choices.includes(null);
    }));
    if (!step.checked) {
      if (check) view.append(el('div', { class: 'actions' }, check));
      return;
    }
    view.append(vsoshFeedback(card, step, olympiadSources.get(card.questions[0].sourceId)));
    const last = round.index === round.ids.length - 1;
    view.append(el('div', { class: 'actions dock' }, el('button', {
      class: 'button', type: 'button', dataset: { enter: '1', space: '1' },
      onclick: () => {
        if (vsoshState.round !== round) return;
        vsoshState.round = advanceRound(round, now());
        saveVsosh();
        render();
      },
    }, last ? (pending ? 'Повторить ошибку' : 'Итог раунда') : 'Дальше')));
  }

  function renderVsoshResult(round) {
    const ids = initialRoundIds(round);
    const training = isTrainingRound(round);
    const type = training ? 'training' : 'test';
    const retries = training ? trainingResult(round, olympiadById) : null;
    const results = ids.map((id) => {
      const card = olympiadById.get(id);
      return { card, score: vsoshScore(card, round.answers[id]), total: card.questions.length };
    });
    const score = results.reduce((sum, result) => sum + result.score, 0);
    const total = results.reduce((sum, result) => sum + result.total, 0);
    const wrong = results.filter((result) => result.score < result.total).map((result) => result.card.id);
    view.append(el('h2', { tabindex: '-1', dataset: { focus: '1' }, text: training ? 'Тренировка окончена' : 'Раунд окончен' }),
      scoreLine(score, total, training ? 'верных с первой попытки' : 'верных ответов'));
    if (retries) view.append(el('p', { class: 'training-result',
      text: `Карточек на повторе ${retries.repeated} · исправлено: ${retries.corrected} · с ошибками ${retries.remaining}.` }));
    view.append(el('div', { class: 'actions result-actions' },
      wrong.length ? el('button', { class: 'button', type: 'button', onclick: () => startVsosh(shuffle(wrong), type) },
        `Повторить ошибки ${training ? 'первой попытки' : 'раунда'} · ${wrong.length}`) : null,
      el('a', { class: wrong.length ? 'button alt' : 'button', href: '#/vsosh/setup', text: 'Новый раунд' }),
      el('button', { class: 'button ghost', type: 'button', onclick: () => startVsosh(ids, type) }, 'Решить эти задания заново')));
    view.append(el('ul', { class: 'results' }, results.map(({ card, score, total }) => {
      const question = card.questions[0];
      const body = el('div', { class: 'body' });
      const retry = retries?.repeats[card.id];
      const corrected = retry === card.correctOptionId;
      const status = corrected ? 'исправлено' : retry !== undefined ? 'снова ошибка'
        : card.context ? `${score} из ${total}` : score ? 'верно' : 'ошибка';
      return el('li', {}, el('details', {
        ontoggle: (event) => {
          if (!event.currentTarget.open || body.childElementCount) return;
          if (retry !== undefined) {
            const answers = card.questions.map((q, i) => {
              const choice = optionText(q, retry[i]);
              return card.context ? `№ ${q.gapNumber} ${retry[i]} ${choice}`
                : q.kind === 'wordPlacement' ? retry[i] : `${retry[i]} ${choice}`;
            });
            body.append(el('p', { class: 'small muted vsosh-retry' },
              `На повторе ${vsoshScore(card, retry)} из ${total}. ${answers.join(' · ')}. Ниже первая попытка.`));
          }
          const step = { checked: true, choices: [...round.answers[card.id]] };
          body.append(vsoshQuestion(card, step, () => {}), vsoshFeedback(card, step, olympiadSources.get(question.sourceId)));
        },
      }, el('summary', {},
        cellnum(question.taskNumber),
        el('span', { class: card.context ? 'vsosh-result-text' : 'zh', lang: card.context ? 'ru' : 'zh',
          text: card.context ? (card.context.label || olympiadTopics.get(question.topicId))
            : question.stem.replace(/\{\{[A-D]\}\}/g, '□') }),
        el('span', { class: score === total || corrected ? 'ok-mark' : 'bad-mark', text: status })),
      body));
    })));
  }

  function renderVsosh(arg) {
    const round = vsoshState.round;
    if (arg === 'setup' || !round) renderVsoshSetup();
    else if (round.finishedAt) renderVsoshResult(round);
    else renderVsoshRound(round);
  }

  // ---------- тренировка тонов ----------

  function toneAvailableText(count) {
    if (count) return `Доступно: ${count} ${plural(count, 'слово', 'слова', 'слов')}. В раунд попадёт ${roundCount(toneFilters.size, count)}.`;
    if (toneFilters.state === 'mistakes') return 'Ошибок с такими фильтрами нет.';
    if (toneFilters.state === 'done') return 'Решённых слов с такими фильтрами пока нет.';
    if (toneFilters.state === 'review') return 'Повторять пока нечего: ошибок нет, а исправленные ещё не подошли к сроку.';
    if (toneFilters.state === 'new') return 'Новых слов с такими фильтрами не осталось. Выберите «Все» или измените фильтры.';
    return 'С такими фильтрами слов нет — снимите часть фильтров.';
  }

  function renderTones() {
    const round = isTonesRound(progress.round) ? progress.round : null;
    if (round && route().arg !== 'setup') {
      if (round.finishedAt) renderRoundResult();
      else renderRound();
      return;
    }
    view.append(el('h2', { tabindex: '-1', dataset: { focus: '1' }, text: 'Тоны · задание 15' }),
      el('p', { class: 'lead', text: 'Слово без пиньиня — выберите сочетание его тонов. Слова HSK 2.0 уровней 1–4 из двух-трёх иероглифов; пиньинь и перевод — после ответа.' }));
    if (!toneQuestions.length) {
      view.append(el('div', { class: 'empty' }, el('strong', { text: 'Слов для тренировки пока нет.' }),
        'Они появятся здесь, когда автор примет их.'));
      return;
    }
    const counts = toneCounts(toneQuestions, toneFilters);
    const change = (key) => (v) => { toneFilters[key] = toggle(toneFilters[key], v); saveToneFilters(); render(false); };
    const available = filterToneWords(toneQuestions, toneFilters, progress, now());
    const size = roundSizeControl(available.length, { filters: toneFilters, save: saveToneFilters, text: toneAvailableText, share: false });
    const other = progress.round && !progress.round.finishedAt && !isTonesRound(progress.round) && Object.keys(progress.round.answers).length;
    const start = el('button', {
      class: 'button', type: 'button', id: 'startTones', disabled: !available.length, dataset: { enter: '1' },
      onclick: () => { size.commit(); startRound(pickRound(available, toneFilters.size).map((q) => q.id), TONES_MODE); },
    }, 'Начать раунд');
    view.append(nextRound({
      summary: toneSummary(),
      notice: el('p', { class: 'next-note', id: 'available', 'aria-live': 'polite', text: toneAvailableText(available.length) }),
      warning: other ? el('p', { class: 'notice warn small', id: 'replaceWarning', text: 'У вас начат раунд практики. Новый раунд тонов заменит его: вернуться к практике будет нельзя.' }) : null,
      start,
      resume: round && !round.finishedAt ? el('a', { class: 'button alt', href: '#/tones', text: `Продолжить раунд · ${roundAnswerCount(round)} из ${round.ids.length + (round.retryQueue?.length || 0)}` }) : null,
    }));
    view.append(roundModeControl(toneFilters, saveToneFilters));
    view.append(el('div', { class: 'filters-row round-settings' },
      roundStateControl('Какие слова', toneFilters.state, (value) => { toneFilters.state = value; saveToneFilters(); render(false); }),
      size.node));
    if (toneFilters.roundType === 'training') view.append(trainingHint());
    view.append(
      chipGroup('Уровень HSK', TONE_LEVELS.filter((n) => counts.levels[n] || toneFilters.levels.includes(n))
        .map((n) => ({ value: n, label: `HSK ${n}`, count: counts.levels[n] })), toneFilters.levels, change('levels'), 'toneLevels'),
      chipGroup('Длина слова', TONE_LENGTHS.filter((n) => counts.lengths[n] || toneFilters.lengths.includes(n))
        .map((n) => ({ value: n, label: `${n} иероглифа`, count: counts.lengths[n] })), toneFilters.lengths, change('lengths'), 'toneLengths'));
    view.append(el('div', { class: 'actions' },
      el('button', {
        class: 'button ghost', type: 'button',
        onclick: () => { toneFilters = { ...toneFilters, levels: [], lengths: [], state: 'all' }; saveToneFilters(); render(false); },
      }, 'Сбросить фильтры')));
    view.append(startBar(start, () => {
      const n = roundCount(toneFilters.size, available.length);
      return available.length ? `В раунд: ${n} ${plural(n, 'слово', 'слова', 'слов')}${other ? ' · заменит начатую практику' : ''}` : 'Слов нет';
    }));
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
          // Enter ведёт к следующей позиции, цифры по-прежнему меняют ответ. Страницу к кнопке
          // не двигаем: задание с выбранным ответом остаётся на экране.
          focusAfterAnswer();
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
      last ? finishButton : el('button', { class: 'button', type: 'button', dataset: v.answers[v.ids[v.index]] === undefined ? { enter: '1' } : { enter: '1', space: '1' }, onclick: () => { progress = { ...progress, variant: moveSession(progress.variant, progress.variant.index + 1) }; save(); render(); } }, 'Дальше →')));
    function finish() {
      commitClock();
      progress = finishVariant(progress, byId, now());
      variantConfirm = false;
      save();
      render();
    }
  }

  function renderVariantResult(v, actions) {
    actions.classList.add('result-actions');
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
    actions.append(...[report.button, share.button,
      el('a', { class: 'button ghost', href: '#/rules', text: 'На главную' })].filter(Boolean));
    view.append(el('p', { class: 'section-title', text: 'Результат последнего варианта' }),
      scoreLine(result.score, result.total, 'первичных баллов за раздел 3'),
      Number.isFinite(v.result && v.result.timeMs)
        ? el('p', { class: v.result.timeMs > VARIANT_MINUTES * 60000 ? 'small variant-time over' : 'small variant-time', id: 'variantTime', text: `Время: ${formatClock(v.result.timeMs)} · рекомендовано ${VARIANT_MINUTES}:00` })
        : document.createDocumentFragment(),
      actions);
    if (report.box) view.append(report.box);
    if (share.box) view.append(share.box);
    view.append(
      sheet(v, { reveal: true, onPick: (i) => {
        // Только позиции варианта: у раскрытого разбора есть свой вложенный details.
        const items = view.querySelectorAll('.results > li > details');
        if (items[i]) { items[i].open = true; items[i].querySelector('summary').focus(); }
      } }),
      ruleAdvice(result.items),
      mistakeWork(result.items, { id: 'variantMistakes' }));
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
    if (origins.includes('words')) sources.push('слова HSK 2.0 уровней 1–4 для тренировки тонов (№15)');
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
        toneQuestions.length ? [
          el('p', { class: 'section-title', text: 'Тоны' }),
          el('p', { text: `Вкладка «Тоны» — отдельная тренировка к заданию 15: ${toneQuestions.length} ${plural(toneQuestions.length, 'слово', 'слова', 'слов')} HSK 2.0 уровней 1–4, по два-три иероглифа. Раунд идёт как в практике, ошибки раунда можно повторить; ссылки учителю и отчёта у этой вкладки нет.` }),
        ] : null,
        olympiadCards.length ? [
          el('p', { class: 'section-title', text: 'ВсОШ' }),
          el('p', { text: 'На вкладке «ВсОШ» можно выбрать темы из региональных и заключительных этапов. Обычный ответ проверяется сразу после выбора. В общем тексте выберите ответы ко всем пропускам, затем проверьте их вместе. Клавиша Tab переводит фокус между пропусками, стрелки выбирают вариант. Раунд сохраняется при перезагрузке вкладки.' }),
        ] : null,
        el('p', { class: 'section-title', text: 'Клавиши' }),
        el('p', {}, el('kbd', { text: '1' }), '–', el('kbd', { text: '4' }), ' выбирают один ответ. ',
          el('kbd', { text: 'Enter' }), ' или ', el('kbd', { text: 'Space' }), ' ведут дальше.'),
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
    // Все текущие ошибки по номерам — свёрнуто: список бывает длинным.
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
        progress = pruneProgress(mergeProgress(progress, result.progress), allItems);
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

  let startBarFrame = 0;
  const scheduleStartBar = () => {
    if (!startBarFrame) {
      startBarFrame = requestAnimationFrame(() => {
        startBarFrame = 0;
        syncStartBar();
      });
    }
  };
  window.addEventListener('scroll', scheduleStartBar, { passive: true });
  window.addEventListener('resize', scheduleStartBar);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleStartBar);
    window.visualViewport.addEventListener('scroll', scheduleStartBar);
  }
  // Шрифты догружаются и сдвигают строки: показ панели пересчитывается.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleStartBar);

  document.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const tag = (event.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (/^[1-4]$/.test(event.key)) {
      const button = view.querySelector(`[data-card] button[data-option="${event.key}"]:not(:disabled)`);
      if (button) {
        event.preventDefault();
        button.click();
      }
      return;
    }
    // Пробел ведёт дальше только там, где есть «Дальше» после ответа (в варианте — у позиции с ответом);
    // «Начать раунд» — только Enter.
    const mark = event.key === 'Enter' ? 'enter' : event.key === ' ' ? 'space' : null;
    // Удержанная клавиша не пролистывает экраны подряд.
    if (mark && event.repeat) return;
    if (mark && tag !== 'button' && tag !== 'a' && tag !== 'summary') {
      const next = view.querySelector(`[data-${mark}]:not(:disabled)`);
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
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.setAttribute('content', dark ? '#181512' : '#FAF4E8'));
  }
  document.getElementById('themeToggle').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    storage.set(THEME_KEY, next);
    syncTheme();
  });
  syncTheme();

  document.getElementById('reviewBanner').hidden = !DATA.meta.drafts;
  // Слов тренировки на сайте ещё нет (никто не принял) — вкладки тоже нет.
  if (!toneQuestions.length) document.querySelector('[data-tab="tones"]').remove();
  if (!olympiadCards.length) document.querySelector('[data-tab="vsosh"]').remove();

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
    let incoming = pruneProgress(parseProgress(event.newValue), allItems);
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
