import unittest

from test.helpers import TOPICS, authored_for, clone, record, rule

import build_bank as bb
from common import QUESTIONS, read_json


class NumeralTest(unittest.TestCase):
    def test_parse(self):
        cases = {
            "七百零九万零五百": 7_090_500,
            "八百二十五亿四千九百六十二万一千七百二十三": 82_549_621_723,
            "一亿五千三百九十一万零一百": 153_910_100,
            "三千两百一十万零五千一百": 32_105_100,
            "三万六千七百零五": 36_705,
            "五百二十八万零一百零三。": 5_280_103,
            "十": 10,
            "一百万零五千七百一十二": 1_005_712,
        }
        for text, value in cases.items():
            self.assertEqual(bb.parse_zh_number(text), value, text)

    def test_unparseable(self):
        self.assertIsNone(bb.parse_zh_number("abc"))

    def test_wrong_key_detected(self):
        rec = record(task=19, stem="七百零九万零五百",
                     options=("70 905 000", "700 950 000", "7 090 500", "7 900 500"), correct="1")
        self.assertIn("это вариант 3", bb.check_numeral_key(rec))

    def test_right_key_passes(self):
        rec = record(task=19, stem="七百零九万零五百",
                     options=("70 905 000", "700 950 000", "7 090 500", "7 900 500"), correct="3")
        self.assertIsNone(bb.check_numeral_key(rec))


class DuplicatesTest(unittest.TestCase):
    def test_identical_tasks_keep_one(self):
        a = record(qid="q20-aaaaaaaa")
        b = record(qid="q20-bbbbbbbb", stem="老板正开 ___ 会,不方便接电话.")
        excluded, conflicts, groups, _ = bb.find_duplicates([a, b])
        self.assertEqual(excluded, {"q20-bbbbbbbb": "q20-aaaaaaaa"})
        self.assertEqual(conflicts, {})
        self.assertEqual(len(groups), 1)

    def test_fipi_id_wins(self):
        a = record(qid="q20-aaaaaaaa")
        b = record(qid="q20-bbbbbbbb")
        b["sourceRef"]["fipiId"] = "ABCDEF"
        excluded, _, _, _ = bb.find_duplicates([a, b])
        self.assertEqual(excluded, {"q20-aaaaaaaa": "q20-bbbbbbbb"})

    def test_different_keys_are_conflict(self):
        a = record(qid="q20-aaaaaaaa", correct="2")
        b = record(qid="q20-bbbbbbbb", correct="1")
        excluded, conflicts, _, _ = bb.find_duplicates([a, b])
        self.assertEqual(excluded, {})
        self.assertEqual(set(conflicts), {"q20-aaaaaaaa", "q20-bbbbbbbb"})

    def test_same_stem_other_options_is_only_similar(self):
        a = record(qid="q20-aaaaaaaa")
        b = record(qid="q20-bbbbbbbb", options=("了", "着", "的"))
        excluded, conflicts, _, similar = bb.find_duplicates([a, b])
        self.assertEqual((excluded, conflicts), ({}, {}))
        self.assertEqual(len(similar), 1)


class MergeTest(unittest.TestCase):
    def merge(self, records, authored=None, rules=None):
        return bb.merge(records, authored or {}, TOPICS, rules if rules is not None else [rule()])

    def test_without_explanation_is_imported_with_default_topic(self):
        (q,), _ = self.merge([record()])
        self.assertEqual(q["reviewStatus"], "imported")
        self.assertEqual(q["topicIds"], ["aspect"])
        self.assertIsNone(q["explanation"])

    def test_accepted_with_accepted_rule_is_ready(self):
        rec = record()
        (q,), _ = self.merge([rec], {rec["id"]: authored_for(rec)})
        self.assertEqual(q["reviewStatus"], "ready")
        self.assertEqual(q["ruleIds"], ["aspect-suffixes"])

    def test_draft_stays_draft(self):
        rec = record()
        (q,), pending = self.merge([rec], {rec["id"]: authored_for(rec, status="draft")})
        self.assertEqual(q["reviewStatus"], "draft")
        self.assertIn("разбор не принят автором", pending[rec["id"]])

    def test_accepted_but_rule_draft_is_not_ready(self):
        rec = record()
        (q,), pending = self.merge([rec], {rec["id"]: authored_for(rec)}, rules=[rule(status="draft")])
        self.assertEqual(q["reviewStatus"], "draft")
        self.assertIn("правило aspect-suffixes не принято", pending[rec["id"]])

    def test_accepted_without_wrong_option_explanation_stops_build(self):
        rec = record()
        entry = authored_for(rec)
        del entry["explanation"]["options"]["3"]
        with self.assertRaisesRegex(bb.BuildError, "разбор варианта 3: пусто"):
            self.merge([rec], {rec["id"]: entry})

    def test_source_change_stops_build(self):
        rec = record()
        entry = authored_for(rec)
        changed = clone(rec)
        changed["options"][0]["text"] = "的"
        with self.assertRaisesRegex(bb.BuildError, "изменились варианты"):
            self.merge([changed], {rec["id"]: entry})

    def test_explanation_for_unknown_task_stops_build(self):
        rec = record()
        with self.assertRaisesRegex(bb.BuildError, "несуществующим"):
            self.merge([rec], {"q20-ffffffff": authored_for(rec)})

    def test_author_key_conflict(self):
        rec = record()
        entry = dict(authored_for(rec), keyConflict="по смыслу подходит и 了")
        (q,), _ = self.merge([rec], {rec["id"]: entry})
        self.assertEqual(q["reviewStatus"], "conflict")
        self.assertEqual(q["conflict"], "по смыслу подходит и 了")

    def test_duplicate_is_excluded(self):
        a, b = record(qid="q20-aaaaaaaa"), record(qid="q20-bbbbbbbb")
        questions, _ = self.merge([a, b])
        self.assertEqual([q["reviewStatus"] for q in questions], ["imported", "excluded"])
        self.assertEqual(questions[1]["duplicateOf"], "q20-aaaaaaaa")

    def test_unreadable_field_blocks_ready(self):
        rec = record(issues=["не удалось выделить фрагменты A, B, C"])
        (q,), _ = self.merge([rec], {rec["id"]: authored_for(rec)})
        self.assertEqual(q["reviewStatus"], "draft")


