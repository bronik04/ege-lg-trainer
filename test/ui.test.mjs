// Браузерный тест: собирает страницу из test/fixtures и проходит её в Google Chrome без окна.
// Локально без Chrome или playwright-core пропускается, в CI (переменная CI) — падает.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

async function open(url, { width = 1100, height = 900, hash = '' } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
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
    await page.keyboard.press('Enter');
  }
  assert.ok(seen.has('Задание 20:3'), 'задание 20 с тремя вариантами');
  assert.ok(seen.has('Задание 22:4'), 'задание 22 с четырьмя вариантами');
  await see(page, 'h2', /Раунд окончен/);
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
  await page.locator('#repeatMistakes').click();
  await page.locator('[data-card]').waitFor();
  await see(page, '.progress', /Задание 1 из 1/);
  await page.goto(`${mainUrl}#/bank`);
  await page.getByRole('button', { name: 'Сбросить прогресс' }).click();
  await page.locator('#confirmReset').click();
  await see(page, '#repeatMistakes', /Ошибок нет/);
  await context.close();
});

test('телефон: без горизонтальной прокрутки во всех режимах', { skip }, async () => {
  const { page, context } = await open(mainUrl, { width: 375, height: 812 });
  for (const hash of ['#/rules', '#/rules/jiu-cai', '#/practice', '#/variant', '#/bank']) {
    await page.goto(mainUrl + hash);
    if (hash === '#/variant' && await page.locator('#buildVariant').count()) await page.locator('#buildVariant').click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `${hash}: горизонтальная прокрутка ${overflow}px`);
  }
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
