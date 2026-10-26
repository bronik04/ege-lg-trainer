"""Слова для тренировки тонов: пиньинь → тоны, варианты ответа и разбор."""

import unittest

from test import helpers  # noqa: F401  (добавляет scripts/ в sys.path)

import tones


class ToneSequenceTest(unittest.TestCase):
    def test_marks_give_tones(self):
        self.assertEqual(tones.tone_sequence("zhěngqí", 2), (3, 2))
        self.assertEqual(tones.tone_sequence("diànyǐng", 2), (4, 3))
        self.assertEqual(tones.tone_sequence("gōngchéngshī", 3), (1, 2, 1))

    def test_no_mark_is_neutral(self):
        self.assertEqual(tones.tone_sequence("xuésheng", 2), (2, 0))
        self.assertEqual(tones.tone_sequence("péngyou", 2), (2, 0))

    def test_spaces_apostrophes_and_hyphens_are_ignored(self):
        self.assertEqual(tones.tone_sequence("tíng zhǐ", 2), (2, 3))
        self.assertEqual(tones.tone_sequence("nǚ’ér", 2), (3, 2))
        self.assertEqual(tones.tone_sequence("nǚ&#x27;ér", 2), (3, 2))
        self.assertEqual(tones.tone_sequence("dào//qiàn", 2), (4, 4))

    def test_breve_stands_for_third_tone(self):
        self.assertEqual(tones.tone_sequence("xuăn", 1), (3,))

    def test_u_umlaut(self):
        self.assertEqual(tones.tone_sequence("lǜshī", 2), (4, 1))
        self.assertEqual(tones.tone_sequence("nǚér", 2), (3, 2))

    def test_syllable_count_must_match_character_count(self):
        # 玩儿 wánr — один слог с «r»: слов с эрхуа в тренировке нет.
        self.assertIsNone(tones.tone_sequence("wánr", 2))
        self.assertIsNone(tones.tone_sequence("zhěngqí", 3))

    def test_ambiguous_split_with_one_tone_sequence_is_fine(self):
        # fāng'àn и fān gàn делятся по-разному, но тоны одни.
        self.assertEqual(tones.tone_sequence("fāngàn", 2), (1, 4))


class ReadingTest(unittest.TestCase):
    def test_same_tones_in_every_candidate(self):
        got = tones.read_candidates(["tíng zhǐ", "tíngzhǐ"], 2)
        self.assertEqual(got, {"pinyin": "tíngzhǐ", "syllables": ["tíng", "zhǐ"], "tones": [2, 3]})

    def test_apostrophe_before_a_vowel_syllable(self):
        got = tones.read_candidates(["nǚ&#x27;ér"], 2)
        self.assertEqual((got["pinyin"], got["syllables"]), ("nǚ'ér", ["nǚ", "ér"]))
        self.assertEqual(tones.read_candidates(["xī ān"], 2)["pinyin"], "xī'ān")

    def test_alternatives_inside_one_field(self):
        got = tones.read_candidates(["fùqīn |&nbsp;fùqin"], 2)
        self.assertIn("расходятся", got["problem"])

    def test_neutral_tone_disagreement_is_disputed(self):
        got = tones.read_candidates(["kùnnan", "kùnnán"], 2)
        self.assertIn("расходятся", got["problem"])

    def test_unreadable_pinyin(self):
        self.assertIn("слоги", tones.read_candidates(["wánr"], 2)["problem"])

    def test_same_tones_but_different_letters_is_a_typo(self):
        # Тоны у обеих записей (1, 1), но одна опечатана: пиньинь увидит ученик.
        got = tones.read_candidates(["bīngxīang", "bīngxiāng"], 2)
        self.assertIn("пишется по-разному", got["problem"])
        self.assertEqual(tones.read_candidates(["bīng xiāng", "bīngxiāng"], 2)["pinyin"], "bīngxiāng")

    def test_no_reading(self):
        self.assertEqual(tones.read_candidates([], 2)["problem"], "нет пиньиня в источниках")

    def test_split_into_syllables_can_be_ambiguous(self):
        # fǎn-gǎn или fǎng-ǎn: показать ученику слог можно только по явной границе.
        self.assertEqual(tones.tone_sequence("fǎngǎn", 2), (3, 3))
        self.assertIsNone(tones.syllabify("fǎngǎn", 2))
        self.assertIn("неоднозначно", tones.read_candidates(["fǎngǎn"], 2)["problem"])
        self.assertEqual(tones.read_candidates(["fǎn gǎn"], 2)["syllables"], ["fǎn", "gǎn"])


