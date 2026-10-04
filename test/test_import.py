import contextlib
import hashlib
import io
import json
import tempfile
import unittest
import unittest.mock
from pathlib import Path

from test import helpers  # noqa: F401  (добавляет scripts/ в sys.path)

import import_constructor as imp
from common import MANIFEST, RAW, SNAPSHOT, read_json


def block(kind="grammar-20", options=("了", "着", "过"), correct="2", prompt="老板正开___会。", tags=("Банк ФИПИ",)):
    return {
        "id": "190b16c0-d583-4585-a255-54b35c99ab26",
        "type": kind,
        "codifierCodes": ["2.4.34"],
        "tasks": [{"id": "t1", "prompt": prompt,
                   "options": [{"id": str(i), "text": t} for i, t in enumerate(options, 1)],
                   "positions": [{"id": "p1", "correct": correct}]}],
        "tags": list(tags),
    }


class ConvertTest(unittest.TestCase):
    def test_three_options_kept_in_source_order(self):
        rec = imp.convert(block(), "x.json")
        self.assertEqual(rec["id"], "q20-190b16c0")
        self.assertEqual([o["text"] for o in rec["options"]], ["了", "着", "过"])
        self.assertEqual(rec["correctOptionId"], "2")
        self.assertEqual(rec["formatYear"], 2026)
        self.assertEqual(rec["origin"], "fipi")
        self.assertNotIn("issues", rec)

    def test_stem_is_not_edited(self):
        rec = imp.convert(block(prompt="  整齐. "), "x.json")
        self.assertEqual(rec["stem"], "  整齐. ")

    def test_fipi_id_and_kes_from_tags(self):
        rec = imp.convert(block(tags=("Банк ФИПИ", "ФИПИ 3872A5", "КЭС ФИПИ 2.1.4")), "x.json")
        self.assertEqual(rec["sourceRef"]["fipiId"], "3872A5")
        self.assertEqual(rec["sourceRef"]["kes"], ["2.1.4"])

    def test_block_without_fipi_tag_or_with_stimulus_is_reported(self):
        # Не из банка ФИПИ — не «Открытый банк заданий ФИПИ»; стимул (текст, картинка) не переносится.
        rec = imp.convert(block(tags=("Мои задания",)), "x.json")
        self.assertIn("в блоке нет тега «Банк ФИПИ»", rec["issues"])
        rec = imp.convert(dict(block(), stimulus={"kind": "text", "text": "Прочитайте текст."}), "x.json")
        self.assertIn("у блока есть стимул (text) — он не переносится", rec["issues"])
        self.assertNotIn("issues", imp.convert(dict(block(), stimulus={"kind": "none"}), "x.json"))

    def test_missing_key_is_reported_not_fixed(self):
        rec = imp.convert(block(correct="9"), "x.json")
        self.assertEqual(rec["correctOptionId"], "9")
        self.assertIn("ключ '9' не совпадает ни с одним вариантом", rec["issues"])

    def test_fragments_multiline(self):
        rec = imp.convert(block(kind="grammar-26", options=("CAB", "ACB", "BAC", "BCA"), correct="1",
                                prompt="A) 这是趋势\nB) 所以你要提高\nC) 现代社会竞争激烈."), "x.json")
        self.assertEqual([f["id"] for f in rec["fragments"]], ["A", "B", "C"])
        self.assertEqual(rec["fragments"][2]["text"], "现代社会竞争激烈.")

    def test_fragments_single_line(self):
        frags = imp.parse_fragments("A 我儿子长得快 B 今年不能穿了 C 去年我买了衣服")
        self.assertEqual([f["text"] for f in frags], ["我儿子长得快", "今年不能穿了", "去年我买了衣服"])

    def test_unparsed_fragments_are_an_issue(self):
        rec = imp.convert(block(kind="grammar-26", options=("CAB", "ACB", "BAC", "BCA"), correct="1",
                                prompt="без фрагментов"), "x.json")
        self.assertNotIn("fragments", rec)
        self.assertIn("не удалось выделить фрагменты A, B, C", rec["issues"])

    def test_odd_number_spacing_is_a_note(self):
        rec = imp.convert(block(kind="grammar-19", options=("754300 267", "754 003 267", "1", "2"), correct="1",
                                prompt="七亿"), "x.json")
        self.assertNotIn("issues", rec)
        self.assertIn("754300 267", rec["notes"][0])


class SnapshotTest(unittest.TestCase):
    def test_snapshot_matches_manifest(self):
        manifest = read_json(MANIFEST)
        files = sorted(p.name for p in SNAPSHOT.glob("*.json"))
        self.assertEqual(files, sorted(manifest["files"]))
        for name, digest in manifest["files"].items():
            self.assertEqual(hashlib.sha256((SNAPSHOT / name).read_bytes()).hexdigest(), digest, name)

    def test_reimport_is_deterministic_and_committed(self):
        first, skipped = imp.load_snapshot()
        second, _ = imp.load_snapshot()
        self.assertEqual(first, second)
        self.assertEqual(skipped, [])
        self.assertEqual(first, read_json(RAW), "data/raw/fipi.json устарел: запустите import_constructor.py")

    def test_block_without_task_is_skipped_not_crashing(self):
        with tempfile.TemporaryDirectory() as tmp:
            empty = dict(block(), tasks=[])
            (Path(tmp) / "empty.json").write_text(json.dumps(empty), encoding="utf-8")
            (Path(tmp) / "ok.json").write_text(json.dumps(block()), encoding="utf-8")
            records, skipped = imp.load_snapshot(tmp)
        self.assertEqual(len(records), 1)
        self.assertIn("empty.json", skipped[0])

    def test_every_position_imported(self):
        numbers = {r["taskNumber"] for r in read_json(RAW)}
        self.assertEqual(numbers, set(range(15, 28)))

    def test_three_options_for_20_and_21(self):
        for r in read_json(RAW):
            expected = 3 if r["taskNumber"] in (20, 21) else 4
            self.assertEqual(len(r["options"]), expected, r["id"])


if __name__ == "__main__":
    unittest.main()


class SnapshotFilterTest(unittest.TestCase):
    def test_only_fipi_blocks_are_copied(self):
        import snapshot_constructor as snap
        with tempfile.TemporaryDirectory() as tmp:
            bank, out = Path(tmp) / "blocks", Path(tmp) / "sources"
            bank.mkdir()
            (bank / "a.json").write_text(json.dumps(block(), ensure_ascii=False), encoding="utf-8")
            (bank / "b.json").write_text(json.dumps(dict(block(tags=("Мои задания",)), id="b")), encoding="utf-8")
            (bank / "c.json").write_text(json.dumps(dict(block(kind="reading-5"), id="c")), encoding="utf-8")
            with unittest.mock.patch.multiple(snap, SNAPSHOT=out / "constructor-bank", MANIFEST=out / "manifest.json"), \
                    contextlib.redirect_stdout(io.StringIO()):
                snap.main(["snapshot", str(bank)])
            self.assertEqual(sorted(p.name for p in (out / "constructor-bank").iterdir()), ["a.json"])
            self.assertEqual(list(read_json(out / "manifest.json")["files"]), ["a.json"])
