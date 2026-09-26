// Чистая логика тренажёра: отбор заданий, полный вариант, проверка ответа, прогресс.
// Без DOM и без localStorage — это делает app.js. При сборке слово `export`
// вырезается, и функции попадают в общий скрипт страницы.

export const TASK_NUMBERS = [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27];
export const PROGRESS_KEY = 'ege-lg-trainer:progress';
// Версия 2 (26.09.2026): у записи задания есть review — интервальное повторение ошибок.
// Прогресс и файлы версии 1 читаются: review выводится из последнего ответа.
export const PROGRESS_VERSION = 2;
const READABLE_VERSIONS = [1, 2];

// Через сколько дней исправленная ошибка возвращается на повтор. После последнего
// верного повтора задание считается усвоенным.
export const REVIEW_DAYS = [1, 3, 7];

// ---------- случайность ----------

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(list, rng = Math.random) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ---------- прогресс ----------

export function emptyProgress() {
  return { version: PROGRESS_VERSION, questions: {}, checks: {}, round: null, variant: null, history: [] };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanReview(review, last) {
  if (isRecord(review) && Number.isInteger(review.step) && review.step >= 0 && review.step <= REVIEW_DAYS.length) {
    return { step: review.step, due: typeof review.due === 'string' ? review.due : null };
  }
  // Версия 1: на повтор ставится только неисправленная ошибка.
  return last.correct ? null : { step: 0, due: last.at };
}

function cleanAnswers(map) {
  const out = {};
  if (!isRecord(map)) return out;
  for (const [id, entry] of Object.entries(map)) {
    if (!isRecord(entry) || !isRecord(entry.last)) continue;
    const last = { optionId: String(entry.last.optionId), correct: entry.last.correct === true, at: String(entry.last.at || '') };
    out[id] = {
      attempts: Number(entry.attempts) || 0,
      correctCount: Number(entry.correctCount) || 0,
      last,
      review: cleanReview(entry.review, last),
    };
  }
  return out;
}

// Сессия без заданий или с индексом за границей не восстанавливается: такой прогресс
// мог записать только сбой, и страница не должна на нём падать.
function cleanSession(session) {
  if (!isRecord(session) || !Array.isArray(session.ids) || session.ids.length === 0) return null;
  const index = Number.isInteger(session.index) ? session.index : 0;
  return {
    ...session,
    ids: session.ids.map(String),
    answers: isRecord(session.answers) ? { ...session.answers } : {},
    index: Math.max(0, Math.min(session.ids.length - 1, index)),
  };
}

// Разбирает сохранённый прогресс. Повреждённые или чужие данные не роняют страницу:
// вернётся пустой прогресс, а не исключение.
export function parseProgress(text) {
  if (!text) return emptyProgress();
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return emptyProgress();
  }
  if (!isRecord(raw) || !READABLE_VERSIONS.includes(raw.version)) return emptyProgress();
  return {
    version: PROGRESS_VERSION,
    questions: cleanAnswers(raw.questions),
    checks: cleanAnswers(raw.checks),
    round: cleanSession(raw.round),
    variant: cleanSession(raw.variant),
    history: Array.isArray(raw.history) ? raw.history.filter(isRecord) : [],
  };
}

// Удаляет из сохранённых сессий ID, которых больше нет в банке (задание сняли с публикации).
export function pruneProgress(progress, questionIds) {
  const known = new Set(questionIds);
  const out = { ...progress };
  if (out.round && !out.round.ids.every((id) => known.has(id))) out.round = null;
  if (out.variant && !out.variant.ids.every((id) => known.has(id))) out.variant = null;
  return out;
}

// ---------- перенос прогресса файлом ----------

const PROGRESS_APP = 'ege-lg-trainer';

// Файл прогресса — тот же объект, что в localStorage, с пометкой приложения и датой выгрузки.
export function exportProgress(progress, at) {
  return `${JSON.stringify({ app: PROGRESS_APP, exportedAt: at, ...progress }, null, 1)}\n`;
}

