# Кнопка «Проверка» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Двойной клик по `Проверка.command` открывает в Терминале всё, что ждёт решения автора: черновые разборы заданий, правила и вопросы к ним, спорные ключи ФИПИ, сообщения учеников. Решения сразу записываются.

**Architecture:** Три модуля на стандартной библиотеке Python. `console_ui.py` отвечает за Терминал: ввод, ширину иероглифа, меню и очистку чужого текста. `review_queue.py` без ввода-вывода строит очереди из данных конвейера (`build_bank.merge`), записывает решения и работает с `gh`. `review_console.py` рисует экраны и ведёт разделы. Кнопка `Проверка.command` запускает `review_console.py`.

**Tech Stack:** Python 3.12+ (только стандартная библиотека), `unittest`, zsh для `.command`, GitHub CLI `gh` (необязательно).

**Замысел:** `docs/superpowers/specs/2026-09-27-review-console-design.md`.

## Global Constraints

- Python — только стандартная библиотека. В CI Python 3.12, локально 3.14.
- Тесты: `python3 -m unittest discover -s test -t .` (в `test/` лежит `__init__.py`), `node --test test/*.test.mjs`.
- Ответы на странице: «в» — все верны, номера через пробел — какие не так, «п» — пропустить, «0» — в меню. У правила — «в», «н», «п», «0». Латинская раскладка тех же клавиш (`d`, `y`, `g`) понимается так же. Пустой ответ не засчитывается.
- Список на правку — `data/review/fixes.md`. Разделы дословно: «Разборы заданий», «Правила и вопросы», «Спорные ключи — вернуть с ключом ФИПИ», «Сообщения учеников». Строка: `` - `ID` текст (ДД.ММ.ГГГГ) ``. ID правила — `rule:<id>`, вопроса к правилу — `check:<id>`.
- `keyDecision` в разборе — `"hidden"` или `"restore"`.
- Путь к `gh` подменяется переменной `REVIEW_GH` (команда, разбирается `shlex.split`).
- Правила проекта: `sources/` не трогать; `data/questions.json` и `data/raw/*` пишут только скрипты; каждое заметное изменение — запись в `CHANGELOG.md`.
- Коммит заканчивается строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Файлы

- Create `scripts/console_ui.py` — Терминал.
- Create `scripts/review_queue.py` — очереди, решения, `fixes.md`, `gh`, пересборка.
- Create `scripts/review_console.py` — экраны и разделы кнопки.
- Create `Проверка.command` — кнопка (исполняемый файл).
- Modify `scripts/add_explanations.py:22` — в `FIELDS` добавить `keyDecision`.
- Modify `data/authored/task-18.json`, `task-23.json`, `task-24.json` — `keyDecision: "hidden"` у трёх спорных заданий.
- Create `test/test_console_ui.py`, `test/test_review_queue.py`, `test/test_review_console.py`.
- Modify `CLAUDE.md`, `README.md`, `CHANGELOG.md`, `docs/superpowers/specs/2026-09-27-review-console-design.md`.

---

### Task 1: Терминал — `console_ui.py`

**Files:**
- Create: `scripts/console_ui.py`
- Test: `test/test_console_ui.py`

**Interfaces:**
- Produces:
  - константы `RULE: str`;
  - `columns(text) -> int`, `clip(text, width) -> str`, `pad(text, width) -> str`, `line(text="") -> None`, `clean(text) -> str`;
  - `parse_page(answer, count) -> dict` — одно из `{"all": True}`, `{"skip": True}`, `{"exit": True}`, `{"error": "empty"|"number"}`, `{"wrong": [int, …]}`;
  - `parse_choice(answer, allowed: set[str]) -> str | None`;
  - `pages(items, size, key) -> list[list]`;
  - `menu(ask, title, items: list[tuple[str, str]], question, footer=()) -> int | "enter" | None`;
  - класс `Asker(stream=None)`, вызов `ask(prompt) -> str | None` (`None` — ввод кончился).

- [ ] **Step 1: Write the failing test**

`test/test_console_ui.py`:

```python
import contextlib
import io
import unittest

from test import helpers  # noqa: F401 — кладёт scripts/ в sys.path

import console_ui as ui


class WidthTest(unittest.TestCase):
    def test_han_takes_two_cells(self):
        self.assertEqual(ui.columns("你好a"), 5)
        self.assertEqual(ui.columns("，。"), 4)

    def test_clip_does_not_split_han(self):
        self.assertEqual(ui.clip("你好世界", 5), "你好…")
        self.assertEqual(ui.clip("abc", 5), "abc")

    def test_pad_counts_cells(self):
        self.assertEqual(ui.pad("你", 4), "你  ")


class CleanTest(unittest.TestCase):
    def test_control_characters_removed_newlines_kept(self):
        self.assertEqual(ui.clean("a\x1b[31mb\tc\r\nd\x07\x9b"), "a[31mb    c\nd")


class AnswerTest(unittest.TestCase):
    def test_page_answers(self):
        self.assertEqual(ui.parse_page("в", 4), {"all": True})
        self.assertEqual(ui.parse_page("D", 4), {"all": True}, "латинская раскладка")
        self.assertEqual(ui.parse_page("п", 4), {"skip": True})
        self.assertEqual(ui.parse_page("g", 4), {"skip": True})
        self.assertEqual(ui.parse_page("0", 4), {"exit": True})
        self.assertEqual(ui.parse_page("  ", 4), {"error": "empty"})
        self.assertEqual(ui.parse_page(None, 4), {"error": "empty"})
        self.assertEqual(ui.parse_page("3 1,3", 4), {"wrong": [1, 3]})
        self.assertEqual(ui.parse_page("5", 4), {"error": "number"})
        self.assertEqual(ui.parse_page("1 x", 4), {"error": "number"})

    def test_choice(self):
        self.assertEqual(ui.parse_choice("Н", {"в", "н"}), "н")
        self.assertEqual(ui.parse_choice("y", {"в", "н"}), "н")
        self.assertIsNone(ui.parse_choice("", {"в"}))
        self.assertIsNone(ui.parse_choice("7", {"1", "2"}))


class PagesTest(unittest.TestCase):
    def test_pages_do_not_mix_keys(self):
        items = [(20, "a"), (20, "b"), (20, "c"), (21, "d")]
        self.assertEqual(ui.pages(items, 2, key=lambda x: x[0]),
                         [[(20, "a"), (20, "b")], [(20, "c")], [(21, "d")]])
        self.assertEqual(ui.pages([], 4, key=lambda x: x), [])


class AskerTest(unittest.TestCase):
    def test_lines_then_none(self):
        ask = ui.Asker(io.StringIO("  в \n1 2\n"))
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(ask("? "), "в")
            self.assertEqual(ask("? "), "1 2")
            self.assertIsNone(ask("? "))


class MenuTest(unittest.TestCase):
    def run_menu(self, answers):
        ask = ui.Asker(io.StringIO("".join(a + "\n" for a in answers)))
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            result = ui.menu(ask, "Заголовок", [("Разборы", "ждут 2"), ("Правила", "ждут 0")], "Номер:",
                             footer=["Подвал"])
        return result, out.getvalue()

    def test_number_enter_zero_and_retry(self):
        self.assertEqual(self.run_menu(["2"])[0], 1)
        self.assertEqual(self.run_menu([""])[0], "enter")
        self.assertIsNone(self.run_menu(["0"])[0])
        self.assertIsNone(self.run_menu([])[0], "ввод кончился")
        result, out = self.run_menu(["9", "1"])
        self.assertEqual(result, 0)
        self.assertIn("Не понял ответ", out)
        self.assertIn("Подвал", out)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest test.test_console_ui -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'console_ui'`

- [ ] **Step 3: Write the implementation**

`scripts/console_ui.py`:

