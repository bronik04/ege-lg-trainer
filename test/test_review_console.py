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
        self.authored = {}
        for path in sorted((data / "authored").glob("task-*.json")):
            entries = {k: v for k, v in read(path).items() if v.get("status") != "draft"}
            for entry in entries.values():
                if entry.get("keyConflict"):
                    entry["keyDecision"] = "hidden"
            write(path, entries)
            self.authored[path.name] = entries
        checks = [c for c in read(data / "rule-checks.json") if c.get("status") != "draft"]
        rules = [dict(r, status="accepted") for r in read(data / "rules.json")]
        # Правило с вопросами — снова черновик, его вопросы тоже.
        self.rule = next(r["id"] for r in rules if any(c["ruleIds"][0] == r["id"] for c in checks))
        next(r for r in rules if r["id"] == self.rule)["status"] = "draft"
        self.checks = [c["id"] for c in checks if c["ruleIds"][0] == self.rule]
        for c in checks:
            if c["id"] in self.checks:
                c["status"] = "draft"
        write(data / "rules.json", rules)
        write(data / "rule-checks.json", checks)
        # Пять разборов №20 — снова черновики.
        task20 = self.authored["task-20.json"]
        self.drafts = sorted(task20)[:5]
        for qid in self.drafts:
            task20[qid]["status"] = "draft"
        write(data / "authored" / "task-20.json", task20)
        self.other20 = sorted(task20)[5]
        self.task22 = sorted(self.authored["task-22.json"])[0]
        # Один спорный ключ снова без решения.
        self.conflict_file, self.conflict = next(
            (name, qid) for name, entries in sorted(self.authored.items())
            for qid, e in sorted(entries.items()) if e.get("keyConflict"))
        entries = self.authored[self.conflict_file]
        entries[self.conflict].pop("keyDecision")
        write(data / "authored" / self.conflict_file, entries)
        self.log = self.tmp / "gh.log"
        (self.tmp / "gh.py").write_text(FAKE_GH, encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_button(self, answers, issues=(), gh=None):
        command = gh or f"{shlex.quote(sys.executable)} {shlex.quote(str(self.tmp / 'gh.py'))}"
        env = dict(os.environ, REVIEW_GH=command, FAKE_GH_LOG=str(self.log),
                   FAKE_GH_ISSUES=json.dumps(list(issues), ensure_ascii=False), PYTHONIOENCODING="utf-8")
        return subprocess.run([sys.executable, str(self.tmp / "scripts" / "review_console.py")],
                              input="".join(a + "\n" for a in answers), capture_output=True, text=True,
                              encoding="utf-8", env=env, timeout=120)

    def test_whole_review(self):
        issues = [
            {"number": 7, "title": f"Ошибка: задание 22 · {self.task22}",
             "body": f"ID: {self.task22}\nВыбранный ответ: 就\nЧто не так:\nКлюч \x1b[31mневерный\x1b[0m",
             "createdAt": "2026-09-27T10:00:00Z\x1b[2J"},
            {"number": 8, "title": f"Ошибка: задание 20 · {self.other20}", "body": "Что не так:\nопечатка",
             "createdAt": "2026-09-27T11:00:00Z"},
            {"number": 9, "title": "Вопрос про сайт", "body": "", "createdAt": "2026-09-27T12:00:00Z"},
        ]
        check_pages = math.ceil(len(self.checks) / 4)
        answers = ["1", "2", "0", "2", "ключ не тот", "", "в"]         # разборы: отмена «0», затем 2-е не так
        answers += ["2", "в"] + ["в"] * check_pages                    # правило и вопросы к нему
        answers += ["3", "2"]                                           # спорный ключ — вернуть с ключом ФИПИ
        answers += ["4", "2", "", "Ключ верный: 才 здесь значит «только».", "1", ""]  # сообщения учеников
        answers += ["1"]                                                # снова разборы — снятого там нет
        answers += ["0"]
        done = self.run_button(answers, issues)
        out = done.stdout
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn("Выбор отменён", out)
        self.assertIn("Пустой ответ не засчитываю", out)
        self.assertIn("Пустой ответ не отправляю", out)
        self.assertIn("Ученик выбрал: 就", out)
        self.assertNotIn("\x1b", out, "управляющие символы из сообщения ученика убраны")
        self.assertIn("Банк пересобран и проверен", out)
        self.assertIn("Скажите Claude: проверка записана", out)

        data = self.tmp / "data"
        task20 = read(data / "authored" / "task-20.json")
        self.assertEqual([task20[q]["status"] for q in self.drafts],
                         ["accepted", "draft", "accepted", "accepted", "accepted"])
        self.assertEqual(task20[self.other20]["status"], "draft", "ученик прав — задание снято до исправления")
        rules = read(data / "rules.json")
        self.assertEqual(next(r for r in rules if r["id"] == self.rule)["status"], "accepted")
        checks = {c["id"]: c for c in read(data / "rule-checks.json")}
        self.assertTrue(all(checks[c]["status"] == "accepted" for c in self.checks))
        conflict = read(data / "authored" / self.conflict_file)[self.conflict]
        self.assertEqual((conflict["keyDecision"], conflict["status"]), ("restore", "draft"))

        fixes = (data / "review" / "fixes.md").read_text(encoding="utf-8")
        self.assertRegex(fixes, rf"- `{self.drafts[1]}` №20 · .* — ключ не тот \(\d\d\.\d\d\.\d{{4}}\)")
        self.assertIn(f"## Спорные ключи — вернуть с ключом ФИПИ\n- `{self.conflict}` №", fixes)
        self.assertIn(f"- `issue:8` {self.other20} — ученик прав", fixes)
        # Задание по сообщению ждёт правки: со старым разбором его не принять, пока Claude не исправит.
        self.assertRegex(fixes, rf"- `{self.other20}` .*сообщени\w* #8")
        self.assertIn("Разборов на проверку нет", out.split("Сообщения кончились")[-1])
        self.assertIn("уйдёт с сайта", out)
        self.assertNotIn("issue:7", fixes)

        calls = [json.loads(line) for line in self.log.read_text(encoding="utf-8").splitlines()]
        listing = next(c for c in calls if c[:2] == ["issue", "list"])
        self.assertEqual(listing[listing.index("--limit") + 1], "1000", "сообщений может быть больше сотни")
        self.assertIn(["issue", "close", "7", "--repo", "bronik04/ege-lg-trainer",
                       "--comment", "Ключ верный: 才 здесь значит «только»."], calls)

        questions = {q["id"]: q for q in read(data / "questions.json")}
        self.assertEqual(questions[self.drafts[0]]["reviewStatus"], "ready", "банк пересобран")
        self.assertEqual(questions[self.drafts[1]]["reviewStatus"], "draft")
        self.assertEqual(questions[self.other20]["reviewStatus"], "draft")

    def test_rejected_rule_keeps_its_checks_waiting(self):
        done = self.run_button(["2", "н", "примеры не те", "0"])
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn("ждут, пока правило не принято", done.stdout)
        self.assertIn("Скажите Claude: проверка записана", done.stdout)
        self.assertNotIn("Банк не прошёл проверку", done.stdout)
        checks = {c["id"]: c for c in read(self.tmp / "data" / "rule-checks.json")}
        self.assertTrue(all(checks[c]["status"] == "draft" for c in self.checks))
        fixes = (self.tmp / "data" / "review" / "fixes.md").read_text(encoding="utf-8")
        self.assertIn(f"- `rule:{self.rule}` ", fixes)

    def test_menu_enter_opens_first_waiting_section(self):
        done = self.run_button(["", "0", "0"])
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn("ждут 5", done.stdout)
        self.assertIn("Разборы заданий · страница 1 из 2", done.stdout)
        self.assertIn("Ничего не записано", done.stdout)
        self.assertFalse((self.tmp / "data" / "review" / "fixes.md").exists())

    def test_reports_without_gh(self):
        done = self.run_button(["4", "0"], gh="/нет/такого/gh")
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn("GitHub недоступен — раздел подскажет", done.stdout)
        self.assertIn("brew install gh", done.stdout)

    def test_input_ends_mid_page(self):
        done = self.run_button(["1", "2"])
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn("Ввод кончился", done.stdout)
        task20 = read(self.tmp / "data" / "authored" / "task-20.json")
        self.assertTrue(all(task20[q]["status"] == "draft" for q in self.drafts), "страница не записана")


if __name__ == "__main__":
    unittest.main()
