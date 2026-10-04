import unittest

from test.helpers import TOPICS, clone, ready_question, rule

import validate as v
from common import QUESTIONS, RULE_CHECKS, RULES, TOPICS as TOPICS_PATH, read_json


def problems(q, rules=None):
    return v.check_all([q], TOPICS, rules if rules is not None else [rule()], [])


class QuestionInvariantsTest(unittest.TestCase):
    def test_valid_three_and_four_options(self):
        self.assertEqual(problems(ready_question()), [])
        self.assertEqual(problems(ready_question(options=("了", "着", "过", "的"))), [])

    def test_broken_question_is_rejected(self):
        broken = {
            "номер вне 15–27": dict(ready_question(), taskNumber=14),
            "пять вариантов": ready_question(options=("1", "2", "3", "4", "5")),
            "два варианта": ready_question(options=("了", "着")),
            "ключ мимо": dict(ready_question(), correctOptionId="7"),
            "нет года": dict(ready_question(), formatYear=None),
            "чужое происхождение": dict(ready_question(), origin="internet"),
            "повтор текста варианта": ready_question(options=("了", "了", "过")),
        }
        for name, q in broken.items():
            self.assertTrue(problems(q), name)

    def test_ready_needs_explanation_for_each_wrong_option(self):
        q = ready_question()
        del q["explanation"]["options"]["3"]
        self.assertIn("задание q20-00000001: разбор варианта 3: пусто", problems(q))

    def test_generic_explanation_is_not_enough(self):
        q = ready_question()
        q["explanation"]["options"]["1"] = "Повторите правило."
        self.assertIn("задание q20-00000001: разбор варианта 1: общая фраза вместо разбора", problems(q))

    def test_same_explanation_for_two_options_is_rejected(self):
        q = ready_question(options=("了", "着", "过", "的"))
        q["explanation"]["options"]["3"] = q["explanation"]["options"]["1"]
        self.assertTrue(any("одинаковый разбор" in p for p in problems(q)))

    def test_explanation_for_correct_option_as_wrong_is_rejected(self):
        q = ready_question()
        q["explanation"]["options"]["2"] = "Лишний разбор для верного варианта, который не нужен."
        self.assertTrue(any("несуществующих или верного" in p for p in problems(q)))

    def test_draft_does_not_need_explanation(self):
        q = dict(ready_question(), reviewStatus="imported", explanation=None, ruleIds=[])
        self.assertEqual(problems(q), [])

    def test_ready_needs_accepted_rule(self):
        self.assertTrue(any("непринятое правило" in p for p in problems(ready_question(), [rule(status="draft")])))

    def test_links_must_exist(self):
        q = dict(ready_question(), topicIds=["nope"])
        self.assertIn("задание q20-00000001: нет темы 'nope'", problems(q))
        q = dict(ready_question(), ruleIds=["nope"])
        self.assertIn("задание q20-00000001: нет правила 'nope'", problems(q))

    def test_task_26_needs_fragments(self):
        q = ready_question(task=26, options=("CAB", "ACB", "BAC", "BCA"), correct="1")
        q["topicIds"] = ["sentence-order"]
        self.assertTrue(any("фрагментов A, B, C" in p for p in problems(q)))
        q["fragments"] = [{"id": x, "text": "…"} for x in "ABC"]
        self.assertEqual(problems(q), [])

    def test_generated_needs_spec_version(self):
        q = dict(ready_question(), origin="generated")
        self.assertTrue(any("версии спецификации" in p for p in problems(q)))
        q["sourceRef"] = dict(q["sourceRef"], specVersion="ЕГЭ 2026")
        self.assertEqual(problems(q), [])

    def test_duplicate_ids(self):
        q = ready_question()
        self.assertIn("банк: повторяется ID 'q20-00000001'", v.check_all([q, clone(q)], TOPICS, [rule()], []))


class RuleTest(unittest.TestCase):
    def test_rule_needs_contrast_pair(self):
        r = rule()
        r["contrast"]["pair"] = r["contrast"]["pair"][:1]
        self.assertTrue(v.rule_problems(r, {"aspect"}))

    def test_rule_check(self):
        check = {"id": "c1", "kind": "choose-form", "status": "accepted", "prompt": "Что выражает…",
                 "ruleIds": ["aspect-suffixes"], "options": [{"id": "a", "text": "了"}, {"id": "b", "text": "过"}],
                 "correctOptionId": "a",
                 "explanation": {"correct": "Достаточно длинное объяснение верного ответа.",
                                 "options": {"b": "Достаточно длинное объяснение неверного ответа."}}}
        rules = {"aspect-suffixes": rule()}
        self.assertEqual(v.rule_check_problems(check, rules), [])
        self.assertTrue(v.rule_check_problems(dict(check, kind="other"), rules))
        self.assertTrue(v.rule_check_problems(check, {"aspect-suffixes": rule(status="draft")}))


class IdTest(unittest.TestCase):
    def test_rule_and_check_ids_do_not_overlap(self):
        # accept.py и «Проверка» принимают по ID: общий ID принял бы заодно и другой пункт.
        same = {"id": "aspect-suffixes", "kind": "identify-rule", "ruleIds": ["aspect-suffixes"], "status": "accepted",
                "prompt": "Какой суффикс?", "options": [{"id": "a", "text": "了"}, {"id": "b", "text": "过"}],
                "correctOptionId": "a", "explanation": {"correct": "Разбор верного варианта достаточной длины.",
                                                        "options": {"b": "Разбор неверного варианта достаточной длины."}}}
        errors = v.check_all([], TOPICS, [rule()], [same])
        self.assertIn("ID 'aspect-suffixes' есть и у правила, и у вопроса по правилу", errors)


class BankOverlapTest(unittest.TestCase):
    def test_filled_stem_puts_key_into_blank(self):
        q = ready_question(stem="老板正开___会。")
        self.assertEqual(v.filled_stem(q), "老板正开着会")
        pair = ready_question(task=27, stem="___他很累，___还在工作。",
                              options=("因为……，所以……", "虽然……，但是……", "只有……，才……"), correct="2")
        self.assertEqual(v.filled_stem(pair), "虽然他很累但是还在工作")

    def test_rule_example_from_bank_is_rejected(self):
        bank = [("q20-x", v.filled_stem(ready_question(stem="老板正开___会，不方便接电话。")))]
        copied = dict(rule(), examples=[{"zh": "老板正开着会呢。", "ru": "…"}, {"zh": "我吃过。", "ru": "…"}])
        self.assertTrue(v.bank_overlap_problems(copied, bank))
        self.assertEqual(v.bank_overlap_problems(rule(), bank), [])

    def test_short_collocation_is_allowed(self):
        bank = [("q16-x", "父亲给我女儿送了一条裙子")]
        item = dict(rule(), usage=["条 — 一条裙子, 一条河"])
        self.assertEqual(v.bank_overlap_problems(item, bank), [])


class RealDataTest(unittest.TestCase):
    def test_project_data_is_valid(self):
        errors = v.check_all(read_json(QUESTIONS), read_json(TOPICS_PATH), read_json(RULES), read_json(RULE_CHECKS))
        self.assertEqual(errors, [])


if __name__ == "__main__":
    unittest.main()
