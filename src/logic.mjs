// Чистая логика тренажёра: отбор заданий, полный вариант, проверка ответа, прогресс.
// Без DOM и без localStorage — это делает app.js. При сборке слово `export`
// вырезается, и функции попадают в общий скрипт страницы.

export const TASK_NUMBERS = [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27];
export const PROGRESS_KEY = 'ege-lg-trainer:progress';
export const PROGRESS_VERSION = 1;

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

function cleanAnswers(map) {
  const out = {};
  if (!isRecord(map)) return out;
  for (const [id, entry] of Object.entries(map)) {
    if (!isRecord(entry) || !isRecord(entry.last)) continue;
    out[id] = {
      attempts: Number(entry.attempts) || 0,
      correctCount: Number(entry.correctCount) || 0,
      last: { optionId: String(entry.last.optionId), correct: entry.last.correct === true, at: String(entry.last.at || '') },
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
  if (!isRecord(raw) || raw.version !== PROGRESS_VERSION) return emptyProgress();
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

export function recordAnswer(progress, kind, id, optionId, correct, at) {
  const prev = progress[kind][id] || { attempts: 0, correctCount: 0 };
  return {
    ...progress,
    [kind]: {
      ...progress[kind],
      [id]: {
        attempts: prev.attempts + 1,
        correctCount: prev.correctCount + (correct ? 1 : 0),
        last: { optionId, correct, at },
      },
    },
  };
}

// new — ещё не решалось; mistake — последний ответ неверный; solved — последний ответ верный.
export function answerState(progress, kind, id) {
  const entry = progress[kind][id];
  if (!entry) return 'new';
  return entry.last.correct ? 'solved' : 'mistake';
}

// ---------- отбор ----------

// Пустой список в фильтре означает «без ограничения». Тема и номер задания — независимые признаки.
export function filterQuestions(questions, filters, progress) {
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

// ---------- ответ и разбор ----------

export function optionText(item, optionId) {
  const option = item.options.find((o) => o.id === optionId);
  return option ? option.text : '';
}

// Оценка по постоянному ID варианта, а не по видимой цифре.
export function grade(item, optionId) {
  return { correct: optionId === item.correctOptionId, correctOptionId: item.correctOptionId };
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
