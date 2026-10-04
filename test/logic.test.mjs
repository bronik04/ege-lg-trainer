import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/logic.mjs';

function q(id, taskNumber, extra = {}) {
  return {
    id,
    taskNumber,
    origin: 'fipi',
    topicIds: ['aspect'],
    options: [{ id: '1', text: '了' }, { id: '2', text: '着' }, { id: '3', text: '过' }],
    correctOptionId: '2',
    explanation: { correct: 'верно потому что', options: { 1: 'не 了 потому что', 3: 'не 过 потому что' } },
    ...extra,
  };
}

const fullBank = L.TASK_NUMBERS.flatMap((n) => [q(`q${n}-a`, n), q(`q${n}-b`, n)]);

test('вариант: ровно 13 позиций в порядке 15–27', () => {
  const result = L.buildVariant(fullBank, L.mulberry32(1));
  assert.equal(result.ok, true);
  assert.equal(result.ids.length, 13);
  const byId = new Map(fullBank.map((x) => [x.id, x]));
  assert.deepEqual(result.ids.map((id) => byId.get(id).taskNumber), L.TASK_NUMBERS);
});

test('вариант: при нехватке банка называет недостающие позиции', () => {
  const partial = fullBank.filter((x) => x.taskNumber !== 17 && x.taskNumber !== 26);
  assert.deepEqual(L.buildVariant(partial), { ok: false, missing: [17, 26] });
  assert.deepEqual(L.buildVariant([]).missing, L.TASK_NUMBERS);
});

test('вариант: разные зёрна дают разные наборы', () => {
  const a = L.buildVariant(fullBank, L.mulberry32(1)).ids;
  const b = L.buildVariant(fullBank, L.mulberry32(99)).ids;
  assert.notDeepEqual(a, b);
});

test('фильтр: тема и номер задания — независимые признаки', () => {
  const bank = [
    q('a', 22, { topicIds: ['adverbs'] }),
    q('b', 27, { topicIds: ['adverbs', 'constructions'] }),
    q('c', 22, { topicIds: ['adverbs'], origin: 'generated' }),
    q('d', 18, { topicIds: ['comparison'] }),
  ];
  const p = L.emptyProgress();
  const ids = (f) => L.filterQuestions(bank, f, p).map((x) => x.id);
  assert.deepEqual(ids({ topics: ['adverbs'] }), ['a', 'b', 'c']);
  assert.deepEqual(ids({ tasks: [22] }), ['a', 'c']);
  assert.deepEqual(ids({ topics: ['adverbs'], tasks: [27] }), ['b']);
  assert.deepEqual(ids({ topics: ['constructions'], tasks: [22] }), []);
  assert.deepEqual(ids({ origins: ['generated'] }), ['c']);
  assert.deepEqual(ids({}), ['a', 'b', 'c', 'd']);
});

test('фильтр: новые и ошибки', () => {
  const bank = [q('a', 20), q('b', 20), q('c', 20)];
  let p = L.emptyProgress();
  p = L.recordAnswer(p, 'questions', 'a', '1', false, 't1');
  p = L.recordAnswer(p, 'questions', 'b', '2', true, 't1');
  assert.deepEqual(L.filterQuestions(bank, { state: 'new' }, p).map((x) => x.id), ['c']);
  assert.deepEqual(L.filterQuestions(bank, { state: 'mistakes' }, p).map((x) => x.id), ['a']);
  p = L.recordAnswer(p, 'questions', 'a', '2', true, 't2');
  assert.deepEqual(L.filterQuestions(bank, { state: 'mistakes' }, p).map((x) => x.id), []);
  assert.equal(p.questions.a.attempts, 2);
  assert.equal(p.questions.a.correctCount, 1);
});

test('оценка по ID варианта: три и четыре варианта', () => {
  const three = q('a', 20);
  const four = q('b', 22, { options: [{ id: '1', text: '才' }, { id: '2', text: '只' }, { id: '3', text: '就' }, { id: '4', text: '再' }], correctOptionId: '1' });
  assert.equal(L.grade(three, '2').correct, true);
  assert.equal(L.grade(three, '3').correct, false);
  assert.equal(L.grade(four, '1').correct, true);
  assert.equal(L.grade(four, '4').correct, false);
});

test('разбор объясняет именно выбранный неверный вариант', () => {
  const e = L.explainChoice(q('a', 20), '3');
  assert.equal(e.correct, false);
  assert.equal(e.chosenText, '过');
  assert.equal(e.chosenExplanation, 'не 过 потому что');
  assert.equal(e.correctText, '着');
  assert.deepEqual(e.others.map((o) => o.id), ['1']);
  const ok = L.explainChoice(q('a', 20), '2');
  assert.equal(ok.correct, true);
  assert.equal(ok.chosenExplanation, null);
  assert.deepEqual(ok.others.map((o) => o.id), ['1', '3']);
});

test('пропуски в условии', () => {
  assert.deepEqual(L.stemSegments('老板正开___会。'), [{ text: '老板正开' }, { blank: true }, { text: '会。' }]);
  assert.deepEqual(L.stemSegments('___ 学校放假，我 ___ 去旅游。'),
    [{ blank: true }, { text: '学校放假，我' }, { blank: true }, { text: '去旅游。' }]);
  assert.deepEqual(L.stemSegments('整齐.'), [{ text: '整齐.' }]);
});

// ---------- пропуск-клетка ----------

const opts = (...texts) => texts.map((text, i) => ({ id: String(i + 1), text }));

test('blankFill: один пропуск — текст варианта целиком', () => {
  const item = { stem: '他说___是将来的事。', options: opts('的', '地') };
  assert.deepEqual(L.blankFill(item, '2'), ['地']);
  assert.equal(L.blankFill(item, 'нет такого'), null);
});

