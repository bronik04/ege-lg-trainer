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

const isTime = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value));

// step — сколько повторов пройдено; после последнего (step = REVIEW_DAYS.length + 1) due = null.
function cleanReview(review, last) {
  if (isRecord(review) && Number.isInteger(review.step) && review.step >= 0 && review.step <= REVIEW_DAYS.length + 1) {
    const learned = review.step > REVIEW_DAYS.length && review.due === null;
    if (learned || isTime(review.due)) return { step: review.step, due: review.due };
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
  const out = {
    ...session,
    ids: session.ids.map(String),
    answers: isRecord(session.answers) ? { ...session.answers } : {},
    index: Math.max(0, Math.min(session.ids.length - 1, index)),
  };
  // Время варианта — только число: строка из испорченного файла склеилась бы, а не сложилась.
  if ('elapsedMs' in out && !(Number.isFinite(out.elapsedMs) && out.elapsedMs >= 0)) delete out.elapsedMs;
  return out;
}

// Разбирает сохранённый прогресс. Повреждённые или чужие данные не роняют страницу:
// вернётся пустой прогресс, а не исключение.
// Версия сохранённого прогресса или null, если это не прогресс. Страница, которая старше
// сохранённых данных, не должна их перезаписывать: иначе откат выкладки сотрёт прогресс.
export function progressVersion(text) {
  try {
    const raw = JSON.parse(text);
    return isRecord(raw) && Number.isInteger(raw.version) ? raw.version : null;
  } catch {
    return null;
  }
}

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

// Срок — начало местных суток через days дней: исправленное вечером повторяется уже утром
// следующего дня, а не через ровно 24 часа.
function addDays(at, days) {
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) return null;
  const date = new Date(ms);
  date.setDate(date.getDate() + days);
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
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

// Работа над ошибками: неверные и пропущенные задания, сгруппированные по правилу (первому из
// ruleIds, которое есть на странице). Порядок групп — как в rulesForMistakes: сначала больше
// неверных ответов (пропуск — не ошибка понимания), потом больше заданий; без правила — в конце.
export function groupMistakesByRule(items, byId, known = null) {
  const groups = new Map();
  for (const item of items) {
    if (item.correct) continue;
    const q = byId.get(item.id);
    if (!q) continue;
    const ruleId = (q.ruleIds || []).find((r) => !known || known.has(r)) || null;
    if (!groups.has(ruleId)) groups.set(ruleId, []);
    groups.get(ruleId).push({ id: item.id, chosen: item.chosen ?? null });
  }
  const answered = (g) => g.entries.filter((e) => e.chosen !== null).length;
  return [...groups].map(([ruleId, entries]) => ({ ruleId, entries }))
    .sort((a, b) => (a.ruleId === null) - (b.ruleId === null) || answered(b) - answered(a) || b.entries.length - a.entries.length);
}

// Правила к ошибкам раунда или варианта — чаще встретившиеся первыми. Пропущенная позиция
// варианта (chosen === null) не ошибка понимания; known — правила, которые есть на странице.
export function rulesForMistakes(items, byId, known = null, limit = 2) {
  const counts = new Map();
  for (const item of items) {
    if (item.correct || item.chosen === null) continue;
    for (const r of byId.get(item.id).ruleIds || []) {
      if (!known || known.has(r)) counts.set(r, (counts.get(r) || 0) + 1);
    }
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

// ---------- отчёт учителю ----------

// Код в конце сообщения ученика: по нему страница учителя сводит результаты класса.
// Префикс — версия формата: меняете поля — новый префикс, а страница учителя читает и старые.
// Обычный base64 без «=»: в нём нет «_» и «-», которые мессенджеры превращают в разметку.
export const REPORT_PREFIX = 'EGELG1:';
const REPORT_CODE = /EGELG1:([A-Za-z0-9+/]+)/g;
const REPORT_KINDS = ['round', 'variant'];
const REPORT_LIMITS = { ids: 100, id: 40, name: 80, day: 86_400_000 };

function toBase64(text) {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=+$/, '');
}

function fromBase64(code) {
  const binary = atob(code + '==='.slice((code.length + 3) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (ch) => ch.charCodeAt(0)));
}

// Отчёт: kind — round | variant, name — как ученик себя назвал, ids и answers — по порядку сессии,
// score и total — счёт, который ученик видел у себя (банк у учителя мог с тех пор измениться).
export function encodeReport(report) {
  const payload = { v: 1, kind: report.kind, name: report.name, at: report.at, ids: report.ids, answers: report.answers };
  if (Number.isInteger(report.score) && Number.isInteger(report.total)) Object.assign(payload, { score: report.score, total: report.total });
  if (Number.isFinite(report.timeMs)) payload.timeMs = Math.round(report.timeMs);
  return REPORT_PREFIX + toBase64(JSON.stringify(payload));
}

// Код приходит из чужого сообщения: только известные поля, типы и пределы проверены.
function cleanReport(raw) {
  if (!isRecord(raw) || raw.v !== 1 || !REPORT_KINDS.includes(raw.kind)) return null;
  if (typeof raw.name !== 'string' || typeof raw.at !== 'string') return null;
  const { ids, answers } = raw;
  if (!Array.isArray(ids) || !Array.isArray(answers) || ids.length !== answers.length) return null;
  if (!ids.length || ids.length > REPORT_LIMITS.ids || new Set(ids).size !== ids.length) return null;
  if (!ids.every((id) => typeof id === 'string' && id.length <= REPORT_LIMITS.id)) return null;
  if (!answers.every((a) => a === null || (typeof a === 'string' && a.length <= REPORT_LIMITS.id))) return null;
  const out = { v: 1, kind: raw.kind, name: raw.name.trim().slice(0, REPORT_LIMITS.name), at: raw.at.slice(0, 40), ids, answers };
  if (Number.isInteger(raw.score) && Number.isInteger(raw.total) && raw.score >= 0 && raw.score <= raw.total && raw.total <= ids.length) {
    out.score = raw.score;
    out.total = raw.total;
  }
  if (Number.isFinite(raw.timeMs) && raw.timeMs >= 0 && raw.timeMs < REPORT_LIMITS.day) out.timeMs = raw.timeMs;
  return out;
}

// Все коды из вставленного текста (сообщения можно вставлять пачкой). Одна и та же работа —
// один раз, по последнему сообщению: ученик мог прислать её дважды, поправив имя.
export function decodeReports(text) {
  const byWork = new Map();
  let broken = 0;
  for (const match of String(text || '').matchAll(REPORT_CODE)) {
    let report = null;
    try {
      report = cleanReport(JSON.parse(fromBase64(match[1])));
    } catch {
      report = null;
    }
    if (!report) {
      broken += 1;
      continue;
    }
    const work = [report.kind, report.at, report.ids.join(',')].join('|');
    byWork.delete(work);
    byWork.set(work, report);
  }
  return { reports: [...byWork.values()], broken };
}

// Итог одного отчёта по банку: счёт, номера с ошибками и без ответа, темы ошибок.
function reportScore(report, byId) {
  let score = 0;
  let total = 0;
  let unknown = 0;
  const wrong = [];
  const skipped = [];
  const topics = new Map();
  report.ids.forEach((id, i) => {
    const q = byId.get(id);
    if (!q) { unknown += 1; return; }
    total += 1;
    const chosen = report.answers[i];
    if (chosen !== null && chosen === q.correctOptionId) { score += 1; return; }
    (chosen === null ? skipped : wrong).push(q.taskNumber);
    for (const t of q.topicIds || []) topics.set(t, (topics.get(t) || 0) + 1);
  });
  return { score, total, unknown, wrong, skipped, topics };
}

function numbersLine(numbers) {
  const counts = new Map();
  for (const n of numbers) counts.set(n, (counts.get(n) || 0) + 1);
  return [...counts].sort((a, b) => a[0] - b[0]).map(([n, c]) => (c > 1 ? `${n} ×${c}` : String(n))).join(', ');
}

// Сообщение ученика: читаемый текст для мессенджера и код последней строкой.
export function reportText(report, byId, topicTitle = (id) => id) {
  const r = reportScore(report, byId);
  const when = Number.isNaN(Date.parse(report.at)) ? ''
    : ` · ${new Date(report.at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}`;
  const what = report.kind === 'variant' ? 'Полный вариант' : `Раунд практики · заданий: ${report.ids.length}`;
  const time = Number.isFinite(report.timeMs) ? ` · время ${formatClock(report.timeMs)}` : '';
  const mistakes = [r.wrong.length ? numbersLine(r.wrong) : '', r.skipped.length ? `без ответа: ${numbersLine(r.skipped)}` : '']
    .filter(Boolean).join(' · ');
  const topics = [...r.topics].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${topicTitle(t)} (${n})`).join(', ');
  return [
    'Отчёт: ЕГЭ, китайский, задания 15–27',
    `Ученик: ${report.name || '(имя не указано)'}`,
    what + when,
    `Результат: ${r.score} из ${r.total}${time}`,
    mistakes ? `Ошибки: ${mistakes}` : 'Ошибок нет',
    topics ? `Темы с ошибками: ${topics}` : '',
    encodeReport(report),
  ].filter(Boolean).join('\n');
}

// Сводка по классу: строка на отчёт (по имени), номера и темы — где ошибок больше.
export function classSummary(reports, byId) {
  const byTask = new Map();
  const byTopic = new Map();
  let unknown = 0;
  const rows = reports.map((report) => {
    const r = reportScore(report, byId);
    unknown += r.unknown;
    report.ids.forEach((id, i) => {
      const q = byId.get(id);
      if (!q) return;
      const entry = byTask.get(q.taskNumber) || { taskNumber: q.taskNumber, wrong: 0, total: 0 };
      entry.total += 1;
      if (report.answers[i] === null || report.answers[i] !== q.correctOptionId) entry.wrong += 1;
      byTask.set(q.taskNumber, entry);
    });
    for (const [t, n] of r.topics) byTopic.set(t, (byTopic.get(t) || 0) + n);
    // Счёт у ученика и по нынешнему банку разошёлся — задание сняли или поправили ключ.
    const reported = Number.isInteger(report.score) && (report.score !== r.score || report.total !== r.total)
      ? { score: report.score, total: report.total } : null;
    return { name: report.name, kind: report.kind, at: report.at, timeMs: report.timeMs, score: r.score, total: r.total,
      reported, wrongTasks: [...new Set([...r.wrong, ...r.skipped])].sort((a, b) => a - b) };
  }).sort((a, b) => a.name.localeCompare(b.name, 'ru') || String(a.at).localeCompare(String(b.at)));
  return {
    rows,
    byTask: [...byTask.values()].filter((t) => t.wrong)
      .sort((a, b) => b.wrong - a.wrong || b.wrong / b.total - a.wrong / a.total || a.taskNumber - b.taskNumber),
    byTopic: [...byTopic].map(([topicId, wrong]) => ({ topicId, wrong }))
      .sort((a, b) => b.wrong - a.wrong || a.topicId.localeCompare(b.topicId)),
    unknown,
  };
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

// ---------- пропуск-клетка: что вписать и сколько клеток ----------

const HANZI = /[㐀-鿿]/; // U+3400–U+9FFF: иероглифы, включая расширение A
const CYRILLIC = /[Ѐ-ӿ]/; // U+0400–U+04FF

// Китайский текст: есть иероглифы и нет кириллицы («感觉 нельзя…» — русский текст).
export function isChinese(text) {
  return HANZI.test(text) && !CYRILLIC.test(text);
}

const PUNCT = '\\s，,、；;。：:';
const EDGE_PUNCT = new RegExp(`^[${PUNCT}]+|[${PUNCT}]+$`, 'g');
const INNER_PUNCT = new RegExp(`[${PUNCT}]`);
const blankCount = (item) => stemSegments(item.stem ?? item.sentence ?? '').filter((p) => p.blank).length;
const charCount = (text) => [...text.replace(/\s+/g, '')].length;

// Что вписать в пропуски для варианта: один пропуск — весь текст, несколько — части союза
// («要是……，就……» → 要是 и 就). Не раскладывается или без иероглифов — null.
export function blankFill(item, optionId) {
  const k = blankCount(item);
  const option = item.options.find((o) => o.id === optionId);
  if (!k || !option || !isChinese(option.text)) return null;
  if (k === 1) return [option.text.trim()];
  const parts = option.text.split(/…+|\.{3,}/).map((p) => p.replace(EDGE_PUNCT, '')).filter(Boolean);
  if (parts.length !== k || parts.some((p) => INNER_PUNCT.test(p))) return null;
  return parts;
}

// Сколько клеток в каждом пропуске. Клетки по числу знаков — только когда у всех вариантов
// в этом пропуске поровну знаков (от 1 до 4): тогда число клеток ничего не подсказывает.
// Разная длина, длиннее четырёх или вариант не вписывается — 0: одна вытянутая клетка без
// деления, по ней не видно, сколько знаков вписать (иначе ученик выбирает вариант по ширине).
export function blankCells(item) {
  const k = blankCount(item);
  const fills = item.options.map((o) => blankFill(item, o.id));
  return Array.from({ length: k }, (_, i) => {
    if (!fills.length || fills.some((f) => !f)) return 0;
    const lengths = new Set(fills.map((f) => charCount(f[i])));
    const [n] = lengths;
    return lengths.size === 1 && n <= 4 ? Math.max(1, n) : 0;
  });
}

// ---------- сессии: раунд тренировки и полный вариант ----------

export function startSession(ids, at) {
  return { ids: ids.slice(), answers: {}, index: 0, startedAt: at, finishedAt: null };
}

// Полный вариант ведёт время с нуля. У варианта, начатого до появления часов, поля нет —
// сколько он шёл, неизвестно, и часы для него не идут.
export function startVariant(ids, at) {
  return { ...startSession(ids, at), elapsedMs: 0 };
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
  // Время есть только у вариантов, начатых с часами (startVariant).
  const time = Number.isFinite(variant.elapsedMs) ? { timeMs: Math.round(variant.elapsedMs) } : {};
  return {
    ...next,
    variant: { ...variant, finishedAt: at, result: { score: result.score, total: result.total, ...time } },
    history: [...next.history, { kind: 'variant', at, score: result.score, total: result.total, ...time }],
  };
}

// ---------- время варианта ----------

// Спецификация ЕГЭ 2026: на раздел «Грамматика, лексика и иероглифика» (задания 15–27)
// рекомендовано 40 минут.
export const VARIANT_MINUTES = 40;

// «мм:сс», от часа — «ч:мм:сс».
export function formatClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = (n) => String(n).padStart(2, '0');
  const h = Math.floor(total / 3600);
  const rest = `${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
  return h ? `${h}:${rest}` : rest;
}

// Сколько осталось из рекомендованных минут — или насколько они превышены.
export function clockState(elapsedMs) {
  const limit = VARIANT_MINUTES * 60000;
  const elapsed = Math.max(0, elapsedMs);
  if (elapsed <= limit) return { over: false, text: formatClock(limit - elapsed + 999) };
  return { over: true, text: `+${formatClock(elapsed - limit)}` };
}

export function unansweredPositions(session, byId) {
  return session.ids.filter((id) => session.answers[id] == null).map((id) => byId.get(id).taskNumber);
}
