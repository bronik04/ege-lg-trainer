"""Снимок выгрузки единого банка в sources/bank."""

import json
import tempfile
import unittest
from pathlib import Path

from scripts.common import load_bank_snapshot
from scripts.snapshot_bank import snapshot


def export(blocks=None, schema=1):
    return {
        "schemaVersion": schema,
        "generatedAt": "2026-10-24T12:00:00.000Z",
        "bankDir": "/банк",
        "blocks": blocks if blocks is not None else [{"id": "a", "taskNumber": 22}, {"id": "b", "taskNumber": 16}],
        "withdrawn": [],
    }


class BankSnapshotTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.source = self.root / "export.json"
        self.target = self.root / "sources" / "bank"

    def write(self, payload):
        self.source.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    def test_snapshot_is_read_back_with_counts_in_manifest(self):
        self.write(export())
        snapshot(self.source, self.target)
        manifest = json.loads((self.target / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["generatedAt"], "2026-10-24T12:00:00.000Z")
        self.assertEqual(manifest["taskCounts"], {"16": 1, "22": 1})
        self.assertEqual(load_bank_snapshot(self.target)["blocks"][0]["id"], "a")

    def test_edited_snapshot_is_rejected(self):
        self.write(export())
        snapshot(self.source, self.target)
        path = self.target / "export.json"
        path.write_text(path.read_text(encoding="utf-8").replace('"a"', '"z"'), encoding="utf-8")
        with self.assertRaisesRegex(SystemExit, "изменён вручную"):
            load_bank_snapshot(self.target)

    def test_unknown_schema_is_rejected(self):
        self.write(export(schema=2))
        with self.assertRaisesRegex(SystemExit, "schemaVersion"):
            snapshot(self.source, self.target)


if __name__ == "__main__":
    unittest.main()