test('blankFill: союз задания 27 раскладывается по двум пропускам', () => {
  const item = { stem: '___西瓜有这么多的优点，___ 我最爱吃西瓜。', options: opts('要是……，就……', '虽然……但是', '除了........以外,........', '不但……，而且……，还……', '除了……以外，还……') };
  assert.deepEqual(L.blankFill(item, '1'), ['要是', '就']);
  assert.deepEqual(L.blankFill(item, '2'), ['虽然', '但是']);
  assert.deepEqual(L.blankFill(item, '3'), ['除了', '以外']);
  assert.equal(L.blankFill(item, '4'), null, 'три части на два пропуска');
  assert.equal(L.blankFill(item, '5'), null, 'знак препинания внутри части');
});

test('blankFill: без пропуска и без иероглифов — null', () => {
  assert.equal(L.blankFill({ stem: '整齐.', options: opts('2-3') }, '1'), null);
  assert.equal(L.blankFill({ sentence: '他十点___来。', options: opts('Позже ожидаемого') }, '1'), null);
  assert.deepEqual(L.blankFill({ sentence: '他十点___来。', options: opts('就', '才') }, '2'), ['才']);
});

test('blankFill: один пропуск с многоточием — целиком; два пропуска без многоточия — null', () => {
  assert.deepEqual(L.blankFill({ stem: '___我看来，这不对。', options: opts('在……看来', '对') }, '1'), ['在……看来']);
  assert.equal(L.blankFill({ stem: '___他，___我。', options: opts('因为所以') }, '1'), null);
});

test('isChinese: иероглифы без кириллицы', () => {
  assert.equal(L.isChinese('上来'), true);
  assert.equal(L.isChinese('要是……，就……'), true);
  assert.equal(L.isChinese('2-4-2'), false);
  assert.equal(L.isChinese('CAB'), false);
  assert.equal(L.isChinese('感觉 нельзя употреблять о прошлом'), false);
});

test('blankCells: клетки по числу знаков, только если у всех вариантов оно одно', () => {
  assert.deepEqual(L.blankCells({ stem: '拿___本书。', options: opts('上 来', '回去') }), [2], 'пробел внутри варианта — не знак');
  assert.deepEqual(L.blankCells({ stem: '他说___是将来的事。', options: opts('的', '地', '得') }), [1]);
  assert.deepEqual(L.blankCells({ stem: '___他，___我。', options: opts('因为……，所以……', '要是……，就……') }), [2, 0], 'пропуски считаются отдельно');
});

test('blankCells: разная длина вариантов — вытянутая клетка, ширина не подсказывает', () => {
  assert.deepEqual(L.blankCells({ stem: '他___走了。', options: opts('已经', '才', '就', '刚') }), [0], 'три по одному знаку и один из двух');
  assert.deepEqual(L.blankCells({ stem: '拿___本书。', options: opts('上来', '回去', '出') }), [0]);
  assert.deepEqual(L.blankCells({ stem: '___我看来', options: opts('在……看来', '对') }), [0]);
  assert.deepEqual(L.blankCells({ stem: '他___走了。', options: opts('马上就要', '一下子就要') }), [0], 'разной длины, один длиннее четырёх');
  assert.deepEqual(L.blankCells({ stem: '他___走了。', options: opts('一下子就要', '马上就要了') }), [0], 'у всех поровну, но длиннее четырёх');
  assert.deepEqual(L.blankCells({ stem: '他___走了。', options: opts('马上就要', '一下子要') }), [4], 'у всех по четыре');
});

test('blankCells: вариант не вписывается — вытянутая клетка', () => {
  assert.deepEqual(L.blankCells({ stem: '___他，___我。', options: opts('一……就……一……', '除了……以外，还……') }), [0, 0], 'не раскладывается');
  assert.deepEqual(L.blankCells({ stem: '___他，___我。', options: opts('因为……，所以……', '一……就……一……') }), [0, 0], 'один из вариантов не раскладывается');
  assert.deepEqual(L.blankCells({ sentence: '他十点___来。', options: opts('Раньше', 'Позже') }), [0], 'варианты по-русски');
  assert.deepEqual(L.blankCells({ stem: '整齐.', options: opts('2-3') }), []);
});

test('прогресс: сохранение и восстановление', () => {
  let p = L.emptyProgress();
  p = L.recordAnswer(p, 'questions', 'a', '1', false, '2026-09-26T10:00:00Z');
  p = { ...p, variant: L.answerSession(L.startSession(['a', 'b'], 't'), 'a', '1') };
  const restored = L.parseProgress(JSON.stringify(p));
  assert.deepEqual(restored.questions, p.questions);
  assert.deepEqual(restored.variant.answers, { a: '1' });
  assert.equal(restored.version, L.PROGRESS_VERSION);
});

test('прогресс: повреждённые и чужие данные дают пустой прогресс', () => {
  for (const text of ['', 'не json', '[]', '{"version":99,"questions":{}}', 'null']) {
    assert.deepEqual(L.parseProgress(text), L.emptyProgress(), text);
  }
  const partial = L.parseProgress('{"version":1,"questions":{"a":{"attempts":1}},"checks":5}');
  assert.deepEqual(partial.questions, {});
  assert.deepEqual(partial.checks, {});
});