class HintReportTest(unittest.TestCase):
    """Ключ задания вместе с соседним иероглифом в другом тексте, который ученик видит до ответа."""

    def test_key_with_neighbour_elsewhere_is_reported(self):
        g17 = dict(record(task=17, qid="g17-aaaaaaaa", stem="下雨了，比赛只好___到明天下午。",
                          options=("迟到", "推广", "退出", "推迟"), correct="4", origin="generated"), reviewStatus="ready")
        g26 = dict(record(task=26, qid="g26-bbbbbbbb", stem="A) 听说明天有大雨\nB) 学校决定把运动会\nC) 推迟到下个星期",
                          options=("ABC", "ACB", "CAB", "BCA"), correct="1", origin="generated"), reviewStatus="draft",
                   fragments=[{"id": "A", "text": "听说明天有大雨"}, {"id": "B", "text": "学校决定把运动会"},
                              {"id": "C", "text": "推迟到下个星期"}])
        q22 = dict(record(task=22, qid="q22-cccccccc", stem="如果明天不下雨，我们___去爬山。",
                          options=("才", "刚", "只", "就"), correct="4"), reviewStatus="ready")
        q27 = dict(record(task=27, qid="q27-dddddddd", stem="要是天气好，我们就去公园。",
                          options=("要是", "虽然", "因为", "所以"), correct="1"), reviewStatus="ready")
        r = rule("constructions-more")
        r["examples"][0] = {"zh": "如果明天下雨，我们就不去。", "ru": "…"}
        hints = bb.hint_pairs([g17, g26, q22, q27], [r], [])
        self.assertIn(("g17-aaaaaaaa", "推迟到", "g26-bbbbbbbb"), hints)
        self.assertIn(("q22-cccccccc", "我们就", "правило constructions-more"), hints)
        # Оба задания из ФИПИ — их не правят, такая пара не показывается.
        self.assertNotIn(("q22-cccccccc", "我们就", "q27-dddddddd"), hints)


class CommittedBankTest(unittest.TestCase):
    def setUp(self):
        self.topics = read_json(bb.TOPICS)
        self.rules = read_json(bb.RULES)
        self.checks = read_json(bb.RULE_CHECKS)
        self.records = bb.load_records()
        self.questions, self.pending = bb.merge(self.records, bb.load_authored(), self.topics, self.rules)

    def test_questions_json_is_up_to_date(self):
        self.assertEqual(self.questions, read_json(QUESTIONS), "data/questions.json устарел: запустите build_bank.py")

    def test_reports_are_up_to_date(self):
        # Автор принимает содержание по queue.md: устаревшая очередь — это принятие не того текста.
        expected = {
            "queue.md": bb.queue_report(self.questions, self.pending, self.rules, self.checks),
            "coverage.md": bb.coverage_report(self.questions, self.topics),
            "duplicates.md": bb.duplicates_report(self.records, self.questions, self.rules, self.checks),
        }
        for name, text in expected.items():
            self.assertEqual((bb.REVIEW / name).read_text(encoding="utf-8"), text,
                             f"data/review/{name} устарел: запустите build_bank.py")


if __name__ == "__main__":
    unittest.main()
