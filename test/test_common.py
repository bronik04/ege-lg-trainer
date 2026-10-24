"""Запись файлов данных: обрыв посреди записи не портит файл."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from test import helpers  # noqa: F401  (добавляет scripts/ в sys.path)

import common


class FragmentsAndNotesTest(unittest.TestCase):
    def test_fragments_on_separate_lines_and_in_one_line(self):
        expected = [{"id": "A", "text": "我"}, {"id": "B", "text": "去"}, {"id": "C", "text": "学校"}]
        self.assertEqual(common.parse_fragments("A) 我\nB) 去\nC) 学校"), expected)
        self.assertEqual(common.parse_fragments("A 我 B 去 C 学校"), expected)

    def test_unparsed_fragments(self):
        self.assertIsNone(common.parse_fragments("A) 我\nC) 学校"))
        self.assertIsNone(common.parse_fragments("我去学校"))

    def test_quality_notes(self):
        options = [{"id": str(i), "text": t} for i, t in enumerate(["350", "三百五", "1 200", "305"], 1)]
        self.assertEqual(common.quality_notes(19, options), ["нестандартная запись числа в вариантах: 三百五"])
        self.assertEqual(common.quality_notes(24, [{"id": "1", "text": "完"}, {"id": "2", "text": "到"}]),
                         ["в вариантах нет 得/不: по формату это задание 23 (результативная морфема), а не 24"])


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
