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
import * as L from '../src/logic.mjs';

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
function buildPage(name, { change, drafts = false, args: extra = [] } = {}) {
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
  args.push(...extra);
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

// В CI (ubuntu) китайских шрифтов нет: иероглифы — пустые квадраты, уже настоящих на 40–50 %.
// Проверки вёрстки сравнивают со значениями самой страницы, а не с пикселями под один шрифт.
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

test('правило → проверка правила → задания по правилу', { skip }, async () => {
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
  await see(page, 'h2', /0 из 2 · 0\s%/);
  await page.getByRole('link', { name: 'К правилу' }).click();
  // Задания именно этого правила: оба задания 22. Сгенерированное 27 с темой «наречия» — о другом правиле.
  await page.getByRole('button', { name: 'Задания ЕГЭ по правилу · 2 задания' }).click();
  assert.equal(page.url().endsWith('#/practice'), true);
  await see(page, '#available', /Доступно: 2 задания/);
  assert.equal(await page.locator('input[data-key="Задания:22"]').isChecked(), true);
  assert.equal(await page.locator('input[data-key="Грамматика:jiu-cai"]').isChecked(), true);
  assert.equal(await page.locator('#topicFocus').count(), 0);
  // Тема из старой ссылки только сужает оглавление: номера без неё не нажимаются.
  await page.goto(`${mainUrl}#/practice?topics=adverbs&size=10`);
  await see(page, '#topicFocus', /Только тема: Наречия/);
  // Тема «наречия» встречается в задании 22 (два) и в сгенерированном задании 27.
  await see(page, '#available', /Доступно: 3 задания/);
  assert.equal(await page.locator('input[data-key="Задания:20"]').isDisabled(), true);
  assert.equal(await page.locator('input[data-key="Задания:27"]').isDisabled(), false);
  assert.deepEqual(await contentsRow(page, 27), ['Прочие темы', '1 задание']);
  await page.getByRole('button', { name: 'Снять тему' }).click();
  assert.equal(await page.locator('#topicFocus').count(), 0);
  // Все опубликованные задания фикстуры, вместе с заданием HSK.
  await see(page, '#available', /Доступно: 16 заданий/);
  // Кнопка исчезла — фокус на первой строке оглавления, а не в никуда.
  assert.equal(await page.evaluate(() => document.activeElement.dataset.key), 'Задания:15');
  assert.deepEqual(errors, []);
  await context.close();
});

// Строка оглавления: тема и число заданий (у числа скрытое для глаз слово — для чтеца экрана).
async function contentsRow(page, n) {
  const row = page.locator('.task-row').filter({ has: page.locator(`input[data-key="Задания:${n}"]`) });
  return [await row.locator('.task-title').textContent(), await row.locator('small').textContent()];
}

test('оглавление по номерам: тема — подпись номера, источник виден', { skip }, async () => {
  const { page, context, errors } = await open(mainUrl, { hash: '#/practice' });
  const row = (n) => page.locator(`input[data-key="Задания:${n}"]`);
  // Отдельного выбора темы и номера нет: одна строка на номер.
  assert.equal(await page.locator('input[data-key^="Темы:"]').count(), 0);
  assert.equal(await page.locator('input[data-key^="Номер задания:"]').count(), 0);
  assert.deepEqual(await contentsRow(page, 22), ['Наречия', '2 задания']);
  await row(27).check();
  await see(page, '#available', /Доступно: 2 задания/);
  await row(22).check();
  await see(page, '#available', /Доступно: 4 задания/);
  await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
  await page.locator('input[data-key="Источник:generated"]').check();
  await see(page, '#available', /Доступно: 1 задание/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('оглавление: отмеченный номер без заданий темы снимается, фокус не теряется', { skip }, async () => {
  // Старая ссылка «наречия + 20»: у 20 наречий нет, но отметку можно снять.
  const { page, context, errors } = await open(mainUrl, { hash: '#/practice?topics=adverbs&tasks=20&size=5' });
  const row20 = page.locator('input[data-key="Задания:20"]');
  await see(page, '#available', /заданий нет/);
  assert.equal(await row20.isChecked(), true);
  assert.equal(await row20.isDisabled(), false);
  await row20.focus();
  await page.keyboard.press('Space');
  await see(page, '#available', /Доступно: 3 задания/);
  assert.equal(await row20.isDisabled(), true);
  // Строка стала недоступна — фокус на «Снять тему».
  assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), '✕ Снять тему');
  assert.deepEqual(errors, []);
  await context.close();
});

test('оглавление: у номера с двумя темами подпись первой, в счёте обе', { skip }, async () => {
  // Как №18: «Предлоги» и «Сравнительные конструкции» в одном номере.
  const url = buildPage('two-topics', {
    change: (data) => {
      const base = data.topics.find((t) => t.id === 'adverbs');
      data.topics.push({ ...base, id: 'cmp', title: 'Сравнение', taskNumbers: [18] });
      const q18 = data.questions.find((q) => q.id === 'q18-a');
      data.questions.push({ ...q18, id: 'q18-cmp', topicIds: ['cmp'] });
    },
  });
  const { page, context, errors } = await open(url, { hash: '#/practice' });
  assert.deepEqual(await contentsRow(page, 18), ['Прочие темы', '2 задания']);
  // Темы сравнения из ссылки: в №18 остаётся только оно.
  await page.goto(`${url}#/practice?topics=cmp&size=5`);
  await see(page, '#topicFocus', /Только тема: Сравнение/);
  assert.deepEqual(await contentsRow(page, 18), ['Прочие темы', '1 задание']);
  assert.equal(await page.locator('input[data-key="Задания:17"]').isDisabled(), true);
  // Две темы из ссылки — «Только темы», в порядке ссылки.
  await page.goto(`${url}#/practice?topics=cmp,adverbs&size=5`);
  await see(page, '#topicFocus', /Только темы: Сравнение, Наречия/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('грамматика: правила отмеченных номеров сужают подборку, ссылка их помнит', { skip }, async () => {
  // Как №22 в банке: у номера два правила — 就 и 才 (q22-a) и 又, 再 и 还 (q22-b).
  const url = buildPage('two-rules', {
    change: (data) => {
      const base = data.rules.find((r) => r.id === 'jiu-cai');
      data.rules.push({ ...base, id: 'you-zai', title: '又, 再 и 还' });
      data.questions.find((q) => q.id === 'q22-b').ruleIds = ['you-zai'];
    },
  });
  const { page, context, errors } = await open(url, { hash: '#/practice' });
  const chip = (id) => page.locator(`input[data-key="Грамматика:${id}"]`);
  // Без номера правил не видно — подсказка, где они появятся.
  assert.equal(await page.locator('input[data-key^="Грамматика:"]').count(), 0);
  await see(page, '#grammar', /Отметьте номер/);
  await page.locator('input[data-key="Задания:22"]').check();
  await see(page, '#grammar', /就 и 才\s*1/);
  await see(page, '#grammar', /又, 再 и 还\s*1/);
  assert.equal(await chip('aspect-suffixes').count(), 0, 'правило без заданий в №22 не предлагается');
  await chip('jiu-cai').check();
  await see(page, '#available', /Доступно: 1 задание/);
  // Правило уточняет только свой номер: отмеченный рядом №20 берётся целиком.
  await page.locator('input[data-key="Задания:20"]').check();
  await see(page, '#available', /Доступно: 2 задания/);
  await page.locator('input[data-key="Задания:20"]').uncheck();
  await see(page, '#available', /Доступно: 1 задание/);
  await page.locator('#share-setup').click();
  const link = new URL(await page.locator('#shareBox input').inputValue());
  assert.equal(link.hash, '#/practice?tasks=22&rules=jiu-cai&size=10');
  // Снятый номер уводит и свои правила: подборка не сужается невидимо.
  await page.locator('input[data-key="Задания:22"]').uncheck();
  await see(page, '#available', /Доступно: 16 заданий/);
  assert.equal(await chip('jiu-cai').count(), 0);
  // Ссылка только с правилом отмечает его номер.
  await page.goto(`${url}#/practice?rules=you-zai&size=5`);
  await see(page, '#shareNotice', /Подборка открыта по ссылке/);
  assert.equal(await page.locator('input[data-key="Задания:22"]').isChecked(), true);
  assert.equal(await chip('you-zai').isChecked(), true);
  await see(page, '#available', /Доступно: 1 задание/);
  // Правила, которого на сайте больше нет, в подборке нет — и ученик об этом знает.
  await page.goto(`${url}#/practice?topics=gone&tasks=22&rules=gone,jiu-cai&size=5`);
  await see(page, '#shareNotice', /одной темы и одного правила из неё на сайте больше нет/);
  assert.equal(await chip('jiu-cai').isChecked(), true);
  // Правило не из номеров ссылки тоже не выбрано — и об этом сказано.
  await page.goto(`${url}#/practice?tasks=20&rules=jiu-cai&size=5`);
  await see(page, '#shareNotice', /одного правила из неё на сайте больше нет/);
  assert.equal(await chip('jiu-cai').count(), 0);
  // Тема из старой ссылки: подсказка не говорит, что у номера нет правил.
  await page.goto(`${url}#/practice?topics=adverbs&tasks=20&size=5`);
  await see(page, '#grammar', /В выбранной теме/);
  // «Сбросить фильтры» снимает и правила.
  await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
  await see(page, '#available', /Доступно: 16 заданий/);
  assert.equal(await chip('jiu-cai').count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test('кнопка карточки правила: задания правила при любом выбранном источнике', { skip }, async () => {
  const { page, context, errors } = await open(mainUrl, { hash: '#/practice' });
  await page.locator('input[data-key="Источник:hsk"]').check();
  await see(page, '#available', /Доступно: 1 задание/);
  await page.goto(`${mainUrl}#/rules/jiu-cai`);
  await page.getByRole('button', { name: 'Задания ЕГЭ по правилу · 2 задания' }).click();
  await see(page, '#available', /Доступно: 2 задания/);
  assert.equal(await page.locator('input[data-key="Источник:hsk"]').isChecked(), false);
  assert.deepEqual(errors, []);
  await context.close();
});

test('сохранённые фильтры: старая версия без правил и правило не своего номера', { skip }, async () => {
  const { page, context, errors } = await open(mainUrl, { hash: '#/rules' });
  const put = (value) => page.evaluate((v) => localStorage.setItem('ege-lg-trainer:filters', JSON.stringify(v)), value);
  await put({ topics: [], tasks: [22], origins: [], state: 'done', size: '5' });
  await page.goto(`${mainUrl}#/practice/setup`);
  await page.reload();
  assert.equal(await page.locator('input[data-key="Задания:22"]').isChecked(), true);
  assert.equal(await page.locator('#stateFilter').inputValue(), 'done', '«Уже решённые» переживают перезагрузку');
  assert.equal(await page.locator('#roundSize').inputValue(), '5');
  assert.equal(await page.locator('input[data-key="Грамматика:jiu-cai"]').isChecked(), false);
  // Правило 就 и 才 у №20 заданий не имеет — подборку оно не сужает и не выбрано.
  await put({ topics: [], tasks: [20], rules: ['jiu-cai'], origins: [], state: 'all', size: '10' });
  await page.reload();
  await see(page, '#available', /Доступно: 1 задание/);
  assert.equal(await page.locator('input[data-key="Грамматика:jiu-cai"]').count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test('уже решённые в практике, сброс фильтров в банке', { skip }, async () => {
  const { page, context, errors } = await open(mainUrl, { hash: '#/practice?ids=q20-a' });
  await page.locator('[data-card]').waitFor();
  await page.keyboard.press('1');
  await page.locator('.feedback').waitFor();
  await page.goto(`${mainUrl}#/practice/setup`);
  await page.locator('#stateFilter').selectOption('done');
  await see(page, '#available', /Доступно: 1 задание/);
  await page.goto(`${mainUrl}#/bank`);
  await page.setViewportSize({ width: 1366, height: 768 });
  const heights = await page.evaluate(() => [document.querySelector('#resetBankFilters'), document.querySelector('select[data-key="bank:task"]')]
    .map((n) => n.getBoundingClientRect().height));
  assert.ok(heights[0] <= heights[1] + 4, `кнопка сброса выше полей: ${heights}`);
  await page.locator('select[data-key="bank:state"]').selectOption('mistake');
  await page.locator('select[data-key="bank:task"]').selectOption('20');
  await see(page, '.small.muted', /Показано: 1 задание/);
  await page.locator('#resetBankFilters').click();
  await see(page, '.small.muted', /Показано: 16 заданий/);
  assert.equal(await page.locator('select[data-key="bank:state"]').inputValue(), 'all');
  assert.equal(await page.locator('select[data-key="bank:task"]').inputValue(), '');
  assert.equal(await page.locator('#resetBankFilters').isDisabled(), true, 'сбрасывать нечего');
  assert.deepEqual(errors, []);
  await context.close();
});

test('итог: процент выполнения рядом со счётом', { skip }, async () => {
  const { page, context, errors } = await open(mainUrl, { hash: '#/practice?ids=q20-a,q22-a' });
  // В задании 20 второй вариант верен, в задании 22 — нет.
  for (let i = 0; i < 2; i += 1) {
    await page.locator('[data-card]').waitFor();
    await page.keyboard.press('2');
    await page.locator('.feedback').waitFor();
    await page.keyboard.press('Enter');
  }
  await see(page, 'h2', /Раунд окончен/);
  await see(page, '.score', /1 из 2,?\s*50\s%/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('задание HSK: подпись источника и фильтр', { skip }, async () => {
  const { page, context, errors } = await open(mainUrl, { hash: '#/bank' });
  await see(page, '.bank-list', /HSK 4 · 样卷 H40000, №56/);
  await page.goto(`${mainUrl}#/practice`);
  await page.locator('input[data-key="Источник:hsk"]').check();
  await see(page, '#available', /Доступно: 1 задание/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('тренировка: разбор выбранного неверного варианта, три и четыре варианта', { skip }, async () => {
  const { page, context, errors } = await open(mainUrl, { hash: '#/practice' });
  await page.locator('input[data-key="Задания:20"]').check();
  await page.locator('input[data-key="Задания:22"]').check();
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
    const order = await page.evaluate(() => [...document.querySelectorAll('.verdict')].map((n) => (n.classList.contains('bad') ? 'bad' : 'ok')));
    if (task === 'Задание 20') {
      // В задании 20 второй вариант верен: один вердикт «Верно».
      assert.deepEqual(order, ['ok']);
      assert.match(await text(page, '.verdict.ok h3'), /^Верно/);
    } else {
      // В заданиях 22 — неверен: сначала почему не подходит выбранный вариант, потом верный ответ.
      assert.equal(task, 'Задание 22');
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
  await see(page, '.score', /из 13,?\s*\d{1,3}\s%/);
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

test('разбор: своё «Сравните» у задания вместо примера из карточки', { skip }, async () => {
  const { page, context, errors } = await open(mainUrl, { hash: '#/practice?ids=q22-a' });
  await page.locator('[data-card]').waitFor();
  await page.keyboard.press('2');
  await see(page, '.rule-note', /他一会儿就回来。 — Он скоро вернётся\./);
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
  await see(page, '#topicFocus', /Только тема: Наречия/);
  assert.equal(await page.locator('input[data-key="Задания:22"]').isChecked(), true);
  assert.equal(await page.locator('#roundSize').inputValue(), '5');
  await see(page, '#available', /Доступно: 2 задания/);
  // Темы, которой больше нет на сайте, из ссылки нет и в подборке — и ученик об этом знает.
  await page.goto(`${mainUrl}#/practice?topics=gone,adverbs&tasks=22&size=5`);
  await see(page, '#shareNotice', /одной темы из неё на сайте больше нет/);
  await see(page, '#topicFocus', /Только тема: Наречия/);
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
  // Как в open(): шрифты из сети тесту не нужны, а зависшая сеть не должна держать загрузку.
  await context.route(/^https?:\/\//, (route) => route.abort());
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
    // Сначала сеть: на сервере страница новее, чем в кэше (worker тот же) — ученик видит новую.
    await context.setOffline(false);
    const index = join(dir, 'index.html');
    writeFileSync(index, readFileSync(index, 'utf8').replace('"title":"Глагольные суффиксы 了, 过, 着"', '"title":"Свежая страница из сети"'));
    await page.goto(`${url}#/rules`);
    await page.reload();
    await see(page, '.index h3', /Свежая страница из сети/);
    // Новая выкладка: новый кэш, старый удалён, страница — новая.
    const version = () => readFileSync(join(dir, 'sw.js'), 'utf8').match(/VERSION = '(\w+)'/)[1];
    const before = version();
    await context.setOffline(false);
    buildPage('offline', { change: (d) => { d.topics[0].title = 'Тема после выкладки'; } });
    const after = version();
    assert.notEqual(after, before);
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
    await page.waitForFunction((v) => caches.keys().then((k) => k.includes(`ege-lg-trainer-${v}`)), after, { timeout: 15000 });
    await page.waitForFunction((v) => caches.keys().then((k) => !k.includes(`ege-lg-trainer-${v}`)), before, { timeout: 15000 });
    // Аварийное выключение: кэши удалены, регистрация снята.
    buildPage('offline', { args: ['--no-offline'] });
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r && r.update()));
    await page.waitForFunction(() => navigator.serviceWorker.getRegistration().then((r) => !r), null, { timeout: 15000 });
    await page.waitForFunction(() => caches.keys().then((k) => !k.some((x) => x.startsWith('ege-lg-trainer-'))), null, { timeout: 15000 });
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
    // Иначе открытые keep-alive соединения держат процесс тестов живым.
    server.closeAllConnections();
    server.close();
  }
});

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
  assert.match(first, /EGELG1:[A-Za-z0-9+/]+$/);
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
  // Чужой код с разметкой в имени: имя показывается текстом, ничего не исполняется.
  const hostile = L.encodeReport({ kind: 'round', name: '<img src=x onerror="window.__xss=1">',
    at: '2026-10-01T10:00:00.000Z', ids: ['q20-a'], answers: ['1'] });
  await page.locator('#reportsInput').fill(`Отчёт\n${hostile}`);
  await see(page, '#classStatus', /1 отчёт/);
  assert.equal(await page.locator('#classSummary img').count(), 0);
  assert.match(await text(page, '#classTable tbody'), /<img src=x onerror=/);
  assert.equal(await page.evaluate(() => window.__xss), undefined);
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
    for (const hash of ['#/rules', '#/rules/jiu-cai', '#/practice', '#/variant', '#/bank', '#/teacher', '#/help']) {
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
  // До ответа — одна клетка, хотя у всех вариантов по два знака: ширина ничего не подсказывает.
  assert.equal(await page.locator('.stem .tz .c').count(), 1);
  assert.equal(await page.locator('.stem .tz').getAttribute('aria-label'), 'пропуск');
  // Неверно: выбранное вписано и зачёркнуто, сверху верный ответ.
  await page.keyboard.press('3');
  await page.locator('.feedback').waitFor();
  // Вписанный ответ раздвигает пропуск: две клетки на два знака.
  assert.equal(await page.locator('.stem .tz .c').count(), 2);
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
  // №24: у всех вариантов по два знака, а клетка до ответа одна.
  await page.locator('.sheet .cell').nth(9).click();
  assert.equal(await page.locator('.stem .tz .c').count(), 1);
  await page.locator('.sheet .cell').nth(1).click();
  await page.keyboard.press('2');
  assert.deepEqual(await page.locator('.stem .tz .ink').allInnerTexts(), ['场']);
  assert.equal(await page.locator('.stem .tz.right, .stem .tz.wrong, .stem .fix').count(), 0);
  await page.locator('.sheet .cell').nth(12).click();
  // До ответа — по одной обычной клетке в каждом пропуске, без вытянутых.
  const gaps = page.locator('.stem .tz');
  assert.equal(await gaps.count(), 2);
  assert.equal(await gaps.nth(0).locator('.c').count(), 1);
  assert.equal(await gaps.nth(1).locator('.c').count(), 1);
  assert.equal(await page.locator('.stem .tz .c.long').count(), 0);
  const cell = await gaps.nth(1).locator('.c').boundingBox();
  assert.ok(Math.abs(cell.width - cell.height) <= 1, `клетка квадратная: ${JSON.stringify(cell)}`);
  await page.keyboard.press('4');
  assert.deepEqual(await page.locator('.stem .tz .ink').allInnerTexts(), ['不', '但', '而', '且']);
  assert.equal(await gaps.nth(1).locator('.c').count(), 2);
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

// Где после ответа предложение задания (или фрагменты №26) и видна ли его верхняя строка над панелью.
const sentenceAt = (page) => page.evaluate(() => {
  const node = document.querySelector('[data-card] .stem, [data-card] .fragments');
  const dock = document.querySelector('.dock');
  const sticky = dock && getComputedStyle(dock).position === 'sticky';
  return {
    top: Math.round(node.getBoundingClientRect().top),
    bottom: Math.round(sticky ? dock.getBoundingClientRect().top : window.innerHeight),
    feedback: Math.round(document.querySelector('.feedback').getBoundingClientRect().top),
    // Низ заголовка и первой строки разбора — та же мерка, что в afterAnswer: 3,5 строки его шрифта.
    head: (() => {
      const box = document.querySelector('.feedback');
      return Math.round(box.getBoundingClientRect().top + 3.5 * parseFloat(getComputedStyle(box).fontSize));
    })(),
    y: Math.round(window.scrollY),
    maxY: Math.round(document.documentElement.scrollHeight - window.innerHeight),
    enter: document.activeElement.dataset.enter === '1',
    // Что в фокусе — на экране: невидимую кнопку нажал бы пробел, которым листают разбор.
    focusSeen: (() => {
      const r = document.activeElement.getBoundingClientRect();
      return r.bottom > 0 && r.top < window.innerHeight;
    })(),
  };
});

for (const [device, size] of [['ноутбук', { width: 1280, height: 720 }], ['телефон', { width: 320, height: 568 }]]) {
  test(`${device}: после неверного ответа предложение не уезжает с экрана, новый экран — с начала`, { skip }, async () => {
    const { page, context, errors } = await open(mainUrl, { ...size, reducedMotion: 'reduce', hash: '#/practice?ids=q26-a,q27-a,q22-a' });
    // Неверные ответы: в №26 (фрагменты), №27 (два пропуска) и №22 разбор длинный.
    for (const key of ['2', '1', '2']) {
      await page.locator('[data-card]').waitFor();
      assert.equal(await page.evaluate(() => window.scrollY), 0, 'задание открывается с начала страницы');
      await page.keyboard.press(key);
      await page.locator('.verdict.bad').waitFor();
      const at = await sentenceAt(page);
      assert.ok(at.top >= 0 && at.top + 40 <= at.bottom, `предложение на экране: ${JSON.stringify(at)}`);
      // Начало разбора видно, и страница сдвинута ровно настолько: не двигалась, если оно и так
      // на экране; иначе встала ровно до него — или до предложения у верхнего края, не дальше.
      const none = at.y === 0 && at.head <= at.bottom + 1;
      const exact = Math.abs(at.head - at.bottom) <= 1 && at.top >= 11;
      const atTop = Math.abs(at.top - 12) <= 1 && at.head >= at.bottom - 1;
      const atEnd = at.y >= at.maxY - 1 && at.head <= at.bottom + 1 && at.top >= 11; // ниже страница не листается
      assert.ok(none || exact || atTop || atEnd, `начало разбора не показано или сдвиг лишний: ${JSON.stringify(at)}`);
      assert.equal(at.focusSeen, true, `фокус за краем экрана: ${JSON.stringify(at)}`);
      if (device === 'телефон') assert.equal(at.enter, true, 'на телефоне фокус на «Дальше» в панели');
      if (device === 'ноутбук') {
        // Пробел листает разбор, а не переходит к следующему заданию.
        const before = await text(page, '.progress');
        const start = await page.evaluate(() => window.scrollY);
        await page.keyboard.press('Space');
        assert.equal(await text(page, '.progress'), before);
        assert.equal(await page.locator('.feedback').count(), 1);
        // Пробел прокрутил разбор; ученик дочитывает — плавная прокрутка успевает закончиться.
        await page.waitForFunction((y) => window.scrollY !== y, start, { timeout: 5000 });
        await page.waitForFunction(() => new Promise((resolve) => {
          const y = window.scrollY;
          setTimeout(() => resolve(window.scrollY === y), 200);
        }), null, { timeout: 5000 });
      }
      await page.keyboard.press('Enter');
    }
    await see(page, 'h2', /Раунд окончен/);
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    assert.deepEqual(errors, []);
    await context.close();
  });
}

test('телефон: предложение ушло за верх, пока ученик выбирал, — после ответа оно снова на экране', { skip }, async () => {
  const { page, context, errors } = await open(mainUrl, { width: 320, height: 360, reducedMotion: 'reduce', hash: '#/practice?ids=q26-a' });
  await page.locator('[data-card]').waitFor();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  assert.ok((await page.evaluate(() => document.querySelector('.fragments').getBoundingClientRect().top)) < 0, 'фрагменты ушли за верх');
  await page.keyboard.press('2');
  await page.locator('.verdict.bad').waitFor();
  const at = await sentenceAt(page);
  assert.ok(at.top >= 0 && at.top + 40 <= at.bottom, `предложение на экране: ${JSON.stringify(at)}`);
  assert.deepEqual(errors, []);
  await context.close();
});

// Enter, пока ещё идёт плавная прокрутка прошлого экрана: пробел по разбору или сдвиг страницы
// к разбору сразу после ответа. Новый экран всё равно открывается с начала.
for (const [what, height, between] of [
  ['пробел и сразу Enter', 720, (page) => page.keyboard.press('Space')],
  ['Enter, пока страница едет к разбору', 560, (page) => page.waitForTimeout(30)],
]) {
  test(`ноутбук: ${what} — новый экран с начала`, { skip }, async () => {
    const { page, context, errors } = await open(mainUrl, { width: 1280, height, hash: '#/practice?ids=q26-a,q27-a,q22-a' });
    for (const [key, screen] of [['2', /Задание 2 из 3/], ['1', /Задание 3 из 3/], ['2', /Раунд окончен/]]) {
      await page.locator('[data-card]').waitFor();
      await page.keyboard.press(key);
      await page.locator('.verdict.bad').waitFor();
      await between(page);
      await page.keyboard.press('Enter');
      await see(page, '.progress, h2', screen);
      // Плавная прокрутка в Chrome длится до 300 мс — ждём с запасом.
      await page.waitForTimeout(700);
      assert.equal(await page.evaluate(() => Math.round(window.scrollY)), 0, `${screen}: экран открылся не с начала`);
    }
    assert.deepEqual(errors, []);
    await context.close();
  });
}

test('ноутбук: сразу после Enter ученик листает сам — страница не возвращается к началу', { skip }, async () => {
  const { page, context, errors } = await open(mainUrl, { width: 1280, height: 600, reducedMotion: 'reduce', hash: '#/practice?ids=q26-a,q27-a,q22-a' });
  await page.mouse.move(640, 300);
  // Третье задание до ответа помещается на экран — листать нечего.
  for (const [key, screen, scroll] of [
    ['2', /Задание 2 из 3/, () => page.keyboard.press('Space')],
    ['1', /Задание 3 из 3/, null],
    ['2', /Раунд окончен/, () => page.mouse.wheel(0, 200)],
  ]) {
    await page.locator('[data-card]').waitFor();
    await page.keyboard.press(key);
    await page.locator('.verdict.bad').waitFor();
    await page.keyboard.press('Enter');
    await see(page, '.progress, h2', screen);
    if (!scroll) continue;
    assert.ok(await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight), `${screen}: экран не листается`);
    await scroll();
    await page.waitForTimeout(700);
    assert.ok(await page.evaluate(() => window.scrollY) > 0, `${screen}: прокрутку ученика сбросили`);
  }
  assert.deepEqual(errors, []);
  await context.close();
});

test('ответ сразу после открытия задания без клавиш и мыши (чтец экрана) — страница всё равно едет к разбору', { skip }, async () => {
  const { page, context, errors } = await open(mainUrl, { width: 1280, height: 400, reducedMotion: 'reduce', hash: '#/practice?ids=q26-a,q27-a' });
  await page.locator('[data-card]').waitFor();
  await page.keyboard.press('2');
  await page.keyboard.press('Enter');
  await see(page, '.progress', /Задание 2 из 2/);
  // Чтец экрана нажимает кнопку одним click — без pointerdown и keydown.
  await page.evaluate(() => document.querySelector('[data-card] .option[data-option="1"]').click());
  await page.locator('.verdict.bad').waitFor();
  await page.waitForTimeout(500);
  assert.ok(await page.evaluate(() => window.scrollY) > 0, 'сдвиг к разбору сброшен к началу страницы');
  assert.deepEqual(errors, []);
  await context.close();
});

// Где после ответа (без анимации) начало предложения, разбор, его первые строки и низ «Дальше» —
// в координатах страницы: от высоты окна они не зависят. sentence — край, до которого страница
// сдвигается самое большее: предложение в 12 px от верха.
async function layoutAfterAnswer(url, { width, hash, key }) {
  const { page, context } = await open(url, { width, height: 400, reducedMotion: 'reduce', hash });
  await page.locator('[data-card]').waitFor();
  await page.keyboard.press(key);
  await page.locator('.feedback').waitFor();
  const at = await page.evaluate(() => {
    const y = (node) => node.getBoundingClientRect().top + window.scrollY;
    const box = document.querySelector('.feedback');
    const next = document.querySelector('[data-enter]');
    return {
      sentence: y(document.querySelector('[data-card] .stem, [data-card] .fragments')) - 12,
      feedback: y(box),
      head: y(box) + 3.5 * parseFloat(getComputedStyle(box).fontSize),
      next: next.getBoundingClientRect().bottom + window.scrollY,
    };
  });
  await context.close();
  return at;
}

test('ноутбук без анимации: «Дальше» после сдвига чуть ниже края — фокус на разборе', { skip }, async () => {
  // Длинное условие опускает предложение: страница сдвигается к разбору дальше, чем от первых строк
  // разбора до «Дальше». Окно — такое, что после сдвига кнопка за нижним краем, хотя ушла бы
  // на экран, если сдвиг посчитать дважды (без анимации он уже сделан к проверке фокуса).
  const url = buildPage('long-prompt', { change: (d) => {
    const q = d.questions.find((x) => x.id === 'q22-a');
    q.prompt = Array(8).fill('Выберите вариант, который грамматически верно заполняет пропуск в предложении.').join(' ');
  } });
  const hash = '#/practice?ids=q22-a';
  const at = await layoutAfterAnswer(url, { width: 1280, hash, key: '2' });
  // Сдвиг head − height (не больше предела sentence): height ≥ head − sentence. После него низ
  // «Дальше» — next − head + height, за краем всегда; после двойного — на экране: height ≤ 2·head − next.
  const low = at.head - at.sentence;
  const high = Math.min(at.head - 1, 2 * at.head - at.next);
  assert.ok(low + 8 < high, `условие не опустило предложение: ${JSON.stringify(at)}`);
  const height = Math.round((low + high) / 2);
  const { page, context, errors } = await open(url, { width: 1280, height, reducedMotion: 'reduce', hash });
  await page.locator('[data-card]').waitFor();
  await page.keyboard.press('2');
  await page.locator('.verdict.bad').waitFor();
  const state = await sentenceAt(page);
  assert.ok(state.y > 0, `страница не сдвинулась: ${JSON.stringify(state)}`);
  assert.ok(await page.evaluate(() => document.querySelector('[data-enter]').getBoundingClientRect().bottom > window.innerHeight),
    `«Дальше» на экране — проверка ни о чём: ${JSON.stringify(state)}`);
  assert.equal(state.enter, false, `фокус на «Дальше» за краем экрана: ${JSON.stringify(state)}`);
  assert.equal(await page.evaluate(() => document.activeElement.matches('.feedback')), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('низкий экран ноутбука: разбор за нижним краем — фокус на условии задания', { skip }, async () => {
  const hash = '#/practice?ids=q27-a';
  const at = await layoutAfterAnswer(mainUrl, { width: 1280, hash, key: '1' });
  // Страница сдвигается самое большее до предложения у верхнего края; окно ниже, чем от
  // этого края до разбора, — разбор начинается за нижним краем (как 1366×768 при масштабе 125 %).
  const height = Math.round(at.feedback - at.sentence - 30);
  const { page, context, errors } = await open(mainUrl, { width: 1280, height, reducedMotion: 'reduce', hash });
  await page.locator('[data-card]').waitFor();
  await page.keyboard.press('1');
  await page.locator('.verdict.bad').waitFor();
  const state = await sentenceAt(page);
  assert.ok(state.feedback >= height, `разбор на экране — проверка ни о чём: ${JSON.stringify(state)}`);
  assert.equal(await page.evaluate(() => document.activeElement.matches('[data-card] .instruction')), true,
    `фокус не на условии: ${await page.evaluate(() => document.activeElement.className)}`);
  assert.deepEqual(errors, []);
  await context.close();
});

test('полный вариант: ответ не прокручивает страницу к кнопке «Дальше»', { skip }, async () => {
  const { page, context, errors } = await open(mainUrl, { width: 1280, height: 520, hash: '#/variant' });
  await page.locator('#buildVariant').click();
  for (let i = 0; i < 3; i += 1) {
    await page.locator('[data-card]').waitFor();
    await page.keyboard.press('1');
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    // В фокусе — то, что видно: «Дальше →» на экране или условие задания. Enter ведёт дальше.
    assert.ok(await page.evaluate(() => {
      const r = document.activeElement.getBoundingClientRect();
      return document.activeElement !== document.body && r.bottom > 0 && r.top < window.innerHeight;
    }));
    await page.keyboard.press('Enter');
  }
  await see(page, '.progress', /Позиция 18/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('шрифт задания: крупный на ноутбуке, на телефоне прежний', { skip }, async () => {
  const sizes = async (page) => page.evaluate(() => {
    const px = (selector) => parseFloat(getComputedStyle(document.querySelector(selector)).fontSize);
    return { instruction: px('.instruction'), stem: px('.stem'), option: px('.option .text'), verdict: px('.verdict p') };
  });
  const wide = await open(mainUrl, { width: 1366, height: 768, hash: '#/practice?ids=q22-a' });
  await wide.page.keyboard.press('2');
  await wide.page.locator('.verdict.bad').waitFor();
  const big = await sizes(wide.page);
  assert.ok(big.stem >= 36, `предложение: ${big.stem}px`);
  assert.ok(big.option >= 30, `варианты: ${big.option}px`);
  assert.ok(big.instruction >= 19, `условие: ${big.instruction}px`);
  assert.ok(big.verdict >= 18, `разбор: ${big.verdict}px`);
  await wide.context.close();
  const phone = await open(mainUrl, { width: 390, height: 844, hash: '#/practice?ids=q22-a' });
  await phone.page.keyboard.press('2');
  await phone.page.locator('.verdict.bad').waitFor();
  const small = await sizes(phone.page);
  assert.ok(small.stem <= 28 && small.option <= 24, `телефон: ${JSON.stringify(small)}`);
  await phone.context.close();
});

test('№19 на ноутбуке: число в варианте не рвётся на две строки', { skip }, async () => {
  for (const width of [800, 1024, 1366]) {
    const { page, context } = await open(mainUrl, { width, height: 768, hash: '#/practice?ids=q19-a' });
    // Сколько строк у числа и не вылезает ли оно за край варианта (nowrap не даёт переноса).
    const lines = () => page.evaluate(() => [...document.querySelectorAll('.option .text')].map((n) => {
      const r = document.createRange();
      r.selectNodeContents(n);
      const rects = [...r.getClientRects()];
      const inside = rects.every((x) => x.right <= n.closest('.option').getBoundingClientRect().right);
      return inside ? new Set(rects.map((x) => Math.round(x.top))).size : 'за краем';
    }));
    assert.deepEqual(await lines(), [1, 1, 1, 1], `${width}px до ответа`);
    await page.keyboard.press('1');
    await page.locator('.feedback').waitFor();
    assert.deepEqual(await lines(), [1, 1, 1, 1], `${width}px после ответа`);
    await context.close();
  }
});

test('шапка телефона: с кнопкой справки не выше прежней', { skip }, async () => {
  for (const width of [320, 360, 375, 390, 402, 412, 414, 430]) {
    const { page, context } = await open(mainUrl, { width, height: 700, hash: '#/rules' });
    const height = await page.evaluate(() => document.querySelector('.top').getBoundingClientRect().height);
    // До кнопки справки — 56 px: задание на телефоне не должно сдвигаться ниже.
    assert.ok(height <= 57, `${width}px: шапка ${height}px`);
    await context.close();
  }
});

test('справка: кнопка в шапке, описание и ссылка учителю, подвала нет', { skip }, async () => {
  const { page, context, errors } = await open(mainUrl, { hash: '#/rules' });
  assert.equal(await page.locator('footer').count(), 0, 'описание переехало в справку');
  await page.getByRole('link', { name: 'Справка' }).click();
  await see(page, 'h2', /Справка/);
  assert.equal(new URL(page.url()).hash, '#/help');
  assert.equal(await page.getByRole('link', { name: 'Справка' }).getAttribute('aria-current'), 'page');
  await see(page, '#view', /Ошибку здесь разбирают на том варианте, который вы выбрали/);
  await see(page, '#bankCount', /16 заданий · 2 правила/);
  await see(page, '#view', /Прогресс хранится/);
  await page.getByRole('link', { name: /сводка отчётов/ }).click();
  await see(page, 'h2', /Результаты класса/);
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
  assert.equal(await pub.page.locator('#reviewBanner').isHidden(), true);
  // В фикстуре 17 заданий с черновиком; опубликовано 16 — черновик не считается.
  await pub.page.goto(`${mainUrl}#/help`);
  assert.doesNotMatch(await text(pub.page, '#bankCount'), /17/);
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
  // У карточки тонов вопросов нет (тоны — не грамматика), берём первую с вопросами.
  await page.locator('.rule-card', { hasNotText: 'Тоны' }).first().click();
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
  // Телефон 320 px на системных шрифтах (шрифты из сети не пришли): ни одна карточка правила не
  // шире экрана — длинные названия переносятся.
  await page.setViewportSize({ width: 320, height: 568 });
  const ruleIds = JSON.parse(readFileSync(join(ROOT, 'data', 'rules.json'), 'utf8')).map((r) => r.id);
  for (const id of ruleIds) {
    await page.goto(`${url}#/rules/${id}`);
    await page.locator('.rule-detail h2').waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.equal(overflow, 0, `правило ${id} шире экрана на ${overflow} px`);
  }
  assert.deepEqual(errors, []);
  await context.close();
});

test('ссылка учителя: повторное открытие не стирает работу, решённое показывает итог', { skip }, async () => {
  const variantIds = [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27].map((n) => `q${n}-a`);
  const variantLink = `${mainUrl}#/variant?ids=${variantIds.join(',')}`;
  const { page, context, errors } = await open(variantLink);
  await see(page, '.progress', /Позиция 15/);
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press('1');
    await page.keyboard.press('Enter');
  }
  await see(page, '.progress', /отвечено: 3/);
  // Ученик закрыл вкладку и вернулся по той же ссылке из чата: работа на месте.
  await page.goto('about:blank');
  await page.goto(variantLink);
  await see(page, '#shareNotice', /уже начали/);
  await see(page, '.progress', /отвечено: 3/);
  assert.equal(Object.keys((await storedProgress(page)).variant.answers).length, 3);
  // Решённый вариант по той же ссылке — итог с отчётом учителю, а не новый вариант.
  await page.locator('.sheet .cell').nth(12).click();
  await page.locator('#finishVariant').click();
  await page.locator('#confirmFinish').click();
  await see(page, '.score', /из 13/);
  await page.goto('about:blank');
  await page.goto(variantLink);
  await see(page, '#shareNotice', /уже решили/);
  await see(page, '.score', /из 13/);
  assert.equal(await page.locator('#report-variant').count(), 1);
  assert.notEqual((await storedProgress(page)).variant.finishedAt, null);
  // Решить заново — те же задания с начала.
  await page.locator('#restartVariant').click();
  await see(page, '.progress', /отвечено: 0/);
  assert.deepEqual((await storedProgress(page)).variant.ids, variantIds);

  // Раунд по ссылке — так же.
  const roundLink = `${mainUrl}#/practice?ids=q20-a,q22-a`;
  await page.goto(roundLink);
  await see(page, '.progress', /Задание 1 из 2/);
  await page.keyboard.press('1');
  await page.locator('.feedback').waitFor();
  await page.keyboard.press('Enter');
  await see(page, '.progress', /Задание 2 из 2/);
  await page.goto('about:blank');
  await page.goto(roundLink);
  await see(page, '#shareNotice', /уже начали/);
  await see(page, '.progress', /Задание 2 из 2/);
  await page.keyboard.press('1');
  await page.locator('.feedback').waitFor();
  await page.keyboard.press('Enter');
  await see(page, 'h2', /Раунд окончен/);
  await page.goto('about:blank');
  await page.goto(roundLink);
  await see(page, '#shareNotice', /уже решили/);
  await see(page, 'h2', /Раунд окончен/);
  assert.equal(await page.locator('#report-round').count(), 1);
  await page.locator('#restartRound').click();
  await see(page, '.progress', /Задание 1 из 2/);
  assert.equal(Object.keys((await storedProgress(page)).round.answers).length, 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test('снятое с публикации задание не стирает начатый вариант, ученик знает почему', { skip }, async () => {
  const { page, context, errors } = await open(mainUrl, { hash: '#/variant' });
  const ids = [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27].map((n) => (n === 20 ? 'q20-gone' : `q${n}-a`));
  const variant = { ids, answers: { 'q15-a': '1', 'q20-gone': '2' }, index: 0, startedAt: new Date().toISOString(), finishedAt: null, elapsedMs: 0 };
  await page.evaluate((v) => localStorage.setItem('ege-lg-trainer:progress',
    JSON.stringify({ version: 2, questions: {}, checks: {}, round: null, variant: v, history: [] })), variant);
  await page.reload();
  await see(page, '#shareNotice', /сняли с сайта/);
  await see(page, '.progress', /отвечено: 1/);
  assert.equal(await page.locator('.sheet .cell').count(), 13);
  await page.keyboard.press('2');
  const stored = (await storedProgress(page)).variant;
  assert.equal(stored.ids[5], 'q20-a', 'место снятого заняло задание того же номера');
  assert.equal(stored.answers['q20-gone'], undefined);
  assert.deepEqual(errors, []);
  await context.close();
});

test('раунд больше 100 заданий: отчёт учителю не предлагается, сказано почему', { skip }, async () => {
  const bigUrl = buildPage('big', { change: (d) => {
    const base = d.questions.find((x) => x.id === 'q20-a');
    for (let i = 0; i < 101; i += 1) d.questions.push({ ...base, id: `q20-x${i}` });
  } });
  const { page, context, errors } = await open(bigUrl, { hash: '#/practice' });
  const put = (ids) => page.evaluate((round) => localStorage.setItem('ege-lg-trainer:progress',
    JSON.stringify({ version: 2, questions: {}, checks: {}, round, variant: null, history: [] })),
  { ids, answers: {}, index: 0, startedAt: 't0', finishedAt: '2026-10-04T10:00:00.000Z' });
  const ids = Array.from({ length: 101 }, (_, i) => `q20-x${i}`);
  await put(ids);
  await page.reload();
  await see(page, 'h2', /Раунд окончен/);
  assert.equal(await page.locator('#report-round').count(), 0);
  await see(page, '#reportTooBig', /до 100 заданий/);
  await put(ids.slice(0, 100));
  await page.reload();
  await see(page, 'h2', /Раунд окончен/);
  assert.equal(await page.locator('#report-round').count(), 1);
  assert.deepEqual(errors, []);
  await context.close();
});

test('прогресс более новой версии из другой вкладки: не перезаписывается, файл и сброс закрыты', { skip }, async () => {
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  await context.route(/^https?:\/\//, (route) => route.abort());
  const errors = [];
  const a = await context.newPage();
  a.on('pageerror', (e) => errors.push(e.message));
  await a.goto(`${mainUrl}#/bank`);
  await a.locator('.bank-item').first().waitFor();
  // Вкладка с новой выкладкой записала прогресс новой версии.
  const b = await context.newPage();
  await b.goto(`${mainUrl}#/rules`);
  const newer = JSON.stringify({ version: 99, questions: { 'q20-a': { future: true } } });
  await b.evaluate((v) => localStorage.setItem('ege-lg-trainer:progress', v), newer);
  await see(a, '#progressLocked', /более новой версией/);
  for (const id of ['#exportProgress', '#importProgress', '#resetProgress']) {
    assert.equal(await a.locator(id).isDisabled(), true, `${id} закрыт`);
  }
  await a.locator('.bank-item').first().click();
  await a.locator('[data-card]').waitFor();
  await a.keyboard.press('1');
  await a.locator('.feedback').waitFor();
  assert.equal(await a.evaluate(() => localStorage.getItem('ege-lg-trainer:progress')), newer);
  assert.deepEqual(errors, []);
  await context.close();
});

test('вариант по ссылке: свой вариант сбросили в другой вкладке — открывается вариант из ссылки', { skip }, async () => {
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  await context.route(/^https?:\/\//, (route) => route.abort());
  const errors = [];
  const a = await context.newPage();
  a.on('pageerror', (e) => errors.push(e.message));
  // Свой вариант — заведомо не тот, что в ссылке (случайный мог бы с ней совпасть).
  const own = [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27].map((n) => `q${n}-a`);
  await a.goto(`${mainUrl}#/variant?ids=${own.join(',')}`);
  await see(a, '.progress', /Позиция 15/);
  await a.keyboard.press('1');
  await see(a, '.progress', /отвечено: 1/);
  const linked = own.map((id) => (id === 'q22-a' ? 'q22-b' : id === 'q27-a' ? 'q27-gen' : id));
  await a.goto(`${mainUrl}#/variant?ids=${linked.join(',')}`);
  await see(a, '#pendingVariant', /незавершённый вариант/);
  const b = await context.newPage();
  await b.goto(`${mainUrl}#/rules`);
  await b.evaluate(() => localStorage.removeItem('ege-lg-trainer:progress'));
  await see(a, '.progress', /Позиция 15/);
  assert.deepEqual((await storedProgress(a)).variant.ids, linked);
  assert.deepEqual(errors, []);
  await context.close();
});

test('часы варианта: время старого варианта не пишется в новый', { skip }, async () => {
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  await context.route(/^https?:\/\//, (route) => route.abort());
  const errors = [];
  const a = await context.newPage();
  a.on('pageerror', (e) => errors.push(e.message));
  await a.clock.install();
  await a.goto(`${mainUrl}#/variant`);
  await a.locator('#buildVariant').click();
  await a.clock.runFor(3 * 60_000);
  // Другая вкладка завершила этот вариант и начала новый, а событие storage сюда не дошло
  // (например, вкладка спала в bfcache): в памяти у неё всё ещё старый вариант.
  const fresh = await a.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('ege-lg-trainer:progress'));
    p.variant = { ...p.variant, startedAt: '2099-01-01T00:00:00.000Z', answers: {}, index: 0, elapsedMs: 0, finishedAt: null };
    localStorage.setItem('ege-lg-trainer:progress', JSON.stringify(p));
    return p.variant.startedAt;
  });
  await a.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const stored = (await storedProgress(a)).variant;
  assert.equal(stored.startedAt, fresh);
  assert.equal(stored.elapsedMs, 0, 'время старого варианта не дописано в новый');
  assert.deepEqual(errors, []);
  await context.close();
});

test('вариант по ссылке: свой вариант завершили в другой вкладке — итог не пропадает, вопрос остаётся', { skip }, async () => {
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  await context.route(/^https?:\/\//, (route) => route.abort());
  const errors = [];
  const a = await context.newPage();
  a.on('pageerror', (e) => errors.push(e.message));
  const own = [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27].map((n) => `q${n}-a`);
  await a.goto(`${mainUrl}#/variant?ids=${own.join(',')}`);
  await see(a, '.progress', /Позиция 15/);
  await a.keyboard.press('1');
  await see(a, '.progress', /отвечено: 1/);
  const linked = own.map((id) => (id === 'q22-a' ? 'q22-b' : id === 'q27-a' ? 'q27-gen' : id));
  await a.goto(`${mainUrl}#/variant?ids=${linked.join(',')}`);
  await see(a, '#pendingVariant', /незавершённый вариант/);
  // Во второй вкладке ученик дорешал свой вариант и смотрит итог.
  const b = await context.newPage();
  b.on('pageerror', (e) => errors.push(e.message));
  await b.goto(`${mainUrl}#/variant`);
  await see(b, '.progress', /отвечено: 1/);
  await b.locator('#finishVariant').click();
  await b.locator('#confirmFinish').click();
  await see(b, '.score', /из 13/);
  // Первая вкладка узнала об этом, но сама вариант из ссылки не открывает: итог второй цел.
  await see(a, '#pendingVariant', /уже завершили/);
  await b.waitForTimeout(500);
  const stored = (await storedProgress(b)).variant;
  assert.deepEqual(stored.ids, own);
  assert.notEqual(stored.finishedAt, null);
  assert.equal(await b.locator('#report-variant').count(), 1);
  // Открыть вариант из ссылки — только по кнопке.
  await a.locator('#openLinkedVariant').click();
  await see(a, '.progress', /Позиция 15/);
  assert.deepEqual((await storedProgress(a)).variant.ids, linked);
  assert.deepEqual(errors, []);
  await context.close();
});

test('снятое задание без замены: позиция убрана и сказано об этом; у решённого варианта нет «заново» и ссылки', { skip }, async () => {
  // Сборка без q23-a: других заданий №23 на сайте нет.
  const url = buildPage('no23', { change: (d) => { d.questions = d.questions.filter((x) => x.id !== 'q23-a'); } });
  const { page, context, errors } = await open(url, { hash: '#/variant' });
  const ids = [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27].map((n) => `q${n}-a`);
  const put = (variant) => page.evaluate((v) => localStorage.setItem('ege-lg-trainer:progress',
    JSON.stringify({ version: 2, questions: {}, checks: {}, round: null, variant: v, history: [] })), variant);
  await put({ ids, answers: { 'q15-a': '1' }, index: 0, startedAt: '2026-10-04T10:00:00.000Z', finishedAt: null, elapsedMs: 0 });
  await page.reload();
  await see(page, '#shareNotice', /других заданий тех же номеров на сайте нет/);
  assert.equal(await page.locator('.sheet .cell').count(), 12);
  // Решённый вариант с ушедшим заданием: итог виден, а решить заново и поделиться нечем — вариант неполный.
  await put({ ids, answers: { 'q15-a': '2' }, index: 12, startedAt: '2026-10-04T10:00:00.000Z', finishedAt: '2026-10-04T10:30:00.000Z', elapsedMs: 60000 });
  await page.reload();
  await see(page, '.score', /из 12/);
  assert.equal(await page.locator('#restartVariant').count(), 0);
  assert.equal(await page.locator('#share-variant').count(), 0);
  await see(page, '#variantIncomplete', /сняли с сайта/);
  assert.doesNotMatch(await text(page, '#view'), /\bnull\b/, 'закрытая кнопка не печатается словом «null»');
  assert.deepEqual(errors, []);
  await context.close();
});

test('прогресс новой версии появился незаметно для вкладки: сброс и загрузка файла его не трогают', { skip }, async () => {
  const { page, context, errors } = await open(mainUrl, { hash: '#/bank' });
  await page.locator('.bank-item').first().waitFor();
  // Событие storage сюда не пришло (своя запись или вкладка спала в bfcache): страница о новой версии не знает.
  const newer = JSON.stringify({ version: 99, questions: { 'q20-a': { future: true } } });
  await page.evaluate((v) => localStorage.setItem('ege-lg-trainer:progress', v), newer);
  const file = join(work, 'progress-v2.json');
  writeFileSync(file, JSON.stringify({ app: 'ege-lg-trainer', exportedAt: 't', version: 2, questions: {}, checks: {}, round: null, variant: null, history: [] }));
  await page.locator('#progressFile').setInputFiles(file);
  await see(page, '#transferNotice', /не сохранён/);
  assert.equal(await page.evaluate(() => localStorage.getItem('ege-lg-trainer:progress')), newer);
  await page.reload();
  await page.evaluate((v) => localStorage.setItem('ege-lg-trainer:progress', JSON.stringify({ version: 2, questions: {}, checks: {}, round: null, variant: null, history: [] })), newer);
  await page.reload();
  await page.locator('#resetProgress').click();
  await page.evaluate((v) => localStorage.setItem('ege-lg-trainer:progress', v), newer);
  await page.locator('#confirmReset').click();
  await see(page, '#progressLocked', /более новой версией/);
  assert.equal(await page.evaluate(() => localStorage.getItem('ege-lg-trainer:progress')), newer);
  assert.deepEqual(errors, []);
  await context.close();
});