```python
"""Терминал для кнопки «Проверка»: ввод, ширина иероглифа, меню, чужой текст.

Приёмы — из кнопок учителя проекта slide-builder (scripts/teacher/терминал.js).
"""

import re
import shutil
import sys

WIDTH = 120
RULE = "─" * 42

# Иероглиф и полноширинная пунктуация занимают в Терминале две клетки (East Asian Wide и
# Fullwidth). Без этого столбцы после китайского слова разъезжаются.
WIDE = ((0x1100, 0x115F), (0x2E80, 0x303E), (0x3041, 0x33FF), (0x3400, 0x4DBF), (0x4E00, 0x9FFF),
        (0xA000, 0xA4CF), (0xAC00, 0xD7A3), (0xF900, 0xFAFF), (0xFE30, 0xFE4F), (0xFF00, 0xFF60),
        (0xFFE0, 0xFFE6), (0x20000, 0x3FFFD))

# Управляющие символы (C0 кроме перевода строки, DEL, C1): чужой текст — сообщение ученика —
# мог бы ими командовать Терминалом.
CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f-\x9f]")

# Ответ, набранный в латинской раскладке: те же клавиши, что «в», «н», «п».
LAYOUT = {"d": "в", "y": "н", "g": "п"}


def cells(ch):
    code = ord(ch)
    return 2 if any(a <= code <= b for a, b in WIDE) else 1


def columns(text):
    return sum(cells(ch) for ch in str(text))


def clip(text, width):
    """Режет по клеткам и иероглиф пополам не режет: не влезает — уходит целиком, вместо него «…»."""
    text = str(text)
    if columns(text) <= width:
        return text
    out, used = "", 0
    for ch in text:
        if used + cells(ch) > width - 1:
            break
        out += ch
        used += cells(ch)
    return out + "…"


def pad(text, width):
    text = str(text)
    return text + " " * max(0, width - columns(text))


def window_width():
    return shutil.get_terminal_size((WIDTH, 50)).columns


def line(text=""):
    """Служебная строка — по ширине окна. Условие и разбор печатаются целиком, через print."""
    print(clip(text, window_width()))


def clean(text):
    """Чужой текст без управляющих символов; переводы строк остаются, табуляция — пробелы."""
    return CONTROL.sub("", str(text).replace("\r\n", "\n").replace("\t", "    "))


def _normal(answer):
    text = (answer or "").strip().lower()
    return LAYOUT.get(text, text)


def parse_page(answer, count):
    """Ответ на страницу. Пустой не засчитывается: случайный двойной Enter одобрил бы страницу,
    которую автор не видел."""
    text = _normal(answer)
    if text == "в":
        return {"all": True}
    if text == "п":
        return {"skip": True}
    if text == "0":
        return {"exit": True}
    if not text:
        return {"error": "empty"}
    parts = [p for p in re.split(r"[\s,]+", text) if p]
    if not all(p.isdigit() and 1 <= int(p) <= count for p in parts):
        return {"error": "number"}
    return {"wrong": sorted({int(p) for p in parts})}


def parse_choice(answer, allowed):
    text = _normal(answer)
    return text if text in allowed else None


def pages(items, size, key):
    """Страницы до size пунктов; пункты с разным key на одну страницу не попадают.
    items уже упорядочены по key."""
    out = []
    for item in items:
        if out and len(out[-1]) < size and key(out[-1][0]) == key(item):
            out[-1].append(item)
        else:
            out.append([item])
    return out


def menu(ask, title, items, question, footer=()):
    """items — [(метка, состояние)]. Номер пункта с нуля, "enter" или None (0 или конец ввода).
    Промах переспрашивается: нельзя уйти уверенным, что выбрал."""
    print("\n" + RULE)
    print("  " + title)
    print(RULE)
    width = max((columns(label) for label, _ in items), default=0)
    for i, (label, state) in enumerate(items, 1):
        line(f"  {i:>2}) {pad(label, width)}   {state}")
    line("   0) закончить")
    if footer:
        print()
        for text in footer:
            line("  " + text)
    while True:
        answer = ask("\n" + question + " ")
        if answer is None or answer.strip() == "0":
            return None
        text = answer.strip()
        if not text:
            return "enter"
        if text.isdigit() and 1 <= int(text) <= len(items):
            return int(text) - 1
        print(f"  Не понял ответ. Номер от 1 до {len(items)}, 0 — закончить.")


class Asker:
    """Вопрос и ответ строкой. Ввод из канала (так гоняются проверки) приходит пачкой:
    readline берёт по строке и ничего не теряет. Конец ввода — None."""

    def __init__(self, stream=None):
        self.stream = stream or sys.stdin

    def __call__(self, prompt):
        sys.stdout.write(prompt)
        sys.stdout.flush()
        answer = self.stream.readline()
        if not answer:
            print()
            return None
        return answer.strip()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest test.test_console_ui -v`
Expected: PASS, 9 тестов.

- [ ] **Step 5: Commit**

```bash
git add scripts/console_ui.py test/test_console_ui.py
git commit -m "Проверка: Терминал — ширина иероглифа, ответы, меню, чужой текст

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Очереди и решения — `review_queue.py`

**Files:**
- Create: `scripts/review_queue.py`
- Test: `test/test_review_queue.py`

**Interfaces:**
- Consumes: `build_bank.load_records()`, `build_bank.load_authored()`, `build_bank.merge(records, authored, topics, rules) -> (questions, pending)`, `build_bank.build()`, `build_bank.BuildError`, `validate.check_all(questions, topics, rules, rule_checks) -> list[str]`, `common.read_json/write_json`, пути из `common`.
- Produces:
  - константы `FIXES: Path`, `SECTIONS: dict`;
  - `read_fixes(path=FIXES) -> str`, `pending_ids(text) -> set[str]`, `pending_issues(text) -> set[int]`, `add_fix(section, item_id, text, path=FIXES, when=None) -> None`;
  - `load_state() -> dict` с ключами `topics, rules, checks, records, authored, questions, pending, fixes`. Может выбросить `BuildError`;
  - `task_queue(questions, pending, authored, fixes_text) -> (list[dict], list[tuple[str, list[str]]])`;
  - `rule_queue(rules, checks, fixes_text) -> list[{"rule": dict, "draft": bool, "checks": list[dict]}]`;
  - `conflict_queue(questions, authored) -> list[dict]`, `decided_conflicts(authored) -> int`, `decide_conflict(qid, decision, authored_dir=AUTHORED) -> bool`;
  - `repo_slug(url=ISSUES_URL) -> str`, `run_gh(args) -> (bool, str, str)`;
  - `list_reports() -> (list[dict] | None, str)`, `close_report(number, comment) -> (bool, str)`;
  - `report_item_id(title) -> str | None`, `student_text(body) -> str`, `find_item(item_id, questions, checks) -> (kind|None, item|None)`;
  - `rebuild() -> list[str]` — ошибки; пустой список — всё в порядке.

- [ ] **Step 1: Write the failing test**

`test/test_review_queue.py`:

```python
import json
import os
import shlex
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path
from unittest import mock

from test.helpers import TOPICS, authored_for, record, rule

import build_bank as bb
import review_queue as rq


def check(check_id="check-a", rule_id="aspect-suffixes", status="draft"):
    return {"id": check_id, "kind": "identify-rule", "ruleIds": [rule_id], "status": status,
            "prompt": "Какой суффикс?", "sentence": "他去___北京。",
            "options": [{"id": "a", "text": "了"}, {"id": "b", "text": "过"}], "correctOptionId": "a",
            "explanation": {"correct": "Разбор верного варианта достаточной длины.",
                            "options": {"b": "Разбор неверного варианта достаточной длины."}}}


