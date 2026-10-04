"""accept.py: что принимается, а что ждёт правки."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from test.helpers import authored_for, record, rule

import accept


def check(check_id, status="draft"):
    return {"id": check_id, "kind": "identify-rule", "ruleIds": ["aspect-suffixes"], "status": status,
            "prompt": "Какой суффикс?", "options": [{"id": "a", "text": "了"}, {"id": "b", "text": "过"}],
            "correctOptionId": "a", "explanation": {"correct": "Разбор верного варианта достаточной длины.",
                                                    "options": {"b": "Разбор неверного варианта достаточной длины."}}}


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


class AcceptTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__("shutil").rmtree(self.tmp, ignore_errors=True))
        a, b = record(qid="q20-aaaaaaaa"), record(qid="q20-bbbbbbbb", stem="我___来。")
        write(self.tmp / "task-20.json", {r["id"]: {k: v for k, v in authored_for(r, status="draft").items() if k != "_file"}
                                          for r in (a, b)})
        write(self.tmp / "rules.json", [rule("r1", status="draft"), rule("r2", status="draft")])
        write(self.tmp / "rule-checks.json", [check("c1"), check("c2")])
        patcher = mock.patch.multiple(accept, AUTHORED=self.tmp, RULES=self.tmp / "rules.json",
                                      RULE_CHECKS=self.tmp / "rule-checks.json")
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_items_waiting_for_fixes_are_not_accepted(self):
        # «Не так» в «Проверке» или «ученик прав» — пункт ждёт правки Claude, принимать нечего.
        fixes = "- `q20-bbbbbbbb` №20 — не так (01.10.2026)\n- `rule:r2` x (01.10.2026)\n- `check:c2` x (01.10.2026)\n"
        done = accept.accept(["q20-aaaaaaaa", "q20-bbbbbbbb", "r1", "r2", "c1", "c2"], fixes_text=fixes)
        self.assertEqual(sorted(done), ["c1", "q20-aaaaaaaa", "r1"])
        self.assertEqual(read(self.tmp / "task-20.json")["q20-bbbbbbbb"]["status"], "draft")
        self.assertEqual([r["status"] for r in read(self.tmp / "rules.json")], ["accepted", "draft"])
        self.assertEqual(accept.accept([], task=20, fixes_text=fixes), [], "--task тоже не берёт ждущее правки")

    def test_whole_task_without_fixes(self):
        self.assertEqual(sorted(accept.accept([], task=20, fixes_text="")), ["q20-aaaaaaaa", "q20-bbbbbbbb"])


if __name__ == "__main__":
    unittest.main()