test('прогресс: несогласованные сессии не восстанавливаются', () => {
  const base = { version: 1, questions: {}, checks: {}, history: [] };
  const empty = L.parseProgress(JSON.stringify({ ...base, round: { ids: [], answers: {}, index: 0 }, variant: { ids: [] } }));
  assert.equal(empty.round, null);
  assert.equal(empty.variant, null);
  const outside = L.parseProgress(JSON.stringify({ ...base, round: { ids: ['a'], answers: {}, index: 5 } }));
  assert.equal(outside.round.index, 0);
  const negative = L.parseProgress(JSON.stringify({ ...base, round: { ids: ['a', 'b'], answers: {}, index: -3 } }));
  assert.equal(negative.round.index, 0);
});

test('прогресс: снятое с публикации задание уходит из сессий, начатый вариант остаётся полным', () => {
  const bank = [q('q20-a', 20), q('q20-b', 20), q('q21-a', 21), q('q22-a', 22)];
  // Раунд: снятое задание уходит вместе с ответом, текущее задание остаётся текущим.
  let round = L.startSession(['q20-a', 'q20-gone', 'q21-a'], 't');
  round = L.moveSession(L.answerSession(L.answerSession(round, 'q20-a', '1'), 'q20-gone', '2'), 2);
  // Вариант: позицию снятого занимает другое задание того же номера, ответ на снятое не переносится.
  let variant = L.startVariant(['q20-gone', 'q21-a', 'q22-a'], 't');
  variant = L.answerSession(L.answerSession(variant, 'q20-gone', '1'), 'q21-a', '2');
  const pruned = L.pruneProgress({ ...L.emptyProgress(), round, variant }, bank);
  assert.deepEqual(pruned.round.ids, ['q20-a', 'q21-a']);
  assert.deepEqual(pruned.round.answers, { 'q20-a': '1' });
  assert.equal(pruned.round.index, 1);
  assert.deepEqual(pruned.variant.ids, ['q20-a', 'q21-a', 'q22-a']);
  assert.deepEqual(pruned.variant.answers, { 'q21-a': '2' });
  assert.equal(pruned.variant.elapsedMs, 0);
  // Ничего не снято — сессия та же.
  assert.equal(L.pruneProgress(pruned, bank).round, pruned.round);
  // Заменить нечем — позиция уходит; от сессии ничего не осталось — она сбрасывается.
  const lone = L.pruneProgress({ ...L.emptyProgress(), variant: L.startVariant(['q23-gone', 'q21-a'], 't') }, bank);
  assert.deepEqual(lone.variant.ids, ['q21-a']);
  assert.equal(L.pruneProgress({ ...L.emptyProgress(), round: L.startSession(['gone'], 't') }, bank).round, null);
  // Решённый вариант чужим заданием не дополняется: его ответы уже засчитаны.
  const done = { ...L.startVariant(['q20-gone', 'q21-a'], 't'), finishedAt: 't2' };
  assert.deepEqual(L.pruneProgress({ ...L.emptyProgress(), variant: done }, bank).variant.ids, ['q21-a']);
});

test('завершение варианта: результат в истории, ответы в прогрессе', () => {
  const bank = [q('a', 20), q('b', 21)];
  const byId = new Map(bank.map((x) => [x.id, x]));
  let p = { ...L.emptyProgress(), variant: L.startSession(['a', 'b'], 't0') };
  p = { ...p, variant: L.answerSession(p.variant, 'a', '2') };
  assert.deepEqual(L.unansweredPositions(p.variant, byId), [21]);
  p = L.finishVariant(p, byId, 't1');
  assert.deepEqual(p.variant.result, { score: 1, total: 2 });
  assert.deepEqual(p.history, [{ kind: 'variant', at: 't1', score: 1, total: 2 }]);
  assert.equal(L.answerState(p, 'questions', 'a'), 'solved');
  assert.equal(L.answerState(p, 'questions', 'b'), 'new');
  // Повтор ошибки не меняет результат варианта.
  p = L.recordAnswer(p, 'questions', 'b', '2', true, 't2');
  assert.deepEqual(p.variant.result, { score: 1, total: 2 });
  assert.deepEqual(p.history[0], { kind: 'variant', at: 't1', score: 1, total: 2 });
});

test('раунд: размер и перемешивание', () => {
  const list = Array.from({ length: 30 }, (_, i) => i);
  assert.equal(L.pickRound(list, '10', L.mulberry32(3)).length, 10);
  assert.equal(L.pickRound(list, 'all', L.mulberry32(3)).length, 30);
  assert.deepEqual(L.pickRound(list, 'all', L.mulberry32(3)).slice().sort((a, b) => a - b), list);
  assert.equal(L.moveSession(L.startSession(['a', 'b'], 't'), 5).index, 1);
  assert.equal(L.moveSession(L.startSession(['a', 'b'], 't'), -1).index, 0);
});

test('ссылка «сообщить об ошибке»: ID, условие, выбранный и верный ответ', () => {
  const base = 'https://github.com/owner/repo/issues/new';
  const item = q('q20-x', 20, { stem: '他___着一件红衣服。' });
  const url = new URL(L.reportUrl(base, item, '1'));
  assert.equal(`${url.origin}${url.pathname}`, base);
  assert.equal(url.searchParams.get('title'), 'Ошибка: задание 20 · q20-x');
  const body = url.searchParams.get('body');
  assert.match(body, /ID: q20-x \(задание 20\)/);
  assert.match(body, /Условие:\n```\n他___着一件红衣服。\n```/);
  assert.match(body, /Выбранный ответ: 了/);
  assert.match(body, /Ответ по ключу: 着/);
});

test('ссылка «сообщить об ошибке»: вопрос к правилу, без ответа, без адреса', () => {
  const check = { id: 'check-x', sentence: '你好 nǐ hǎo', options: [{ id: 'a', text: '3-3' }], correctOptionId: 'a' };
  const url = new URL(L.reportUrl('https://example.org/new', check, null));
  assert.equal(url.searchParams.get('title'), 'Ошибка: вопрос к правилу · check-x');
  assert.match(url.searchParams.get('body'), /```\n你好 nǐ hǎo\n```/);
  assert.match(url.searchParams.get('body'), /Выбранный ответ: —/);
  assert.equal(L.reportUrl('', check, 'a'), '');
});

