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
