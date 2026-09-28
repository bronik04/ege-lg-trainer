# Облик «тетрадь» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** новый облик «тетрадь» (田字格, синяя и красная ручка, «ночная тетрадь») и удобный
на телефоне сценарий задания по спецификации
`docs/superpowers/specs/2026-09-26-notebook-redesign-design.md`.

**Architecture:** чистая логика пропусков — в `src/logic.mjs` (тесты в Node); отрисовка — в
`src/app.js`; облик — полностью переписанный `src/app.css` на токенах; шрифты и шапка — в
`src/template.html`. Данные, маршруты, прогресс не меняются.

**Tech Stack:** статическая страница без сборщика (Python собирает один HTML), ванильный JS,
Node test runner, Playwright (`playwright-core`) + Google Chrome без окна.

## Global Constraints

- Цвета, шрифты, размеры — только из спецификации (таблица токенов, раздел «Шрифты»).
- Чёрного фона и чёрных кнопок нет; основная кнопка — `--pen`.
- До 720 px варианты ответа — один столбец; главная кнопка сессии — в `.actions.dock`.
- Текст из банка — только через `textContent` / `el(... { text })`.
- Классы и ID из раздела «Код» спецификации сохраняются; `.pill` первой в карточке задания
  остаётся и содержит «Задание N».
- Внешние ресурсы — только стили шрифтов с `fonts.googleapis.com` и
  `cdn.jsdelivr.net/npm/lxgw-wenkai-screen-webfont@1.7.0/`; внешних скриптов нет.
- Ширина 320 px — без горизонтальной прокрутки.
- Каждое заметное изменение — запись в `CHANGELOG.md`.

Проверки проекта: `python3 -m unittest discover -s test -t .` и `node --test test/*.test.mjs`.

---

### Task 1: Пропуски — `blankCells` и `blankFill`

**Files:**
- Modify: `src/logic.mjs` (после `stemSegments`)
- Test: `test/logic.test.mjs`

**Interfaces:**
- Produces: `blankFill(item, optionId) → string[] | null` — тексты по пропускам;
  `blankCells(item) → number[]` — число клеток каждого пропуска (1–4; `0` — вытянутая
  клетка для текста длиннее 4 знаков). Пропуски ищутся в `item.stem ?? item.sentence`.
  *Изменено 28.09.2026:* клетки по числу знаков — только если у всех вариантов оно
  одинаковое, иначе `0` (подсказка длиной); код и тесты ниже — исходная версия, действующее
  правило — в spec, раздел «Пропуск-клетка».

- [ ] **Step 1: тесты**

```js
test('blankFill: один пропуск — текст варианта целиком', () => {
  const item = { stem: '他说___是将来的事。', options: [{ id: '1', text: '的' }, { id: '2', text: '地' }] };
  assert.deepEqual(blankFill(item, '2'), ['地']);
  assert.equal(blankFill(item, 'нет такого'), null);
});

test('blankFill: союз задания 27 раскладывается по двум пропускам', () => {
  const item = { stem: '___西瓜有这么多的优点，___ 我最爱吃西瓜。', options: [
    { id: '1', text: '要是……，就……' }, { id: '2', text: '虽然……但是' },
    { id: '3', text: '除了........以外,........' }, { id: '4', text: '不但……，而且……，还……' }] };
  assert.deepEqual(blankFill(item, '1'), ['要是', '就']);
  assert.deepEqual(blankFill(item, '2'), ['虽然', '但是']);
  assert.deepEqual(blankFill(item, '3'), ['除了', '以外']);
  assert.equal(blankFill(item, '4'), null, 'три части на два пропуска');
});

test('blankFill: без пропуска и без иероглифов — null', () => {
  assert.equal(blankFill({ stem: '整齐.', options: [{ id: '1', text: '2-3' }] }, '1'), null);
  const check = { sentence: '他十点___来。', options: [{ id: '1', text: 'Позже ожидаемого' }] };
  assert.equal(blankFill(check, '1'), null);
});

test('blankCells: по самому длинному варианту, от 1 до 4, длинный — 0', () => {
  const opts = (...texts) => texts.map((text, i) => ({ id: String(i + 1), text }));
  assert.deepEqual(blankCells({ stem: '拿___本书。', options: opts('上来', '回去', '出') }), [2]);
  assert.deepEqual(blankCells({ stem: '我听___。', options: opts('不了', '得好', '不懂') }), [2]);
  assert.deepEqual(blankCells({ stem: '___我看来', options: opts('在……看来', '对') }), [0]);
  assert.deepEqual(blankCells({ stem: '___他，___我。', options: opts('因为……，所以……', '要是……，就……') }), [2, 2]);
  assert.deepEqual(blankCells({ stem: '___他，___我。', options: opts('除了……以外，还……', '一……就……一……') }), [2, 2], 'не раскладывается — по две');
  assert.deepEqual(blankCells({ stem: '整齐.', options: opts('2-3') }), []);
});
```

