"""Сборка слов тренировки тонов: чтение, отчёт, принятие, проверка данных и страница."""

import unittest

from test import helpers  # noqa: F401  (добавляет scripts/ в sys.path)

import accept_tones
import build_site
import build_tones
import tones
import validate
from common import QUESTIONS, TONE_WORDS, read_json


def source(*words):
    return {"source": {"levels": "HSK 2.0"}, "words": list(words)}


def item(word, level=1, table=(), anki=(), ru="значение; другое"):
    return {"word": word, "level": level, "ru": ru, "table": list(table), "anki": list(anki)}


class BuildTest(unittest.TestCase):
    def test_sources_agree_word_is_taken(self):
        kept, skipped, _ = build_tones.build(source(item("整齐", 4, ["zhěngqí"], ["zhěng qí"])), {}, set(), [])
        self.assertEqual(skipped, [])
        self.assertEqual(kept[0]["tones"], [3, 2])
        self.assertEqual(kept[0]["syllables"], ["zhěng", "qí"])
        self.assertEqual(kept[0]["ru"], "значение")
        self.assertEqual(kept[0]["status"], "draft")

    def test_disagreement_in_neutral_tone_is_reported_not_guessed(self):
        kept, skipped, _ = build_tones.build(source(item("困难", 4, ["kùnnan"], ["kùnnán"])), {}, set(), [])
        self.assertEqual(kept, [])
        self.assertIn("расходятся", skipped[0][2])

    def test_word_from_bank_task_15_is_not_taken(self):
        kept, skipped, _ = build_tones.build(source(item("整齐", 4, ["zhěngqí"])), {}, {"整齐"}, [])
        self.assertEqual((kept, skipped[0][2]), ([], "есть среди заданий №15 на сайте"))

    def test_only_published_task_15_takes_the_word_away(self):
        # Черновик №15 (без разбора, не на сайте) ключа не подсказывает: слово остаётся в тренировке.
        questions = [{"taskNumber": 15, "stem": "整齐。", "reviewStatus": "ready"},
                     {"taskNumber": 15, "stem": "漂亮", "reviewStatus": "imported"},
                     {"taskNumber": 16, "stem": "学生", "reviewStatus": "ready"}]
        self.assertEqual(build_tones.fipi_stems(questions), {"整齐"})

    def test_override_fixes_reading_skip_removes_word(self):
        data = source(item("不过", 4, ["bùguò"], ["búguò"]), item("可能", 2, ["kěnéng"]), item("奇怪", 3, ["qíguài"]))
        overrides = {"不过": {"pinyin": "bù guò", "why": "x"}, "可能": {"pinyin": "kě néng", "why": "x"},
                     "奇怪": {"skip": True, "why": "двойное чтение"}}
        kept, skipped, _ = build_tones.build(data, overrides, set(), [])
        self.assertEqual({e["word"]: e["tones"] for e in kept}, {"不过": [4, 4], "可能": [3, 2]})
        self.assertEqual(skipped, [("奇怪", 3, "решение автора: двойное чтение")])

    def test_override_can_change_translation(self):
        kept, _, _ = build_tones.build(source(item("整齐", 4, ["zhěngqí"])), {"整齐": {"ru": "аккуратный", "why": "x"}}, set(), [])
        self.assertEqual(kept[0]["ru"], "аккуратный")

    def test_accepted_stays_accepted_until_the_word_changes(self):
        first, _, _ = build_tones.build(source(item("整齐", 4, ["zhěngqí"])), {}, set(), [])
        accept_tones.accept({"words": first}, everything=True)
        again, _, reopened = build_tones.build(source(item("整齐", 4, ["zhěngqí"])), {}, set(), first)
        self.assertEqual((again[0]["status"], reopened), ("accepted", []))
        changed, _, reopened = build_tones.build(source(item("整齐", 4, ["zhěngqí"])), {"整齐": {"ru": "ровный", "why": "x"}}, set(), first)
        self.assertEqual((changed[0]["status"], reopened), ("draft", ["整齐"]))
        self.assertNotIn("acceptedHash", changed[0])

    def test_report_names_every_skipped_word_and_reopened_ones(self):
        text = build_tones.report_text([], [("困难", 4, "источники расходятся в тонах — 4-0: kùnnan")], ["整齐"])
        self.assertIn("困难", text)
        self.assertIn("整齐", text)
        self.assertIn("Вернулись в черновик", text)


