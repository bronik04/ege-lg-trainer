"""Задания HSK 4 (№26): снимок файла автора, импорт, место в банке."""

import contextlib
import hashlib
import io
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from test import helpers  # noqa: F401  (добавляет scripts/ в sys.path)

import build_bank as bb
import import_hsk as imp
from common import HSK_MANIFEST, HSK_SOURCE, INSTRUCTIONS, read_json
from test.helpers import TOPICS, authored_for, record as fipi_record, rule


def block(source="样卷 H40000 №56", fragments=("他就给我打了电话", "说明天不来了", "我刚到家"),
          options=("CAB", "ABC", "CBA", "BAC"), answer="1", number=26):
    """Блок «ЕГЭ Конструктора», как в файле автора."""
    lines = [f"# Блок: задание {number}", "название: Порядок слов",
             f"теги: HSK4, Порядок фрагментов, HSK4 {source}, добавлено 2026-09", "", "## Задание", "стем:"]
    lines += [f"{letter}) {text}" for letter, text in zip("ABC", fragments)]
    lines += [f"{i}. {o}" for i, o in enumerate(options, 1)]
    lines.append(f"ответ: {answer}")
    return "\n".join(lines) + "\n\n"


def parse(text, file_name="hsk4-task26.md"):
    return imp.record(imp.split_blocks(text)[0][1], file_name)


def snapshot_files(directory=HSK_SOURCE):
    return sorted(p.name for p in Path(directory).glob("*.md") if p.name != "README.md")


class SnapshotTest(unittest.TestCase):
    def test_snapshot_matches_manifest(self):
        manifest = read_json(HSK_MANIFEST)
        self.assertEqual(snapshot_files(), sorted(manifest["files"]))
        for name, digest in manifest["files"].items():
            self.assertEqual(hashlib.sha256((HSK_SOURCE / name).read_bytes()).hexdigest(), digest, name)

    def test_file_is_copied_byte_for_byte(self):
        import snapshot_hsk as snap
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "hsk4_задание26.md"
            source.write_bytes("# Блок: задание 26\r\nтеги: HSK4\n".encode("utf-8"))
            out = Path(tmp) / "hsk4"
            out.mkdir()
            (out / "README.md").write_text("Описание папки.\n", encoding="utf-8")
            (out / "old.md").write_text("старый снимок\n", encoding="utf-8")
            with mock.patch.multiple(snap, HSK_SOURCE=out, HSK_MANIFEST=out / "manifest.json"), \
                    contextlib.redirect_stdout(io.StringIO()):
                snap.main(["snapshot", str(source)])
            self.assertEqual((out / snap.SNAPSHOT_NAME).read_bytes(), source.read_bytes())
            self.assertEqual(sorted(p.name for p in out.iterdir()), ["README.md", "hsk4-task26.md", "manifest.json"])
            manifest = read_json(out / "manifest.json")
            self.assertEqual(manifest["files"], {"hsk4-task26.md": hashlib.sha256(source.read_bytes()).hexdigest()})


class RecordTest(unittest.TestCase):
    def test_block_becomes_bank_record(self):
        [(number, _)] = imp.split_blocks(block())
        self.assertEqual(number, 26)
        rec, problems = parse(block())
        self.assertEqual(problems, [])
        self.assertTrue(rec["id"].startswith("h26-"))
        self.assertEqual(rec["id"], imp.hsk_id(rec["stem"], ["CAB", "ABC", "CBA", "BAC"]))
        self.assertEqual(rec["origin"], "hsk")
        self.assertEqual(rec["formatYear"], 2026)
        self.assertEqual(rec["sourceRef"], {"collection": "HSK 4", "paper": "样卷 H40000", "number": 56,
                                            "file": "sources/hsk4/hsk4-task26.md"})
        self.assertEqual(rec["prompt"], INSTRUCTIONS[26])
        self.assertEqual(rec["stem"], "A) 他就给我打了电话\nB) 说明天不来了\nC) 我刚到家")
        self.assertEqual(rec["fragments"], [{"id": "A", "text": "他就给我打了电话"},
                                            {"id": "B", "text": "说明天不来了"}, {"id": "C", "text": "我刚到家"}])
        self.assertEqual([o["text"] for o in rec["options"]], ["CAB", "ABC", "CBA", "BAC"])
        self.assertEqual(rec["correctOptionId"], "1")

    def test_id_depends_on_text_only(self):
        a, _ = parse(block())
        b, _ = parse(block(source="H41001 №60"), "other.md")
        c, _ = parse(block(fragments=("他就给我打了电话", "说明天不来了", "我刚回家")))
        self.assertEqual(a["id"], b["id"])
        self.assertNotEqual(a["id"], c["id"])

    def test_broken_blocks_are_reported_not_imported(self):
        broken = {
            "нет фрагмента C": block(fragments=("他就给我打了电话", "说明天不来了")),
            "три варианта": block(options=("CAB", "ABC", "CBA")),
            "повтор варианта": block(options=("CAB", "CAB", "CBA", "BAC")),
            "не перестановка": block(options=("CAB", "ABB", "CBA", "BAC")),
            "ответ вне 1–4": block(answer="5"),
            "нет источника": block().replace("HSK4 样卷 H40000 №56, ", ""),
        }
        for name, text in broken.items():
            rec, problems = parse(text)
            self.assertIsNone(rec, name)
            self.assertTrue(problems, name)


