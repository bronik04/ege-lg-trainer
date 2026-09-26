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

test('прогресс: сессии с исчезнувшими заданиями сбрасываются', () => {
  const p = { ...L.emptyProgress(), round: L.startSession(['a', 'gone'], 't'), variant: L.startSession(['a'], 't') };
  const pruned = L.pruneProgress(p, ['a']);
  assert.equal(pruned.round, null);
  assert.deepEqual(pruned.variant.ids, ['a']);
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
  assert.deepEqual(L.mergeProgress(merged, L.emptyProgress()), merged);
});

