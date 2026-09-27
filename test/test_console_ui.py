import contextlib
import io
import unittest

from test import helpers  # noqa: F401 — кладёт scripts/ в sys.path

import console_ui as ui


class WidthTest(unittest.TestCase):
    def test_han_takes_two_cells(self):
        self.assertEqual(ui.columns("你好a"), 5)
        self.assertEqual(ui.columns("，。"), 4)

    def test_clip_does_not_split_han(self):
        self.assertEqual(ui.clip("你好世界", 5), "你好…")
        self.assertEqual(ui.clip("abc", 5), "abc")

    def test_pad_counts_cells(self):
        self.assertEqual(ui.pad("你", 4), "你  ")


class CleanTest(unittest.TestCase):
    def test_control_characters_removed_newlines_kept(self):
        self.assertEqual(ui.clean("a\x1b[31mb\tc\r\nd\x07\x9b"), "a[31mb    c\nd")


class AnswerTest(unittest.TestCase):
    def test_page_answers(self):
        self.assertEqual(ui.parse_page("в", 4), {"all": True})
        self.assertEqual(ui.parse_page("D", 4), {"all": True}, "латинская раскладка")
        self.assertEqual(ui.parse_page("п", 4), {"skip": True})
        self.assertEqual(ui.parse_page("g", 4), {"skip": True})
        self.assertEqual(ui.parse_page("0", 4), {"exit": True})
        self.assertEqual(ui.parse_page("  ", 4), {"error": "empty"})
        self.assertEqual(ui.parse_page(None, 4), {"error": "empty"})
        self.assertEqual(ui.parse_page("3 1,3", 4), {"wrong": [1, 3]})
        self.assertEqual(ui.parse_page("5", 4), {"error": "number"})
        self.assertEqual(ui.parse_page("1 x", 4), {"error": "number"})

    def test_choice(self):
        self.assertEqual(ui.parse_choice("Н", {"в", "н"}), "н")
        self.assertEqual(ui.parse_choice("y", {"в", "н"}), "н")
        self.assertIsNone(ui.parse_choice("", {"в"}))
        self.assertIsNone(ui.parse_choice("7", {"1", "2"}))


class PagesTest(unittest.TestCase):
    def test_pages_do_not_mix_keys(self):
        items = [(20, "a"), (20, "b"), (20, "c"), (21, "d")]
        self.assertEqual(ui.pages(items, 2, key=lambda x: x[0]),
                         [[(20, "a"), (20, "b")], [(20, "c")], [(21, "d")]])
        self.assertEqual(ui.pages([], 4, key=lambda x: x), [])


class AskerTest(unittest.TestCase):
    def test_lines_then_none(self):
        ask = ui.Asker(io.StringIO("  в \n1 2\n"))
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(ask("? "), "в")
            self.assertEqual(ask("? "), "1 2")
            self.assertIsNone(ask("? "))


class MenuTest(unittest.TestCase):
    def run_menu(self, answers):
        ask = ui.Asker(io.StringIO("".join(a + "\n" for a in answers)))
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            result = ui.menu(ask, "Заголовок", [("Разборы", "ждут 2"), ("Правила", "ждут 0")], "Номер:",
                             footer=["Подвал"])
        return result, out.getvalue()

    def test_number_enter_zero_and_retry(self):
        self.assertEqual(self.run_menu(["2"])[0], 1)
        self.assertEqual(self.run_menu([""])[0], "enter")
        self.assertIsNone(self.run_menu(["0"])[0])
        self.assertIsNone(self.run_menu([])[0], "ввод кончился")
        result, out = self.run_menu(["9", "1"])
        self.assertEqual(result, 0)
        self.assertIn("Не понял ответ", out)
        self.assertIn("Подвал", out)


if __name__ == "__main__":
    unittest.main()