class LoadTest(unittest.TestCase):
    def load(self, text):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "hsk4-task26.md").write_text(text, encoding="utf-8")
            (Path(tmp) / "README.md").write_text("# Не задания\n", encoding="utf-8")
            return imp.load(tmp)

    def test_blue_book_is_not_taken(self):
        records, problems, skipped = self.load(
            block() + block(source="Blue book комплект 1 №57", fragments=("你先走吧", "我马上就来", "别等我了")))
        self.assertEqual([r["sourceRef"]["paper"] for r in records], ["样卷 H40000"])
        self.assertEqual(skipped, {"Blue book": 1})
        self.assertEqual(problems, [])

    def test_other_numbers_and_repeats_are_reported(self):
        records, problems, _ = self.load(block() + block(source="H41001 №58") + block(number=25))
        self.assertEqual(len(records), 1)
        self.assertTrue(any("задание 25" in p for p in problems), problems)
        self.assertTrue(any("одинаковые задания" in p for p in problems), problems)

    def test_report_names_sources_and_skipped(self):
        records, problems, skipped = self.load(block() + block(source="Blue book комплект 1 №57", answer="9"))
        text = imp.report(records, problems, skipped)
        self.assertIn("Записей: 1.", text)
        self.assertIn("Не берутся по решению автора: Blue book — 1.", text)
        self.assertIn("| 样卷 H40000 | 1 |", text)
        self.assertIn("## Замечания\n\nНет.", text)



def hsk(**kw):
    rec, problems = parse(block(**kw))
    assert not problems, problems
    return rec


class BankTest(unittest.TestCase):
    def test_hsk_task_goes_through_pipeline(self):
        rec = hsk()
        entry = authored_for(rec, topic_ids=("sentence-order",))
        questions, _ = bb.merge([rec], {rec["id"]: entry}, TOPICS, [rule()])
        self.assertEqual(questions[0]["reviewStatus"], "ready")
        self.assertEqual(bb.merge([rec], {}, TOPICS, [rule()])[0][0]["reviewStatus"], "imported")

    def test_near_copy_of_fipi_is_a_repeat(self):
        fipi = fipi_record(task=26, qid="q26-aaaaaaaa", stem="A) 他就给我打了电话\nB) 说明天不来了\nC) 我刚到家",
                           options=("ABC", "ACB", "CAB", "BCA"), correct="3")
        rec = hsk()
        status = {q["id"]: q for q in bb.merge([fipi, rec], {}, TOPICS, [rule()])[0]}
        self.assertEqual(status[rec["id"]]["reviewStatus"], "excluded")
        self.assertEqual(status[rec["id"]]["duplicateOf"], "q26-aaaaaaaa")

    def test_hsk_task_with_fipi_key_hint_is_excluded(self):
        # Ключ 才 задания ФИПИ с соседними иероглифами («小时才», «才能到») стоит во фрагменте задания HSK:
        # ученик увидит его до ответа. Ни то, ни другое не правят — задание HSK не публикуется.
        fipi = fipi_record(task=22, qid="q22-cccccccc", stem="坐地铁要坐一个多小时___能到。",
                           options=("才", "只", "就", "再"), correct="1")
        leaking = hsk(fragments=("走路要一个多小时才能到", "所以我们打车去吧", "学校离这儿很远"))
        clean = hsk(source="H41001 №57")
        records = [fipi, leaking, clean]
        questions, _ = bb.merge(records, {}, TOPICS, [rule()])
        status = {q["id"]: q for q in questions}
        self.assertEqual(status[leaking["id"]]["reviewStatus"], "excluded")
        self.assertEqual(status[leaking["id"]]["hintsKeyOf"], ["q22-cccccccc"])
        self.assertNotIn("duplicateOf", status[leaking["id"]])
        self.assertEqual(status[clean["id"]]["reviewStatus"], "imported")
        report = bb.duplicates_report(records, questions)
        self.assertIn("## Задания HSK с подсказкой ключа ФИПИ (не публикуются)", report)
        self.assertIn(f"- `{leaking['id']}` (样卷 H40000, №56): `q22-cccccccc`", report)


if __name__ == "__main__":
    unittest.main()