class OptionsTest(unittest.TestCase):
    def test_four_distinct_options_with_one_correct(self):
        for word, seq in (("整齐", (3, 2)), ("工程师", (1, 2, 1)), ("学生", (2, 0)), ("你好", (3, 3))):
            options, correct = tones.make_options(word, seq)
            texts = [o["text"] for o in options]
            self.assertEqual(len(set(texts)), 4, word)
            self.assertEqual(texts.count(tones.sequence_text(seq)), 1)
            self.assertEqual(options[int(correct) - 1]["text"], tones.sequence_text(seq))
            self.assertEqual([o["id"] for o in options], ["1", "2", "3", "4"])
            self.assertTrue(all(len(t.split("-")) == len(seq) for t in texts), word)

    def test_distractors_are_valid_sequences_of_the_right_length(self):
        for word, seq in (("整齐", (3, 2)), ("工程师", (1, 2, 1)), ("电影", (4, 3))):
            for option in tones.make_options(word, seq)[0]:
                digits = option["text"].split("-")
                self.assertEqual(len(digits), len(seq))
                self.assertTrue(all(d in "01234" for d in digits))

    def test_options_depend_only_on_the_word(self):
        self.assertEqual(tones.make_options("整齐", (3, 2)), tones.make_options("整齐", (3, 2)))

    def test_position_of_correct_answer_varies(self):
        words = [chr(0x4e00 + i) * 2 for i in range(200)]
        spots = {tones.make_options(w, (3, 2))[1] for w in words}
        self.assertEqual(spots, {"1", "2", "3", "4"})


class SandhiTest(unittest.TestCase):
    def test_heard_forms(self):
        self.assertEqual(tones.heard_sequences("一起", (1, 3)), {(4, 3)})
        self.assertEqual(tones.heard_sequences("可以", (3, 3)), {(2, 3)})
        self.assertEqual(tones.heard_sequences("不过", (4, 4)), {(2, 4)})
        self.assertEqual(tones.heard_sequences("整齐", (3, 2)), set())

    def test_heard_form_is_never_offered_as_an_answer(self):
        for word, seq in (("一起", (1, 3)), ("可以", (3, 3)), ("不过", (4, 4)), ("一般", (1, 1)), ("不客气", (4, 4, 0))):
            texts = {o["text"] for o in tones.make_options(word, seq)[0]}
            for heard in tones.heard_sequences(word, seq):
                self.assertNotIn(tones.sequence_text(heard), texts, word)

    def test_correct_explanation_warns_about_speech(self):
        entry = {"word": "一起", "pinyin": "yīqǐ", "tones": [1, 3], "ru": "вместе"}
        self.assertIn("В речи тон может меняться (4-3), но в записи — словарный тон.", tones.explain_correct(entry))
        plain = {"word": "整齐", "pinyin": "zhěngqí", "tones": [3, 2], "ru": "аккуратный"}
        self.assertNotIn("В речи", tones.explain_correct(plain))

    def test_no_two_neutral_syllables_in_a_distractor(self):
        for i in range(300):
            word = chr(0x4e00 + i) + "客气"
            for option in tones.make_options(word, (4, 4, 0))[0]:
                self.assertLessEqual(option["text"].split("-").count("0"), 1)