- [ ] **Step 2:** `node --test test/logic.test.mjs` — FAIL (`blankFill is not a function`).

- [ ] **Step 3: реализация** (в `src/logic.mjs`, экспорт; импорт в тесте дополнить)

```js
const HANZI = /[㐀-鿿]/;
const EDGE_PUNCT = /^[\s，,、；;。：:]+|[\s，,、；;。：:]+$/g;
const blankCount = (item) => stemSegments(item.stem ?? item.sentence ?? '').filter((p) => p.blank).length;
const chars = (text) => [...text.replace(/\s+/g, '')].length;

// Что вписать в пропуски для варианта: один пропуск — весь текст, несколько — части союза.
export function blankFill(item, optionId) {
  const k = blankCount(item);
  const option = item.options.find((o) => o.id === optionId);
  if (!k || !option || !HANZI.test(option.text)) return null;
  if (k === 1) return [option.text.trim()];
  const parts = option.text.split(/…+|\.{3,}/).map((p) => p.replace(EDGE_PUNCT, '')).filter(Boolean);
  return parts.length === k ? parts : null;
}

// Сколько клеток в каждом пропуске: по самому длинному варианту, чтобы ширина не подсказывала.
export function blankCells(item) {
  const k = blankCount(item);
  const fills = item.options.map((o) => blankFill(item, o.id)).filter(Boolean);
  return Array.from({ length: k }, (_, i) => {
    if (!fills.length) return 2;
    const longest = Math.max(...fills.map((f) => chars(f[i])));
    return longest > 4 ? 0 : Math.max(1, longest);
  });
}
```

- [ ] **Step 4:** `node --test test/logic.test.mjs` — PASS.
- [ ] **Step 5:** commit «Пропуск-клетка: сколько клеток и что вписать».

### Task 2: Шрифты, шапка, подвал, токены

**Files:**
- Modify: `src/template.html` (весь `<head>` ссылки, шапка, подвал)
- Modify: `src/app.css` — переписать целиком на токенах спецификации
- Modify: `test/test_build_site.py::test_page_has_everything_inline`
- Modify: `README.md:12`

- [ ] **Step 1: тест сборки** — заменить проверку «нет `<link rel="stylesheet">`»:

```python
        links = re.findall(r'<link rel="stylesheet" href="([^"]+)"', html)
        self.assertTrue(links, "стили шрифтов подключены")
        for href in links:
            self.assertTrue(href.startswith(("https://fonts.googleapis.com/css2?",
                                             "https://cdn.jsdelivr.net/npm/lxgw-wenkai-screen-webfont@1.7.0/")), href)
        self.assertNotRegex(html, r'<script[^>]+src=')
```

- [ ] **Step 2:** `python3 -m unittest test.test_build_site` — FAIL (ссылок нет).
- [ ] **Step 3: шаблон.** В `<head>`: `preconnect` к `fonts.googleapis.com`,
  `fonts.gstatic.com` (crossorigin), `cdn.jsdelivr.net`; ссылки
  `https://fonts.googleapis.com/css2?family=Alegreya:wght@500..800&family=Golos+Text:wght@400..800&display=swap`
  и `https://cdn.jsdelivr.net/npm/lxgw-wenkai-screen-webfont@1.7.0/lxgwwenkaigbscreen.css`;
  `theme-color` `#F2F4EF` (light) и `#1B2338` (`media="(prefers-color-scheme: dark)"`);
  значок — красный квадрат `#C23A2C` с белым 语. Шапка: `.brand` (печать `.seal` 语,
  `<strong>Лексика и грамматика</strong>`, подпись «ЕГЭ · китайский · задания 15–27»),
  кнопка `#themeToggle` (иконка ◐, `#themeLabel` — визуально скрытая подпись),
  вкладки `Правила · Практика · Вариант · Банк` (`data-tab` прежние). Подвал: описание
  тренажёра, `#bankCount`, `#footNote`.
- [ ] **Step 4: CSS.** Токены светлой и тёмной темы из спецификации; `--zh`, `--ui`,
  `--disp`; компоненты: шапка, вкладки (подчёркивание `--pen`), кнопки (`.button` —
  `--pen`, `.alt` — `--pen-bg`, `.ghost` — прозрачная с `--line`), поля, теги, клетки
  номеров, карточки, уведомления, `.dock`, кольцо фокуса, `h2[tabindex="-1"]:focus`
  без рамки, `.sr` для скрытых подписей. Ширина 320 px без переполнения.
- [ ] **Step 5:** `app.js` — `syncTheme()` ставит `aria-pressed` и подпись
  «Тёмная тема» / «Светлая тема».