class FixesTest(unittest.TestCase):
    def test_sections_and_entries(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "fixes.md"
            rq.add_fix("tasks", "q20-a", "№20 · 他___去。 — ключ", path=path, when="27.09.2026")
            rq.add_fix("rules", "rule:aspect", "Суффиксы", path=path, when="27.09.2026")
            rq.add_fix("tasks", "q20-b", "№20 · 我___来。", path=path, when="27.09.2026")
            text = path.read_text(encoding="utf-8")
        self.assertTrue(text.startswith("# На правку\n"))
        self.assertIn("## Разборы заданий\n- `q20-a` №20 · 他___去。 — ключ (27.09.2026)\n"
                      "- `q20-b` №20 · 我___来。 (27.09.2026)\n\n## Правила и вопросы\n", text)
        self.assertEqual(rq.pending_ids(text), {"q20-a", "q20-b", "rule:aspect"})

    def test_pending_issues(self):
        text = "## Сообщения учеников\n- `q22-a` issue #12 — ученик прав (27.09.2026)\n"
        self.assertEqual(rq.pending_issues(text), {12})

    def test_missing_file_reads_empty(self):
        self.assertEqual(rq.read_fixes(Path(tempfile.gettempdir()) / "нет-такого-файла.md"), "")


class TaskQueueTest(unittest.TestCase):
    def merge(self, records, authored, rules=None):
        return bb.merge(records, authored, TOPICS, rules if rules is not None else [rule()])

    def test_ready_not_ready_and_waiting(self):
        ready_rec = record(qid="q20-aaaaaaaa")
        broken_rec = record(qid="q20-bbbbbbbb", stem="我___来。")
        waiting_rec = record(qid="q20-cccccccc", stem="他___去。")
        accepted_rec = record(qid="q20-dddddddd", stem="你___吃。")
        broken = authored_for(broken_rec, status="draft")
        broken["explanation"]["options"].pop("1")
        authored = {
            ready_rec["id"]: authored_for(ready_rec, status="draft"),
            broken_rec["id"]: broken,
            waiting_rec["id"]: authored_for(waiting_rec, status="draft"),
            accepted_rec["id"]: authored_for(accepted_rec),
        }
        questions, pending = self.merge([ready_rec, broken_rec, waiting_rec, accepted_rec], authored)
        ready, not_ready = rq.task_queue(questions, pending, authored, "- `q20-cccccccc` № (27.09.2026)\n")
        self.assertEqual([q["id"] for q in ready], ["q20-aaaaaaaa"])
        self.assertEqual([qid for qid, _ in not_ready], ["q20-bbbbbbbb"])
        self.assertTrue(not_ready[0][1])

    def test_draft_rule_does_not_block_review(self):
        rec = record()
        authored = {rec["id"]: authored_for(rec, status="draft")}
        questions, pending = self.merge([rec], authored, rules=[rule(status="draft")])
        ready, not_ready = rq.task_queue(questions, pending, authored, "")
        self.assertEqual([q["id"] for q in ready], [rec["id"]])
        self.assertEqual(not_ready, [])


class RuleQueueTest(unittest.TestCase):
    def test_groups(self):
        rules = [rule("aspect-suffixes", status="draft"), rule("jiu-cai"), rule("other")]
        checks = [check("c1"), check("c2", "jiu-cai"), check("c3", "jiu-cai", status="accepted"),
                  check("c4", "jiu-cai")]
        groups = rq.rule_queue(rules, checks, "- `check:c4` x (27.09.2026)\n")
        self.assertEqual([(g["rule"]["id"], g["draft"], [c["id"] for c in g["checks"]]) for g in groups],
                         [("aspect-suffixes", True, ["c1"]), ("jiu-cai", False, ["c2"])])
        self.assertEqual(rq.rule_queue(rules, checks, "- `rule:aspect-suffixes` x\n- `check:c1` x\n")[0]["rule"]["id"],
                         "jiu-cai")


class ConflictTest(unittest.TestCase):
    def test_queue_and_decision(self):
        rec = record(qid="q23-aaaaaaaa")
        entry = authored_for(rec)
        entry["keyConflict"] = "好 тоже естественно."
        authored = {rec["id"]: entry}
        questions, _ = bb.merge([rec], authored, TOPICS, [rule()])
        self.assertEqual([q["id"] for q in rq.conflict_queue(questions, authored)], [rec["id"]])
        self.assertEqual(rq.decided_conflicts(authored), 0)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "task-23.json"
            stored = {k: v for k, v in entry.items() if k != "_file"}
            path.write_text(json.dumps({rec["id"]: stored}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            self.assertTrue(rq.decide_conflict(rec["id"], "hidden", authored_dir=tmp))
            saved = json.loads(path.read_text(encoding="utf-8"))[rec["id"]]
            self.assertFalse(rq.decide_conflict("q23-ffffffff", "hidden", authored_dir=tmp))
        self.assertEqual(saved["keyDecision"], "hidden")
        self.assertEqual(saved["keyConflict"], entry["keyConflict"], "остальные поля не тронуты")
        authored[rec["id"]]["keyDecision"] = "hidden"
        self.assertEqual(rq.conflict_queue(questions, authored), [])
        self.assertEqual(rq.decided_conflicts(authored), 1)
        with self.assertRaises(ValueError):
            rq.decide_conflict(rec["id"], "maybe")


FAKE_GH = textwrap.dedent("""
    import json, sys
    if sys.argv[1:3] == ["issue", "list"]:
        print(json.dumps([
            {"number": 7, "title": "Ошибка: задание 22 · q22-a", "body": "ID…\\nЧто не так:\\nКлюч не тот", "createdAt": "2026-09-27T10:00:00Z"},
            {"number": 9, "title": "Вопрос про сайт", "body": "", "createdAt": "2026-09-27T11:00:00Z"},
        ], ensure_ascii=False))
    elif sys.argv[1:3] == ["issue", "close"]:
        sys.exit(0 if sys.argv[3] == "7" else 1)
""")


class ReportsTest(unittest.TestCase):
    def test_title_body_and_items(self):
        self.assertEqual(rq.report_item_id("Ошибка: задание 22 · q22-a"), "q22-a")
        self.assertEqual(rq.report_item_id("Ошибка: вопрос к правилу · check-x"), "check-x")
        self.assertIsNone(rq.report_item_id("Вопрос про сайт"))
        self.assertEqual(rq.student_text("ID\nЧто не так:\n  Ключ не тот  "), "Ключ не тот")
        self.assertEqual(rq.student_text("просто текст"), "просто текст")
        self.assertEqual(rq.repo_slug("https://github.com/owner/repo/issues/new"), "owner/repo")
        q, c = {"id": "q22-a"}, {"id": "check-x"}
        self.assertEqual(rq.find_item("q22-a", [q], [c]), ("task", q))
        self.assertEqual(rq.find_item("check-x", [q], [c]), ("check", c))
        self.assertEqual(rq.find_item("gone", [q], [c]), (None, None))
        self.assertEqual(rq.find_item(None, [q], [c]), (None, None))

    def test_gh_list_and_close(self):
        with tempfile.TemporaryDirectory() as tmp:
            fake = Path(tmp) / "gh.py"
            fake.write_text(FAKE_GH, encoding="utf-8")
            command = f"{shlex.quote(sys.executable)} {shlex.quote(str(fake))}"
            with mock.patch.dict(os.environ, {"REVIEW_GH": command}):
                issues, error = rq.list_reports()
                self.assertEqual(error, "")
                self.assertEqual([i["number"] for i in issues], [7], "только «Ошибка: …»")
                self.assertEqual(rq.close_report(7, "Ключ верный."), (True, ""))
                ok, error = rq.close_report(8, "…")
                self.assertFalse(ok)
                self.assertIn("gh не смог", error)

    def test_gh_missing(self):
        with mock.patch.dict(os.environ, {"REVIEW_GH": "/нет/такого/gh"}):
            issues, error = rq.list_reports()
        self.assertIsNone(issues)
        self.assertIn("brew install gh", error)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest test.test_review_queue -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'review_queue'`

- [ ] **Step 3: Write the implementation**

`scripts/review_queue.py`:

```python
"""Что ждёт решения автора и запись его решений — для кнопки «Проверка».

Без ввода-вывода: экраны — в review_console.py. Замысел —
docs/superpowers/specs/2026-09-27-review-console-design.md
"""

import datetime
import json
import os
import re
import shlex
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_bank  # noqa: E402
import validate  # noqa: E402
from common import (AUTHORED, ISSUES_URL, QUESTIONS, REVIEW, RULE_CHECKS, RULES, TOPICS,  # noqa: E402
                    read_json, write_json)

FIXES = REVIEW / "fixes.md"
FIXES_HEADER = ("# На правку\n\n"
                "Что автор отметил в «Проверке». Claude исправляет, пункт уходит на проверку заново,\n"
                "строка удаляется.\n")
SECTIONS = {
    "tasks": "Разборы заданий",
    "rules": "Правила и вопросы",
    "conflicts": "Спорные ключи — вернуть с ключом ФИПИ",
    "reports": "Сообщения учеников",
}
NOT_ACCEPTED = "разбор не принят автором"
RULE_NOT_ACCEPTED = re.compile(r"^правило \S+ не принято$")
PENDING = re.compile(r"^- `([^`]+)`", re.M)
ISSUE = re.compile(r"issue #(\d+)")
REPORT_TITLE = re.compile(r"^Ошибка: .* · (\S+)$")
DECISIONS = ("hidden", "restore")


# ---------- список на правку ----------

def read_fixes(path=FIXES):
    try:
        return Path(path).read_text(encoding="utf-8")
    except FileNotFoundError:
        return ""


def pending_ids(text):
    """ID пунктов, которые стоят в списке на правку: их не спрашивают, пока Claude не исправит."""
    return set(PENDING.findall(text))


def pending_issues(text):
    return {int(n) for n in ISSUE.findall(text)}


def add_fix(section, item_id, text, path=FIXES, when=None):
    """Строка в конец своего раздела; раздела нет — он дописывается в конец файла."""
    path = Path(path)
    content = read_fixes(path) or FIXES_HEADER
    heading = f"## {SECTIONS[section]}\n"
    if heading not in content:
        content = content.rstrip("\n") + "\n\n" + heading
    entry = f"- `{item_id}` {text} ({when or datetime.date.today().strftime('%d.%m.%Y')})\n"
    start = content.index(heading) + len(heading)
    following = content.find("\n## ", start)
    if following == -1:
        content = content.rstrip("\n") + "\n" + entry
    else:
        content = content[:following].rstrip("\n") + "\n" + entry + content[following:]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


# ---------- очереди ----------

def load_state():
    """Всё, из чего строятся очереди, — свежим с диска. Несобираемые данные — BuildError."""
    topics = read_json(TOPICS)
    rules = read_json(RULES)
    records = build_bank.load_records()
    authored = build_bank.load_authored()
    questions, pending = build_bank.merge(records, authored, topics, rules)
    return {"topics": topics, "rules": rules, "checks": read_json(RULE_CHECKS), "records": records,
            "authored": authored, "questions": questions, "pending": pending, "fixes": read_fixes()}


def task_queue(questions, pending, authored, fixes_text):
    """(готовые к решению автора, не готовые — [(ID, причины)]).

    Готово: черновой разбор, из причин «не готово» — только непринятый разбор и непринятое
    правило (задание примется, а на сайт выйдет вместе с правилом). Пункты из списка на правку
    не спрашиваются."""
    waiting = pending_ids(fixes_text)
    ready, not_ready = [], []
    for q in questions:
        entry = authored.get(q["id"])
        if q["reviewStatus"] != "draft" or not entry or entry.get("status") != "draft" or q["id"] in waiting:
            continue
        other = [r for r in pending.get(q["id"], []) if r != NOT_ACCEPTED and not RULE_NOT_ACCEPTED.match(r)]
        if other:
            not_ready.append((q["id"], other))
        else:
            ready.append(q)
    return ready, not_ready


def rule_queue(rules, checks, fixes_text):
    """По правилам: черновое правило (draft) и черновые вопросы к нему. Вопрос относится
    к первому правилу из своих ruleIds."""
    waiting = pending_ids(fixes_text)
    draft_checks = [c for c in checks if c.get("status") == "draft" and f"check:{c['id']}" not in waiting]
    groups = []
    for rule in rules:
        rule_draft = rule.get("status") == "draft" and f"rule:{rule['id']}" not in waiting
        own = [c for c in draft_checks if c.get("ruleIds") and c["ruleIds"][0] == rule["id"]]
        if rule_draft or own:
            groups.append({"rule": rule, "draft": rule_draft, "checks": own})
    return groups


def conflict_queue(questions, authored):
    """Спорные ключи автора (keyConflict в разборе) без его решения."""
    return [q for q in questions
            if q["reviewStatus"] == "conflict" and authored.get(q["id"], {}).get("keyConflict")
            and not authored[q["id"]].get("keyDecision")]


def decided_conflicts(authored):
    return sum(1 for e in authored.values() if e.get("keyConflict") and e.get("keyDecision"))


def decide_conflict(qid, decision, authored_dir=AUTHORED):
    """keyDecision в разборе: hidden — оставить скрытым, restore — вернуть с ключом ФИПИ."""
    if decision not in DECISIONS:
        raise ValueError(f"неизвестное решение {decision!r}")
    for path in sorted(Path(authored_dir).glob("task-*.json")):
        entries = read_json(path)
        if qid in entries:
            entries[qid]["keyDecision"] = decision
            write_json(path, entries)
            return True
    return False


# ---------- сообщения учеников (gh) ----------

def repo_slug(url=ISSUES_URL):
    return re.search(r"github\.com/([^/]+/[^/]+)/issues", url).group(1)


def run_gh(args):
    """(получилось, вывод, ошибка для автора). Путь к gh подменяется переменной REVIEW_GH."""
    command = shlex.split(os.environ.get("REVIEW_GH", "gh"))
    try:
        done = subprocess.run(command + list(args), capture_output=True, text=True, timeout=60)
    except FileNotFoundError:
        return False, "", "Не найден gh. Установить: brew install gh, затем gh auth login."
    except subprocess.TimeoutExpired:
        return False, "", "GitHub не ответил за минуту — проверьте сеть."
    if done.returncode != 0:
        first = (done.stderr or done.stdout or "").strip().splitlines()[:1]
        reason = first[0] if first else f"код {done.returncode}"
        return False, "", f"gh не смог: {reason}. Если ещё не входили — gh auth login."
    return True, done.stdout, ""


def list_reports():
    """Открытые сообщения «Ошибка: …»: ([{number, title, body, createdAt}], "") или (None, ошибка)."""
    ok, out, error = run_gh(["issue", "list", "--repo", repo_slug(), "--state", "open", "--limit", "100",
                             "--json", "number,title,body,createdAt"])
    if not ok:
        return None, error
    try:
        issues = json.loads(out)
    except json.JSONDecodeError:
        return None, "gh ответил не тем — покажите это Claude."
    return [i for i in issues if str(i.get("title", "")).startswith("Ошибка:")], ""


def close_report(number, comment):
    ok, _, error = run_gh(["issue", "close", str(number), "--repo", repo_slug(), "--comment", comment])
    return ok, error


def report_item_id(title):
    """ID из заголовка «Ошибка: задание 22 · q22-…» (так его пишет ссылка на странице)."""
    match = REPORT_TITLE.match(str(title).strip())
    return match.group(1) if match else None


def student_text(body):
    """Что написал ученик: текст после «Что не так:»; нет метки — всё сообщение."""
    body = str(body or "")
    marker = "Что не так:"
    return (body.split(marker, 1)[1] if marker in body else body).strip()


def find_item(item_id, questions, checks):
    for q in questions:
        if q["id"] == item_id:
            return "task", q
    for c in checks:
        if c["id"] == item_id:
            return "check", c
    return None, None


# ---------- после проверки ----------

def rebuild():
    """Пересобрать банк и проверить его: без этого публикация остановится на сверке данных."""
    try:
        build_bank.build()
    except build_bank.BuildError as error:
        return [f"сборка банка остановлена: {error}"]
    return validate.check_all(read_json(QUESTIONS), read_json(TOPICS), read_json(RULES), read_json(RULE_CHECKS))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest test.test_review_queue -v`
Expected: PASS, 10 тестов.

- [ ] **Step 5: Run the whole Python suite**

Run: `python3 -m unittest discover -s test -t .`
Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add scripts/review_queue.py test/test_review_queue.py
git commit -m "Проверка: очереди, решения, список на правку, сообщения учеников через gh

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Решение по трём спорным ключам в данных

**Files:**
- Modify: `scripts/add_explanations.py:22`
- Modify: `data/authored/task-18.json`, `data/authored/task-23.json`, `data/authored/task-24.json` (через `review_queue.decide_conflict`)

**Interfaces:**
- Consumes: `review_queue.decide_conflict(qid, "hidden")`.
- Produces: в данных у `q18-3343db6a`, `q23-ed5be886`, `q24-41d3f9f2` стоит `keyDecision: "hidden"`. Сквозной тест в Task 4 на это опирается.

- [ ] **Step 1: Carry keyDecision through waves**

В `scripts/add_explanations.py` заменить строку 22:

```python
FIELDS = ("topicIds", "ruleIds", "explanation", "contrast", "keyConflict", "keyDecision", "note")
```

- [ ] **Step 2: Record the author's decision of 26.09.2026**

Run:

```bash
python3 -c "
import sys; sys.path.insert(0, 'scripts')
import review_queue as rq
for qid in ('q18-3343db6a', 'q23-ed5be886', 'q24-41d3f9f2'):
    print(qid, rq.decide_conflict(qid, 'hidden'))
"
```

Expected: три строки с `True`.

- [ ] **Step 3: Verify only the decision changed**

Run: `git diff --stat -- data/ && npm run -s data && git status --short -- data/`
Expected: изменены только три файла `data/authored/task-18.json`, `task-23.json`, `task-24.json`, в каждом по две строки (запятая и `"keyDecision": "hidden"`). После `npm run data` других изменений в `data/` нет: `questions.json` поле не несёт, и три задания по-прежнему `conflict`.

- [ ] **Step 4: Run tests**

Run: `python3 -m unittest discover -s test -t .`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add scripts/add_explanations.py data/authored/task-18.json data/authored/task-23.json data/authored/task-24.json
git commit -m "Спорные ключи: решение автора «скрыть» записано полем keyDecision

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Экраны кнопки — `review_console.py`

**Files:**
- Create: `scripts/review_console.py`
- Test: `test/test_review_console.py`

**Interfaces:**
- Consumes: всё из Task 1 (`console_ui as ui`) и Task 2 (`review_queue as rq`), `accept.accept(ids) -> list[str]`, `build_bank.BuildError`, данные из Task 3.
- Produces: `python3 scripts/review_console.py` — диалог по stdin/stdout; код выхода 0.

- [ ] **Step 1: Write the failing end-to-end test**

`test/test_review_console.py`:

```python
"""Кнопка «Проверка» целиком: копия scripts/ и data/, ответы пачкой через канал, поддельный gh."""

import json
import math
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

FAKE_GH = textwrap.dedent("""
    import json, os, sys
    with open(os.environ["FAKE_GH_LOG"], "a", encoding="utf-8") as fh:
        fh.write(json.dumps(sys.argv[1:], ensure_ascii=False) + "\\n")
    if sys.argv[1:3] == ["issue", "list"]:
        print(os.environ["FAKE_GH_ISSUES"])
""")


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


class ReviewConsoleTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        ignore = shutil.ignore_patterns("__pycache__")
        shutil.copytree(ROOT / "scripts", self.tmp / "scripts", ignore=ignore)
        shutil.copytree(ROOT / "data", self.tmp / "data", ignore=ignore)
        data = self.tmp / "data"
        # Копия не зависит от того, что сейчас в репозитории: чужих черновиков, решений и списка
        # на правку в ней нет. Черновой разбор убирается целиком (задание станет «без разбора»),
        # черновой вопрос к правилу — тоже, у спорных ключей — решение «скрыто».
        (data / "review" / "fixes.md").unlink(missing_ok=True)
        for path in sorted((data / "authored").glob("task-*.json")):
            entries = {k: v for k, v in read(path).items() if v.get("status") != "draft"}
            for entry in entries.values():
                if entry.get("keyConflict"):
                    entry["keyDecision"] = "hidden"
            write(path, entries)
        write(data / "rule-checks.json", [c for c in read(data / "rule-checks.json") if c.get("status") != "draft"])
        write(data / "rules.json", [dict(r, status="accepted") for r in read(data / "rules.json")])
        # Пять разборов №20 — снова черновики; правило 了/过/着 и вопросы к нему — тоже.
        task20 = read(data / "authored" / "task-20.json")
        self.drafts = sorted(task20)[:5]
        for qid in self.drafts:
            task20[qid]["status"] = "draft"
        write(data / "authored" / "task-20.json", task20)
        rules = read(data / "rules.json")
        next(r for r in rules if r["id"] == "aspect-suffixes")["status"] = "draft"
        write(data / "rules.json", rules)
        checks = read(data / "rule-checks.json")
        self.checks = [c["id"] for c in checks if c["ruleIds"][0] == "aspect-suffixes"]
        for c in checks:
            if c["id"] in self.checks:
                c["status"] = "draft"
        write(data / "rule-checks.json", checks)
        # Один спорный ключ снова без решения.
        task23 = read(data / "authored" / "task-23.json")
        task23["q23-ed5be886"].pop("keyDecision", None)
        write(data / "authored" / "task-23.json", task23)
        self.other20 = sorted(task20)[10]
        self.log = self.tmp / "gh.log"
        (self.tmp / "gh.py").write_text(FAKE_GH, encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_button(self, answers, issues):
        env = dict(os.environ,
                   REVIEW_GH=f"{shlex.quote(sys.executable)} {shlex.quote(str(self.tmp / 'gh.py'))}",
                   FAKE_GH_LOG=str(self.log), FAKE_GH_ISSUES=json.dumps(issues, ensure_ascii=False),
                   PYTHONIOENCODING="utf-8")
        done = subprocess.run([sys.executable, str(self.tmp / "scripts" / "review_console.py")],
                              input="".join(a + "\n" for a in answers), capture_output=True, text=True,
                              encoding="utf-8", env=env, timeout=120)
        return done

    def test_whole_review(self):
        issues = [
            {"number": 7, "title": "Ошибка: задание 22 · q22-bee8f831",
             "body": "ID: q22-bee8f831\nЧто не так:\nКлюч \x1b[31mневерный\x1b[0m", "createdAt": "2026-09-27T10:00:00Z"},
            {"number": 8, "title": f"Ошибка: задание 20 · {self.other20}", "body": "Что не так:\nопечатка",
             "createdAt": "2026-09-27T11:00:00Z"},
            {"number": 9, "title": "Вопрос про сайт", "body": "", "createdAt": "2026-09-27T12:00:00Z"},
        ]
        check_pages = math.ceil(len(self.checks) / 4)
        answers = ["1", "2", "ключ не тот", "", "в"]                     # разборы: 2-е не так; пустой ответ не засчитан
        answers += ["2", "в"] + ["в"] * check_pages                     # правило и вопросы к нему
        answers += ["3", "2"]                                            # спорный ключ — вернуть с ключом ФИПИ
        answers += ["4", "2", "", "Ключ верный: 才 здесь значит «только».", "1", ""]  # сообщения учеников
        answers += ["0"]
        done = self.run_button(answers, issues)
        out = done.stdout
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn("Пустой ответ не засчитываю", out)
        self.assertIn("Пустой ответ не отправляю", out)
        self.assertNotIn("\x1b", out, "управляющие символы из сообщения ученика убраны")
        self.assertIn("Банк пересобран и проверен", out)
        self.assertIn("Скажите Claude: проверка записана", out)

        data = self.tmp / "data"
        task20 = read(data / "authored" / "task-20.json")
        self.assertEqual([task20[q]["status"] for q in self.drafts],
                         ["accepted", "draft", "accepted", "accepted", "accepted"])
        rules = read(data / "rules.json")
        self.assertEqual(next(r for r in rules if r["id"] == "aspect-suffixes")["status"], "accepted")
        checks = {c["id"]: c for c in read(data / "rule-checks.json")}
        self.assertTrue(all(checks[c]["status"] == "accepted" for c in self.checks))
        self.assertEqual(read(data / "authored" / "task-23.json")["q23-ed5be886"]["keyDecision"], "restore")

        fixes = (data / "review" / "fixes.md").read_text(encoding="utf-8")
        self.assertRegex(fixes, rf"- `{self.drafts[1]}` №20 · .* — ключ не тот \(\d\d\.\d\d\.\d{{4}}\)")
        self.assertIn("## Спорные ключи — вернуть с ключом ФИПИ\n- `q23-ed5be886` №23", fixes)
        self.assertIn(f"- `{self.other20}` issue #8 — ученик прав", fixes)
        self.assertNotIn("issue #7", fixes)

        calls = [json.loads(line) for line in self.log.read_text(encoding="utf-8").splitlines()]
        self.assertIn(["issue", "close", "7", "--repo", "bronik04/ege-lg-trainer",
                       "--comment", "Ключ верный: 才 здесь значит «только»."], calls)

        questions = {q["id"]: q for q in read(data / "questions.json")}
        self.assertEqual(questions[self.drafts[0]]["reviewStatus"], "ready", "банк пересобран")
        self.assertEqual(questions[self.drafts[1]]["reviewStatus"], "draft")

    def test_nothing_to_do_and_no_gh(self):
        env_issues = []
        done = self.run_button(["0"], env_issues)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn("Разборы заданий", done.stdout)
        self.assertIn("ждут 5", done.stdout)
        self.assertIn("Ничего не записано", done.stdout)
        self.assertFalse((self.tmp / "data" / "review" / "fixes.md").exists())

    def test_input_ends_mid_page(self):
        done = self.run_button(["1", "2"], [])
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn("Ввод кончился", done.stdout)
        task20 = read(self.tmp / "data" / "authored" / "task-20.json")
        self.assertTrue(all(task20[q]["status"] == "draft" for q in self.drafts), "страница не записана")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest test.test_review_console -v`
Expected: FAIL — `returncode` 2: `can't open file …/scripts/review_console.py`.

- [ ] **Step 3: Write the implementation**

`scripts/review_console.py`:

```python
#!/usr/bin/env python3
"""Кнопка «Проверка»: автор принимает черновики и решает спорное в Терминале.

    python3 scripts/review_console.py      (двойной клик — «Проверка.command» в корне)

По страницам: разборы заданий, правила и вопросы к ним, спорные ключи ФИПИ, сообщения
учеников. Верное принимается сразу, «не так» уходит в data/review/fixes.md. Содержание кнопка
не пишет, коммитов не делает. Замысел — docs/superpowers/specs/2026-09-27-review-console-design.md
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import accept  # noqa: E402
import console_ui as ui  # noqa: E402
import review_queue as rq  # noqa: E402
from build_bank import BuildError  # noqa: E402

PAGE = 4
ORIGIN = {"fipi": "Банк ФИПИ", "generated": "Новое задание"}
FIXES_NAME = "data/review/fixes.md"
CANCEL_HINT = "(Enter — без пояснения, 0 — отменить выбор)"


class Tally:
    def __init__(self):
        self.accepted = self.fixes = self.conflicts = self.replies = 0

    def wrote_data(self):
        return bool(self.accepted or self.fixes or self.conflicts)


# ---------- как выглядит пункт ----------

def one_line(text):
    return " ".join(str(text).split())


def stem_lines(q):
    """Условие: фрагменты №26 построчно, иначе строки условия как есть."""
    if q.get("fragments"):
        return [f"{f['id']}) {f['text']}" for f in q["fragments"]]
    return [s for s in str(q.get("stem", "")).split("\n") if s.strip()]


def check_lines(c):
    return [s for s in (c.get("prompt"), c.get("sentence")) if s]


def task_header(q):
    return f"№{q['taskNumber']} · {ORIGIN.get(q.get('origin'), q.get('origin'))} · {q['id']}"


def task_brief(q):
    return f"№{q['taskNumber']} · " + one_line(" / ".join(stem_lines(q)))


def check_brief(c):
    return one_line(" · ".join(check_lines(c)))


def task_footer(q, state):
    topics = {t["id"]: t["title"] for t in state["topics"]}
    rules = {r["id"]: r["title"] for r in state["rules"]}
    parts = []
    if q.get("topicIds"):
        parts.append("Тема: " + ", ".join(topics.get(t, t) for t in q["topicIds"]))
    if q.get("ruleIds"):
        parts.append("правило: " + ", ".join(rules.get(r, r) for r in q["ruleIds"]))
    return " · ".join(parts)


def show_item(number, header, lines, item, footer=None, mark="✓"):
    """Номер и признаки, условие, варианты с ключом, разбор каждого варианта. Условие и разбор —
    целиком: обрезанное не проверить."""
    head = f"  {number:>2}. " if number else "  "
    indent = " " * len(head)
    print()
    ui.line(head + header)
    for text in lines:
        print(indent + text)
    print(indent + "   ".join(f"{o['id']}) {o['text']}" + (f" {mark}" if o["id"] == item["correctOptionId"] else "")
                               for o in item["options"]))
    explanation = item.get("explanation") or {}
    wrong = explanation.get("options") or {}
    for o in item["options"]:
        if o["id"] == item["correctOptionId"]:
            print(f"{indent}✓ {o['text']} — {explanation.get('correct', '')}")
    for o in item["options"]:
        if o["id"] != item["correctOptionId"]:
            print(f"{indent}✗ {o['id']} {o['text']} — {wrong.get(o['id'], 'разбора нет')}")
    if footer:
        ui.line(indent + footer)


def show_rule(rule):
    print("\n" + ui.RULE)
    ui.line(f"  Правило · {rule['title']} · {rule['id']}")
    print(f"\n  Суть: {rule.get('summary', '')}")
    if rule.get("usage"):
        print("  Как применять:")
        for text in rule["usage"]:
            print(f"    • {text}")
    if rule.get("examples"):
        print("  Примеры:")
        for e in rule["examples"]:
            print(f"    {e['zh']} — {e['ru']}")
    contrast = rule.get("contrast") or {}
    if contrast.get("pair"):
        print("  Сравните:")
        for e in contrast["pair"]:
            print(f"    {e['zh']} — {e['ru']}")
        if contrast.get("note"):
            print(f"    {contrast['note']}")
    if rule.get("mistake"):
        print(f"  Типичная ошибка: {rule['mistake']}")


def page_hint():
    print("\n  в — все верны · номера через пробел — какие не так (остальные верны)")
    print("  п — пропустить страницу · 0 — в меню")


# ---------- ответы ----------

def ask_page(ask, items, brief):
    """("end" | "exit" | "skip", None) или ("done", [(пункт, не так?, пояснение)]).

    Пояснения спрашиваются до записи: кончится ввод посреди — страница не записана. Перед
    вопросом пункт печатается ещё раз — промахнулись номером, «0», и страница спрашивается заново."""
    while True:
        answer = ask("\n  Ваш ответ: ")
        if answer is None:
            return "end", None
        parsed = ui.parse_page(answer, len(items))
        if parsed.get("error") == "empty":
            print("  Пустой ответ не засчитываю: «в» — если все верны, номера — если нет.")
            continue
        if parsed.get("error"):
            print(f"  Не понял ответ. «в», «п», «0» или номера от 1 до {len(items)}.")
            continue
        if parsed.get("exit"):
            return "exit", None
        if parsed.get("skip"):
            return "skip", None
        wrong = parsed.get("wrong", [])
        notes, cancelled = {}, False
        for n in wrong:
            print("\n  " + brief(items[n - 1]))
            note = ask(f"  Что не так {CANCEL_HINT}: ")
            if note is None:
                return "end", None
            if note.strip() == "0":
                cancelled = True
                break
            notes[n] = note.strip()
        if cancelled:
            print("\n  Выбор отменён, страница не записана — ответьте на неё заново.")
            continue
        return "done", [(item, n in notes, notes.get(n, "")) for n, item in enumerate(items, 1)]


def ask_choice(ask, allowed, hint):
    while True:
        answer = ask("\n  Ваш ответ: ")
        if answer is None:
            return None
        choice = ui.parse_choice(answer, allowed)
        if choice:
            return choice
        print(f"  Не понял ответ. {hint}")


def record_page(marks, tally, section, accept_id, fix_id, brief):
    good = [accept_id(item) for item, wrong, _ in marks if not wrong]
    accepted = accept.accept(good) if good else []
    fixes = 0
    for item, wrong, note in marks:
        if wrong:
            rq.add_fix(section, fix_id(item), brief(item) + (f" — {note}" if note else ""))
            fixes += 1
    tally.accepted += len(accepted)
    tally.fixes += fixes
    print(f"\n  Записано: принято {len(accepted)}" + (f" · на правку {fixes} — в {FIXES_NAME}" if fixes else ""))


def load():
    try:
        return rq.load_state()
    except BuildError as error:
        print(f"\n  Данные не собираются: {error}")
        print("  Кнопка ничего не записала — покажите это Claude.")
        return None


# ---------- разделы ----------

def review_tasks(ask, tally):
    state = load()
    if state is None:
        return "menu"
    ready, _ = rq.task_queue(state["questions"], state["pending"], state["authored"], state["fixes"])
    if not ready:
        print("\n  Разборов на проверку нет.")
        return "menu"
    pages = ui.pages(ready, PAGE, key=lambda q: q["taskNumber"])
    for i, page in enumerate(pages):
        print("\n" + ui.RULE)
        ui.line(f"  Разборы заданий · страница {i + 1} из {len(pages)} · осталось {sum(len(p) for p in pages[i:])}")
        for n, q in enumerate(page, 1):
            show_item(n, task_header(q), stem_lines(q), q, task_footer(q, state))
        page_hint()
        result, marks = ask_page(ask, page, task_brief)
        if result == "end":
            return "end"
        if result == "exit":
            return "menu"
        if result == "done":
            record_page(marks, tally, "tasks", lambda q: q["id"], lambda q: q["id"], task_brief)
    print("\n  Разборы кончились.")
    return "menu"


def review_rules(ask, tally):
    state = load()
    if state is None:
        return "menu"
    groups = rq.rule_queue(state["rules"], state["checks"], state["fixes"])
    if not groups:
        print("\n  Правил и вопросов на проверку нет.")
        return "menu"
    for group in groups:
        rule = group["rule"]
        if group["draft"]:
            show_rule(rule)
            print("\n  в — принять · н — не так · п — пропустить · 0 — в меню")
            while True:
                choice = ask_choice(ask, {"в", "н", "п", "0"}, "«в», «н», «п» или «0».")
                if choice is None:
                    return "end"
                note = ""
                if choice == "н":
                    note = ask(f"  Что не так {CANCEL_HINT}: ")
                    if note is None:
                        return "end"
                    if note.strip() == "0":
                        print("  Выбор отменён — ответьте заново.")
                        continue
                break
            if choice == "0":
                return "menu"
            if choice == "в":
                tally.accepted += len(accept.accept([rule["id"]]))
                print("\n  Правило принято.")
            if choice == "н":
                rq.add_fix("rules", f"rule:{rule['id']}", rule["title"] + (f" — {note.strip()}" if note.strip() else ""))
                tally.fixes += 1
                print(f"\n  На правку — в {FIXES_NAME}.")
        pages = ui.pages(group["checks"], PAGE, key=lambda c: 0)
        for i, page in enumerate(pages):
            print("\n" + ui.RULE)
            ui.line(f"  Вопросы к правилу «{rule['title']}» · страница {i + 1} из {len(pages)}")
            for n, c in enumerate(page, 1):
                show_item(n, f"Вопрос к правилу · {c['id']}", check_lines(c), c)
            page_hint()
            result, marks = ask_page(ask, page, check_brief)
            if result == "end":
                return "end"
            if result == "exit":
                return "menu"
            if result == "done":
                record_page(marks, tally, "rules", lambda c: c["id"], lambda c: f"check:{c['id']}", check_brief)
    print("\n  Правила и вопросы кончились.")
    return "menu"


def review_conflicts(ask, tally):
    state = load()
    if state is None:
        return "menu"
    queue = rq.conflict_queue(state["questions"], state["authored"])
    if not queue:
        print("\n  Спорных ключей без решения нет.")
        return "menu"
    for i, q in enumerate(queue, 1):
        print("\n" + ui.RULE)
        ui.line(f"  Спорные ключи · {i} из {len(queue)}")
        show_item(0, task_header(q), stem_lines(q), q, mark="✓ по ключу")
        print(f"\n  Спорно: {q.get('conflict', '')}")
        print("\n  1) оставить скрытым   2) вернуть с ключом ФИПИ   3) пропустить   0) в меню")
        choice = ask_choice(ask, {"1", "2", "3", "0"}, "1, 2, 3 или 0.")
        if choice is None:
            return "end"
        if choice == "0":
            return "menu"
        if choice == "1":
            rq.decide_conflict(q["id"], "hidden")
            tally.conflicts += 1
            print("\n  Оставлено скрытым.")
        if choice == "2":
            rq.decide_conflict(q["id"], "restore")
            rq.add_fix("conflicts", q["id"], task_brief(q))
            tally.conflicts += 1
            tally.fixes += 1
            print(f"\n  Вернуть с ключом ФИПИ: разбор перепишет Claude (строка в {FIXES_NAME}).")
    print("\n  Спорные ключи кончились.")
    return "menu"


def show_report(issue, state):
    title = ui.clean(issue.get("title", ""))
    item_id = rq.report_item_id(title)
    kind, item = rq.find_item(item_id, state["questions"], state["checks"])
    ui.line(f"  {title}")
    if kind == "task":
        show_item(0, task_header(item), stem_lines(item), item, task_footer(item, state))
    elif kind == "check":
        show_item(0, f"Вопрос к правилу · {item['id']}", check_lines(item), item)
    else:
        print(f"\n  {item_id or 'ID в заголовке нет'} — такого пункта в банке нет.")
    print("\n  Ученик пишет:")
    for text in ui.clean(rq.student_text(issue.get("body"))).splitlines() or ["(пусто)"]:
        print("    " + text)
    fix_id = item["id"] if kind == "task" else f"check:{item['id']}" if kind == "check" else f"issue:{issue['number']}"
    return fix_id


def review_reports(ask, tally):
    issues, error = rq.list_reports()
    if issues is None:
        print("\n  " + error)
        return "menu"
    state = load()
    if state is None:
        return "menu"
    waiting = rq.pending_issues(state["fixes"])
    queue = [i for i in issues if i["number"] not in waiting]
    if not queue:
        print("\n  Новых сообщений учеников нет.")
        return "menu"
    for k, issue in enumerate(queue, 1):
        number = issue["number"]
        print("\n" + ui.RULE)
        ui.line(f"  Сообщения учеников · {k} из {len(queue)} · #{number} · {str(issue.get('createdAt', ''))[:10]}")
        fix_id = show_report(issue, state)
        print("\n  1) ученик прав — на правку   2) не прав — закрыть с ответом   3) пропустить   0) в меню")
        while True:
            choice = ask_choice(ask, {"1", "2", "3", "0"}, "1, 2, 3 или 0.")
            if choice is None:
                return "end"
            if choice == "1":
                note = ask("  Что исправить (Enter — как пишет ученик, 0 — отменить выбор): ")
                if note is None:
                    return "end"
                if note.strip() == "0":
                    print("  Выбор отменён — ответьте заново.")
                    continue
                rq.add_fix("reports", fix_id, f"issue #{number} — ученик прав" + (f": {note.strip()}" if note.strip() else ""))
                tally.fixes += 1
                print(f"\n  На правку — в {FIXES_NAME}. Сообщение закроет Claude, когда исправление выйдет.")
            if choice == "2":
                reply = ""
                while not reply:
                    answer = ask("  Ответ ученику (0 — отменить выбор): ")
                    if answer is None:
                        return "end"
                    reply = answer.strip()
                    if not reply:
                        print("  Пустой ответ не отправляю: ученик должен узнать почему.")
                if reply == "0":
                    print("  Выбор отменён — ответьте заново.")
                    continue
                ok, error = rq.close_report(number, reply)
                if ok:
                    tally.replies += 1
                    print(f"\n  Сообщение #{number} закрыто с ответом.")
                else:
                    print("\n  " + error)
            break
        if choice == "0":
            return "menu"
    print("\n  Сообщения кончились.")
    return "menu"


# ---------- меню и итог ----------

SECTIONS = (review_tasks, review_rules, review_conflicts, review_reports)


def finish(tally):
    if tally.wrote_data():
        print("\n  Пересобираю банк…")
        errors = rq.rebuild()
        if errors:
            print("  Банк не прошёл проверку — покажите это Claude:")
            for error in errors[:10]:
                print("   - " + error)
        else:
            print("  Банк пересобран и проверен.")
    print(f"\n  Принято {tally.accepted} · на правку {tally.fixes} · решено спорных {tally.conflicts}"
          f" · ответов ученикам {tally.replies}")
    if tally.wrote_data():
        print("  Скажите Claude: проверка записана." + (f" Что не так — в {FIXES_NAME}." if tally.fixes else ""))
    elif tally.replies:
        print("  Ответы уже на GitHub, в данных ничего не менялось.")
    else:
        print("  Ничего не записано.")


def main():
    ask = ui.Asker()
    tally = Tally()
    # Строка до чтения данных и gh: иначе двойной клик дал бы на пару секунд пустое окно.
    print("\n  Смотрю черновики и сообщения учеников…")
    reports = rq.list_reports()
    try:
        while True:
            state = load()
            if state is None:
                break
            ready, not_ready = rq.task_queue(state["questions"], state["pending"], state["authored"], state["fixes"])
            groups = rq.rule_queue(state["rules"], state["checks"], state["fixes"])
            rules_waiting = sum(int(g["draft"]) + len(g["checks"]) for g in groups)
            conflicts = rq.conflict_queue(state["questions"], state["authored"])
            issues, _ = reports
            waiting = rq.pending_issues(state["fixes"])
            open_reports = None if issues is None else len([i for i in issues if i["number"] not in waiting])
            counts = [len(ready), rules_waiting, len(conflicts), open_reports or 0]
            items = [
                ("Разборы заданий", f"ждут {len(ready)}"),
                ("Правила и вопросы", f"ждут {rules_waiting}"),
                ("Спорные ключи", f"ждут {len(conflicts)} · решено {rq.decided_conflicts(state['authored'])}"),
                ("Сообщения учеников", "gh не настроен — раздел подскажет" if issues is None else f"открыто {open_reports}"),
            ]
            footer = [f"Не готовы к проверке: {len(not_ready)} — покажите Claude."] if not_ready else []
            choice = ui.menu(ask, "Проверка — что ждёт вашего решения", items,
                             "Какой раздел (номер; Enter — первый, где ждут):", footer)
            if choice is None:
                break
            if choice == "enter":
                choice = next((i for i, n in enumerate(counts) if n), None)
                if choice is None:
                    print("\n  Всё проверено.")
                    break
            result = SECTIONS[choice](ask, tally)
            if choice == 3:
                reports = rq.list_reports()
            if result == "end":
                print("\n  Ввод кончился — незаписанная страница ждёт следующего раза.")
                break
    except KeyboardInterrupt:
        print("\n\n  Прервано. Записанное до этого момента сохранено.")
    finish(tally)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest test.test_review_console -v`
Expected: PASS, 3 теста.

- [ ] **Step 5: Run the whole suite**

Run: `python3 -m unittest discover -s test -t . && node --test test/*.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `OK`, `ℹ fail 0`.

- [ ] **Step 6: Commit**

```bash
git add scripts/review_console.py test/test_review_console.py
git commit -m "Проверка: экраны разделов, меню и итог

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Кнопка в Finder и документация

**Files:**
- Create: `Проверка.command`
- Modify: `CLAUDE.md`, `README.md`, `CHANGELOG.md`, `docs/superpowers/specs/2026-09-27-review-console-design.md`

**Interfaces:**
- Consumes: `scripts/review_console.py` из Task 4.

- [ ] **Step 1: Create the button**

`Проверка.command`:

```zsh
#!/bin/zsh
# Двойной клик в Finder: проверить черновики, спорные ключи и сообщения учеников.
# Кнопка не пишет содержание и не делает коммитов — только показывает и записывает решение.
cd "$(dirname "$0")" || exit 1
if ! command -v python3 >/dev/null; then
  echo "Не найден python3 — без него проверка не запустится."
  echo "Установить: откройте Терминал и наберите  xcode-select --install"
  echo
  echo "Нажмите Enter, чтобы закрыть окно."
  read
  exit 1
fi
if [ ! -f scripts/review_console.py ]; then
  echo "Этот файл лежит не в папке проекта, а в: $(pwd)"
  echo "Перенесите его обратно в папку ege-lg-trainer — или сделайте на него псевдоним"
  echo "(правый клик → «Создать псевдоним»), псевдоним можно держать где угодно."
  echo
  echo "Нажмите Enter, чтобы закрыть окно."
  read
  exit 1
fi
# окно шире: задания стоят строками с иероглифами и не должны переноситься (120 знаков на 50 строк)
printf '\e[8;50;120t'
python3 scripts/review_console.py
echo
echo "Нажмите Enter, чтобы закрыть окно."
read
```

Run: `chmod +x Проверка.command && git add --chmod=+x Проверка.command`

- [ ] **Step 2: Check the button from a pipe**

Run: `printf '0\n' | zsh Проверка.command | head -20`
Expected: меню со строками «Разборы заданий ждут 0», «Спорные ключи ждут 0 · решено 3», в конце «Ничего не записано.» и «Нажмите Enter, чтобы закрыть окно.» Строка «Сообщения учеников» — «открыто N» при настроенном `gh`, иначе «gh не настроен — раздел подскажет».

- [ ] **Step 3: Update CLAUDE.md**

В разделе «Данные» заменить пункт о статусе `accepted`:

```markdown
- **Статус `accepted` — решение автора**: кнопкой «Проверка» (`Проверка.command` →
  `scripts/review_console.py`) или командой в чате — тогда Claude запускает `accept.py`
  (так принят пилот 26.09.2026: «черновики ок»), с записью в `CHANGELOG.md`. Claude пишет
  только черновики (`draft`). В публикацию попадает только принятое.
- «Не так» из кнопки — `data/review/fixes.md`: Claude исправляет пункт (он возвращается на
  проверку) и удаляет строку; сообщение ученика, по которому тот прав, закрывает после
  публикации исправления. Решение по спорному ключу — поле `keyDecision` в разборе
  (`hidden` / `restore`), его пишет кнопка.
```

В разделе «Команды» добавить строку после `accept.py`-подобных команд:

```
    python3 scripts/review_console.py       # кнопка «Проверка» (двойной клик — Проверка.command)
```

- [ ] **Step 4: Update README.md**

В разделе «Как добавить и проверить задания» заменить пункты 4–5 на:

```markdown
4. Проверить: двойной клик по `Проверка.command` в корне проекта. В Терминале по страницам
   идут разборы заданий, правила и вопросы к ним, спорные ключи ФИПИ и сообщения учеников;
   «в» — все верны, номера — какие не так. Верное принимается сразу, «не так» уходит в
   `data/review/fixes.md` для Claude, банк пересобирается сам. Без кнопки — прочитать
   `data/review/queue.md` или страницу `python3 scripts/build_site.py --drafts` →
   `review-build/review.html` и принять `python3 scripts/accept.py ID …` (или `--task 20`),
   затем `npm run data`.
5. Сколько готово по позициям и темам — `data/review/coverage.md`.
```

- [ ] **Step 5: Update CHANGELOG.md**

Дописать в конец:

```markdown

## 2026-09-27 — кнопка «Проверка»

- `Проверка.command` в корне: двойной клик — в Терминале по страницам всё, что ждёт решения
  автора: разборы заданий (по 4 на страницу), правила и вопросы к ним, спорные ключи ФИПИ и
  сообщения учеников из «Сообщить об ошибке» (через `gh`). «в» — все верны, номера — какие не
  так; верное принимается сразу, «не так» — в `data/review/fixes.md` для Claude; ученику, который
  не прав, кнопка отвечает и закрывает сообщение. После проверки банк пересобирается сам.
- Решение по трём спорным ключам (26.09.2026, «оставить скрытыми») записано полем
  `keyDecision: "hidden"`; `add_explanations.py` переносит это поле.
```

- [ ] **Step 6: Align the spec with the implementation**

В `docs/superpowers/specs/2026-09-27-review-console-design.md` заменить пункт:

```markdown
- Ввод копится в очереди, а не спрашивается по одному `input()`: при вводе из канала (так
  гоняются проверки) строки приходят пачкой.
```

на:

```markdown
- Ввод из канала (так гоняются проверки) приходит пачкой: ответ читается `readline` по строке,
  и ни одна не теряется; конец ввода — «закончить».
```

- [ ] **Step 7: Full verification**

Run: `npm run -s data && git status --short -- data/ && python3 -m unittest discover -s test -t . && node --test test/*.test.mjs 2>&1 | grep -E "^ℹ (pass|fail|skipped)"`
Expected: `data/` без изменений, `OK`, `ℹ fail 0`, `ℹ skipped 0`.

- [ ] **Step 8: Commit**

```bash
git add Проверка.command CLAUDE.md README.md CHANGELOG.md docs/superpowers/specs/2026-09-27-review-console-design.md
git commit -m "Кнопка «Проверка» в Finder; правила и README о приёме черновиков

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## После ревью перед слиянием (27.09.2026)

Код в задачах выше — первая версия. Ревью нашло и исправлено в той же ветке (код — в
`scripts/`, тесты — в `test/`, поведение — в замысле):

- `review_queue.checks_ready` — вопросы к непринятому правилу ждут правила;
- `review_queue.reopen` — «вернуть с ключом ФИПИ» и «ученик прав» делают запись черновиком;
  строка сообщения — `issue:N`, `pending_issues` читает только такие строки;
- `review_queue.unchanged` — принимается только то, что автор видел;
- `review_queue.student_choice`, перевод `sentenceRu`, `contrast` — на экране всё, что уйдёт
  на сайт; `createdAt` очищается;
- `Tally.rebuild` — банк пересобирается после каждой записи в данные;
- надписи «GitHub недоступен», «Проверять нечего…»; список сообщений ждёт GitHub 20 с;
- сквозной тест выбирает ID из данных и покрывает отмену «0», Enter в меню, раздел 4 без `gh`
  и отложенное правило.

