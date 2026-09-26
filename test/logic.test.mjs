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
