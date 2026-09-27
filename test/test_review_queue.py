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
