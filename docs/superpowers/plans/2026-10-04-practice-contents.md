# Оглавление заданий на экране практики — план работ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** заменить на экране «Практика ЕГЭ» два независимых блока «Темы» и «Номер задания»
одним оглавлением по номерам 15–27, где тема — подпись номера, а тема снаружи только сужает.

**Architecture:** меняется только отрисовка `renderPractice` в `src/app.js` и стили в
`src/app.css`. Логика отбора (`filterQuestions`, `shareQuery`, `parseShareQuery` в
`src/logic.mjs`) и формат `filters` не трогаются: `filters.tasks` — отмеченные строки,
`filters.topics` — сужение, пришедшее с карточки правила, из старой ссылки или старого
сохранения.

**Tech Stack:** статическая страница (ванильный JS, `el()`), Node test runner, Playwright
(`playwright-core` + Google Chrome) для `test/ui.test.mjs`.

## Global Constraints

- Замысел: `docs/superpowers/specs/2026-10-04-practice-contents-design.md`.
- Цвета только токенами из `src/app.css` (обе темы); чёрного фона и кнопок нет.
- Текст из данных — через `textContent` (`text:` в `el()`).
- Разосланные ссылки `#/practice?topics=…&tasks=…` должны открывать ту же подборку.
- Строка оглавления не ниже 44 px; на телефоне одна колонка.
- Тесты: `python3 -m unittest discover -s test -t .` и `node --test test/*.test.mjs`.
- Каждое заметное изменение — запись в `CHANGELOG.md`.

---

### Task 1: Оглавление вместо «Темы» и «Номер задания»

**Files:**
- Modify: `src/app.js` (`renderPractice`, около строк 850–865; новая функция `taskContents`
  рядом с `chipGroup`)
- Modify: `src/app.css` (после блока `.chip.num`, около строки 166)
- Test: `test/ui.test.mjs` (тесты «правило → проверка правила → задания по теме»,
  «фильтры по теме и номеру независимы…», «тренировка…», «ссылки учителя…»)

**Interfaces:**
- Consumes: `filters` (`topics`, `tasks`), `questions`, `topics` (у темы `taskNumbers`),
  `TASK_NUMBERS`, `toggle`, `saveFilters`, `render`, `topicTitle`, `el`.
- Produces: чекбоксы `input[data-key="Задания:N"]` (N — номер), строки `label.task-row`,
  строка сужения `#topicFocus` с кнопкой «Снять тему».

- [ ] **Step 1: Переписать браузерные тесты под оглавление**

В тесте «правило → проверка правила → задания по теме» после
`await see(page, '#available', /Доступно: 3 задания/);` добавить:

```js
  // Тема с карточки правила только сужает оглавление: номера без неё не нажимаются.
  await see(page, '#topicFocus', /Только тема: Наречия/);
  assert.equal(await page.locator('input[data-key="Задания:20"]').isDisabled(), true);
  assert.equal(await page.locator('input[data-key="Задания:27"]').isDisabled(), false);
  await see(page, '.task-row', /27\s*Прочие темы\s*1/);
  await page.getByRole('button', { name: 'Снять тему' }).click();
  assert.equal(await page.locator('#topicFocus').count(), 0);
  await see(page, '#available', /Доступно: 15 заданий/);
```

Тест «фильтры по теме и номеру независимы, источник виден» заменить целиком:

```js
test('оглавление по номерам: тема — подпись номера, источник виден', { skip }, async () => {
  const { page, context, errors } = await open(mainUrl, { hash: '#/practice' });
  const row = (n) => page.locator(`input[data-key="Задания:${n}"]`);
  // Отдельного выбора темы и номера нет: одна строка на номер.
  assert.equal(await page.locator('input[data-key^="Темы:"]').count(), 0);
  assert.equal(await page.locator('input[data-key^="Номер задания:"]').count(), 0);
  await see(page, '.task-row', /22\s*Наречия\s*2/);
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
```

В тесте «тренировка…» ключи `Номер задания:20` и `Номер задания:22` заменить на
`Задания:20` и `Задания:22`.

В тесте «ссылки учителя…»:
- `assert.equal(await page.locator('input[data-key="Темы:adverbs"]').isChecked(), true);`
  (оба места) заменить на `await see(page, '#topicFocus', /Наречия/);`
- `input[data-key="Номер задания:22"]` заменить на `input[data-key="Задания:22"]`.

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `node --test test/ui.test.mjs`
Expected: FAIL — нет `#topicFocus`, `.task-row` и `input[data-key="Задания:…"]`.

- [ ] **Step 3: Отрисовка оглавления в `src/app.js`**

Рядом с `chipGroup` добавить:

