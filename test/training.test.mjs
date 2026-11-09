import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/logic.mjs';

const at = '2026-11-09T10:00:00.000Z';
const bank = 'abcdefghij'.split('').map((id) => ({ id, taskNumber: 22, origin: 'fipi', correctOptionId: '1' }));
const byId = new Map(bank.map((item) => [item.id, item]));
const training = (ids, mode = null) => L.startSession(ids, at, mode, 'training');
const answer = (round, correct = true) => L.answerRound(round, correct ? '1' : '2', correct);
const next = (round) => L.advanceRound(round, at);
const restored = (round) => L.parseProgress(JSON.stringify({ ...L.emptyProgress(), round })).round;

test('training: test mode keeps one pass and the existing session shape', () => {
  let round = L.startSession(['a'], at);
  assert.deepEqual(round, { ids: ['a'], answers: {}, index: 0, startedAt: at, finishedAt: null });
  round = next(answer(round, false));
  assert.equal(round.finishedAt, at);
  assert.deepEqual(round.ids, ['a']);
  assert.equal(L.isTrainingRound(round), false);
});

test('training: an error returns after five other cards without changing the first score', () => {
  let round = next(answer(training('abcdefgh'.split('')), false));
  for (const id of 'bcdef') {
    assert.equal(round.ids[round.index], id);
    round = next(answer(round));
  }
  assert.equal(round.index, 6);
  assert.equal(round.ids[round.index], 'a');
  assert.equal(L.roundAnswer(round), undefined, 'the first wrong answer must not pre-answer the repeat');
  round = answer(round);
  assert.equal(round.answers.a, '2');
  assert.equal(L.roundAnswer(round), '1');
  round = next(round);
  for (const id of 'gh') {
    assert.equal(round.ids[round.index], id);
    round = next(answer(round));
  }
  assert.equal(round.finishedAt, at);
  assert.equal(L.scoreSession(round, byId).score, 7);
  assert.equal(L.scoreSession(round, byId).total, 8);
  assert.deepEqual(L.initialRoundIds(round), 'abcdefgh'.split(''));
  assert.deepEqual(L.trainingResult(round, byId), { repeated: 1, corrected: 1, remaining: 0, repeats: { a: '1' } });
});

test('training: a last-card error returns at the end and a second error does not loop', () => {
  let round = next(answer(training(['a', 'b'])));
  round = next(answer(round, false));
  assert.deepEqual(round.ids, ['a', 'b', 'b']);
  assert.equal(round.finishedAt, null);
  round = next(answer(round, false));
  assert.equal(round.finishedAt, at);
  assert.deepEqual(L.trainingResult(round, byId), { repeated: 1, corrected: 0, remaining: 1, repeats: { b: '2' } });
});

test('training: multiple due errors keep the reference order and repeat only once', () => {
  let round = training('abcdefghij'.split(''));
  const seen = [];
  while (!round.finishedAt && seen.length < 20) {
    const id = round.ids[round.index];
    seen.push(id);
    round = next(answer(round, !['a', 'b'].includes(id)));
  }
  assert.deepEqual(seen, ['a', 'b', 'c', 'd', 'e', 'f', 'a', 'b', 'g', 'h', 'i', 'j']);
  assert.equal(round.finishedAt, at);
  assert.equal(L.scoreSession(round, byId).score, 8);
  assert.equal(L.scoreSession(round, byId).total, 10);
});

test('training: every wrong original gets one retry even in a short round', () => {
  let round = training(['a', 'b', 'c']);
  const seen = [];
  while (!round.finishedAt && seen.length < 10) {
    seen.push(round.ids[round.index]);
    round = next(answer(round, false));
  }
  assert.deepEqual(seen, ['a', 'b', 'c', 'a', 'b', 'c']);
  assert.equal(L.trainingResult(round, byId).remaining, 3);
});

test('training: unanswered/finished steps and a double answer are idempotent', () => {
  const initial = training(['a']);
  assert.equal(next(initial), initial);
  const wrong = answer(initial, false);
  assert.equal(answer(wrong), wrong);
  assert.equal(wrong.retryQueue.length, 1);
  const finished = next(answer(next(wrong)));
  assert.equal(next(finished), finished);
});

test('training: reload preserves pending errors and the selected repeat answer', () => {
  let round = restored(answer(training(['a'], L.TONES_MODE), false));
  assert.equal(L.isTonesRound(round), true);
  assert.equal(round.retryQueue.length, 1);
  round = restored(next(round));
  assert.equal(L.roundAnswer(round), undefined);
  round = restored(answer(round));
  assert.equal(L.roundAnswer(round), '1');
  assert.equal(round.answers.a, '2');
  assert.equal(L.roundAnswerCount(round), 2);
  assert.equal(next(round).finishedAt, at);
});

