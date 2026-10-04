import json
import os
import shlex
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path
from unittest import mock

from test.helpers import TOPICS, authored_for, record, rule, stamped

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
        text = ("## Разборы заданий\n- `q20-a` №20 · 他___去。 — см. issue #6 (27.09.2026)\n"
                "## Сообщения учеников\n- `issue:12` q22-a — ученик прав (27.09.2026)\n")
        self.assertEqual(rq.pending_issues(text), {12}, "упоминание в пояснении — не строка сообщения")
        self.assertNotIn("q22-a", rq.pending_ids(text), "задание по сообщению не блокируется")

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


class ChecksReadyTest(unittest.TestCase):
    def test_check_waits_for_all_its_rules(self):
        rules = [rule("aspect-suffixes"), rule("jiu-cai", status="draft")]
        checks = [check("c1"), check("c2", "jiu-cai"), dict(check("c3"), ruleIds=["aspect-suffixes", "jiu-cai"])]
        ready, blocked = rq.checks_ready(checks, rules)
        self.assertEqual([c["id"] for c in ready], ["c1"])
        self.assertEqual(blocked, 2)


class ReopenTest(unittest.TestCase):
    def test_accepted_task_and_check_become_drafts(self):
        rec = record(qid="q20-aaaaaaaa")
        with tempfile.TemporaryDirectory() as tmp:
            authored = Path(tmp) / "task-20.json"
            entry = {k: v for k, v in authored_for(rec).items() if k != "_file"}
            authored.write_text(json.dumps({rec["id"]: entry}, ensure_ascii=False), encoding="utf-8")
            checks = Path(tmp) / "rule-checks.json"
            checks.write_text(json.dumps([check("c1", status="accepted")], ensure_ascii=False), encoding="utf-8")
            self.assertTrue(rq.reopen("task", rec["id"], authored_dir=tmp, checks_path=checks))
            self.assertFalse(rq.reopen("task", rec["id"], authored_dir=tmp, checks_path=checks), "уже черновик")
            self.assertTrue(rq.reopen("check", "c1", authored_dir=tmp, checks_path=checks))
            self.assertFalse(rq.reopen("check", "gone", authored_dir=tmp, checks_path=checks))
            self.assertEqual(json.loads(authored.read_text(encoding="utf-8"))[rec["id"]]["status"], "draft")
            self.assertEqual(json.loads(checks.read_text(encoding="utf-8"))[0]["status"], "draft")


class UnchangedTest(unittest.TestCase):
    """Принимается только то, что автор видел: Claude мог переписать пункт, пока автор смотрел."""

    def test_task(self):
        rec = record()
        entry = authored_for(rec, status="draft")
        questions, _ = bb.merge([rec], {rec["id"]: entry}, TOPICS, [rule()])
        shown = questions[0]
        on_disk = lambda value: mock.patch.object(bb, "load_authored", return_value={rec["id"]: value})
        with on_disk(entry):
            self.assertTrue(rq.unchanged("task", shown))
        rewritten = json.loads(json.dumps(entry))
        rewritten["explanation"]["correct"] = "Claude переписал разбор, пока автор смотрел на старый."
        with on_disk(rewritten):
            self.assertFalse(rq.unchanged("task", shown))
        with on_disk(dict(entry, status="accepted")):
            self.assertFalse(rq.unchanged("task", shown), "уже принято")
        with on_disk(dict(entry, ruleIds=["jiu-cai"])):
            self.assertFalse(rq.unchanged("task", shown))

    def test_task_with_empty_contrast(self):
        rec = record()
        entry = dict(authored_for(rec, status="draft"), contrast={})
        questions, _ = bb.merge([rec], {rec["id"]: entry}, TOPICS, [rule()])
        with mock.patch.object(bb, "load_authored", return_value={rec["id"]: entry}):
            self.assertTrue(rq.unchanged("task", questions[0]), "пустой «Сравните» — не изменение")

    def test_rule_and_check(self):
        with tempfile.TemporaryDirectory() as tmp:
            rules, checks = Path(tmp) / "rules.json", Path(tmp) / "rule-checks.json"
            shown_rule, shown_check = rule(status="draft"), check("c1")
            rules.write_text(json.dumps([shown_rule], ensure_ascii=False), encoding="utf-8")
            checks.write_text(json.dumps([shown_check], ensure_ascii=False), encoding="utf-8")
            with mock.patch.multiple(rq, RULES=rules, RULE_CHECKS=checks):
                self.assertTrue(rq.unchanged("rule", shown_rule))
                self.assertTrue(rq.unchanged("check", shown_check))
                rules.write_text(json.dumps([dict(shown_rule, summary="Новая суть.")], ensure_ascii=False), encoding="utf-8")
                checks.write_text(json.dumps([dict(shown_check, prompt="Другой вопрос?")], ensure_ascii=False), encoding="utf-8")
                self.assertFalse(rq.unchanged("rule", shown_rule))
                self.assertFalse(rq.unchanged("check", shown_check))


class ConflictTest(unittest.TestCase):
    def test_queue_and_decision(self):
        rec = record(qid="q23-aaaaaaaa")
        entry = authored_for(rec)
        entry["keyConflict"] = "好 тоже естественно."
        stamped(entry)  # принято вместе с пометкой
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


class RestoredKeyTest(unittest.TestCase):
    def test_restored_key_returns_to_review(self):
        # Автор решил «вернуть с ключом ФИПИ»: спорным задание больше не считается — переписанный разбор
        # приходит в раздел 1, даже если пометка keyConflict осталась в записи.
        rec = record(qid="q23-aaaaaaaa")
        entry = dict(authored_for(rec, status="draft"), keyConflict="好 тоже естественно.", keyDecision="restore")
        questions, pending = bb.merge([rec], {rec["id"]: entry}, TOPICS, [rule()])
        self.assertEqual(questions[0]["reviewStatus"], "draft")
        ready, _ = rq.task_queue(questions, pending, {rec["id"]: entry}, "")
        self.assertEqual([q["id"] for q in ready], [rec["id"]])
        hidden = dict(entry, keyDecision="hidden")
        self.assertEqual(bb.merge([rec], {rec["id"]: hidden}, TOPICS, [rule()])[0][0]["reviewStatus"], "conflict")


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
        self.assertEqual(rq.student_choice("ID\nВыбранный ответ: 就 \nОтвет по ключу: 才"), "就")
        self.assertIsNone(rq.student_choice("без строки"))
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
