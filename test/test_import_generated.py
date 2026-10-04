import json
import tempfile
import unittest
from pathlib import Path

from test.helpers import TOPICS, record as fipi_record, rule

import build_bank as bb
import import_generated as ig

SKILL_MD = """Спецификация: ЕГЭ 2026

## Часть 1. Задания

### Раздел 3. Грамматика, лексика и иероглифика

**16.** Укажите, какое счётное слово пропущено в данном предложении.

昨天我在书店买了三_____词典，准备送给我的同学。

1) 本  2) 张  3) 条  4) 只

Ответ: ________

**20.** Укажите, какой глагольный суффикс пропущен в данном предложении.

门上挂_____一张牌子。

1) 了  2) 着  3) 过

Ответ: ________

**6.** 李老师教汉语已经超过二十年了。

1) 正确  2) 错误  3) 没说

---

## Часть 2. Ответы и решения

**16 — ответ: 1**

**20 — ответ: 2**

**6 — ответ: 1 (正确)**
"""


class RecordTest(unittest.TestCase):
    def test_json_task(self):
        rec, problems = ig.record({"taskNumber": 22, "stem": "他昨天来了，今天___来了。", "options": ["还", "再", "又", "就"], "key": 3},
                                  "batch-1", "навык ege-chinese", "ЕГЭ 2026")
        self.assertEqual(problems, [])
        self.assertTrue(rec["id"].startswith("g22-"))
        self.assertEqual(rec["origin"], "generated")
        self.assertEqual(rec["formatYear"], 2026)
        self.assertEqual(rec["sourceRef"]["specVersion"], "ЕГЭ 2026")
        self.assertEqual(rec["correctOptionId"], "3")
        self.assertEqual(rec["prompt"], "Укажите, какое наречие пропущено в данном предложении.")

    def test_id_is_stable_and_content_based(self):
        task = {"taskNumber": 22, "stem": "A", "options": ["还", "再", "又", "就"], "key": 1}
        a, _ = ig.record(task, "b1", "g", "ЕГЭ 2026")
        b, _ = ig.record(task, "b2", "g", "ЕГЭ 2026")
        c, _ = ig.record(dict(task, stem="B"), "b1", "g", "ЕГЭ 2026")
        self.assertEqual(a["id"], b["id"])
        self.assertNotEqual(a["id"], c["id"])

    def test_bad_tasks_are_reported(self):
        for task in ({"taskNumber": 14, "stem": "x", "options": ["a", "b", "c"], "key": 1},
                     {"taskNumber": 20, "stem": "x", "options": ["a", "b"], "key": 1},
                     {"taskNumber": 20, "stem": "x", "options": ["a", "b", "c"], "key": 4},
                     {"taskNumber": 20, "stem": "", "options": ["a", "b", "c"], "key": 1},
                     {"taskNumber": 20, "stem": "x", "options": ["a", "a", "c"], "key": 1},
                     {"taskNumber": 20, "stem": "x", "options": ["a", "", "c"], "key": 1},
                     # Как в ЕГЭ: у №20 и №21 три варианта, у остальных — четыре.
                     {"taskNumber": 22, "stem": "x", "options": ["a", "b", "c"], "key": 1},
                     {"taskNumber": 20, "stem": "x", "options": ["a", "b", "c", "d"], "key": 1},
                     # Инструкция по-русски попала в условие.
                     {"taskNumber": 22, "stem": "Укажите наречие.\n他___来。", "options": ["a", "b", "c", "d"], "key": 1}):
            rec, problems = ig.record(task, "b", "g", "ЕГЭ 2026")
            self.assertIsNone(rec)
            self.assertTrue(problems, task)