test('ссылка «сообщить об ошибке»: два пропуска задания 27 не превращаются в разметку', () => {
  const item = q('q27-x', 27, { stem: '___下雨，___我们去。' });
  const body = new URL(L.reportUrl('https://example.org/new', item, '2')).searchParams.get('body');
  // Внутри блока кода GitHub не читает ___…___ как жирный курсив.
  assert.match(body, /```\n___下雨，___我们去。\n```/);
});

test('файл прогресса: выгрузка читается обратно, чужой файл — понятная причина', () => {
  let p = L.recordAnswer(L.emptyProgress(), 'questions', 'q20-a', '1', false, '2026-09-26T10:00:00.000Z');
  p = { ...p, round: L.startSession(['q20-a'], '2026-09-26T09:59:00.000Z') };
  const text = L.exportProgress(p, '2026-09-26T10:05:00.000Z');
  const back = L.readProgressFile(text);
  assert.equal(back.ok, true);
  assert.deepEqual(back.progress, L.parseProgress(JSON.stringify(p)));
  assert.deepEqual(L.readProgressFile('не json'), { ok: false, reason: 'not-json' });
  assert.deepEqual(L.readProgressFile('{"version": 1, "questions": {}}'), { ok: false, reason: 'not-progress' });
  assert.deepEqual(L.readProgressFile(JSON.stringify({ app: 'ege-lg-trainer', version: 99 })), { ok: false, reason: 'version' });
});

test('объединение прогресса: по заданию — последний ответ, сессия — начатая позже, история без повторов', () => {
  const t = (m) => `2026-09-26T10:${String(m).padStart(2, '0')}:00.000Z`;
  let phone = L.recordAnswer(L.emptyProgress(), 'questions', 'q20-a', '1', false, t(1));
  phone = L.recordAnswer(phone, 'questions', 'q22-a', '2', true, t(5));
  phone = { ...phone, variant: L.startSession(['q20-a'], t(4)), history: [{ kind: 'variant', at: t(4), score: 5, total: 13 }] };
  let laptop = L.recordAnswer(L.emptyProgress(), 'questions', 'q20-a', '2', true, t(3));
  laptop = L.recordAnswer(laptop, 'checks', 'check-x', 'a', true, t(2));
  laptop = { ...laptop, variant: L.startSession(['q22-a'], t(2)), history: [{ kind: 'variant', at: t(2), score: 7, total: 13 }] };

  const merged = L.mergeProgress(laptop, phone);
  assert.equal(merged.questions['q20-a'].last.at, t(3), 'на ноутбуке ответ позже');
  assert.equal(L.answerState(merged, 'questions', 'q20-a'), 'solved');
  assert.equal(merged.questions['q22-a'].last.optionId, '2', 'задание только с телефона');
  assert.equal(merged.checks['check-x'].last.optionId, 'a');
  assert.deepEqual(merged.variant.ids, ['q20-a'], 'вариант с телефона начат позже');
  assert.deepEqual(merged.history.map((h) => h.score), [7, 5]);
  // Повторная загрузка того же файла ничего не меняет.
  assert.deepEqual(L.mergeProgress(merged, phone), merged);
  // Файл версии 1 объединяется с прогрессом версии 2: повтор идёт вместе с последним ответом.
  const v1 = L.parseProgress(JSON.stringify({ version: 1, questions: { 'q22-a': { attempts: 1, correctCount: 0, last: { optionId: '1', correct: false, at: t(9) } } } }));
  const withV1 = L.mergeProgress(merged, v1);
  assert.deepEqual(withV1.questions['q22-a'].review, { step: 0, due: t(9) });
  assert.equal(withV1.questions['q20-a'].review, merged.questions['q20-a'].review);
  assert.deepEqual(L.mergeProgress(merged, L.emptyProgress()), merged);
});

test('ссылка на подборку: читается обратно, незнакомое отбрасывается', () => {
  const known = { topicIds: new Set(['aspect', 'adverbs']), origins: ['fipi', 'generated'], questionIds: new Set(['q20-a']) };
  const filters = { topics: ['aspect', 'adverbs'], tasks: [20, 22], origins: ['fipi'], state: 'mistakes', size: '5' };
  const text = L.shareQuery(filters);
  assert.equal(text, 'topics=aspect,adverbs&tasks=20,22&origins=fipi&size=5', 'личное состояние в ссылку не входит');
  assert.deepEqual(L.parseShareQuery(text, known), {
    kind: 'filters', missing: 0, filters: { topics: ['aspect', 'adverbs'], tasks: [20, 22], origins: ['fipi'], size: '5' },
  });
  assert.deepEqual(L.parseShareQuery('topics=gone,aspect&tasks=14,20,x&origins=other&size=1000', known).filters,
    { topics: ['aspect'], tasks: [20], origins: [], size: '10' });
});

test('ссылка на задания: порядок сохраняется, пропавшие считаются', () => {
  const known = { topicIds: new Set(), origins: [], questionIds: new Set(['q20-a', 'q22-a']) };
  assert.equal(L.idsQuery(['q22-a', 'q20-a']), 'ids=q22-a,q20-a');
  assert.deepEqual(L.parseShareQuery('ids=q22-a,gone,q20-a,q22-a', known), { kind: 'ids', ids: ['q22-a', 'q20-a'], missing: 1 });
  const byId = new Map(fullBank.map((x) => [x.id, x]));
  const variant = L.TASK_NUMBERS.map((n) => `q${n}-a`);
  assert.equal(L.isVariant(variant, byId), true);
  assert.equal(L.isVariant(variant.slice().reverse(), byId), false, 'позиции не по порядку');
  assert.equal(L.isVariant(variant.slice(1), byId), false, 'не хватает позиции');
  assert.equal(L.isVariant([...variant.slice(0, 12), 'gone'], byId), false, 'задания нет в банке');
});

