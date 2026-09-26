# Правила работы

Тренажёр заданий 15–27 ЕГЭ по китайскому языку: правила, вопросы по правилам, практика
по банку ФИПИ, полный вариант. Статическая страница без сервера; данные собираются до
публикации. Замысел — `docs/superpowers/specs/2026-09-26-ege-lg-trainer-design.md`,
план — `docs/superpowers/plans/2026-09-26-ege-lg-trainer.md`.

## Данные

- `sources/` не редактировать: это снимки первоисточников. Обновление — только
  `scripts/snapshot_constructor.py` (банк Конструктора) или новый файл в `sources/generated/`.
- `data/raw/*.json` и `data/questions.json` пишутся только скриптами, руками — никогда.
  Тесты сверяют их с пересборкой.
- Формулировки, варианты и их порядок из источника не правятся. Спорный ключ — не
  исправлять, а отметить `keyConflict` в разборе или записать в `data/review/reading-notes.md`.
- Разборы, темы и правила задания — в `data/authored/task-NN.json`; добавлять волной
  через `scripts/add_explanations.py`. У каждого неверного варианта — свой разбор
  в контексте предложения; общая фраза «повторите правило» не проходит проверку.
- **Статус `accepted` — решение автора** после чтения `data/review/queue.md`. Claude пишет
  только черновики (`draft`) и запускает `accept.py` лишь по прямой команде автора в чате
  (так принят пилот 26.09.2026: «черновики ок»), с записью в `CHANGELOG.md`. В публикацию
  попадает только принятое.
- Примеры в карточках правил не берутся из заданий банка: ученик должен запоминать
  правило, а не ответ.

## Команды

    python3 scripts/import_constructor.py   # sources/constructor-bank → data/raw/fipi.json
    python3 scripts/import_generated.py     # sources/generated → data/raw/generated.json
    python3 scripts/build_bank.py           # data/raw + data/authored → data/questions.json + отчёты
    python3 scripts/validate.py             # инварианты банка, правил и вопросов
    python3 scripts/build_site.py           # dist/index.html — только принятое
    python3 scripts/build_site.py --drafts  # review-build/review.html — с черновиками

Тесты: `python3 -m unittest discover -s test -t .` и `node --test test/*.test.mjs`.
Браузерный `test/ui.test.mjs` проходит страницу из `test/fixtures` в Google Chrome без
окна; нужен `npm ci`. Локально без Chrome пропускается, в CI падает.
В Python 3.14 стандартный пакет `test` перехватывает импорт, поэтому в `test/` лежит
`__init__.py`, а discover запускается с `-t .`. Паттерн `test/*.test.mjs` пишется без
кавычек: его раскрывает shell (так работает в любой версии Node, в том числе без встроенного глоба).

## Интерфейс

- Весь текст из банка выводится через `textContent`; разметку из данных не исполнять.
- Чистая логика — `src/logic.mjs` (тестируется в Node), DOM — `src/app.js`.
  При сборке `export` вырезается, и оба файла попадают в один скрипт страницы.
- Ссылка «Сообщить об ошибке» ведёт в issues (`ISSUES_URL` в `scripts/common.py`) и несёт
  только то, что видно на экране: ID, условие, выбранный ответ и ключ.
- Прогресс — `localStorage`, ключ `ege-lg-trainer:progress`, версия структуры в
  `PROGRESS_VERSION`. Меняете структуру — поднимите версию и не роняйте старые данные.

Каждое заметное изменение — короткая запись в `CHANGELOG.md` рядом с коммитом.
