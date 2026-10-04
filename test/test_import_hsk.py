"""Задания HSK 4 (№26): снимок файла автора, импорт, место в банке."""

import contextlib
import hashlib
import io
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from test import helpers  # noqa: F401  (добавляет scripts/ в sys.path)

from common import HSK_MANIFEST, HSK_SOURCE, read_json


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


if __name__ == "__main__":
    unittest.main()