test('повторение: исправленная ошибка возвращается через 1, 3 и 7 дней', () => {
  const day = (d, h = 10) => new Date(Date.UTC(2026, 8, 1 + d, h)).toISOString();
  // Срок — начало местных суток через n дней после ответа (тест не зависит от часового пояса).
  const dayStart = (at, n) => { const x = new Date(at); x.setDate(x.getDate() + n); x.setHours(0, 0, 0, 0); return x.toISOString(); };
  const before = (iso) => new Date(Date.parse(iso) - 1).toISOString();
  const state = (p, at) => L.answerState(p, 'questions', 'a', at);
  let p = L.recordAnswer(L.emptyProgress(), 'questions', 'a', '1', false, day(0));
  assert.equal(state(p, day(0)), 'mistake');
  p = L.recordAnswer(p, 'questions', 'a', '2', true, day(0, 11));
  const first = dayStart(day(0, 11), 1);
  assert.deepEqual(p.questions.a.review, { step: 1, due: first });
  assert.equal(state(p, before(first)), 'solved', 'исправлено — до срока не беспокоим');
  assert.equal(state(p, first), 'due', 'со следующих суток — пора повторить');
  assert.equal(state(p), 'solved', 'без текущего времени срок не проверяется');
  // Верный ответ до срока ничего не сдвигает.
  const early = L.recordAnswer(p, 'questions', 'a', '2', true, before(first));
  assert.deepEqual(early.questions.a.review, p.questions.a.review);
  // Повторы в срок: 1 → 3 → 7 дней, потом задание усвоено.
  p = L.recordAnswer(p, 'questions', 'a', '2', true, day(1, 11));
  assert.deepEqual(p.questions.a.review, { step: 2, due: dayStart(day(1, 11), 3) });
  p = L.recordAnswer(p, 'questions', 'a', '2', true, day(4, 11));
  assert.deepEqual(p.questions.a.review, { step: 3, due: dayStart(day(4, 11), 7) });
  p = L.recordAnswer(p, 'questions', 'a', '2', true, day(11, 11));
  assert.deepEqual(p.questions.a.review, { step: 4, due: null });
  assert.equal(state(p, day(100)), 'solved');
  // Усвоенное переживает сохранение и загрузку.
  assert.deepEqual(L.parseProgress(JSON.stringify(p)).questions.a.review, { step: 4, due: null });
  // Ошибка на любом шаге — снова ошибка с начала.
  p = L.recordAnswer(p, 'questions', 'a', '1', false, day(101));
  assert.deepEqual(p.questions.a.review, { step: 0, due: day(101) });
  // Верно решённое сразу на повтор не ставится.
  const clean = L.recordAnswer(L.emptyProgress(), 'questions', 'b', '2', true, day(0));
  assert.equal(clean.questions.b.review, null);
});

test('повторение: испорченный срок не принимается, версия прогресса читается отдельно', () => {
  const entry = (review, correct) => JSON.stringify({ version: 2, questions: { a: { attempts: 1, correctCount: 0, last: { optionId: '1', correct, at: '2026-09-20T10:00:00.000Z' }, review } } });
  assert.deepEqual(L.parseProgress(entry({ step: 1, due: 'zzz' }, false)).questions.a.review,
    { step: 0, due: '2026-09-20T10:00:00.000Z' }, 'мусор вместо срока — повтор выводится из ответа');
  assert.equal(L.parseProgress(entry({ step: 2, due: null }, true)).questions.a.review, null, 'due = null бывает только у усвоенного');
  assert.equal(L.progressVersion('{"version":3,"questions":{}}'), 3);
  assert.equal(L.progressVersion('не json'), null);
  assert.equal(L.progressVersion(null), null);
});

test('прогресс версии 1 читается: неисправленная ошибка встаёт на повтор', () => {
  const v1 = {
    version: 1,
    questions: {
      a: { attempts: 1, correctCount: 0, last: { optionId: '1', correct: false, at: 't1' } },
      b: { attempts: 2, correctCount: 1, last: { optionId: '2', correct: true, at: 't2' } },
    },
    checks: {}, round: null, variant: null, history: [],
  };
  const p = L.parseProgress(JSON.stringify(v1));
  assert.equal(p.version, 2);
  assert.deepEqual(p.questions.a.review, { step: 0, due: 't1' });
  assert.equal(p.questions.b.review, null);
  const file = L.readProgressFile(JSON.stringify({ app: 'ege-lg-trainer', ...v1 }));
  assert.equal(file.ok, true, 'файл версии 1 тоже загружается');
  assert.deepEqual(file.progress.questions, p.questions);
});

