"""Принятое привязано к тексту: правка после принятия не уходит на сайт без автора."""

import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from test.helpers import TOPICS, authored_for, record, rule, stamped

import accept
import add_explanations as ae
import build_bank as bb
import reopen
import review_queue as rq
import validate as v
from common import TASK_CONTENT, content_hash


def check(check_id, status="accepted", rule_id="aspect-suffixes"):
    item = {"id": check_id, "kind": "identify-rule", "ruleIds": [rule_id], "status": status,
            "prompt": f"Вопрос {check_id}?", "options": [{"id": "a", "text": "了"}, {"id": "b", "text": "过"}],
            "correctOptionId": "a", "explanation": {"correct": "Разбор верного варианта достаточной длины.",
                                                    "options": {"b": "Разбор неверного варианта достаточной длины."}}}
    if status == "accepted":
        item["acceptedHash"] = content_hash(item)
    return item


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


class TempData(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.rec = record(qid="q20-aaaaaaaa")
        entry = {k: val for k, val in authored_for(self.rec).items() if k != "_file"}
        write(self.tmp / "task-20.json", {self.rec["id"]: entry})
        write(self.tmp / "rules.json", [rule(), rule("jiu-cai")])
        write(self.tmp / "rule-checks.json", [check("c1"), check("c2", rule_id="jiu-cai")])
        for module in (accept, reopen):
            patcher = mock.patch.multiple(module, AUTHORED=self.tmp, RULES=self.tmp / "rules.json",
                                          RULE_CHECKS=self.tmp / "rule-checks.json")
            patcher.start()
            self.addCleanup(patcher.stop)


class AcceptStampsTest(TempData):
    def test_accept_records_what_was_accepted(self):
        draft = {k: val for k, val in read(self.tmp / "task-20.json")[self.rec["id"]].items() if k != "acceptedHash"}
        write(self.tmp / "task-20.json", {self.rec["id"]: dict(draft, status="draft")})
        write(self.tmp / "rules.json", [rule(status="draft")])
        accept.accept([self.rec["id"], "aspect-suffixes"], fixes_text="")
        entry = read(self.tmp / "task-20.json")[self.rec["id"]]
        self.assertEqual(entry["acceptedHash"], content_hash(entry, TASK_CONTENT))
        stored = read(self.tmp / "rules.json")[0]
        self.assertEqual(stored["acceptedHash"], content_hash(stored))


class EditedAfterAcceptanceTest(unittest.TestCase):
    def test_edited_task_explanation_stops_the_build(self):
        entry = authored_for(self.rec_())
        entry["explanation"]["correct"] = "Claude поправил принятый разбор, не вернув его в черновик."
        with self.assertRaisesRegex(bb.BuildError, r"изменён после принятия.*reopen\.py q20-aaaaaaaa"):
            bb.merge([self.rec_()], {"q20-aaaaaaaa": entry}, TOPICS, [rule()])

    def test_conflict_mark_is_part_of_acceptance(self):
        # Снять пометку спорного ключа или «вернуть с ключом» у принятого — открыть задание ученикам:
        # это решение автора, без него сборка останавливается.
        hidden = stamped(dict(authored_for(self.rec_()), keyConflict="好 тоже естественно.", keyDecision="hidden"))
        questions, _ = bb.merge([self.rec_()], {"q20-aaaaaaaa": hidden}, TOPICS, [rule()])
        self.assertEqual(questions[0]["reviewStatus"], "conflict")
        for changed in ({k: v for k, v in hidden.items() if k != "keyConflict"}, dict(hidden, keyDecision="restore")):
            with self.assertRaisesRegex(bb.BuildError, "изменён после принятия"):
                bb.merge([self.rec_()], {"q20-aaaaaaaa": changed}, TOPICS, [rule()])

    def test_hidden_decision_keeps_acceptance(self):
        # «Оставить скрытым» в «Проверке» — решение автора: принятое остаётся принятым.
        with tempfile.TemporaryDirectory() as tmp:
            entry = {k: v for k, v in stamped(dict(authored_for(self.rec_()), keyConflict="好 тоже.")).items() if k != "_file"}
            write(Path(tmp) / "task-20.json", {"q20-aaaaaaaa": entry})
            self.assertTrue(rq.decide_conflict("q20-aaaaaaaa", "hidden", authored_dir=tmp))
            saved = read(Path(tmp) / "task-20.json")["q20-aaaaaaaa"]
        self.assertEqual(saved["acceptedHash"], content_hash(saved, TASK_CONTENT))

    def test_edited_rule_and_check_are_reported(self):
        edited_rule = dict(rule(), summary="Новая суть, которую автор не видел.")
        edited_check = dict(check("c1"), prompt="Другой вопрос?")
        errors = v.check_all([], TOPICS, [edited_rule], [edited_check])
        self.assertIn("правило aspect-suffixes: изменено после принятия — верните в черновик "
                      "(python3 scripts/reopen.py aspect-suffixes), автор примет заново", errors)
        self.assertIn("вопрос по правилу c1: изменено после принятия — верните в черновик "
                      "(python3 scripts/reopen.py c1), автор примет заново", errors)
        self.assertEqual(v.check_all([], TOPICS, [rule()], [check("c1")]), [])

    @staticmethod
    def rec_():
        return record(qid="q20-aaaaaaaa")


class ReopenTest(TempData):
    def test_reopen_task_rule_and_check(self):
        done = reopen.reopen([self.rec["id"], "jiu-cai", "c1", "нет-такого"])
        self.assertEqual(sorted(done), ["c1", "c2", "jiu-cai", self.rec["id"]], "правило уводит свои вопросы")
        entry = read(self.tmp / "task-20.json")[self.rec["id"]]
        self.assertEqual(entry["status"], "draft")
        self.assertNotIn("acceptedHash", entry)
        self.assertEqual({r["id"]: r["status"] for r in read(self.tmp / "rules.json")},
                         {"aspect-suffixes": "accepted", "jiu-cai": "draft"})
        self.assertEqual({c["id"]: c["status"] for c in read(self.tmp / "rule-checks.json")}, {"c1": "draft", "c2": "draft"})
        self.assertEqual(reopen.reopen([self.rec["id"]]), [], "уже черновик")


class ReopenImpactTest(unittest.TestCase):
    def test_reopened_rule_takes_its_tasks_off_the_site(self):
        # Задание с непринятым правилом не публикуется: правка карточки уводит с сайта её задания,
        # а если других заданий того же номера нет — и позицию полного варианта.
        def task(qid, number, rule_id):
            return {"id": qid, "taskNumber": number, "ruleIds": [rule_id], "reviewStatus": "ready"}
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "questions.json"
            write(path, [task("q20-a", 20, "aspect-suffixes"), task("q20-b", 20, "aspect-suffixes"),
                         task("q22-a", 22, "jiu-cai"), task("q22-b", 22, "adverbs-common")])
            self.assertEqual(reopen.impact(["aspect-suffixes"], path), (2, [20]))
            self.assertEqual(reopen.impact(["jiu-cai"], path), (1, []))


class AddExplanationsTest(unittest.TestCase):
    """Claude пишет только черновики: волна не принимает и не перезаписывает принятое."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.a, self.b = record(qid="q20-aaaaaaaa"), record(qid="q20-bbbbbbbb", stem="我___来。")
        accepted = {k: val for k, val in authored_for(self.a).items() if k != "_file"}
        write(self.tmp / "task-20.json", {self.a["id"]: accepted})
        for patcher in (mock.patch.object(ae, "AUTHORED", self.tmp),
                        mock.patch.object(ae, "load_records", return_value=[self.a, self.b])):
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_wave_writes_drafts_only(self):
        wave = {
            self.a["id"]: {"status": "accepted", "topicIds": ["aspect"], "ruleIds": ["aspect-suffixes"],
                           "explanation": {"correct": "Переписано, но принятое не трогается."}},
            self.b["id"]: {"status": "accepted", "acceptedHash": "deadbeef", "topicIds": ["aspect"],
                           "ruleIds": ["aspect-suffixes"], "explanation": {"correct": "Новый разбор."}},
        }
        added, skipped = ae.add(wave)
        self.assertEqual((added, skipped), ([self.b["id"]], [self.a["id"]]))
        stored = read(self.tmp / "task-20.json")
        self.assertEqual(stored[self.a["id"]]["explanation"], authored_for(self.a)["explanation"], "принятое не тронуто")
        self.assertEqual(stored[self.b["id"]]["status"], "draft", "статус из волны не берётся")
        self.assertNotIn("acceptedHash", stored[self.b["id"]])
        self.assertEqual(stored[self.b["id"]]["sourceSnapshot"],
                         {"stem": "我___来。", "options": {"1": "了", "2": "着", "3": "过"}, "correctOptionId": "2"})


if __name__ == "__main__":
    unittest.main()