class RealDataTest(unittest.TestCase):
    """Файл data/tone-words.json — результат сборки: руками его не правят."""

    def test_file_matches_rebuild(self):
        sources = read_json(build_tones.WORDS)
        overrides = read_json(build_tones.OVERRIDES) if build_tones.OVERRIDES.exists() else {}
        stems = build_tones.fipi_stems(read_json(QUESTIONS))
        previous = read_json(TONE_WORDS)["words"]
        kept, _, reopened = build_tones.build(sources, overrides, stems, previous)
        self.assertEqual(kept, previous, "data/tone-words.json расходится с пересборкой: python3 scripts/build_tones.py")
        self.assertEqual(reopened, [])

    def test_real_words_pass_validation(self):
        words = read_json(TONE_WORDS)["words"]
        stems = build_tones.fipi_stems(read_json(QUESTIONS))
        self.assertEqual(validate.tone_word_problems(words, stems), [])
        self.assertGreater(len(words), 700)


class ValidationTest(unittest.TestCase):
    def entry(self, **extra):
        base = {"word": "整齐", "level": 4, "pinyin": "zhěngqí", "syllables": ["zhěng", "qí"], "tones": [3, 2],
                "ru": "аккуратный", "status": "draft"}
        return {**base, **extra}

    def problems(self, entry, stems=()):
        return validate.tone_word_problems([entry], stems)

    def test_good_entry(self):
        self.assertEqual(self.problems(self.entry()), [])

    def test_tones_must_match_pinyin(self):
        self.assertIn("не сходятся с пиньинем", " ".join(self.problems(self.entry(tones=[3, 4]))))

    def test_wrong_length_level_and_neutral_first_syllable(self):
        self.assertIn("не столько", " ".join(self.problems(self.entry(tones=[3]))))
        self.assertIn("вне 1–4", " ".join(self.problems(self.entry(level=5))))
        self.assertIn("первый слог не бывает лёгким", " ".join(self.problems(self.entry(tones=[0, 2], pinyin="zhengqí"))))

    def test_word_from_bank_is_refused(self):
        self.assertIn("подсказала бы ключ", " ".join(self.problems(self.entry(), {"整齐"})))

    def test_accepted_must_match_its_hash(self):
        good = self.entry(status="accepted")
        good["acceptedHash"] = tones.fingerprint(good)
        self.assertEqual(self.problems(good), [])
        self.assertIn("изменено после принятия", " ".join(self.problems({**good, "ru": "другой перевод"})))

    def test_duplicate_words(self):
        self.assertIn("повторяется", " ".join(validate.tone_word_problems([self.entry(), self.entry()])))


class SitePayloadTest(unittest.TestCase):
    def words(self):
        draft = {"word": "整齐", "level": 4, "pinyin": "zhěngqí", "syllables": ["zhěng", "qí"], "tones": [3, 2],
                 "ru": "аккуратный", "status": "draft"}
        done = {**draft, "word": "学生", "level": 1, "pinyin": "xuésheng", "syllables": ["xué", "sheng"],
                "tones": [2, 0], "ru": "ученик", "status": "accepted"}
        return [draft, done]

    def test_published_page_has_only_accepted_words(self):
        data = build_site.payload([], [], [], [], tone_words=self.words())
        self.assertEqual([q["stem"] for q in data["tones"]], ["学生"])
        self.assertNotIn("draft", data["tones"][0])

    def test_review_page_shows_drafts_marked(self):
        data = build_site.payload([], [], [], [], drafts=True, tone_words=self.words())
        self.assertEqual({q["stem"]: q.get("draft") for q in data["tones"]}, {"整齐": True, "学生": None})

    def test_common_fields_travel_once(self):
        data = build_site.payload([], [], [], [], drafts=True, tone_words=self.words())
        self.assertEqual(data["toneBase"], tones.QUESTION_BASE)
        for q in data["tones"]:
            self.assertFalse(set(tones.QUESTION_BASE) & set(q))
            self.assertEqual({**data["toneBase"], **q}["taskNumber"], 15)


class AcceptTest(unittest.TestCase):
    def data(self):
        words = [{"word": "整齐", "level": 4, "pinyin": "zhěngqí", "tones": [3, 2], "ru": "аккуратный", "status": "draft"},
                 {"word": "学生", "level": 1, "pinyin": "xuésheng", "tones": [2, 0], "ru": "ученик", "status": "draft"}]
        return {"words": words}

    def test_by_word_and_by_level(self):
        data = self.data()
        self.assertEqual(accept_tones.accept(data, words=["整齐"]), ["整齐"])
        self.assertEqual(accept_tones.accept(data, levels=[1]), ["学生"])
        self.assertTrue(all(e["acceptedHash"] == tones.fingerprint(e) for e in data["words"]))

    def test_accepted_is_not_accepted_twice(self):
        data = self.data()
        accept_tones.accept(data, everything=True)
        self.assertEqual(accept_tones.accept(data, everything=True), [])


if __name__ == "__main__":
    unittest.main()