- [ ] **Step 6:** README: «Страница самодостаточна: `dist/index.html` работает без сервера;
  шрифты подгружаются из сети, без неё — системные».
- [ ] **Step 7:** все тесты — PASS; commit.

### Task 3: Карточка задания и сессия

**Files:**
- Modify: `src/app.js` — `questionPills`, `stemNode`, `questionCard`, `progressBar`,
  `renderRound`, `renderCheck`, `renderVariantRun`, `renderVariantResult`, keydown не трогать
- Modify: `src/app.css`

**Interfaces:**
- Consumes: `blankFill`, `blankCells` (Task 1).

- [ ] **Step 1:** `blankNode(item, i, cells, { written, correct, reveal })` — `span.tz`
  (`role="img"`, подпись по спецификации) с `cells[i]` клетками `span.c` (или одной
  `span.c.long` при `0`); вписанный текст — по знаку в клетку, в `span.ink`; при reveal:
  верно — класс `right` и SVG-галочка `.tick`, неверно — класс `wrong` и `span.fix` с
  верной частью. `stemNode` и предложение вопроса по правилу строят пропуски через неё.
  В `questionCard` передаётся `selected` и `reveal`.
- [ ] **Step 2:** `questionPills` — первая `.pill.task`: «Задание» + клетка с номером.
- [ ] **Step 3:** вариант ответа: `lang` = `zh` только при иероглифах, иначе `ru` и класс
  `plain` (Golos, tabular-nums); `.options.row` лишь при коротких вариантах, до 720 px —
  один столбец (CSS). Подсказка `.keys` под вариантами, видна только при
  `(hover: hover) and (pointer: fine)`.
- [ ] **Step 4:** `sessionBar({ exit, label, right, marks, index })` — ✕ (`a.exit`,
  `aria-label="Выйти"`), `.ticks` (по делению на задание: `ok`/`bad`/`now`/пусто) и строка
  `.progress`. Раунд — выход `#/practice/setup`, кнопка «К настройкам» удаляется; проверка
  правила — выход к правилу; вариант — без ✕ и делений (есть бланк).
- [ ] **Step 5:** действия сессии — `div.actions.dock`: раунд/проверка — «Дальше» / «Итог»
  после ответа; вариант — «← Назад», «Дальше →» (на последней позиции — «Завершить
  вариант» `#finishVariant`), на остальных — `#finishVariant` обычной кнопкой вне панели.
- [ ] **Step 6:** после ответа, если панель липкая (телефон) и начало разбора под ней, —
  прокрутка так, чтобы `.stem` (или `.fragments`) был у верха, но начало разбора всё равно
  видно; фокус на `[data-enter]` с `preventScroll` только при липкой панели.
- [ ] **Step 7:** `renderVariantResult` — `share.box` в `view.append` только если не `null`.
- [ ] **Step 8:** тесты — PASS; снимки 390/1280; commit.

### Task 4: Оглавление правил и карточка правила

**Files:** `src/app.js` (`renderRules`, `renderRule`), `src/app.css`.

- [ ] **Step 1:** строки оглавления: группировка тем по `taskNumbers.join()`, порядок —
  по первому номеру; в строке `span.num` (номера через «·»), `h3` — названия тем через
  « · », ссылки `a.rule-card` на правила этих тем без повторов, пометка «черновик».
  Блок «Проверить себя по всем правилам» — кнопка `.all-checks`.
- [ ] **Step 2:** карточка правила — прежняя структура, новый облик.
- [ ] **Step 3:** тесты — PASS; commit.

### Task 5: Практика, итоги, банк — облик

**Files:** `src/app.js` (разметка клеток номеров в `resultList`, `bank-item`, `sheet`),
`src/app.css`.

- [ ] **Step 1:** номера в клетках (`.n.num`), бланк с ✓/✗, счёт Alegreya.
- [ ] **Step 2:** тесты — PASS; commit.

### Task 6: Браузерные проверки, журнал

**Files:** `test/ui.test.mjs`, `CHANGELOG.md`.

- [ ] **Step 1:** в `open()` — `context.route(/^https?:/, (r) => r.abort())`.
- [ ] **Step 2:** новый тест «тетрадь: пропуск-клетка, исправление, панель на телефоне»:
  раунд из `q25-a` (`#/practice?ids=q25-a`), 390×844: две клетки в `.tz`; ответ «3»
  (неверно) → `.tz.wrong`, `.fix` = «过来»; «Дальше» (`.dock [data-enter]`) в пределах
  окна; раунд из `q21-a`, ответ «1» → `.tz.right .tick`; вариант — ответ вписан в
  `.tz .ink`, пометок нет; итог варианта — нет текста `null`.
- [ ] **Step 3:** в тест «телефон» добавить ширину 390 и экран раунда с разбором.
- [ ] **Step 4:** CHANGELOG, все проверки, снимки «до/после»; commit.