test('фильтр «на повторение», слабые темы и правила к ошибкам', () => {
  const now = '2026-09-26T12:00:00.000Z';
  const bank = [q('a', 20), q('b', 22, { topicIds: ['adverbs'], ruleIds: ['jiu-cai'] }), q('c', 22, { topicIds: ['adverbs'], ruleIds: ['jiu-cai', 'you-zai-hai'] }), q('d', 20)];
  let p = L.recordAnswer(L.emptyProgress(), 'questions', 'b', '1', false, '2026-09-20T10:00:00.000Z');
  p = L.recordAnswer(p, 'questions', 'c', '1', false, '2026-09-20T10:00:00.000Z');
  p = L.recordAnswer(p, 'questions', 'a', '1', false, '2026-09-20T10:00:00.000Z');
  p = L.recordAnswer(p, 'questions', 'a', '2', true, '2026-09-21T10:00:00.000Z');
  p = L.recordAnswer(p, 'questions', 'd', '2', true, '2026-09-21T10:00:00.000Z');
  assert.deepEqual(L.filterQuestions(bank, { state: 'review' }, p, now).map((x) => x.id), ['a', 'b', 'c']);
  // Исправлено сегодня — до завтрашнего срока на повтор не попадает.
  const fresh = L.recordAnswer(p, 'questions', 'a', '2', true, '2026-09-26T11:00:00.000Z');
  assert.deepEqual(L.filterQuestions(bank, { state: 'review' }, fresh, now).map((x) => x.id), ['b', 'c']);
  assert.deepEqual(L.filterQuestions(bank, { state: 'mistakes' }, p, now).map((x) => x.id), ['b', 'c']);
  assert.deepEqual(L.weakTopics(bank, p), [{ topicId: 'adverbs', count: 2 }]);
  const byId = new Map(bank.map((x) => [x.id, x]));
  const items = [{ id: 'b', correct: false }, { id: 'c', correct: false }, { id: 'a', correct: true }];
  assert.deepEqual(L.rulesForMistakes(items, byId), ['jiu-cai', 'you-zai-hai']);
  assert.deepEqual(L.rulesForMistakes([{ id: 'a', correct: true }], byId), []);
  // Неизвестное странице правило не занимает место в совете; пропуск — не ошибка.
  assert.deepEqual(L.rulesForMistakes(items, byId, new Set(['you-zai-hai'])), ['you-zai-hai']);
  assert.deepEqual(L.rulesForMistakes([{ id: 'b', correct: false, chosen: null }], byId), []);
});

test('время варианта: табло, остаток из 40 минут и время в итоге', () => {
  assert.equal(L.VARIANT_MINUTES, 40, 'спецификация ЕГЭ 2026: 40 минут на раздел 3');
  assert.equal(L.formatClock(0), '00:00');
  assert.equal(L.formatClock(61_500), '01:01');
  assert.equal(L.formatClock(3_723_000), '1:02:03');
  assert.deepEqual(L.clockState(0), { over: false, text: '40:00' });
  assert.deepEqual(L.clockState(500), { over: false, text: '40:00' }, 'первая секунда ещё не прошла');
  assert.deepEqual(L.clockState(39 * 60000 + 30_500), { over: false, text: '00:30' });
  assert.deepEqual(L.clockState(40 * 60000 + 5_000), { over: true, text: '+00:05' });

  const bank = [q('a', 20), q('b', 21)];
  const byId = new Map(bank.map((x) => [x.id, x]));
  const timed = { ...L.emptyProgress(), variant: { ...L.startSession(['a', 'b'], 't0'), elapsedMs: 1_234_567.8 } };
  const done = L.finishVariant(timed, byId, 't1');
  assert.equal(done.variant.result.timeMs, 1_234_568);
  assert.equal(done.history[0].timeMs, 1_234_568);
  // Вариант, начатый до таймера, времени не получает.
  const old = L.finishVariant({ ...L.emptyProgress(), variant: L.startSession(['a'], 't0') }, byId, 't1');
  assert.equal('timeMs' in old.variant.result, false);
  assert.equal('timeMs' in old.history[0], false);
  // Время переживает сохранение и загрузку; мусор вместо числа отбрасывается.
  assert.equal(L.parseProgress(JSON.stringify(timed)).variant.elapsedMs, 1_234_567.8);
  const broken = { ...timed, variant: { ...timed.variant, elapsedMs: '1000' } };
  assert.equal('elapsedMs' in L.parseProgress(JSON.stringify(broken)).variant, false);
  // Новый вариант ведёт время с нуля.
  assert.equal(L.startVariant(['a'], 't0').elapsedMs, 0);
});

test('работа над ошибками: группы по правилу, частые первыми, без правила — в конце', () => {
  const bank = [q('a', 20, { ruleIds: ['aspect'] }), q('b', 22, { ruleIds: ['gone', 'jiu-cai'] }),
    q('c', 22, { ruleIds: ['jiu-cai'] }), q('d', 21, { ruleIds: [] }), q('e', 20, { ruleIds: ['aspect'] })];
  const byId = new Map(bank.map((x) => [x.id, x]));
  const items = [{ id: 'a', chosen: '1', correct: false }, { id: 'b', chosen: null, correct: false },
    { id: 'c', chosen: '3', correct: false }, { id: 'd', chosen: '1', correct: false }, { id: 'e', chosen: '2', correct: true }];
  assert.deepEqual(L.groupMistakesByRule(items, byId, new Set(['aspect', 'jiu-cai'])), [
    { ruleId: 'jiu-cai', entries: [{ id: 'b', chosen: null }, { id: 'c', chosen: '3' }] },
    { ruleId: 'aspect', entries: [{ id: 'a', chosen: '1' }] },
    { ruleId: null, entries: [{ id: 'd', chosen: '1' }] },
  ]);
  assert.deepEqual(L.groupMistakesByRule([{ id: 'e', chosen: '2', correct: true }], byId), []);
});