```js
  // Оглавление по номерам: номер в клетке, тема номера, число заданий. Тема с карточки
  // правила или из старой ссылки (filters.topics) только сужает: номер без неё не нажать.
  function taskContents() {
    const inTopics = (q) => !filters.topics.length || q.topicIds.some((t) => filters.topics.includes(t));
    const rows = TASK_NUMBERS.map((n) => {
      const own = questions.filter((q) => q.taskNumber === n);
      const topic = topics.find((t) => t.taskNumbers.includes(n));
      return { n, title: topic ? topic.title : `Задание ${n}`, total: own.length, count: own.filter(inTopics).length };
    }).filter((r) => r.total > 0);
    const focus = filters.topics.length
      ? el('p', { class: 'topic-focus', id: 'topicFocus' },
        el('span', {}, 'Только тема: ', el('b', { text: filters.topics.map(topicTitle).join(', ') })),
        el('button', {
          class: 'button ghost', type: 'button',
          onclick: () => {
            filters = { ...filters, topics: [] };
            saveFilters();
            render(false);
            const first = view.querySelector('.task-row input');
            if (first) first.focus();
          },
        }, el('span', { 'aria-hidden': 'true', text: '✕' }), ' Снять тему'))
      : null;
    return el('fieldset', { class: 'filter' },
      el('legend', { text: 'Задания' }),
      focus,
      el('div', { class: 'contents' }, rows.map((r) => {
        const checked = filters.tasks.includes(r.n);
        return el('label', { class: 'task-row' },
          el('input', {
            type: 'checkbox', checked, disabled: !checked && !r.count, dataset: { key: `Задания:${r.n}` },
            onchange: () => { filters.tasks = toggle(filters.tasks, r.n); saveFilters(); render(false); },
          }),
          el('span', {},
            el('span', { class: 'cellnum', text: String(r.n) }),
            el('span', { class: 'task-title', text: r.title }),
            el('small', { text: String(r.count) })));
      })));
  }
```

В `renderPractice`:
- вводный текст заменить на `'Задания из банка с разбором сразу после ответа. Отметьте номера — или ничего, чтобы взять все.'`;
- удалить построение `topicItems`, `taskItems` и оба `view.append(chipGroup('Темы'…))`,
  `view.append(chipGroup('Номер задания'…))`, вместо них — `view.append(taskContents());`.

- [ ] **Step 4: Стили в `src/app.css`**

После блока `.chip.num small` добавить:

```css
/* Оглавление практики: номер в клетке, тема, число заданий; колонки сверху вниз, как в правилах. */
.contents { columns: 2 300px; column-gap: 12px; }
.task-row { position: relative; display: block; margin: 0 0 6px; break-inside: avoid; cursor: pointer; }
.task-row input { position: absolute; inset: 0; margin: 0; opacity: 0; cursor: pointer; }
.task-row > span {
  display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px;
  min-height: 52px; padding: 7px 14px 7px 8px; border: 1.5px solid var(--line); border-radius: 6px;
  background: var(--sheet); color: var(--ink); font-weight: 650; line-height: 1.3;
}
.task-row .cellnum { min-width: 38px; height: 36px; font-size: 1rem; }
.task-row small { color: var(--muted); font-weight: 600; font-variant-numeric: tabular-nums; }
.task-row input:hover + span { border-color: var(--grid); }
.task-row input:checked + span { border-color: var(--pen); background: var(--pen-bg); color: var(--pen); }
.task-row input:checked + span .cellnum { border-color: var(--pen); color: var(--pen); }
.task-row input:checked + span small { color: var(--pen); }
.task-row input:focus-visible + span { outline: 3px solid var(--focus); outline-offset: 2px; }
.task-row input:disabled { cursor: not-allowed; }
.task-row input:disabled + span { opacity: .45; }
.topic-focus {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px;
  margin: 0 0 8px; padding: 6px 6px 6px 14px; border: 1.5px dashed var(--pen); border-radius: 6px;
  background: var(--pen-bg); color: var(--pen); font-weight: 600;
}
.topic-focus b { font-weight: 750; }
.topic-focus .button { min-height: 40px; padding: 6px 12px; color: var(--pen); }
```

(Окончательный вид — по навыку frontend-design и проверке в браузере в обеих темах;
структура классов и токены — эти.)

- [ ] **Step 5: Прогнать тесты**

Run: `node --test test/*.test.mjs` и `python3 -m unittest discover -s test -t .`
Expected: PASS (браузерный тест не пропущен — Chrome есть).

- [ ] **Step 6: Commit**

```bash
git add src/app.js src/app.css test/ui.test.mjs
git commit -m "Практика: оглавление по номерам вместо отдельных тем и номеров"
```

### Task 2: Проверка в браузере и журнал

**Files:**
- Modify: `CHANGELOG.md` (новая запись сверху)
- Modify: `CLAUDE.md` — не нужно: маршруты и ключи хранилища не менялись.

- [ ] **Step 1: Собрать страницу и посмотреть её**

Run: `python3 scripts/build_site.py`, открыть `dist/index.html#/practice` в браузере.
Проверить: светлая и тёмная темы; ширина 375 px (одна колонка, нет горизонтальной
прокрутки) и 1100 px (две колонки, 15–21 слева); карточка «Сравнение с 比» → «Задания ЕГЭ
по теме» → строка «Только тема: Сравнительные конструкции», у №18 число 18, остальные бледные;
«Снять тему» возвращает все номера; ссылка `#/practice?topics=prepositions&tasks=18`
открывает №18 с сужением «Предлоги».

- [ ] **Step 2: Запись в `CHANGELOG.md`**

```markdown
## 2026-10-04 — оглавление заданий в практике (ветка design/practice-contents)

- Экран практики: вместо отдельных блоков «Темы» и «Номер задания» — одно оглавление по
  номерам 15–27: номер в клетке, тема номера, число заданий. У №18 — «Предлоги», в счёт входят
  и задания на сравнение. Пустых подборок вроде «тоны + 16» больше не собрать.
- Тема с карточки правила, из старой ссылки учителя или старого сохранения только сужает
  оглавление: строка «Только тема: …» с кнопкой «Снять тему», номера без этой темы бледнеют.
  Отбор и формат ссылок прежние — разосланные ссылки открывают ту же подборку.
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "Журнал: оглавление заданий в практике"
```
