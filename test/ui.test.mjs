// Браузерный тест: собирает страницу из test/fixtures и проходит её в Google Chrome без окна.
// Локально без Chrome или playwright-core пропускается, в CI (переменная CI) — падает.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'test', 'fixtures');
const work = mkdtempSync(join(tmpdir(), 'ege-lg-ui-'));

let chromium = null;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  if (process.env.CI) throw new Error('playwright-core не установлен: npm ci');
}

let browser = null;
if (chromium) {
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  } catch (error) {
    if (process.env.CI) throw error;
  }
}
const skip = browser ? false : 'нет Google Chrome или playwright-core — браузерный тест пропущен';

function fixture(name) {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'));
}

// Собирает страницу из набора данных; change(data) может его поменять.
function buildPage(name, { change, drafts = false } = {}) {
  const data = {
    topics: fixture('topics'), rules: fixture('rules'), 'rule-checks': fixture('rule-checks'), questions: fixture('questions'),
  };
  if (change) change(data);
  const dir = join(work, name);
  mkdirSync(dir, { recursive: true });
  for (const [file, value] of Object.entries(data)) writeFileSync(join(dir, `${file}.json`), JSON.stringify(value));
  const out = join(dir, 'index.html');
  const args = [join(ROOT, 'scripts', 'build_site.py'), '--data-dir', dir, '--out', out];
  if (drafts) args.push('--drafts');
  const result = spawnSync('python3', args, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return pathToFileURL(out).href;
}

let mainUrl;
before(() => { mainUrl = buildPage('main'); });
after(async () => {
  if (browser) await browser.close();
  rmSync(work, { recursive: true, force: true });
});

async function open(url, { width = 1100, height = 900, hash = '', reducedMotion = 'no-preference' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion });
  // Шрифты из сети тесту не нужны: без них страница работает на системных. Что страница
  // ходит в сеть только за ними и не ждёт их, проверяет отдельный тест.
  await context.route(/^https?:\/\//, (route) => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url + hash);
  return { page, context, errors };
}

const text = (page, selector) => page.locator(selector).first().innerText();

// Ждёт, пока элемент с таким текстом появится: смена экрана по ссылке асинхронна.
async function see(page, selector, pattern) {
  await page.locator(selector).filter({ hasText: pattern }).first().waitFor({ timeout: 5000 });
}

test('правило → проверка правила → задания по теме', { skip }, async () => {
  const { page, context, errors } = await open(mainUrl, { hash: '#/rules' });
  await page.getByRole('link', { name: /就 и 才/ }).click();
  await see(page, 'h2', /就 и 才/);
  await see(page, '.mistake', /после долгого срока/);
  await page.getByRole('button', { name: /Проверить правило/ }).click();
  await page.locator('[data-card]').waitFor();
  // Отвечаем на оба вопроса заведомо неверно и читаем разбор выбранного варианта.
  for (let i = 0; i < 2; i += 1) {
    const prompt = await text(page, '.instruction');
    const wrong = prompt.includes('раньше, чем ожидалось') ? '2' : '1';
    await page.keyboard.press(wrong);
    await page.locator('.verdict.bad').waitFor();
    const reason = await text(page, '.verdict.bad p');
    assert.ok(reason.length > 10, 'разбор неверного варианта не пустой');
    const report = new URL(await page.locator('.report a').getAttribute('href'));
    assert.match(report.searchParams.get('title'), /^Ошибка: вопрос к правилу · /);
    await page.keyboard.press('Enter');
  }
  await see(page, 'h2', /0 из 2/);
  await page.getByRole('link', { name: 'К правилу' }).click();
  await page.getByRole('button', { name: /Задания ЕГЭ по теме/ }).click();
  assert.equal(page.url().endsWith('#/practice'), true);
  // Тема «наречия» встречается в задании 22 (два) и в сгенерированном задании 27.
  await see(page, '#available', /Доступно: 3 задания/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('фильтры по теме и номеру независимы, источник виден', { skip }, async () => {
  const { page, context } = await open(mainUrl, { hash: '#/practice' });
  const chip = (group, value) => page.locator(`input[data-key="${group}:${value}"]`);
  await chip('Номер задания', 27).check();
  await see(page, '#available', /Доступно: 2 задания/);
  await chip('Темы', 'adverbs').check();
  await see(page, '#available', /Доступно: 1 задание/);
  await chip('Номер задания', 27).uncheck();
  await chip('Номер задания', 20).check();
  await see(page, '#available', /заданий нет/);
  assert.equal(await page.locator('#startRound').isDisabled(), true);
  await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
  await chip('Источник', 'generated').check();
  await see(page, '#available', /Доступно: 1 задание/);
  await context.close();
});

test('тренировка: разбор выбранного неверного варианта, три и четыре варианта', { skip }, async () => {
  const { page, context, errors } = await open(mainUrl, { hash: '#/practice' });
  await page.locator('input[data-key="Номер задания:20"]').check();
  await page.locator('input[data-key="Номер задания:22"]').check();
  await page.locator('#roundSize').selectOption('all');
  await page.locator('#startRound').click();
  const seen = new Set();
  for (let i = 0; i < 3; i += 1) {
    const count = await page.locator('.option').count();
    const task = await text(page, '.pill');
    seen.add(`${task}:${count}`);
    // Выбираем второй вариант: в задании 20 он верен, в обоих заданиях 22 — нет.
    const texts = await page.evaluate(() => [...document.querySelectorAll('.option .text')].map((n) => n.textContent));
    await page.keyboard.press('2');
    await page.locator('.feedback').waitFor();
    const verdicts = await page.locator('.verdict').count();
    if (verdicts === 2) {
      // Сначала — почему не подходит выбранный вариант, потом — верный ответ.
      const order = await page.evaluate(() => [...document.querySelectorAll('.verdict')].map((n) => (n.classList.contains('bad') ? 'bad' : 'ok')));
      assert.deepEqual(order, ['bad', 'ok']);
      assert.match(await text(page, '.verdict.bad h3'), new RegExp(`Почему не ${texts[1]}`));
      assert.match(await text(page, '.verdict.bad p'), new RegExp(`Вариант ${texts[1]}|${texts[1]}:`));
    }
    assert.ok(await page.locator('.rule-note a').count() > 0, 'есть ссылка на правило');
    // «Сообщить об ошибке» ведёт в issues репозитория и называет задание.
    const report = page.locator('.report a');
    const href = new URL(await report.getAttribute('href'));
    assert.match(href.pathname, /\/issues\/new$/);
    assert.match(href.searchParams.get('title'), new RegExp(`Ошибка: задание \\d+ · q\\d+-`));
    // В сообщении — это задание: его условие и выбранный вариант.
    const body = href.searchParams.get('body');
    const stemParts = await page.evaluate(() => [...document.querySelector('.stem').childNodes]
      .filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent.trim()).filter(Boolean));
    for (const part of stemParts) assert.ok(body.includes(part), `условие в сообщении: ${part}`);
    assert.ok(body.includes(`Выбранный ответ: ${texts[1]}`));
    assert.equal(await report.getAttribute('target'), '_blank');
    assert.equal(await report.getAttribute('rel'), 'noopener');
    await page.keyboard.press('Enter');
  }
  assert.ok(seen.has('Задание 20:3'), 'задание 20 с тремя вариантами');
  assert.ok(seen.has('Задание 22:4'), 'задание 22 с четырьмя вариантами');
  await see(page, 'h2', /Раунд окончен/);
  // Ошибки были в задании 22 — страница советует его правило.
  await see(page, '#ruleAdvice', /Перечитайте правило: 就 и 才/);
  // Работа над ошибками: оба задания 22 под своим правилом, повтор — только они.
  await see(page, '#roundMistakes summary', /Работа над ошибками · 2/);
  await see(page, '#roundMistakes .mistake-group h3', /就 и 才 · 2/);
  assert.equal(await page.locator('#roundMistakes .mistake-list li').count(), 2);
  await see(page, '#roundMistakes .mistake-list', /ваш ответ: .* → верно: /);
  await page.getByRole('button', { name: 'Повторить задания правила «就 и 才» · 2' }).click();
  await see(page, '.progress', /Задание 1 из 2/);
  const repeat = await page.evaluate(() => JSON.parse(localStorage.getItem('ege-lg-trainer:progress')).round.ids);
  assert.deepEqual([...repeat].sort(), ['q22-a', 'q22-b'], 'повтор — именно ошибки этого правила');
  assert.deepEqual(errors, []);
  await context.close();
});

test('полный вариант: 13 позиций, разбор только после завершения, восстановление после перезагрузки', { skip }, async () => {
  const { page, context, errors } = await open(mainUrl, { hash: '#/variant' });
  await page.locator('#buildVariant').click();
  assert.equal(await page.locator('.sheet .cell').count(), 13);
  const positions = await page.locator('.sheet .pos').allInnerTexts();
  assert.deepEqual(positions.map(Number), [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27]);
  for (let i = 0; i < 5; i += 1) {
    await page.keyboard.press('1');
    assert.equal(await page.locator('.feedback').count(), 0, 'в варианте нет разбора до конца');
    await page.keyboard.press('Enter');
  }
  await page.reload();
  const marks = await page.locator('.sheet .mark').allInnerTexts();
  assert.deepEqual(marks.slice(0, 5), ['1', '1', '1', '1', '1']);
  await see(page, '.progress', /Позиция 20/);
  // Исходный порядок вариантов: у задания 26 первым идёт CAB.
  await page.locator('.sheet .cell').nth(11).click();
  assert.deepEqual(await page.locator('.option .text').allInnerTexts(), ['CAB', 'BAC', 'ACB', 'BCA']);
  assert.equal(await page.locator('.fragments li').count(), 3);
  await page.locator('#finishVariant').click();
  await see(page, '.notice.warn', /Без ответа: 20, 21, 22, 23, 24, 25, 26, 27/);
  await page.locator('#confirmFinish').click();
  await see(page, '.score', /из 13/);
  // Enter после результата не собирает новый вариант: разбор по позициям остаётся.
  await page.keyboard.press('Enter');
  await see(page, '.score', /из 13/);
  assert.equal(await page.locator('.results li').count(), 13);
  // «К содержимому» переводит фокус, но не уводит с экрана варианта.
  await page.locator('.skip').focus();
  await page.keyboard.press('Enter');
  assert.equal(new URL(page.url()).hash, '#/variant');
  await see(page, '.score', /из 13/);
  assert.equal(await page.locator('.sheet .cell.good, .sheet .cell.bad').count(), 13);
  await page.locator('.results summary').nth(1).click();
  await page.locator('.results .feedback').first().waitFor();
  // Позиция 27 осталась без ответа — в сообщении об ошибке это видно.
  const last = page.locator('.results > li').nth(12);
  await last.locator('summary').first().click();
  const skipped = last.locator('.report a');
  await skipped.waitFor();
  const skippedBody = new URL(await skipped.getAttribute('href')).searchParams.get('body');
  assert.match(skippedBody, /Выбранный ответ: —/);
  assert.match(skippedBody, /задание 27/);
  await page.getByRole('button', { name: /Повторить ошибки варианта/ }).click();
  await see(page, '.progress', /Задание 1 из/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('вариант не собирается и называет недостающие позиции', { skip }, async () => {
  const url = buildPage('missing', {
    change: (d) => { d.questions = d.questions.filter((q) => q.taskNumber !== 17 && q.taskNumber !== 26); },
  });
  const { page, context } = await open(url, { hash: '#/variant' });
  await see(page, '#variantMissing', /позиций 17, 26/);
  assert.equal(await page.locator('#buildVariant').count(), 0);
  await context.close();
});

test('банк и ошибки: повтор ошибок, сброс прогресса', { skip }, async () => {
  const { page, context } = await open(mainUrl, { hash: '#/bank' });
  assert.equal(await page.locator('#repeatMistakes').isDisabled(), true);
  await see(page, '.bank-list', /Банк ФИПИ · 3872A5/);
  await see(page, '.bank-list', /Новое задание/);
  await page.locator('.bank-item').first().click();
  await page.locator('[data-card]').waitFor();
  await page.keyboard.press('1');
  await page.keyboard.press('Enter');
  await page.goto(`${mainUrl}#/bank`);
  await see(page, '#repeatMistakes', /Повторить ошибки · 1/);
  await see(page, '#weakTopics', /Прочие темы — ошибок: 1/);
  await see(page, '#bankMistakes summary', /Работа над ошибками · 1/);
  assert.equal(await page.locator('#bankMistakes').getAttribute('open'), null, 'в банке свёрнуто');
  await page.locator('#repeatMistakes').click();
  await page.locator('[data-card]').waitFor();
  await see(page, '.progress', /Задание 1 из 1/);
  await page.goto(`${mainUrl}#/bank`);
  await page.getByRole('button', { name: 'Сбросить прогресс' }).click();
  await page.locator('#confirmReset').click();
  await see(page, '#repeatMistakes', /Ошибок нет/);
  await context.close();
});

test('прогресс: файл с одного устройства загружается на другом', { skip }, async () => {
  const first = await open(mainUrl, { hash: '#/bank' });
  await first.page.locator('.bank-item').first().click();
  await first.page.locator('[data-card]').waitFor();
  await first.page.keyboard.press('1');
  await first.page.goto(`${mainUrl}#/bank`);
  await see(first.page, '#repeatMistakes', /Повторить ошибки · 1/);
  const [download] = await Promise.all([first.page.waitForEvent('download'), first.page.locator('#exportProgress').click()]);
  assert.match(download.suggestedFilename(), /^ege-lg-trainer-progress-\d{4}-\d{2}-\d{2}\.json$/);
  const file = join(work, 'progress.json');
  await download.saveAs(file);
  await first.context.close();

  // Новый контекст браузера — как другое устройство: прогресса нет, пока не загрузить файл.
  const { page, context, errors } = await open(mainUrl, { hash: '#/bank' });
  await see(page, '#repeatMistakes', /Ошибок нет/);
  await page.locator('#progressFile').setInputFiles(file);
  await see(page, '#transferNotice', /объединён/);
  await see(page, '#repeatMistakes', /Повторить ошибки · 1/);
  // Тот же файл ещё раз ничего не меняет.
  await page.locator('#progressFile').setInputFiles(file);
  await see(page, '#repeatMistakes', /Повторить ошибки · 1/);
  // Чужой файл — понятная ошибка, прогресс не тронут, после перезагрузки он на месте.
  const junk = join(work, 'junk.json');
  writeFileSync(junk, '{"hello": 1}');
  await page.locator('#progressFile').setInputFiles(junk);
  await see(page, '#transferNotice', /не файл прогресса/);
  await page.reload();
  await see(page, '#repeatMistakes', /Повторить ошибки · 1/);
  assert.equal(await page.locator('#transferNotice').count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

const storedProgress = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('ege-lg-trainer:progress')));

test('ссылки учителя: подборка, те же задания, тот же вариант', { skip }, async () => {
  // Подборка по ссылке: фильтры выбраны, адрес заменён обычным.
  const { page, context, errors } = await open(mainUrl, { hash: '#/practice?topics=adverbs&tasks=22&size=5' });
  await see(page, '#shareNotice', /Подборка открыта по ссылке/);
  assert.equal(new URL(page.url()).hash, '#/practice/setup');
  assert.equal(await page.locator('input[data-key="Темы:adverbs"]').isChecked(), true);
  assert.equal(await page.locator('input[data-key="Номер задания:22"]').isChecked(), true);
  assert.equal(await page.locator('#roundSize').inputValue(), '5');
  await see(page, '#available', /Доступно: 2 задания/);
  // Своя ссылка на подборку повторяет выбранные фильтры.
  await page.locator('#share-setup').click();
  const setupLink = new URL(await page.locator('#shareBox input').inputValue());
  assert.equal(setupLink.hash, '#/practice?topics=adverbs&tasks=22&size=5');

  // Раунд → ссылка на те же задания → у другого ученика тот же набор в том же порядке.
  await page.locator('#startRound').click();
  for (let i = 0; i < 2; i += 1) {
    await page.locator('[data-card]').waitFor();
    await page.keyboard.press('1');
    await page.keyboard.press('Enter');
  }
  await see(page, 'h2', /Раунд окончен/);
  await page.locator('#share-round').click();
  const roundLink = await page.locator('#shareBox input').inputValue();
  const roundIds = (await storedProgress(page)).round.ids;
  await context.close();

  const other = await open(roundLink);
  await see(other.page, '.progress', /Задание 1 из 2/);
  assert.deepEqual((await storedProgress(other.page)).round.ids, roundIds);
  assert.equal(new URL(other.page.url()).hash, '#/practice');
  await other.context.close();

  // Вариант по ссылке: у всех одни и те же 13 заданий.
  const ids = (suffix22, suffix27) => [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27]
    .map((n) => (n === 22 ? `q22-${suffix22}` : n === 27 ? `q27-${suffix27}` : `q${n}-a`));
  const first = ids('a', 'a');
  const second = ids('b', 'gen');
  const student = await open(mainUrl, { hash: `#/variant?ids=${first.join(',')}` });
  await see(student.page, '.progress', /Позиция 15/);
  assert.deepEqual((await storedProgress(student.page)).variant.ids, first);
  await student.page.keyboard.press('1');
  // Ссылка на другой вариант поверх начатого своего — сначала вопрос.
  await student.page.goto(`${mainUrl}#/variant?ids=${second.join(',')}`);
  await see(student.page, '#pendingVariant', /отвечено 1 из 13/);
  await student.page.locator('#keepOwnVariant').click();
  await see(student.page, '.progress', /Позиция 15/);
  assert.deepEqual((await storedProgress(student.page)).variant.ids, first);
  await student.page.goto(`${mainUrl}#/variant?ids=${second.join(',')}`);
  await student.page.locator('#openLinkedVariant').click();
  await see(student.page, '.progress', /Позиция 15/);
  assert.deepEqual((await storedProgress(student.page)).variant.ids, second);
  // Испорченный вариант не открывается, свой остаётся.
  await student.page.goto(`${mainUrl}#/variant?ids=${first.slice(1).join(',')}`);
  await see(student.page, '#shareNotice', /не открыть/);
  assert.deepEqual((await storedProgress(student.page)).variant.ids, second);
  assert.deepEqual([...errors, ...student.errors], []);
  await student.context.close();
});

test('повторение: исправленная ошибка возвращается в срок, прогресс версии 1 читается', { skip }, async () => {
  const { page, context, errors } = await open(mainUrl, { hash: '#/bank' });
  const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();
  const put = (value) => page.evaluate((v) => localStorage.setItem('ege-lg-trainer:progress', JSON.stringify(v)), value);
  const base = { checks: {}, round: null, variant: null, history: [] };
  // Версия 1: ошибка без поля review — встаёт на повтор, тема попадает в слабые.
  await put({ ...base, version: 1, questions: { 'q20-a': { attempts: 1, correctCount: 0, last: { optionId: '1', correct: false, at: ago(2) } } } });
  await page.reload();
  await see(page, '#repeatMistakes', /Повторить ошибки · 1/);
  await see(page, '#weakTopics', /Глагольные суффиксы/);
  assert.equal(await page.locator('#weakTopics a').first().innerText(), '了, 过 и 着');
  // Прогресс версии 1 сохранён копией до переноса.
  const backup = await page.evaluate(() => JSON.parse(localStorage.getItem('ege-lg-trainer:progress:v1')));
  assert.equal(backup.version, 1);
  // Ошибка исправлена позавчера, срок повтора вчера — пора повторить.
  await put({ ...base, version: 2, questions: { 'q20-a': { attempts: 2, correctCount: 1, last: { optionId: '2', correct: true, at: ago(2) }, review: { step: 1, due: ago(1) } } } });
  await page.reload();
  await see(page, '#repeatDue', /Пора повторить · 1/);
  await see(page, '.bank-list', /повторить/);
  assert.equal(await page.locator('#weakTopics').count(), 0, 'исправленная ошибка — не слабая тема');
  await page.locator('select[data-key="bank:state"]').selectOption('due');
  await see(page, '.small.muted', /Показано: 1 задание/);
  await page.goto(`${mainUrl}#/practice/setup`);
  await page.locator('#stateFilter').selectOption('review');
  await see(page, '#available', /Доступно: 1 задание/);
  await page.goto(`${mainUrl}#/bank`);
  await page.locator('#repeatDue').click();
  await page.locator('[data-card]').waitFor();
  await page.keyboard.press('2');
  await page.locator('.feedback').waitFor();
  await page.goto(`${mainUrl}#/bank`);
  await see(page, '#repeatMistakes', /Ошибок нет/);
  assert.equal(await page.locator('#repeatDue').count(), 0);
  const stored = await storedProgress(page);
  assert.equal(stored.version, 2);
  assert.equal(stored.questions['q20-a'].review.step, 2, 'следующий повтор — через 3 дня');
  assert.deepEqual(errors, []);
  await context.close();
});

test('прогресс более новой версии страница не перезаписывает', { skip }, async () => {
  const { page, context, errors } = await open(mainUrl, { hash: '#/bank' });
  const newer = JSON.stringify({ version: 99, questions: { 'q20-a': { future: true } } });
  await page.evaluate((v) => localStorage.setItem('ege-lg-trainer:progress', v), newer);
  await page.reload();
  await see(page, '#progressLocked', /более новой версией/);
  await page.locator('.bank-item').first().click();
  await page.locator('[data-card]').waitFor();
  await page.keyboard.press('1');
  await page.locator('.feedback').waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('ege-lg-trainer:progress')), newer);
  assert.deepEqual(errors, []);
  await context.close();
});

test('полный вариант: часы идут, пока страница видна, время — в итоге', { skip }, async () => {
  const { page, context, errors } = await open(mainUrl, { hash: '#/variant' });
  await page.locator('#buildVariant').click();
  await see(page, '#variantClock', /осталось (40:00|39:5\d)/);
  assert.equal(await page.locator('#variantClock').getAttribute('role'), 'timer');
  // Ушли в банк — часы остановились и записали время.
  await page.goto(`${mainUrl}#/bank`);
  const v = (await storedProgress(page)).variant;
  assert.ok(v.elapsedMs > 0, 'время варианта записано при уходе с экрана');
  // Вариант, где прошла 41 минута: время вышло, но вариант не обрывается.
  await page.evaluate((variant) => {
    const p = JSON.parse(localStorage.getItem('ege-lg-trainer:progress'));
    localStorage.setItem('ege-lg-trainer:progress', JSON.stringify({ ...p, variant: { ...variant, elapsedMs: 41 * 60000 } }));
  }, v);
  await page.reload();
  await page.goto(`${mainUrl}#/variant`);
  await see(page, '#variantClock', /время вышло · \+01:0\d/);
  assert.match(await page.locator('#variantClock').getAttribute('class'), /over/);
  // Страница скрыта — часы стоят и ничего не пишут.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const paused = (await storedProgress(page)).variant.elapsedMs;
  assert.ok(paused >= 41 * 60000, 'при скрытии набежавшее время записано');
  await page.waitForTimeout(1500);
  assert.equal((await storedProgress(page)).variant.elapsedMs, paused, 'пока скрыто — время не идёт');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.locator('#finishVariant').click();
  await page.locator('#confirmFinish').click();
  await see(page, '#variantTime', /Время: 41:\d\d · рекомендовано 40:00/);
  assert.equal((await storedProgress(page)).history.at(-1).timeMs >= 41 * 60000, true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('часы варианта: переход по позициям не теряет время, вкладки не затирают ответы', { skip }, async () => {
  // Пять минут на одной позиции (часы страницы подменены), затем «Дальше».
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  const a = await context.newPage();
  a.on('pageerror', (e) => errors.push(e.message));
  await a.clock.install();
  await a.goto(`${mainUrl}#/variant`);
  await a.locator('#buildVariant').click();
  await see(a, '#variantClock', /осталось 40:00/);
  await a.clock.runFor(5 * 60_000);
  await see(a, '#variantClock', /осталось 35:00/);
  await a.getByRole('button', { name: 'Дальше →' }).click();
  await see(a, '.progress', /Позиция 16/);
  assert.ok((await storedProgress(a)).variant.elapsedMs >= 5 * 60_000, 'время после перехода сохранено');

  // Вторая вкладка отвечает — первая подхватывает ответ и своим таймером его не затирает.
  const b = await context.newPage();
  b.on('pageerror', (e) => errors.push(e.message));
  await b.goto(`${mainUrl}#/variant`);
  await see(b, '.progress', /отвечено: 0/);
  await b.keyboard.press('1');
  await see(b, '.progress', /отвечено: 1/);
  await see(a, '.progress', /отвечено: 1/);
  await a.clock.runFor(31_000);
  await a.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const stored = await storedProgress(b);
  assert.equal(Object.keys(stored.variant.answers).length, 1, 'ответ второй вкладки на месте');
  assert.ok(stored.variant.elapsedMs >= 5 * 60_000 + 31_000, 'время первой вкладки дописано');
  assert.deepEqual(errors, []);
  await context.close();
});

// Каталог со сборкой по http: service worker на file:// не работает.
function serve(dir) {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png',
    '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = join(dir, path.endsWith('/') ? 'index.html' : path);
    try {
      const body = readFileSync(file);
      res.writeHead(200, { 'Content-Type': types[file.slice(file.lastIndexOf('.'))] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test('без сети: после первого визита страница открывается из кэша', { skip }, async () => {
  const dir = dirname(fileURLToPath(buildPage('offline')));
  const server = await serve(dir);
  const url = `http://127.0.0.1:${server.address().port}/`;
  // Свой контекст: open() режет все http-запросы, а здесь нужен локальный сервер. Внешняя сеть
  // (шрифты) по-прежнему закрыта.
  const context = await browser.newContext();
  await context.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(`${url}#/rules`);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 })
      .catch(async () => { await page.reload(); await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 }); });
    assert.equal(await page.evaluate(() => document.querySelector('link[rel="manifest"]').getAttribute('href')), 'manifest.webmanifest');
    await context.setOffline(true);
    await page.goto(`${url}?nocache=1#/practice/setup`);
    await see(page, 'h2', /Практика ЕГЭ/);
    await page.goto(`${url}#/rules/jiu-cai`);
    await see(page, 'h2', /就 и 才/);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
    // Иначе открытые keep-alive соединения держат процесс тестов живым.
    server.closeAllConnections();
    server.close();
  }
test('отчёт учителю: ученик отправляет текст, учитель сводит класс', { skip }, async () => {
  const { page, context, errors } = await open(mainUrl);
  const finishRound = async (ids, pick) => {
    await page.goto(`${mainUrl}#/practice?ids=${ids}`);
    for (let i = 0; i < ids.split(',').length; i += 1) {
      await page.locator('[data-card]').waitFor();
      await page.locator('.option').nth(pick).click();
      await page.locator('[data-enter]').click();
    }
    await see(page, 'h2', /Раунд окончен/);
    await page.locator('#report-round').click();
  };
  // Без имени отчёт не копируется: учитель не поймёт, чей он.
  await finishRound('q20-a,q22-a', 1);
  await page.locator('#copyReport').click();
  await see(page, '#reportBox', /Впишите имя/);
  await page.locator('#studentName').fill('Иванова Аня');
  const first = await page.locator('#reportText').inputValue();
  assert.match(first, /Ученик: Иванова Аня/);
  assert.match(first, /Результат: 1 из 2/);
  assert.match(first, /Ошибки: 22/);
  assert.match(first, /EGELG1:[A-Za-z0-9_-]+$/);
  // Имя запоминается в этом браузере.
  await finishRound('q22-b', 0);
  assert.equal(await page.locator('#studentName').inputValue(), 'Иванова Аня');
  await page.locator('#studentName').fill('Петров Боря');
  const second = await page.locator('#reportText').inputValue();

  await page.goto(`${mainUrl}#/teacher`);
  await page.locator('#reportsInput').fill(`${first}\n\nЕщё раз: ${first}\n\n${second}\nEGELG1:e30`);
  await see(page, '#classStatus', /2 отчёта, не прочитано 1/);
  await see(page, '#classSummary .score', /2\s*отчёта · не прочитано 1/);
  const rows = await page.locator('#classTable tbody tr').allInnerTexts();
  assert.equal(rows.length, 2, 'повтор одного отчёта считается один раз');
  assert.match(rows[0], /Иванова Аня\s+Раунд.*1 из 2.*22/);
  assert.match(rows[1], /Петров Боря\s+Раунд.*1 из 1/);
  await see(page, '#classByTask', /№22 — ошибок 1 из 2/);
  // Вставленное живёт только на странице: после перезагрузки поле пустое.
  await page.reload();
  assert.equal(await page.locator('#reportsInput').inputValue(), '');
  assert.deepEqual(errors, []);
  await context.close();
});

test('телефон: без горизонтальной прокрутки во всех режимах', { skip }, async () => {
  for (const width of [390, 375, 320]) {
    const { page, context } = await open(mainUrl, { width, height: 812 });
    const noOverflow = async (where) => {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 0, `${width}px ${where}: горизонтальная прокрутка ${overflow}px`);
    };
    for (const hash of ['#/rules', '#/rules/jiu-cai', '#/practice', '#/variant', '#/bank', '#/teacher']) {
      await page.goto(mainUrl + hash);
      if (hash === '#/variant' && await page.locator('#buildVariant').count()) await page.locator('#buildVariant').click();
      await noOverflow(hash);
    }
    // Страница учителя с заполненной таблицей: широкая таблица прокручивается внутри рамки.
    const sample = await page.evaluate(() => encodeReport({ kind: 'variant', name: 'Константинопольская Александра',
      at: new Date().toISOString(), timeMs: 2_000_000, ids: ['q20-a', 'q21-a', 'q22-a'], answers: ['1', null, '2'], score: 0, total: 3 }));
    await page.goto(`${mainUrl}#/teacher`);
    await page.locator('#reportsInput').fill(sample);
    await page.locator('#classTable').waitFor();
    await noOverflow('#/teacher с таблицей');
    // Работа над ошибками на итоге раунда и в банке: №15, №22 и собранный порядок №26.
    await page.goto(`${mainUrl}#/practice?ids=q15-a,q22-a,q26-a`);
    for (let i = 0; i < 3; i += 1) {
      await page.locator('[data-card]').waitFor();
      await page.locator('.option').nth(2).click();
      await page.locator('[data-enter]').click();
    }
    await see(page, '#roundMistakes summary', /Работа над ошибками · 3/);
    await see(page, '#roundMistakes', /верный порядок: /);
    await see(page, '#roundMistakes', /— тоны/);
    await noOverflow('итог раунда с работой над ошибками');
    await page.goto(`${mainUrl}#/bank`);
    await page.locator('#bankMistakes summary').click();
    await noOverflow('банк с работой над ошибками');
    // Раунд с разбором и итог варианта: длинные предложения в одну строку не распирают страницу.
    await page.goto(`${mainUrl}#/practice?ids=q21-a`);
    await page.locator('[data-card]').waitFor();
    await page.keyboard.press('2');
    await page.locator('.feedback').waitFor();
    await noOverflow('раунд с разбором');
    await page.goto(`${mainUrl}#/variant`);
    await page.locator('#finishVariant').click();
    await page.locator('#confirmFinish').click();
    await see(page, '.score', /из 13/);
    await noOverflow('итог варианта');
    await context.close();
  }
});

test('тетрадь: пропуск-клетка, исправление красной ручкой, панель на телефоне', { skip }, async () => {
  const { page, context, errors } = await open(mainUrl, { width: 390, height: 844, hash: '#/practice?ids=q25-a' });
  await page.locator('[data-card]').waitFor();
  // Два знака в самом длинном варианте — две клетки; пустая клетка ничего не подсказывает.
  assert.equal(await page.locator('.stem .tz .c').count(), 2);
  assert.equal(await page.locator('.stem .tz').getAttribute('aria-label'), 'пропуск');
  // Неверно: выбранное вписано и зачёркнуто, сверху верный ответ.
  await page.keyboard.press('3');
  await page.locator('.feedback').waitFor();
  assert.deepEqual(await page.locator('.stem .tz .ink').allInnerTexts(), ['下', '去']);
  assert.equal(await page.locator('.stem .tz.wrong .fix').innerText(), '过来');
  assert.equal(await page.locator('.stem .tz').getAttribute('aria-label'), 'пропуск: выбрано 下去, верно 过来');
  // «Дальше» — в панели внизу экрана, видна без прокрутки.
  const next = await page.locator('.dock [data-enter]').boundingBox();
  assert.ok(next && next.y + next.height <= 844, `«Дальше» за краем экрана: ${JSON.stringify(next)}`);
  await page.keyboard.press('Enter');
  await see(page, 'h2', /Раунд окончен/);
  assert.doesNotMatch(await page.locator('#view').innerText(), /\bnull\b/);

  // Верно: галочка у клетки, исправления нет; итог без ошибок — без «null».
  await page.goto(`${mainUrl}#/practice?ids=q21-a`);
  await page.locator('[data-card]').waitFor();
  await page.keyboard.press('1');
  await page.locator('.stem .tz.right .tick').waitFor();
  assert.equal(await page.locator('.stem .fix').count(), 0);
  await page.keyboard.press('Enter');
  await see(page, 'h2', /Раунд окончен/);
  assert.doesNotMatch(await page.locator('#view').innerText(), /\bnull\b/);

  // Вариант: ответ вписан без пометок; союз задания 27 разложен по двум пропускам.
  const ids = [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27].map((n) => `q${n}-a`);
  await page.goto(`${mainUrl}#/variant?ids=${ids.join(',')}`);
  await page.locator('.sheet .cell').nth(1).click();
  await page.keyboard.press('2');
  assert.deepEqual(await page.locator('.stem .tz .ink').allInnerTexts(), ['场']);
  assert.equal(await page.locator('.stem .tz.right, .stem .tz.wrong, .stem .fix').count(), 0);
  await page.locator('.sheet .cell').nth(12).click();
  await page.keyboard.press('4');
  assert.equal(await page.locator('.stem .tz').count(), 2);
  assert.deepEqual(await page.locator('.stem .tz .ink').allInnerTexts(), ['不', '但', '而', '且']);
  await page.locator('#finishVariant').click();
  await page.locator('#confirmFinish').click();
  await see(page, '.score', /из 13/);
  assert.doesNotMatch(await page.locator('#view').innerText(), /\bnull\b/);
  // Бланк итога: верно и неверно различаются не только цветом, но и знаком.
  const signs = await page.evaluate(() => [...document.querySelectorAll('.sheet .cell')]
    .map((cell) => getComputedStyle(cell.querySelector('.mark'), '::after').content));
  assert.ok(signs.every((s) => s === '"✓"' || s === '"✗"'), signs.join(' '));
  assert.ok(signs.includes('"✓"') && signs.includes('"✗"'));
  assert.deepEqual(errors, []);
  await context.close();
});

test('шрифты из сети не задерживают страницу, других внешних запросов нет', { skip }, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const hosts = new Set();
  // Хост шрифтов «висит»: школьный фильтр или медленный CDN. Страница не должна его ждать.
  await context.route(/^https?:\/\//, async (route) => {
    hosts.add(new URL(route.request().url()).host);
    await new Promise((resolve) => setTimeout(resolve, 5000));
    await route.abort().catch(() => {});
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const started = Date.now();
  await page.goto(`${mainUrl}#/rules`, { waitUntil: 'commit' });
  await page.locator('#view h2').waitFor({ timeout: 2500 });
  assert.ok(Date.now() - started < 2500, `страница ждала шрифты: ${Date.now() - started} мс`);
  assert.deepEqual([...hosts].sort(), ['cdn.jsdelivr.net', 'fonts.googleapis.com']);
  assert.deepEqual(errors, []);
  await context.close();
});

test('телефон: после ответа видно начало разбора, новый экран — с начала', { skip }, async () => {
  const { page, context, errors } = await open(mainUrl, { width: 320, height: 568, reducedMotion: 'reduce', hash: '#/practice?ids=q26-a,q27-a' });
  // Неверные ответы: в №26 (фрагменты) и №27 (два пропуска) разбор длинный.
  for (const key of ['2', '1']) {
    await page.locator('[data-card]').waitFor();
    assert.equal(await page.evaluate(() => window.scrollY), 0, 'задание открывается с начала страницы');
    await page.keyboard.press(key);
    await page.locator('.feedback').waitFor();
    const at = await page.evaluate(() => ({
      feedback: document.querySelector('.feedback').getBoundingClientRect().top,
      dock: document.querySelector('.dock').getBoundingClientRect().top,
    }));
    assert.ok(at.feedback + 40 <= at.dock, `начало разбора под панелью: ${JSON.stringify(at)}`);
    await page.keyboard.press('Enter');
  }
  await see(page, 'h2', /Раунд окончен/);
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test('шапка: заголовок страницы, кнопка темы — переключатель', { skip }, async () => {
  const { page, context } = await open(mainUrl, { hash: '#/rules' });
  assert.equal(await page.locator('h1').count(), 1);
  const toggle = page.locator('#themeToggle');
  const themeColors = () => page.evaluate(() => [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.content));
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
  assert.deepEqual(await themeColors(), ['#F2F4EF', '#F2F4EF']);
  await toggle.click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await themeColors(), ['#1B2338', '#1B2338']);
  await page.reload();
  assert.equal(await page.locator('#themeToggle').getAttribute('aria-pressed'), 'true', 'тема запомнилась');
  await context.close();
});

test('правила: оглавление по номерам заданий, клетка номера не наезжает на тему', { skip }, async () => {
  const { page, context } = await open(buildPage('rules-index', { drafts: true }), { width: 390, hash: '#/rules' });
  const rows = await page.evaluate(() => [...document.querySelectorAll('.index > li')].map((li) => {
    const num = li.querySelector('.cellnum').getBoundingClientRect();
    const title = li.querySelector('h3').getBoundingClientRect();
    return {
      numbers: li.querySelector('.cellnum').textContent.replace('Задание ', ''),
      rules: [...li.querySelectorAll('.rule-card')].map((a) => a.getAttribute('href')),
      overlap: num.right > title.left,
    };
  }));
  // Строки идут по первому номеру; у темы «прочее» номеров много — клетка шире, но не наезжает.
  assert.deepEqual(rows.map((r) => r.numbers), ['15·16·17·18·19·21·23·24·25·26·27', '20', '22']);
  assert.deepEqual(rows.map((r) => r.overlap), [false, false, false]);
  for (const row of rows) assert.equal(new Set(row.rules).size, row.rules.length, 'правило в строке — один раз');
  await context.close();
});

test('публикация без черновиков, проверка — с пометкой', { skip }, async () => {
  const pub = await open(mainUrl, { hash: '#/bank' });
  assert.equal(await pub.page.locator('.pill.draft').count(), 0);
  assert.doesNotMatch(await text(pub.page, '#bankCount'), /16/);
  assert.equal(await pub.page.locator('#reviewBanner').isHidden(), true);
  await pub.page.goto(`${mainUrl}#/rules`);
  assert.equal(await pub.page.getByText('Черновое правило').count(), 0);
  await pub.context.close();

  const review = await open(buildPage('review', { drafts: true }), { hash: '#/bank' });
  assert.equal(await review.page.locator('#reviewBanner').isVisible(), true);
  await see(review.page, '.bank-list', /черновик/);
  await review.context.close();
});

test('пустой банк: понятное сообщение вместо пустых экранов', { skip }, async () => {
  const url = buildPage('empty', { change: (d) => { d.questions = []; d.rules = []; d['rule-checks'] = []; } });
  const { page, context, errors } = await open(url, { hash: '#/practice' });
  await see(page, '.empty', /Проверенных заданий пока нет/);
  await page.goto(`${url}#/variant`);
  await see(page, '#variantMissing', /проверенных заданий ещё нет/);
  await page.goto(`${url}#/rules`);
  await see(page, '.empty', /Карточек правил пока нет/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('текст из банка не исполняется как разметка', { skip }, async () => {
  const url = buildPage('xss', {
    change: (d) => { d.questions[0].stem = '<img src=x onerror="window.__xss=1">整齐</script>'; },
  });
  const { page, context } = await open(url, { hash: '#/bank' });
  await see(page, '.bank-list', /<img src=x/);
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  await context.close();
});

test('повреждённый прогресс в хранилище не ломает страницу', { skip }, async () => {
  const { page, context, errors } = await open(mainUrl, { hash: '#/bank' });
  await page.evaluate(() => localStorage.setItem('ege-lg-trainer:progress', '{битый json'));
  await page.reload();
  await see(page, '#repeatMistakes', /Ошибок нет/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('настоящие данные: сборка для проверки открывается во всех режимах без ошибок', { skip }, async () => {
  const out = join(work, 'real', 'review.html');
  mkdirSync(dirname(out), { recursive: true });
  const result = spawnSync('python3', [join(ROOT, 'scripts', 'build_site.py'), '--drafts', '--out', out], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const url = pathToFileURL(out).href;
  const { page, context, errors } = await open(url, { hash: '#/rules' });
  const ruleLinks = await page.locator('.rule-card').count();
  assert.ok(ruleLinks >= 13, `карточек правил: ${ruleLinks}`);
  await page.locator('.rule-card').first().click();
  await page.getByRole('button', { name: /Проверить правило/ }).click();
  await page.locator('[data-card]').waitFor();
  await page.keyboard.press('1');
  await page.locator('.feedback').waitFor();
  await page.goto(`${url}#/practice`);
  await page.locator('#roundSize').selectOption('all');
  await page.locator('#startRound').click();
  await page.locator('[data-card]').waitFor();
  await page.keyboard.press('2');
  await page.locator('.feedback').waitFor();
  await page.goto(`${url}#/variant`);
  await page.locator('#buildVariant').click();
  assert.equal(await page.locator('.sheet .cell').count(), 13);
  await page.goto(`${url}#/bank`);
  // В сборке для проверки — все задания с разбором: готовые и черновики (с пометкой).
  const bank = JSON.parse(readFileSync(join(ROOT, 'data', 'questions.json'), 'utf8'))
    .filter((q) => (q.reviewStatus === 'ready' || q.reviewStatus === 'draft') && q.explanation);
  await page.locator('.bank-item').first().waitFor();
  assert.equal(await page.locator('.bank-item').count(), bank.length);
  const drafts = bank.filter((q) => q.reviewStatus === 'draft').length;
  assert.equal(await page.locator('.bank-item .meta', { hasText: 'черновик' }).count(), drafts);
  assert.deepEqual(errors, []);
  await context.close();
});