class MarkdownTest(unittest.TestCase):
    def test_skill_output_is_parsed(self):
        spec, tasks, problems = ig.parse_markdown(SKILL_MD)
        self.assertEqual(spec, "ЕГЭ 2026")
        self.assertEqual(problems, [])
        self.assertEqual([t["taskNumber"] for t in tasks], [16, 20])
        self.assertEqual(tasks[0]["stem"], "昨天我在书店买了三_____词典，准备送给我的同学。")
        self.assertEqual(tasks[0]["options"], ["本", "张", "条", "只"])
        self.assertEqual(tasks[0]["key"], 1)
        self.assertEqual(tasks[1]["options"], ["了", "着", "过"])

    def test_missing_key_is_reported(self):
        spec, tasks, problems = ig.parse_markdown(SKILL_MD.replace("**20 — ответ: 2**", ""))
        self.assertEqual([t["taskNumber"] for t in tasks], [16])
        self.assertTrue(any(p.startswith("№20: заданий 1, ключей") for p in problems), problems)

    def test_several_tasks_of_one_number_keep_their_keys(self):
        md = SKILL_MD.replace("**20.**", "**16.**", 1).replace("**20 — ответ: 2**", "**16 — ответ: 2**")
        md = md.replace("1) 了  2) 着  3) 过", "1) 本  2) 张  3) 条  4) 只")
        spec, tasks, problems = ig.parse_markdown(md)
        self.assertEqual(problems, [])
        self.assertEqual([(t["taskNumber"], t["key"]) for t in tasks], [(16, 1), (16, 2)])

    def test_options_are_read_by_their_numbers(self):
        # Один пробел между вариантами вместо двух — не повод склеить два варианта в один.
        spec, tasks, problems = ig.parse_markdown(SKILL_MD.replace("1) 本  2) 张  3) 条  4) 只", "1) 本  2) 张 3) 条  4) 只"))
        self.assertEqual(problems, [])
        self.assertEqual(tasks[0]["options"], ["本", "张", "条", "只"])
        self.assertEqual(tasks[0]["key"], 1)

    def test_broken_option_line_is_reported(self):
        for line in ("1) 本  2)   3) 条  4) 只", "1) 本  3) 张  2) 条  4) 只"):
            spec, tasks, problems = ig.parse_markdown(SKILL_MD.replace("1) 本  2) 张  3) 条  4) 只", line))
            self.assertEqual([t["taskNumber"] for t in tasks], [20], line)
            self.assertTrue(any(p.startswith("№16:") for p in problems), (line, problems))

    def test_batch_without_grammar_tasks_is_reported(self):
        spec, tasks, problems = ig.parse_markdown("Спецификация: ЕГЭ 2026\n\n**1.** Аудирование\n")
        self.assertEqual(tasks, [])
        self.assertIn("в партии нет заданий 15–27", problems)

    def test_batches_from_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "a.md").write_text(SKILL_MD, encoding="utf-8")
            Path(tmp, "README.md").write_text("Описание формата, не партия.", encoding="utf-8")
            Path(tmp, "b.json").write_text(json.dumps({"specVersion": "ЕГЭ 2026", "tasks": [
                {"taskNumber": 16, "stem": "昨天我在书店买了三_____词典，准备送给我的同学。", "options": ["本", "张", "条", "只"], "key": 1}]}),
                encoding="utf-8")
            Path(tmp, "c.json").write_text(json.dumps({"tasks": [{"taskNumber": 16, "stem": "x", "options": ["a", "b", "c"], "key": 1}]}),
                                           encoding="utf-8")
            records, report = ig.load_batches(tmp)
        self.assertEqual(len(records), 2, "одинаковое задание из двух партий попадает один раз")
        self.assertTrue(any("c.json: не указана версия спецификации" in line for line in report))
        self.assertTrue(any("одинаковые задания" in line for line in report))
        self.assertFalse(any("README" in line for line in report))


    def test_same_task_with_different_keys_is_reported(self):
        task = {"taskNumber": 16, "stem": "昨天我在书店买了三_____词典。", "options": ["本", "张", "条", "只"], "key": 1}
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "a.json").write_text(json.dumps({"specVersion": "ЕГЭ 2026", "tasks": [task]}), encoding="utf-8")
            Path(tmp, "b.json").write_text(json.dumps({"specVersion": "ЕГЭ 2026", "tasks": [dict(task, key=2)]}),
                                           encoding="utf-8")
            records, report = ig.load_batches(tmp)
        self.assertEqual(len(records), 1)
        self.assertTrue(any("разные ключи" in line for line in report), report)


class CommittedTest(unittest.TestCase):
    def test_generated_json_is_up_to_date(self):
        records, _ = ig.load_batches()
        self.assertEqual(records, json.loads(ig.RAW_GENERATED.read_text(encoding="utf-8")),
                         "data/raw/generated.json устарел: запустите import_generated.py")


class GeneratedInBankTest(unittest.TestCase):
    def test_generated_copy_of_fipi_is_excluded(self):
        fipi = fipi_record(qid="q20-aaaaaaaa")
        generated, _ = ig.record({"taskNumber": 20, "stem": fipi["stem"], "options": ["着", "了", "过"], "key": 1},
                                 "b", "g", "ЕГЭ 2026")
        questions, _ = bb.merge([fipi, generated], {}, TOPICS, [rule()])
        status = {q["id"]: q for q in questions}
        self.assertEqual(status[generated["id"]]["reviewStatus"], "excluded")
        self.assertEqual(status[generated["id"]]["duplicateOf"], "q20-aaaaaaaa")
        self.assertEqual(status["q20-aaaaaaaa"]["reviewStatus"], "imported")

    def test_near_copy_of_fipi_is_excluded(self):
        fipi = fipi_record(task=22, qid="q22-b24a67ef", stem="你看，他昨天来找你，今天 ___ 来了。",
                           options=("再", "才", "就", "又"), correct="4")
        near, _ = ig.record({"taskNumber": 22, "stem": "他昨天来了，今天___来了。", "options": ["还", "再", "又", "就"], "key": 3},
                            "b", "g", "ЕГЭ 2026")
        other, _ = ig.record({"taskNumber": 22, "stem": "这个电影我上个月看过，昨天___看了一遍。", "options": ["还", "再", "又", "就"], "key": 3},
                             "b", "g", "ЕГЭ 2026")
        questions, _ = bb.merge([fipi, near, other], {}, TOPICS, [rule()])
        status = {q["id"]: q["reviewStatus"] for q in questions}
        self.assertEqual(status[near["id"]], "excluded")
        self.assertEqual(status[other["id"]], "imported")


if __name__ == "__main__":
    unittest.main()
