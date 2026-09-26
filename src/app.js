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
  const ORIGIN_NAMES = { fipi: 'Банк ФИПИ', generated: 'Новые задания' };
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

  let progress = pruneProgress(parseProgress(storage.get(PROGRESS_KEY)), questions.map((q) => q.id));
  let storageOk = true;
  function save() {
    storageOk = storage.set(PROGRESS_KEY, JSON.stringify(progress));
  }
  const now = () => new Date().toISOString();

  function loadFilters() {
    const empty = { topics: [], tasks: [], origins: [], state: 'all', size: '10' };
    try {
      const raw = JSON.parse(storage.get(FILTERS_KEY) || 'null');
      if (!raw || typeof raw !== 'object') return empty;
      return {
        topics: Array.isArray(raw.topics) ? raw.topics.filter((t) => topicsById.has(t)) : [],
        tasks: Array.isArray(raw.tasks) ? raw.tasks.filter((n) => TASK_NUMBERS.includes(n)) : [],
        origins: Array.isArray(raw.origins) ? raw.origins.filter((o) => origins.includes(o)) : [],
        state: ['all', 'new', 'mistakes'].includes(raw.state) ? raw.state : 'all',
        size: ['5', '10', '20', 'all'].includes(raw.size) ? raw.size : '10',
      };
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
  let shareNotice = null; // что открыто по ссылке учителя; показывается один раз
  let shareOpen = null; // какой блок «Ссылка…» раскрыт: setup, round или variant
  let pendingVariant = null; // вариант из ссылки ждёт решения: поверх незавершённого своего
  let bankFilters = { task: '', topic: '', state: 'all', origin: '' };

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
    document.querySelectorAll('.tab').forEach((tab) => {
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
    else renderRules();
    if (shareNotice) {
      const node = el('p', { class: shareNotice.warn ? 'notice warn' : 'notice', id: 'shareNotice', role: 'status', text: shareNotice.text });
      const title = view.querySelector('h2');
      if (title) title.after(node);
      else view.prepend(node);
      shareNotice = null;
    }
    if (!storageOk) {
      view.append(el('p', { class: 'notice warn small', text: 'Браузер не даёт сохранить прогресс: он пропадёт после перезагрузки страницы.' }));
    }
    if (focus) {
      const target = view.querySelector('[data-focus]') || view;
      target.focus({ preventScroll: false });
    } else if (activeKey) {
      const same = [...view.querySelectorAll('[data-key]')].find((node) => node.dataset.key === activeKey);
      if (same) same.focus();
    }
  }

  // ---------- общие части ----------

  // Ссылка учителя: открыть подборку, раунд из тех же заданий или тот же вариант.
  // Адрес сразу заменяется обычным, чтобы перезагрузка не открывала ссылку повторно.
  function openShared(name, query) {
    const link = parseShareQuery(query, { topicIds: new Set(topicsById.keys()), origins, questionIds: new Set(byId.keys()) });
    let target = `#/${name}`;
    if (name === 'variant') {
      if (link.kind === 'ids' && isVariant(link.ids, byId)) {
        const v = progress.variant;
        const own = v && !v.finishedAt && Object.keys(v.answers).length > 0 && v.ids.join() !== link.ids.join();
        if (own) pendingVariant = link.ids;
        else startLinkedVariant(link.ids);
      } else {
        shareNotice = { warn: true, text: 'Вариант из ссылки не открыть: части его заданий больше нет в банке. Соберите новый вариант.' };
      }
    } else if (link.kind === 'ids') {
      if (link.ids.length) {
        progress = { ...progress, round: startSession(link.ids, now()) };
        save();
        if (link.missing) shareNotice = { warn: true, text: `Из ссылки не найдено в банке: ${tasksWord(link.missing)}. Раунд собран из остальных.` };
      } else {
        shareNotice = { warn: true, text: 'Заданий из ссылки больше нет в банке. Выберите подборку сами.' };
        target = '#/practice/setup';
      }
    } else {
      filters = { ...filters, ...link.filters, state: 'all' };
      saveFilters();
      shareNotice = { warn: false, text: 'Подборка открыта по ссылке: темы, номера и размер раунда уже выбраны.' };
      target = '#/practice/setup';
    }
    window.history.replaceState(null, '', target);
  }

  function startLinkedVariant(ids) {
    progress = { ...progress, variant: startSession(ids, now()) };
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

  function originLabel(q) {
    if (q.origin === 'fipi') return q.sourceRef && q.sourceRef.fipiId ? `Банк ФИПИ · ${q.sourceRef.fipiId}` : 'Банк ФИПИ';
    return 'Новое задание';
  }

  function questionPills(q) {
    return el('div', { class: 'pills' },
      el('span', { class: 'pill', text: `Задание ${q.taskNumber}` }),
      q.topicIds.map((id) => topicsById.get(id)).filter(Boolean).map((t) => el('span', { class: 'pill quiet', text: t.title })),
      el('span', { class: 'pill quiet', text: originLabel(q) }),
      q.draft ? el('span', { class: 'pill draft', text: 'черновик' }) : null);
  }

  function stemNode(q) {
    if (q.taskNumber === 26 && q.fragments) {
      return el('ol', { class: 'fragments' },
        q.fragments.map((f) => el('li', {}, el('b', { text: f.id }), el('span', { text: f.text }))));
    }
    const cls = SOLO_STEM.has(q.taskNumber) ? 'stem solo' : 'stem';
    return el('p', { class: cls, lang: 'zh' },
      stemSegments(q.stem).map((part) => (part.blank
        ? el('span', { class: 'blank', role: 'img', 'aria-label': 'пропуск' })
        : part.text)));
  }

  // Карточка вопроса: задание ЕГЭ или вопрос по правилу. reveal — показать верный/неверный.
  function questionCard(item, { kind, selected, reveal, onChoose, heading }) {
    const card = el('article', { class: 'question', dataset: { card: '1' } });
    if (kind === 'exam') card.append(questionPills(item));
    else {
      card.append(el('div', { class: 'pills' },
        item.ruleIds.map((id) => rulesById.get(id)).filter(Boolean).map((r) => el('span', { class: 'pill quiet', text: r.title })),
        item.draft ? el('span', { class: 'pill draft', text: 'черновик' }) : null));
    }
    card.append(el('p', { class: 'instruction', tabindex: '-1', dataset: { focus: '1' }, text: heading || item.prompt }));
    if (kind === 'exam') card.append(stemNode(item));
    else if (item.sentence) {
      card.append(el('p', { class: 'stem', lang: 'zh' },
        stemSegments(item.sentence).map((part) => (part.blank ? el('span', { class: 'blank', role: 'img', 'aria-label': 'пропуск' }) : part.text))));
      if (item.sentenceRu) card.append(el('p', { class: 'stem-ru', text: item.sentenceRu }));
    }
    const short = item.options.every((o) => o.text.length <= 12);
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
      }, el('span', { class: 'num', text: `${i + 1})` }), el('span', { class: 'text', lang: kind === 'exam' || /[一-鿿]/.test(o.text) ? 'zh' : 'ru', text: o.text })));
    });
    card.append(list);
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

  function progressBar(label, right, done, total) {
    return el('div', { class: 'quiz-top' },
      el('div', { class: 'progress' }, el('span', { text: label }), el('span', { text: right })),
      el('div', { class: 'track' }, el('div', { class: 'fill', style: `width:${total ? Math.round((done / total) * 100) : 0}%` })));
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
      view.append(el('div', { class: 'actions' },
        el('button', { class: 'button alt', type: 'button', onclick: () => startChecks(checks.map((c) => c.id), null) },
          `Проверить себя по всем правилам · ${questionsWord(checks.length)}`)));
    }
    for (const topic of topics) {
      const topicRules = rules.filter((r) => r.topicIds.includes(topic.id));
      if (!topicRules.length) continue;
      view.append(el('section', { class: 'topic-group' },
        el('h3', {}, topic.title, el('small', { text: `№ ${topic.taskNumbers.join(', ')}` })),
        el('div', { class: 'rule-list' }, topicRules.map((r) => el('a', { class: 'rule-card', href: `#/rules/${encodeURIComponent(r.id)}` },
          el('strong', { text: r.title }), el('span', { text: r.summary }),
          r.draft ? el('span', { class: 'pill draft', text: 'черновик' }) : null)))));
    }
  }

  function renderRule(id) {
    const rule = rulesById.get(id);
    if (!rule) {
      view.append(el('h2', { tabindex: '-1', dataset: { focus: '1' }, text: 'Правило не найдено' }),
        el('p', {}, el('a', { href: '#/rules', text: '← Все правила' })));
      return;
    }
    const ruleChecks = checks.filter((c) => c.ruleIds.includes(id));
    const ruleQuestions = questions.filter((q) => q.topicIds.some((t) => rule.topicIds.includes(t)));
    const taskNumbers = [...new Set(rule.topicIds.flatMap((t) => (topicsById.get(t) || { taskNumbers: [] }).taskNumbers))];
    const detail = el('article', { class: 'rule-detail' },
      el('a', { href: '#/rules', text: '← Все правила' }),
      el('h2', { tabindex: '-1', dataset: { focus: '1' }, text: rule.title }),
      el('div', { class: 'pills' },
        rule.topicIds.map((t) => topicsById.get(t)).filter(Boolean).map((t) => el('span', { class: 'pill quiet', text: t.title })),
        taskNumbers.length ? el('span', { class: 'pill', text: `ЕГЭ: № ${taskNumbers.join(', ')}` }) : null,
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
      onclick: () => {
        filters = { ...filters, topics: rule.topicIds.slice(), tasks: [], state: 'all' };
        saveFilters();
        go('#/practice');
      },
    }, ruleQuestions.length ? `Задания ЕГЭ по теме · ${tasksWord(ruleQuestions.length)}` : 'Заданий ЕГЭ по теме пока нет'));
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
      view.append(el('h2', { tabindex: '-1', dataset: { focus: '1' }, text: `Проверка правила: ${correctCount} из ${s.ids.length}` }),
        el('p', { class: 'lead', text: correctCount === s.ids.length ? 'Правило усвоено — можно переходить к заданиям ЕГЭ.' : 'Перечитайте карточку правила и попробуйте ещё раз.' }),
        el('div', { class: 'actions' },
          el('a', { class: 'button', href: back, text: s.ruleId ? 'К правилу' : 'К правилам' }),
          el('button', { class: 'button alt', type: 'button', onclick: () => startChecks(s.ids, s.ruleId) }, 'Пройти ещё раз')));
      return;
    }
    const id = s.ids[s.index];
    const item = checksById.get(id);
    const chosen = s.answers[id];
    view.append(progressBar(`Вопрос ${s.index + 1} из ${s.ids.length}`, `верно: ${correctCount}`, answered, s.ids.length));
    view.append(questionCard(item, {
      kind: 'check',
      selected: chosen,
      reveal: chosen !== undefined,
      onChoose: (optionId) => {
        if (checkSession.answers[id] !== undefined) return;
        checkSession = answerSession(checkSession, id, optionId);
        progress = recordAnswer(progress, 'checks', id, optionId, optionId === item.correctOptionId, now());
        save();
        render(false);
        const next = view.querySelector('[data-enter]');
        if (next) next.focus();
      },
    }));
    if (chosen !== undefined) {
      view.append(feedback(item, chosen));
      const last = s.index === s.ids.length - 1;
      view.append(el('div', { class: 'actions' },
        el('button', {
          class: 'button', type: 'button', dataset: { enter: '1' },
          onclick: () => {
            checkSession = last ? { ...checkSession, finishedAt: now() } : moveSession(checkSession, checkSession.index + 1);
            render();
          },
        }, last ? 'Итог' : 'Дальше'),
        el('a', { class: 'button ghost', href: back, text: 'Выйти' })));
    }
  }

  // ---------- практика ----------

  function chipGroup(legend, items, selected, onToggle, extraClass) {
    return el('fieldset', { class: 'filter' },
      el('legend', { text: legend }),
      el('div', { class: 'chips' }, items.map((it) => el('label', { class: `chip ${extraClass || ''}` },
        el('input', { type: 'checkbox', checked: selected.includes(it.value), dataset: { key: `${legend}:${it.value}` }, onchange: () => onToggle(it.value) }),
        el('span', {}, it.label, it.count !== undefined ? el('small', { text: String(it.count) }) : null)))));
  }

  function toggle(list, value) {
    return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
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
      el('p', { class: 'lead', text: 'Задания из банка с разбором сразу после ответа. Тему и номер задания можно выбирать независимо: одна тема встречается в разных номерах.' }));
    if (!questions.length) {
      view.append(emptyBank());
      return;
    }
    const topicItems = topics.map((t) => ({
      value: t.id, label: t.title, count: questions.filter((q) => q.topicIds.includes(t.id)).length,
    })).filter((t) => t.count > 0);
    view.append(chipGroup('Темы', topicItems, filters.topics, (v) => { filters.topics = toggle(filters.topics, v); saveFilters(); render(false); }));
    const taskItems = TASK_NUMBERS.map((n) => ({ value: n, label: String(n), count: questions.filter((q) => q.taskNumber === n).length }))
      .filter((t) => t.count > 0);
    view.append(chipGroup('Номер задания', taskItems, filters.tasks, (v) => { filters.tasks = toggle(filters.tasks, v); saveFilters(); render(false); }, 'num'));
    if (origins.length > 1) {
      view.append(chipGroup('Источник', origins.map((o) => ({ value: o, label: ORIGIN_NAMES[o] || o, count: questions.filter((q) => q.origin === o).length })),
        filters.origins, (v) => { filters.origins = toggle(filters.origins, v); saveFilters(); render(false); }));
    }
    const stateSelect = el('select', { id: 'stateFilter', dataset: { key: 'state' }, onchange: (e) => { filters.state = e.target.value; saveFilters(); render(false); } },
      [['all', 'Все'], ['new', 'Новые'], ['mistakes', 'Ошибки']].map(([v, label]) => el('option', { value: v, selected: filters.state === v, text: label })));
    const sizeSelect = el('select', { id: 'roundSize', dataset: { key: 'size' }, onchange: (e) => { filters.size = e.target.value; saveFilters(); render(false); } },
      [['5', '5 заданий'], ['10', '10 заданий'], ['20', '20 заданий'], ['all', 'Все доступные']].map(([v, label]) => el('option', { value: v, selected: filters.size === v, text: label })));
    view.append(el('div', { class: 'filters-row' },
      el('label', { class: 'field' }, 'Какие задания', stateSelect),
      el('label', { class: 'field' }, 'Размер раунда', sizeSelect)));
    const available = filterQuestions(questions, filters, progress);
    const roundSize = filters.size === 'all' ? available.length : Math.min(Number(filters.size), available.length);
    view.append(el('p', { class: 'notice', id: 'available', 'aria-live': 'polite' },
      available.length
        ? `Доступно: ${tasksWord(available.length)}. В раунд попадёт ${roundSize}.`
        : filters.state === 'mistakes' ? 'Ошибок с такими фильтрами нет.' : 'С такими фильтрами заданий нет — снимите часть фильтров.'));
    const actions = el('div', { class: 'actions' },
      el('button', {
        class: 'button', type: 'button', id: 'startRound', disabled: !available.length, dataset: { enter: '1' },
        onclick: () => startRound(pickRound(available, filters.size).map((q) => q.id)),
      }, 'Начать раунд'),
      el('button', {
        class: 'button ghost', type: 'button',
        onclick: () => { filters = { ...filters, topics: [], tasks: [], origins: [], state: 'all' }; saveFilters(); render(false); },
      }, 'Сбросить фильтры'));
    if (round && !round.finishedAt) {
      actions.append(el('a', { class: 'button alt', href: '#/practice', text: `Продолжить раунд · ${Object.keys(round.answers).length} из ${round.ids.length}` }));
    }
    const share = shareToggle('setup', 'Ссылка на подборку', pageUrl(`#/practice?${shareQuery(filters)}`),
      'По ссылке откроется эта подборка: темы, номера, источник и размер раунда. Задания каждому выпадут свои. Чтобы у всех были одни и те же задания, пройдите раунд и возьмите ссылку на его итоге.',
      !available.length);
    actions.append(share.button);
    view.append(actions);
    if (share.box) view.append(share.box);
  }

  function startRound(ids) {
    if (!ids.length) return;
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
    view.append(progressBar(`Задание ${round.index + 1} из ${round.ids.length}`, `верно: ${correct}`, answered.length, round.ids.length));
    view.append(questionCard(q, {
      kind: 'exam',
      selected: chosen,
      reveal: chosen !== undefined,
      onChoose: (optionId) => {
        if (progress.round.answers[id] !== undefined) return;
        progress = recordAnswer({ ...progress, round: answerSession(progress.round, id, optionId) },
          'questions', id, optionId, grade(q, optionId).correct, now());
        save();
        render(false);
        const next = view.querySelector('[data-enter]');
        if (next) next.focus();
      },
    }));
    const actions = el('div', { class: 'actions' });
    if (chosen !== undefined) {
      view.append(feedback(q, chosen));
      const last = round.index === round.ids.length - 1;
      actions.append(el('button', {
        class: 'button', type: 'button', dataset: { enter: '1' },
        onclick: () => {
          progress = { ...progress, round: last ? { ...progress.round, finishedAt: now() } : moveSession(progress.round, progress.round.index + 1) };
          save();
          render();
        },
      }, last ? 'Итог раунда' : 'Дальше'));
    }
    actions.append(el('a', { class: 'button ghost', href: '#/practice/setup', text: 'К настройкам' }));
    view.append(actions);
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
        el('span', { class: 'n', text: String(q.taskNumber) }),
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
      el('p', { class: 'score' }, el('b', { text: `${result.score} из ${result.total}` }), el('span', { class: 'muted', text: 'верных ответов' })),
      resultList(round.ids, round.answers));
    const share = shareToggle('round', 'Ссылка на эти задания', pageUrl(`#/practice?${idsQuery(round.ids)}`),
      `По ссылке откроется раунд из этих же заданий (${round.ids.length}) в том же порядке — одинаковый для всех, кто её получит.`);
    view.append(el('div', { class: 'actions' },
      wrong.length ? el('button', { class: 'button', type: 'button', onclick: () => startRound(shuffle(wrong)) }, `Повторить ошибки раунда · ${wrong.length}`) : null,
      el('a', { class: wrong.length ? 'button alt' : 'button', href: '#/practice/setup', text: 'Новый раунд' }),
      share.button));
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
    const v = progress.variant;
    if (pendingVariant) {
      const answered = Object.values(v.answers).filter((x) => x != null).length;
      view.append(el('h2', { tabindex: '-1', dataset: { focus: '1' }, text: 'Вариант по ссылке' }),
        el('p', { class: 'notice warn', id: 'pendingVariant', text: `У вас есть незавершённый вариант: отвечено ${answered} из ${v.ids.length}. Если открыть вариант из ссылки, эти ответы пропадут.` }),
        el('div', { class: 'actions' },
          el('button', {
            class: 'button', type: 'button', id: 'openLinkedVariant',
            onclick: () => { startLinkedVariant(pendingVariant); pendingVariant = null; render(); },
          }, 'Открыть вариант из ссылки'),
          el('button', { class: 'button ghost', type: 'button', id: 'keepOwnVariant', onclick: () => { pendingVariant = null; render(); } }, 'Продолжить свой')));
      return;
    }
    if (v && !v.finishedAt) {
      renderVariantRun();
      return;
    }
    view.append(el('h2', { tabindex: '-1', dataset: { focus: '1' }, text: 'Полный вариант' }),
      el('p', { class: 'lead', text: 'Тринадцать заданий, по одному на каждую позицию 15–27, в порядке раздела 3 экзамена. Ответы можно менять до конца; разбор — после завершения.' }));
    const attempt = buildVariant(questions);
    const actions = el('div', { class: 'actions' });
    if (attempt.ok) {
      // После результата Enter не должен сразу собирать новый вариант и стирать разбор.
      actions.append(el('button', {
        class: 'button', type: 'button', id: 'buildVariant', dataset: v && v.finishedAt ? {} : { enter: '1' },
        onclick: () => {
          const fresh = buildVariant(questions);
          progress = { ...progress, variant: startSession(fresh.ids, now()) };
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
        el('ul', { class: 'usage' }, history.map((h) => el('li', { text: `${new Date(h.at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })} — ${h.score} из ${h.total}` }))));
    }
  }

  function renderVariantRun() {
    const v = progress.variant;
    const id = v.ids[v.index];
    const q = byId.get(id);
    const answered = v.ids.filter((x) => v.answers[x] != null).length;
    view.append(el('h2', { class: 'sr-title', tabindex: '-1', text: 'Полный вариант' }),
      progressBar(`Позиция ${q.taskNumber} · ${v.index + 1} из ${v.ids.length}`, `отвечено: ${answered}`, answered, v.ids.length),
      sheet(v, { reveal: false, onPick: (i) => { progress = { ...progress, variant: moveSession(progress.variant, i) }; save(); render(); } }),
      questionCard(q, {
        kind: 'exam',
        selected: v.answers[id],
        reveal: false,
        onChoose: (optionId) => {
          progress = { ...progress, variant: answerSession(progress.variant, id, optionId) };
          variantConfirm = false;
          save();
          render(false);
          // Фокус на «Дальше»: Enter ведёт к следующей позиции, цифры по-прежнему меняют ответ.
          const next = view.querySelector('[data-enter]') || view.querySelector('#finishVariant');
          if (next) next.focus();
        },
      }));
    const last = v.index === v.ids.length - 1;
    const missing = unansweredPositions(v, byId);
    const actions = el('div', { class: 'actions' },
      el('button', { class: 'button ghost', type: 'button', disabled: v.index === 0, onclick: () => { progress = { ...progress, variant: moveSession(v, v.index - 1) }; save(); render(); } }, '← Назад'),
      last ? null : el('button', { class: 'button alt', type: 'button', dataset: { enter: '1' }, onclick: () => { progress = { ...progress, variant: moveSession(v, v.index + 1) }; save(); render(); } }, 'Дальше →'),
      el('button', {
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
      }, 'Завершить вариант'));
    view.append(actions);
    if (variantConfirm && missing.length) {
      view.append(el('div', { class: 'notice warn' },
        `Без ответа: ${missing.join(', ')}. Эти задания будут засчитаны как неверные.`,
        el('div', { class: 'actions' },
          el('button', { class: 'button', type: 'button', id: 'confirmFinish', onclick: finish }, 'Всё равно завершить'),
          el('button', { class: 'button ghost', type: 'button', onclick: () => { variantConfirm = false; render(false); } }, 'Вернуться к заданиям'))));
    }
    function finish() {
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
    const share = shareToggle('variant', 'Ссылка на этот вариант', pageUrl(`#/variant?${idsQuery(v.ids)}`),
      'По ссылке откроется этот же вариант — те же 13 заданий. Удобно, чтобы весь класс решал одно и то же.');
    actions.append(share.button);
    view.append(el('p', { class: 'section-title', text: 'Результат последнего варианта' }),
      el('p', { class: 'score' }, el('b', { text: `${result.score} из ${result.total}` }), el('span', { class: 'muted', text: 'первичных баллов за раздел 3' })),
      sheet(v, { reveal: true, onPick: (i) => {
        // Только позиции варианта: у раскрытого разбора есть свой вложенный details.
        const items = view.querySelectorAll('.results > li > details');
        if (items[i]) { items[i].open = true; items[i].querySelector('summary').focus(); }
      } }),
      actions,
      share.box,
      el('p', { class: 'section-title', text: 'Разбор по позициям' }),
      resultList(v.ids, v.answers));
  }

  // ---------- банк и ошибки ----------

  function renderBank() {
    view.append(el('h2', { tabindex: '-1', dataset: { focus: '1' }, text: 'Банк и ошибки' }));
    if (!questions.length) {
      view.append(el('p', { class: 'lead', text: 'Все проверенные задания с источником и вашим результатом.' }), emptyBank());
      return;
    }
    const states = questions.map((q) => answerState(progress, 'questions', q.id));
    const count = (s) => states.filter((x) => x === s).length;
    const mistakes = questions.filter((q) => answerState(progress, 'questions', q.id) === 'mistake');
    view.append(el('p', { class: 'lead', text: 'Все проверенные задания с источником и вашим результатом. Ошибкой считается задание, на которое последний ответ был неверным.' }),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('b', { text: String(questions.length) }), el('span', { text: 'в банке' })),
        el('div', { class: 'stat' }, el('b', { text: String(count('solved')) }), el('span', { text: 'решено верно' })),
        el('div', { class: 'stat' }, el('b', { text: String(count('mistake')) }), el('span', { text: 'ошибки' })),
        el('div', { class: 'stat' }, el('b', { text: String(count('new')) }), el('span', { text: 'ещё не решались' }))),
      el('div', { class: 'actions' },
        el('button', { class: 'button', type: 'button', id: 'repeatMistakes', disabled: !mistakes.length, onclick: () => startRound(shuffle(mistakes.map((q) => q.id))) },
          mistakes.length ? `Повторить ошибки · ${mistakes.length}` : 'Ошибок нет')));

    const select = (label, key, items) => el('label', { class: 'field' }, label,
      el('select', { dataset: { key: `bank:${key}` }, onchange: (e) => { bankFilters = { ...bankFilters, [key]: e.target.value }; render(false); } },
        items.map(([v, text]) => el('option', { value: v, selected: bankFilters[key] === v, text }))));
    const row = el('div', { class: 'filters-row' },
      select('Номер', 'task', [['', 'Все номера'], ...TASK_NUMBERS.filter((n) => questions.some((q) => q.taskNumber === n)).map((n) => [String(n), `Задание ${n}`])]),
      select('Тема', 'topic', [['', 'Все темы'], ...topics.filter((t) => questions.some((q) => q.topicIds.includes(t.id))).map((t) => [t.id, t.title])]),
      select('Результат', 'state', [['all', 'Любой'], ['new', 'Не решались'], ['mistake', 'Ошибки'], ['solved', 'Решено верно']]));
    if (origins.length > 1) row.append(select('Источник', 'origin', [['', 'Все'], ...origins.map((o) => [o, ORIGIN_NAMES[o] || o])]));
    view.append(el('div', { class: 'section-title', text: 'Задания' }), row);

    const shown = questions.filter((q) => (!bankFilters.task || q.taskNumber === Number(bankFilters.task))
      && (!bankFilters.topic || q.topicIds.includes(bankFilters.topic))
      && (!bankFilters.origin || q.origin === bankFilters.origin)
      && (bankFilters.state === 'all' || answerState(progress, 'questions', q.id) === bankFilters.state));
    const STATE_TEXT = { new: 'не решалось', mistake: 'ошибка', solved: 'верно' };
    view.append(el('p', { class: 'small muted', 'aria-live': 'polite', text: `Показано: ${tasksWord(shown.length)}` }),
      el('ul', { class: 'bank-list' }, shown.map((q) => {
        const state = answerState(progress, 'questions', q.id);
        return el('li', {}, el('button', { class: 'bank-item', type: 'button', onclick: () => startRound([q.id]) },
          el('span', { class: 'n', text: String(q.taskNumber) }),
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
      el('button', { class: 'button ghost', type: 'button', id: 'exportProgress', dataset: { key: 'progress:export' }, onclick: downloadProgress }, 'Сохранить в файл'),
      el('button', { class: 'button ghost', type: 'button', id: 'importProgress', dataset: { key: 'progress:import' }, onclick: () => fileInput.click() }, 'Загрузить из файла'),
      fileInput));
    if (transferNotice) {
      view.append(el('p', { class: transferNotice.ok ? 'notice' : 'notice warn', role: 'status', id: 'transferNotice', text: transferNotice.text }));
    }
    const reset = el('div', { class: 'actions' });
    if (!resetConfirm) {
      reset.append(el('button', { class: 'button ghost danger', type: 'button', onclick: () => { resetConfirm = true; render(false); } }, 'Сбросить прогресс'));
    } else {
      reset.append(el('span', { class: 'notice warn', text: 'Ответы, ошибки и результаты вариантов будут удалены.' }),
        el('button', { class: 'button danger ghost', type: 'button', id: 'confirmReset', onclick: () => {
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
    if (!file) return;
    let result;
    try {
      result = readProgressFile(await file.text());
    } catch {
      result = { ok: false, reason: 'not-json' };
    }
    if (result.ok) {
      progress = pruneProgress(mergeProgress(progress, result.progress), questions.map((q) => q.id));
      save();
      const count = Object.keys(result.progress.questions).length;
      transferNotice = { ok: true, text: `Прогресс из файла объединён с этим браузером. В файле ответы на ${tasksWord(count)}.` };
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
  function syncTheme() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    themeLabel.textContent = dark ? 'Светлая' : 'Тёмная';
  }
  document.getElementById('themeToggle').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    storage.set(THEME_KEY, next);
    syncTheme();
  });
  syncTheme();

  document.getElementById('bankCount').textContent = questions.length
    ? `${tasksWord(questions.length)} · ${rules.length} ${plural(rules.length, 'правило', 'правила', 'правил')}`
    : 'Банк готовится';
  document.getElementById('reviewBanner').hidden = !DATA.meta.drafts;
  const sourceNote = origins.includes('generated')
    ? 'Задания — открытый банк ФИПИ и новые задания в том же формате'
    : 'Задания — открытый банк ФИПИ';
  document.getElementById('footNote').textContent =
    `${sourceNote}, формат ЕГЭ ${DATA.meta.formatYear}. Разборы и правила проверены автором тренажёра. Прогресс хранится в этом браузере.`;

  // Ссылка «К содержимому» переводит фокус, а не меняет маршрут.
  document.querySelector('.skip').addEventListener('click', (event) => {
    event.preventDefault();
    view.focus();
  });
  window.addEventListener('hashchange', () => {
    if (location.hash && !location.hash.startsWith('#/')) return;
    shareOpen = null;
    render();
  });
  render(false);
})();
