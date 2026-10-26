# Тренировка тонов по словам HSK 2.0 — план

Замысел — `docs/superpowers/specs/2026-10-26-tone-words-design.md`. Ветка `feature/tone-words`.

1. **`scripts/tones.py` + тесты** — слоги пиньиня, тоны слога, строка тонов, варианты, разбор, отпечаток.
2. **`scripts/extract_words.py`** — таблицы HSK1–4 и Anki → `sources/words/hsk2-words.json` (+ README).
3. **`scripts/build_tones.py`** — выписка + `overrides.json` + №15 ФИПИ → `data/tone-words.json`
   и `data/review/tones-report.md`; статусы переносятся, если отпечаток тот же.
4. **`scripts/accept_tones.py`, `validate.py`, `build_site.py`** — принятие, инварианты, `tones` в данных страницы.
5. **`src/logic.mjs`** — `filterToneWords`, `toneCounts`; тесты в `test/logic.test.mjs`.
6. **`src/app.js`, `template.html`, `app.css`** — вкладка «Тоны», настройка круга, общий раунд с `mode: "tones"`.
7. **Проверка** — все тесты, браузерный тест на фикстуре, живая сборка в `preview`.
8. **`CHANGELOG.md`, `CLAUDE.md`** — запись и правила; отчёт автору (отчёт о спорных словах, ревью).
