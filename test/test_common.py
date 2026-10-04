"""Запись файлов данных: обрыв посреди записи не портит файл."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from test import helpers  # noqa: F401  (добавляет scripts/ в sys.path)

import common


class WriteTest(unittest.TestCase):
    def test_interrupted_write_keeps_old_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "task-20.json"
            common.write_json(path, {"q20-a": {"status": "accepted"}})
            with mock.patch("os.replace", side_effect=KeyboardInterrupt):
                with self.assertRaises(KeyboardInterrupt):
                    common.write_json(path, {"q20-a": {"status": "draft"}})
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), {"q20-a": {"status": "accepted"}})
            self.assertEqual([p.name for p in Path(tmp).iterdir()], ["task-20.json"], "временный файл убран")
            common.write_json(path, {"q20-a": {"status": "draft"}})
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), {"q20-a": {"status": "draft"}})


if __name__ == "__main__":
    unittest.main()