test('training: removing a queued item removes its repeat and keeps the next question unanswered', () => {
  const round = next(answer(training(['a', 'b', 'c']), false));
  const pruned = L.pruneProgress({ ...L.emptyProgress(), round }, bank.filter((q) => q.id !== 'a')).round;
  assert.deepEqual(pruned.ids, ['b', 'c']);
  assert.deepEqual(L.initialRoundIds(pruned), ['b', 'c']);
  assert.equal(pruned.index, 0);
  assert.equal(L.roundAnswer(pruned), undefined);
  assert.deepEqual(pruned.retryQueue, []);
});

test('training: removing an answered step remaps attempts, queue deadlines and first answers', () => {
  let round = next(answer(training(['a', 'b', 'c']), false));
  round = next(answer(round));
  round = answer(round, false);
  round = L.pruneProgress({ ...L.emptyProgress(), round }, bank.filter((q) => q.id !== 'b')).round;
  assert.deepEqual(round.ids, ['a', 'c']);
  assert.equal(round.index, 1);
  assert.equal(L.roundAnswer(round), '2');
  assert.deepEqual(round.attemptAnswers, { 0: '2', 1: '2' });
  assert.deepEqual(round.retryQueue.map((entry) => entry.afterPosition), [5, 7]);
  round = next(round);
  assert.equal(round.ids[round.index], 'a');
  assert.equal(L.roundAnswer(round), undefined);
});

test('training: removing a future card does not count it as one of the five answered cards', () => {
  const round = answer(training(['a', 'b', 'c']), false);
  const pruned = L.pruneProgress({ ...L.emptyProgress(), round }, bank.filter((q) => q.id !== 'b')).round;
  assert.equal(pruned.retryQueue[0].afterPosition, 6);
});

test('training: malformed saved attempts and unknown or duplicate retries are discarded', () => {
  const raw = { ...training(['a', 'b']), attemptAnswers: { 0: '2', 99: '1', bad: '1' },
    retryQueue: [{ id: 'gone', afterPosition: 1 }, { id: 'a', afterPosition: 6 }, { id: 'a', afterPosition: 7 }, { id: 'b', afterPosition: -1 }],
    retriedIds: ['gone', 'a'] };
  const round = restored(raw);
  assert.deepEqual(round.attemptAnswers, { 0: '2' });
  assert.deepEqual(round.retryQueue, [{ id: 'a', afterPosition: 6 }]);
  assert.deepEqual(round.retriedIds, ['a']);
});

test('training: old progress and files migrate without changing a running test or variant', () => {
  assert.equal(L.PROGRESS_VERSION, 3);
  const legacy = { ids: ['a', 'b'], answers: { a: '2' }, index: 1, startedAt: at, finishedAt: null };
  for (const version of [1, 2]) {
    const old = { ...L.emptyProgress(), version, round: legacy, variant: { ...legacy, elapsedMs: 1234 } };
    const parsed = L.parseProgress(JSON.stringify(old));
    assert.equal(parsed.version, 3);
    assert.deepEqual(parsed.round, legacy);
    assert.equal(parsed.variant.elapsedMs, 1234);
    assert.equal(L.isTrainingRound(parsed.round), false);
    assert.equal(L.readProgressFile(JSON.stringify({ app: 'ege-lg-trainer', ...old })).ok, true);
  }
});

test('training: links carry the mode but share only the original IDs', () => {
  const known = { topicIds: new Set(), ruleIds: new Set(), origins: ['fipi'], questionIds: new Set(['a', 'b']) };
  const filters = { topics: [], tasks: [], rules: [], origins: [], size: '10', roundType: 'training' };
  assert.equal(L.shareQuery(filters), 'size=10&roundType=training');
  assert.equal(L.parseShareQuery(L.shareQuery(filters), known).filters.roundType, 'training');
  let round = next(answer(training(['a', 'b']), false));
  round = next(answer(round));
  const query = L.idsQuery(L.initialRoundIds(round), 'training');
  assert.equal(query, 'ids=a,b&roundType=training');
  assert.equal(L.parseShareQuery(query, known).roundType, 'training');
  assert.equal(L.linkAction(round, ['a', 'b'], 'training'), 'continue');
  assert.equal(L.linkAction(round, ['a', 'b']), 'ask', 'a test link must not silently resume training');
});