test('отчёт учителю: код читается обратно, мусор и повторы отбрасываются', () => {
  const report = { kind: 'variant', name: 'Иванова Аня', at: '2026-09-27T15:40:00.000Z', timeMs: 2_050_000,
    ids: ['q20-a', 'q21-a'], answers: ['2', null] };
  const code = L.encodeReport(report);
  assert.match(code, /^EGELG1:[A-Za-z0-9+/]+$/, 'без «_», «-» и «=» — мессенджеры их не портят');
  const text = `Привет!\n${code}\nещё раз ${code}\nEGELG1:испорчено EGELG1:e30`;
  const { reports, broken } = L.decodeReports(text);
  assert.deepEqual(reports, [{ ...report, v: 1 }], 'повтор того же сообщения считается один раз');
  assert.equal(broken, 1, 'e30 — {} без полей; «испорчено» не похоже на код и не считается');
});

test('отчёт учителю: текст для мессенджера', () => {
  const bank = [q('q20-a', 20, { topicIds: ['aspect'] }), q('q21-a', 21, { topicIds: ['aspect'] }), q('q22-a', 22)];
  const byId = new Map(bank.map((x) => [x.id, x]));
  const report = { kind: 'variant', name: 'Аня', at: '2026-09-27T15:40:00.000Z', timeMs: 2_050_000,
    ids: ['q20-a', 'q21-a', 'q22-a'], answers: ['2', null, '1'] };
  const text = L.reportText(report, byId, (id) => ({ aspect: 'Суффиксы' })[id] || id);
  assert.match(text, /^Отчёт: ЕГЭ, китайский, задания 15–27/);
  assert.match(text, /Ученик: Аня/);
  assert.match(text, /Полный вариант/);
  assert.match(text, /Результат: 1 из 3 · время 34:10/);
  assert.match(text, /Ошибки: 22 · без ответа: 21/);
  assert.match(text, /^Темы с ошибками: Суффиксы \(2\)$/m);
  assert.ok(text.trim().endsWith(L.encodeReport(report)), 'код — последней строкой');
});

test('сводка по классу: ученики, номера и темы, где ошибаются', () => {
  const bank = [q('q20-a', 20), q('q22-a', 22, { topicIds: ['adverbs'] }), q('q22-b', 22, { topicIds: ['adverbs'] })];
  const byId = new Map(bank.map((x) => [x.id, x]));
  const reports = [
    { kind: 'round', name: 'Боря', at: 't2', ids: ['q20-a', 'q22-a'], answers: ['1', '1'] },
    { kind: 'round', name: 'Аня', at: 't1', ids: ['q22-b', 'gone'], answers: ['2', '1'] },
  ];
  const s = L.classSummary(reports, byId);
  assert.deepEqual(s.rows.map((r) => [r.name, r.score, r.total, r.wrongTasks]), [['Аня', 1, 1, []], ['Боря', 0, 2, [20, 22]]]);
  assert.deepEqual(s.byTask, [{ taskNumber: 20, wrong: 1, total: 1 }, { taskNumber: 22, wrong: 1, total: 2 }]);
  assert.deepEqual(s.byTopic, [{ topicId: 'adverbs', wrong: 1 }, { topicId: 'aspect', wrong: 1 }]);
  assert.equal(s.unknown, 1, 'задания нет в банке — не считается');
});

test('отчёт учителю: чужой код — только известные поля в пределах', () => {
  const code = (payload) => `EGELG1:${btoa(unescape(encodeURIComponent(JSON.stringify(payload)))).replace(/=+$/, '')}`;
  const base = { v: 1, kind: 'round', name: 'Аня 😀', at: 't', ids: ['q20-a'], answers: ['1'] };
  const read = (payload) => L.decodeReports(code(payload));
  assert.equal(read(base).reports[0].name, 'Аня 😀', 'эмодзи и кириллица без искажений');
  assert.equal(read({ ...base, __proto__: { polluted: true }, extra: 1 }).reports[0].extra, undefined);
  assert.equal(({}).polluted, undefined);
  for (const bad of [
    { ...base, ids: [] }, { ...base, answers: [] }, { ...base, ids: [1], answers: ['1'] },
    { ...base, ids: ['q20-a', 'q20-a'], answers: ['1', '1'] }, { ...base, ids: ['x'.repeat(41)] },
    { ...base, ids: Array.from({ length: 101 }, (_, i) => `q${i}`), answers: Array(101).fill(null) },
    { ...base, kind: 'exam' }, { ...base, name: 5 },
  ]) assert.equal(read(bad).broken, 1, JSON.stringify(bad).slice(0, 60));
  assert.equal('timeMs' in read({ ...base, timeMs: 1e300 }).reports[0], false, 'время больше суток отбрасывается');
  assert.equal('score' in read({ ...base, score: 5, total: 1 }).reports[0], false);
});

test('отчёт учителю: та же работа с исправленным именем — одна строка, последняя', () => {
  const work = { kind: 'variant', at: '2026-09-27T15:40:00.000Z', ids: ['q20-a'], answers: ['1'] };
  const { reports } = L.decodeReports(`${L.encodeReport({ ...work, name: 'Аня' })}\n${L.encodeReport({ ...work, name: 'Аня Иванова' })}`);
  assert.deepEqual(reports.map((r) => r.name), ['Аня Иванова']);
});

test('сводка по классу: счёт ученика, если банк с тех пор изменился', () => {
  const byId = new Map([q('q20-a', 20)].map((x) => [x.id, x]));
  const s = L.classSummary([{ kind: 'round', name: 'Аня', at: 't', ids: ['q20-a', 'gone'], answers: ['2', '1'], score: 2, total: 2 }], byId);
  assert.deepEqual([s.rows[0].score, s.rows[0].total, s.rows[0].reported], [1, 1, { score: 2, total: 2 }]);
});