class JoinTest(unittest.TestCase):
    def test_ambiguous_joined_spelling_gets_spaces(self):
        self.assertEqual(tones.join_syllables(["tán", "gāng", "qín"]), "tán gāng qín")
        self.assertEqual(tones.join_syllables(["fǎn", "gǎn"]), "fǎn gǎn")

    def test_plain_words_stay_joined(self):
        self.assertEqual(tones.join_syllables(["bàn", "gōng", "shì"]), "bàngōngshì")
        self.assertEqual(tones.join_syllables(["xī", "ān"]), "xī'ān")


class ExplanationTest(unittest.TestCase):
    def setUp(self):
        self.entry = {"word": "整齐", "pinyin": "zhěngqí", "tones": [3, 2], "ru": "аккуратный"}

    def test_correct_names_every_syllable(self):
        text = tones.explain_correct(self.entry)
        self.assertIn("整齐 zhěngqí «аккуратный»", text)
        self.assertIn("整 zhěng — третий тон", text)
        self.assertIn("齐 qí — второй тон", text)
        self.assertIn("3-2", text)

    def test_wrong_option_names_the_syllable_that_differs(self):
        text = tones.explain_wrong(self.entry, (1, 2))
        self.assertIn("1-2", text)
        self.assertIn("первый слог 整 zhěng", text)
        self.assertIn("третьим тоном, а не первым", text)
        self.assertNotIn("齐", text)

    def test_wrong_option_with_both_syllables_different(self):
        text = tones.explain_wrong(self.entry, (4, 1))
        self.assertIn("первый слог 整", text)
        self.assertIn("второй слог 齐 qí", text)

    def test_neutral_tone_is_named(self):
        entry = {"word": "学生", "pinyin": "xuésheng", "tones": [2, 0], "ru": "ученик"}
        self.assertIn("生 sheng — лёгкий тон", tones.explain_correct(entry))
        self.assertIn("второй слог 生 sheng произносится лёгким тоном, а не первым", tones.explain_wrong(entry, (2, 1)))
        self.assertIn("третьим тоном, а не лёгким", tones.explain_wrong(self.entry, (0, 2)))


class QuestionTest(unittest.TestCase):
    def test_question_has_the_shape_of_a_task(self):
        entry = {"word": "整齐", "pinyin": "zhěngqí", "tones": [3, 2], "ru": "аккуратный", "level": 4}
        q = tones.make_question(entry)
        self.assertTrue(q["id"].startswith("w15-"))
        self.assertEqual(q["taskNumber"], 15)
        self.assertEqual(q["origin"], "words")
        self.assertEqual(q["stem"], "整齐")
        self.assertEqual(q["level"], 4)
        self.assertEqual(q["ruleIds"], ["tones-in-words"])
        self.assertEqual(q["topicIds"], ["tones"])
        self.assertEqual(q["prompt"], "Укажите, какое сочетание тонов соответствует сочетанию тонов в слове")
        wrong = {o["id"] for o in q["options"]} - {q["correctOptionId"]}
        self.assertEqual(set(q["explanation"]["options"]), wrong)

    def test_id_is_stable_and_unique(self):
        a = tones.word_id("整齐")
        self.assertEqual(a, tones.word_id("整齐"))
        self.assertNotEqual(a, tones.word_id("整个"))

    def test_fingerprint_changes_with_reading(self):
        base = {"word": "整齐", "pinyin": "zhěngqí", "tones": [3, 2], "ru": "аккуратный", "level": 4}
        other = {**base, "tones": [3, 4]}
        self.assertNotEqual(tones.fingerprint(base), tones.fingerprint(other))
        self.assertEqual(tones.fingerprint(base), tones.fingerprint({**base, "status": "accepted", "acceptedHash": "x"}))


if __name__ == "__main__":
    unittest.main()
