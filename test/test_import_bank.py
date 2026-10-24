"""Импорт заданий 15–27 из снимка единого банка."""

import unittest

from scripts.import_bank import records_from_export

FIPI = "Укажите, какое наречие пропущено в данном предложении."


def block(bank_id, n, prompt, options, correct, *, source="ФИПИ", lg=(), tags=(), note=None, batch="порция"):
    return {
        "id": bank_id,
        "taskNumber": n,
        "state": "отборное",
        "updatedAt": "2026-10-24T00:00:00.000Z",
        "source": source,
        "batch": batch,
        "prompt": prompt,
        "options": [{"id": str(i), "text": t} for i, t in enumerate(options, 1)],
        "correct": correct,
        "codifierCodes": ["2.4.27"],
        "tags": list(tags),
        "note": note,
        "lgIds": list(lg),
    }


def export(blocks, withdrawn=()):
    return {"schemaVersion": 1, "generatedAt": "2026-10-24T12:00:00.000Z", "blocks": blocks, "withdrawn": list(withdrawn)}


class ImportBankTest(unittest.TestCase):
    def test_linked_fipi_task_keeps_its_id_and_source(self):
        b = block("05d752ed-a8b5-4332-bee0-221a918b27f3", 22, "我们明天___去吧。", ["就", "才", "还", "再"], "4",
                  lg=["q22-05d752ed"], tags=["Банк ФИПИ", "ФИПИ 3872A5", "КЭС ФИПИ 2.4.27"])
        records, new_links, problems = records_from_export(export([b]), {})
        self.assertEqual(problems, [])
        self.assertEqual(new_links, {})
        [r] = records
        self.assertEqual(r["id"], "q22-05d752ed")
        self.assertEqual(r["origin"], "fipi")
        self.assertEqual(r["prompt"], FIPI)
        self.assertEqual(r["stem"], "我们明天___去吧。")
        self.assertEqual(r["correctOptionId"], "4")
        self.assertEqual(r["sourceRef"]["fipiId"], "3872A5")
        self.assertEqual(r["sourceRef"]["kes"], ["2.4.27"])
        self.assertEqual(r["sourceRef"]["constructorBlockId"], b["id"])
        self.assertEqual(r["sourceRef"]["bankId"], b["id"])

    def test_edited_text_keeps_the_id(self):
        b = block("aaaa1111-0000", 22, "我们后天___去吧。", ["就", "才", "还", "再"], "4", source="тренажёр ЛГ",
                  lg=["g22-0efff49d"], note="Разбор: … Источник: тренажёр ЛГ, партия 2026-10-10-claude-16, g22-0efff49d.")
        [r], _, _ = records_from_export(export([b]), {})
        self.assertEqual(r["id"], "g22-0efff49d")
        self.assertEqual(r["origin"], "generated")
        self.assertEqual(r["sourceRef"]["batch"], "2026-10-10-claude-16")
        self.assertEqual(r["sourceRef"]["specVersion"], "ЕГЭ 2026")

    def test_new_tasks_get_ids_from_the_bank_and_are_listed_for_linking(self):
        fresh = [
            block("abcdef12-1111", 22, "他今天___来。", ["就", "才", "还", "再"], "2", source="скилл ege-chinese", batch="2026-10 наречия"),
            block("bcdef123-2222", 26, "A) 我\nB) 去\nC) 学校", ["ABC", "ACB", "BAC", "CAB"], "1", source="HSK4",
                  tags=["HSK4", "HSK4 H41007 №61"]),
            block("cdef1234-3333", 16, "他买了两___书。", ["个", "本", "张", "件"], "2"),
        ]
        records, new_links, _ = records_from_export(export(fresh), {})
        ids = {r["sourceRef"]["bankId"]: r["id"] for r in records}
        self.assertEqual(ids, {"abcdef12-1111": "g22-abcdef12", "bcdef123-2222": "h26-bcdef123", "cdef1234-3333": "q16-cdef1234"})
        self.assertEqual(new_links, {v: k for k, v in ids.items()})
        hsk = next(r for r in records if r["origin"] == "hsk")
        self.assertEqual((hsk["sourceRef"]["paper"], hsk["sourceRef"]["number"]), ("H41007", 61))
        self.assertEqual([f["id"] for f in hsk["fragments"]], ["A", "B", "C"])
        gen = next(r for r in records if r["origin"] == "generated")
        self.assertEqual(gen["sourceRef"]["batch"], "2026-10 наречия")

    def test_withdrawn_task_is_not_imported(self):
        keep = block("aaaa1111-0000", 22, "我们明天___去吧。", ["就", "才", "还", "再"], "4", lg=["q22-aaaa1111"])
        records, _, _ = records_from_export(export([keep], withdrawn=["g22-0efff49d"]), {})
        self.assertEqual([r["id"] for r in records], ["q22-aaaa1111"])

    def test_replaces_comes_from_the_explanation(self):
        b = block("dddd4444-0000", 16, "她送了一大___花。", ["支", "束", "件", "个"], "2", source="тренажёр ЛГ", lg=["g16-56406db2"])
        authored = {"g16-56406db2": {"status": "accepted", "replaces": "q16-15173f0c"}}
        [r], _, _ = records_from_export(export([b]), authored)
        self.assertEqual(r["replaces"], "q16-15173f0c")

    def test_broken_task_is_reported(self):
        b = block("eeee5555-0000", 22, "他___来。", ["就", "才", "还", "再"], "9", lg=["q22-eeee5555"])
        records, _, problems = records_from_export(export([b]), {})
        self.assertEqual(records[0]["issues"], ["ключ '9' не совпадает ни с одним вариантом"])


if __name__ == "__main__":
    unittest.main()