test('ссылка на те же задания: начатое продолжается, решённое показывает итог', () => {
  const ids = ['a', 'b'];
  const fresh = L.startSession(ids, 't0');
  assert.equal(L.linkAction(null, ids), 'start');
  assert.equal(L.linkAction(fresh, ids), 'continue');
  assert.equal(L.linkAction(L.answerSession(fresh, 'a', '1'), ids), 'continue');
  assert.equal(L.linkAction({ ...fresh, finishedAt: 't1' }, ids), 'result');
  // Те же задания в другом порядке — другая работа.
  assert.equal(L.linkAction(L.answerSession(L.startSession(['b', 'a'], 't0'), 'a', '1'), ids), 'ask');
  // Своя начатая работа с ответами — сначала вопрос; без ответов или решённая — новая сессия.
  const other = L.answerSession(L.startSession(['c'], 't0'), 'c', '1');
  assert.equal(L.linkAction(other, ids), 'ask');
  assert.equal(L.linkAction(L.startSession(['c'], 't0'), ids), 'start');
  assert.equal(L.linkAction({ ...other, finishedAt: 't1' }, ids), 'start');
});

test('№26: верный порядок — одно предложение, без точки посередине', () => {
  const item = {
    fragments: [{ id: 'A', text: '有一些歌词是很久以前的，但我还是用了' }, { id: 'B', text: '这首歌是我寒假时写出来的' },
      { id: 'C', text: '我想用这些词来表达我的感受.' }],
    options: [{ id: '1', text: 'BCA' }, { id: '2', text: 'BAC' }], correctOptionId: '1',
  };
  assert.equal(L.assembledOrder(item), '这首歌是我寒假时写出来的，我想用这些词来表达我的感受，有一些歌词是很久以前的，但我还是用了。');
  assert.equal(L.assembledOrder({ ...item, correctOptionId: '2' }), '这首歌是我寒假时写出来的，有一些歌词是很久以前的，但我还是用了，我想用这些词来表达我的感受。');
  // Фрагмента нет — собирать нечего.
  assert.equal(L.assembledOrder({ ...item, fragments: item.fragments.slice(0, 2) }), '');
});

test('файл прогресса: ключи вроде constructor и __proto__ не ломают загрузку и объединение', () => {
  const entry = JSON.stringify({ attempts: 1, correctCount: 1, last: { optionId: '1', correct: true, at: 't1' } });
  const text = `{"app":"ege-lg-trainer","version":2,"questions":{"constructor":${entry},"__proto__":${entry},`
    + `"toString":${entry},"q20-a":${entry}},"checks":{},"round":null,"variant":null,"history":[]}`;
  const file = L.readProgressFile(text);
  assert.equal(file.ok, true);
  assert.deepEqual(Object.keys(file.progress.questions), ['q20-a']);
  assert.equal(Object.getPrototypeOf(file.progress.questions), Object.prototype);
  const merged = L.mergeProgress(L.emptyProgress(), file.progress);
  assert.deepEqual(Object.keys(merged.questions), ['q20-a']);
});

test('ссылка на подборку: исчезнувшие темы считаются', () => {
  const known = { topicIds: new Set(['aspect']), origins: ['fipi'], questionIds: new Set() };
  const link = L.parseShareQuery('topics=renamed-topic,aspect&size=5', known);
  assert.deepEqual(link.filters.topics, ['aspect']);
  assert.equal(link.missing, 1);
  assert.equal(L.parseShareQuery('topics=aspect&size=5', known).missing, 0);
});

test('раунд: номера поровну, внутри номера — случайно', () => {
  const big = Array.from({ length: 40 }, (_, i) => q(`h26-${i}`, 26, { origin: 'hsk' }));
  const small = L.TASK_NUMBERS.filter((n) => n !== 26).map((n) => q(`q${n}-a`, n));
  const ten = L.pickRound([...big, ...small], '10', L.mulberry32(5));
  assert.equal(ten.length, 10);
  assert.equal(new Set(ten.map((x) => x.taskNumber)).size, 10, '10 заданий — 10 разных номеров');
  const twenty = L.pickRound([...big, ...small], '20', L.mulberry32(5));
  assert.equal(new Set(twenty.map((x) => x.taskNumber)).size, 13, 'сначала все номера, потом повторы');
  assert.equal(twenty.filter((x) => x.taskNumber === 26).length, 8, 'остаток — из номера, где задания ещё есть');
  assert.equal(L.pickRound([...big, ...small], 'all', L.mulberry32(5)).length, 52);
});

test('вариант: задания HSK в него не входят', () => {
  const withHsk = [...Array.from({ length: 20 }, (_, i) => q(`h26-${i}`, 26, { origin: 'hsk' })), ...fullBank];
  for (let seed = 1; seed <= 20; seed += 1) {
    assert.ok(L.buildVariant(withHsk, L.mulberry32(seed)).ids.every((id) => !id.startsWith('h26-')));
  }
  const onlyHsk26 = [...fullBank.filter((x) => x.taskNumber !== 26), q('h26-x', 26, { origin: 'hsk' })];
  assert.deepEqual(L.buildVariant(onlyHsk26), { ok: false, missing: [26] });
});

test('вариант: снятое задание не заменяется заданием HSK', () => {
  const questions = [q('q25-a', 25), q('h26-x', 26, { origin: 'hsk' }), q('q26-b', 26)];
  const variant = { ids: ['q25-a', 'q26-gone'], answers: {}, index: 0, startedAt: 't', finishedAt: null };
  assert.deepEqual(L.pruneProgress({ round: null, variant }, questions).variant.ids, ['q25-a', 'q26-b']);
  const noEge26 = questions.filter((x) => x.id !== 'q26-b');
  assert.deepEqual(L.pruneProgress({ round: null, variant }, noEge26).variant.ids, ['q25-a']);
});