// Разбор загруженного файла: { ok, progress } или { ok: false, reason } — понятная причина
// отказа нужна ученику, поэтому, в отличие от parseProgress, ошибка не прячется.
export function readProgressFile(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not-json' };
  }
  if (!isRecord(raw) || raw.app !== PROGRESS_APP) return { ok: false, reason: 'not-progress' };
  if (!READABLE_VERSIONS.includes(raw.version)) return { ok: false, reason: 'version' };
  return { ok: true, progress: parseProgress(text) };
}

function laterEntry(a, b) {
  if (!a) return b;
  if (!b) return a;
  return b.last.at > a.last.at ? b : a;
}

function laterSession(a, b) {
  if (!a) return b;
  if (!b) return a;
  return String(b.startedAt || '') > String(a.startedAt || '') ? b : a;
}

// Объединение прогресса двух устройств. По каждому заданию остаётся запись с более поздним
// последним ответом, из сессий — начатая позже, история складывается без повторов.
// Повторная загрузка того же файла ничего не меняет.
export function mergeProgress(local, incoming) {
  const merged = emptyProgress();
  for (const kind of ['questions', 'checks']) {
    for (const id of new Set([...Object.keys(local[kind]), ...Object.keys(incoming[kind])])) {
      merged[kind][id] = laterEntry(local[kind][id], incoming[kind][id]);
    }
  }
  merged.round = laterSession(local.round, incoming.round);
  merged.variant = laterSession(local.variant, incoming.variant);
  const seen = new Set();
  merged.history = [...local.history, ...incoming.history]
    .filter((h) => {
      const key = JSON.stringify([h.kind, h.at, h.score, h.total]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return merged;
}

function addDays(at, days) {
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? null : new Date(ms + days * 86400000).toISOString();
}

// Ошибка ставит задание на повтор сразу. Исправленная возвращается через 1, 3 и 7 дней;
// верный ответ до срока ничего не сдвигает, неверный — снова делает задание ошибкой.
function nextReview(prev, correct, at) {
  if (!correct) return { step: 0, due: at };
  const review = prev.review || null;
  if (!review || review.due === null) return review;
  const fixing = prev.last && !prev.last.correct;
  if (!fixing && review.due > at) return review;
  const step = review.step + 1;
  return { step, due: step > REVIEW_DAYS.length ? null : addDays(at, REVIEW_DAYS[step - 1]) };
}

export function recordAnswer(progress, kind, id, optionId, correct, at) {
  const prev = progress[kind][id] || { attempts: 0, correctCount: 0, review: null };
  return {
    ...progress,
    [kind]: {
      ...progress[kind],
      [id]: {
        attempts: prev.attempts + 1,
        correctCount: prev.correctCount + (correct ? 1 : 0),
        last: { optionId, correct, at },
        review: nextReview(prev, correct, at),
      },
    },
  };
}

// new — ещё не решалось; mistake — последний ответ неверный; due — ошибка исправлена, но
// подошёл срок повтора (только если передано now); solved — последний ответ верный.
export function answerState(progress, kind, id, now = null) {
  const entry = progress[kind][id];
  if (!entry) return 'new';
  if (!entry.last.correct) return 'mistake';
  const review = entry.review;
  if (now && review && review.due && review.due <= now) return 'due';
  return 'solved';
}

// Темы, в которых больше всего неисправленных ошибок: что перечитать в первую очередь.
export function weakTopics(questions, progress, limit = 3) {
  const counts = new Map();
  for (const q of questions) {
    if (answerState(progress, 'questions', q.id) !== 'mistake') continue;
    for (const t of q.topicIds) counts.set(t, (counts.get(t) || 0) + 1);
  }
  return [...counts].map(([topicId, count]) => ({ topicId, count }))
    .sort((a, b) => b.count - a.count).slice(0, limit);
}

// Правила к ошибкам раунда или варианта — чаще встретившиеся первыми.
export function rulesForMistakes(items, byId, limit = 2) {
  const counts = new Map();
  for (const item of items) {
    if (item.correct) continue;
    for (const r of byId.get(item.id).ruleIds || []) counts.set(r, (counts.get(r) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([ruleId]) => ruleId);
}

// ---------- отбор ----------

// Пустой список в фильтре означает «без ограничения». Тема и номер задания — независимые признаки.
export function filterQuestions(questions, filters, progress, now = null) {
  const topics = filters.topics || [];
  const tasks = filters.tasks || [];
  const origins = filters.origins || [];
  const state = filters.state || 'all';
  return questions.filter((q) => {
    if (topics.length && !q.topicIds.some((t) => topics.includes(t))) return false;
    if (tasks.length && !tasks.includes(q.taskNumber)) return false;
    if (origins.length && !origins.includes(q.origin)) return false;
    if (state === 'new') return answerState(progress, 'questions', q.id) === 'new';
    if (state === 'mistakes') return answerState(progress, 'questions', q.id) === 'mistake';
    if (state === 'review') return ['mistake', 'due'].includes(answerState(progress, 'questions', q.id, now));
    return true;
  });
}

export function pickRound(list, size, rng = Math.random) {
  const shuffled = shuffle(list, rng);
  if (size === 'all') return shuffled;
  return shuffled.slice(0, Number(size));
}

// Одно задание на каждую позицию 15–27. Если позиция пуста — вариант не собирается.
export function buildVariant(questions, rng = Math.random) {
  const byTask = new Map(TASK_NUMBERS.map((n) => [n, []]));
  for (const q of questions) {
    if (byTask.has(q.taskNumber)) byTask.get(q.taskNumber).push(q);
  }
  const missing = TASK_NUMBERS.filter((n) => byTask.get(n).length === 0);
  if (missing.length) return { ok: false, missing };
  const ids = TASK_NUMBERS.map((n) => {
    const pool = byTask.get(n);
    return pool[Math.floor(rng() * pool.length)].id;
  });
  return { ok: true, ids };
}

// ---------- ссылки для учителя ----------

const ROUND_SIZES = ['5', '10', '20', 'all'];

// Запятая в адресе допустима: ссылка остаётся читаемой (topics=aspect,adverbs).
function query(pairs) {
  return pairs.map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%2C/g, ',')}`).join('&');
}

// Подборка: темы, номера, источник и размер раунда. «Новые» и «ошибки» — личное
// состояние ученика, в ссылку оно не входит.
export function shareQuery(filters) {
  const pairs = [];
  if (filters.topics.length) pairs.push(['topics', filters.topics.join(',')]);
  if (filters.tasks.length) pairs.push(['tasks', filters.tasks.join(',')]);
  if (filters.origins.length) pairs.push(['origins', filters.origins.join(',')]);
  pairs.push(['size', filters.size]);
  return query(pairs);
}

// Одни и те же задания для всех, в том же порядке.
export function idsQuery(ids) {
  return query([['ids', ids.join(',')]]);
}

// Разбор ссылки. known: { topicIds: Set, origins: [], questionIds: Set } — незнакомое
// отбрасывается: ссылка могла пережить снятое с публикации задание или тему.
export function parseShareQuery(text, known) {
  const params = new URLSearchParams(text);
  const list = (key) => (params.get(key) || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (params.has('ids')) {
    const asked = [...new Set(list('ids'))];
    const ids = asked.filter((id) => known.questionIds.has(id));
    return { kind: 'ids', ids, missing: asked.length - ids.length };
  }
  return {
    kind: 'filters',
    filters: {
      topics: list('topics').filter((t) => known.topicIds.has(t)),
      tasks: list('tasks').map(Number).filter((n) => TASK_NUMBERS.includes(n)),
      origins: list('origins').filter((o) => known.origins.includes(o)),
      size: ROUND_SIZES.includes(params.get('size')) ? params.get('size') : '10',
    },
  };
}

// Вариант из ссылки — ровно по одному заданию на позиции 15–27, по порядку.
export function isVariant(ids, byId) {
  return ids.length === TASK_NUMBERS.length
    && ids.every((id, i) => byId.has(id) && byId.get(id).taskNumber === TASK_NUMBERS[i]);
}

// ---------- ответ и разбор ----------

export function optionText(item, optionId) {
  const option = item.options.find((o) => o.id === optionId);
  return option ? option.text : '';
}

// Оценка по постоянному ID варианта, а не по видимой цифре.
export function grade(item, optionId) {
  return { correct: optionId === item.correctOptionId, correctOptionId: item.correctOptionId };
}

// Ссылка «Сообщить об ошибке»: новый issue на GitHub с ID, условием и ответами.
// В ней только данные задания — ничего о самом ученике. Условие идёт блоком кода:
// иначе GitHub прочтёт два пропуска ___…___ как разметку и они пропадут.
export function reportUrl(base, item, optionId) {
  if (!base) return '';
  const what = item.taskNumber ? `задание ${item.taskNumber}` : 'вопрос к правилу';
  const body = [
    `ID: ${item.id} (${what})`,
    'Условие:',
    '```',
    item.stem || item.sentence || item.prompt || '',
    '```',
    `Выбранный ответ: ${optionId == null ? '—' : optionText(item, optionId)}`,
    `Ответ по ключу: ${optionText(item, item.correctOptionId)}`,
    '',
    'Что не так:',
    '',
  ].join('\n');
  return `${base}?${new URLSearchParams({ title: `Ошибка: ${what} · ${item.id}`, body })}`;
}

export function explainChoice(item, optionId) {
  const correct = optionId === item.correctOptionId;
  const explanation = item.explanation || { correct: '', options: {} };
  return {
    correct,
    chosenText: optionText(item, optionId),
    chosenExplanation: correct ? null : (explanation.options || {})[optionId] || '',
    correctText: optionText(item, item.correctOptionId),
    correctExplanation: explanation.correct || '',
    others: item.options
      .filter((o) => o.id !== item.correctOptionId && o.id !== optionId)
      .map((o) => ({ id: o.id, text: o.text, explanation: (explanation.options || {})[o.id] || '' })),
  };
}

// Условие с пропусками: «老板正开___会» → [текст, пропуск, текст].
export function stemSegments(stem) {
  const parts = [];
  const re = /\s*_{2,}\s*/g;
  let last = 0;
  let match;
  while ((match = re.exec(stem)) !== null) {
    if (match.index > last) parts.push({ text: stem.slice(last, match.index) });
    parts.push({ blank: true });
    last = match.index + match[0].length;
  }
  if (last < stem.length) parts.push({ text: stem.slice(last) });
  return parts;
}

// ---------- сессии: раунд тренировки и полный вариант ----------

export function startSession(ids, at) {
  return { ids: ids.slice(), answers: {}, index: 0, startedAt: at, finishedAt: null };
}

export function answerSession(session, id, optionId) {
  return { ...session, answers: { ...session.answers, [id]: optionId } };
}

export function moveSession(session, index) {
  const bounded = Math.max(0, Math.min(session.ids.length - 1, index));
  return { ...session, index: bounded };
}

export function scoreSession(session, byId) {
  const items = session.ids.map((id) => {
    const item = byId.get(id);
    const chosen = session.answers[id] ?? null;
    return { id, taskNumber: item.taskNumber, chosen, correct: chosen !== null && chosen === item.correctOptionId };
  });
  return { score: items.filter((i) => i.correct).length, total: items.length, items };
}

// Завершение варианта: ответы идут в личный прогресс, результат — в историю.
// Последующий повтор ошибок меняет прогресс заданий, но не этот результат.
export function finishVariant(progress, byId, at) {
  const variant = progress.variant;
  const result = scoreSession(variant, byId);
  let next = progress;
  for (const item of result.items) {
    if (item.chosen !== null) next = recordAnswer(next, 'questions', item.id, item.chosen, item.correct, at);
  }
  return {
    ...next,
    variant: { ...variant, finishedAt: at, result: { score: result.score, total: result.total } },
    history: [...next.history, { kind: 'variant', at, score: result.score, total: result.total }],
  };
}

export function unansweredPositions(session, byId) {
  return session.ids.filter((id) => session.answers[id] == null).map((id) => byId.get(id).taskNumber);
}
