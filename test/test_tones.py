"""Слова для тренировки тонов: пиньинь → тоны, варианты ответа и разбор."""

import itertools
import json
import unittest
from collections import Counter
from pathlib import Path

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


def _digits(text):
    return tuple(int(d) for d in text.split("-"))


def _overlap(a, b):
    return sum(x == y for x, y in zip(a, b))


class SyllableTableTest(unittest.TestCase):
    def test_plain_syllable(self):
        self.assertEqual([tones.plain_syllable(s) for s in ("nǚ", "lǜ", "zhōng", "ér", "lüè", "mā")], ["nv", "lv", "zhong", "er", "lve", "ma"])

    def test_table_knows_real_syllables_and_not_zai2(self):
        known = tones.syllable_tones()
        self.assertEqual(set(known["zai"]), {1, 3, 4})
        self.assertEqual(set(known["nuan"]) - {2, 4}, {3})  # nuán и nuàn бывают только у редких иероглифов
        self.assertEqual(known["nuan"].get(2, 0), 0)
        self.assertIn(3, known["nv"])
        self.assertNotIn(2, known["zai"])

    def test_every_correct_syllable_of_every_word_is_in_the_table(self):
        known = tones.syllable_tones()
        words = json.loads((Path(__file__).resolve().parent.parent / "data" / "tone-words.json").read_text(encoding="utf-8"))["words"]
        for w in words:
            for syllable, tone in zip(w["syllables"], w["tones"]):
                if tone:
                    self.assertIn(tone, known.get(tones.plain_syllable(syllable), set()), f"{w['word']} {syllable}")

    def test_options_use_existing_syllables_where_the_word_allows(self):
        # Вариант с несуществующим слогом (zái) отбрасывают, не зная слова; редкое чтение (xín) — почти так же.
        known = tones.syllable_tones()
        words = json.loads((Path(__file__).resolve().parent.parent / "data" / "tone-words.json").read_text(encoding="utf-8"))["words"]
        absent = rare = 0
        for w in words:
            syllables = [tones.plain_syllable(s) for s in w["syllables"]]
            options, correct = tones.make_options(w["word"], tuple(w["tones"]), syllables, known)
            counts = [known.get(syllables[i], {}).get(t) for o in options for i, t in enumerate(_digits(o["text"])) if t]
            absent += any(c is None for c in counts)
            rare += any(c == 0 for c in counts)
        self.assertLess(absent / len(words), 0.05)
        self.assertLess(rare / len(words), 0.15)

    def test_homograph_reading_is_not_offered(self):
        # 结果 jiéguǒ «результат»: 1-3 — jiēguǒ «плодоносить», другое слово тех же иероглифов.
        for syllables in (None, ["jie", "guo"]):
            texts = {o["text"] for o in tones.make_options("结果", (2, 3), syllables, tones.syllable_tones() if syllables else None)[0]}
            self.assertNotIn("1-3", texts)
        # Другие чтения тех же иероглифов (dàngshí, chéngjī, yīnwéi…) не предлагаются ни у одного слова из данных.
        words = json.loads((Path(__file__).resolve().parent.parent / "data" / "tone-words.json").read_text(encoding="utf-8"))["words"]
        for w in words:
            if w["word"] in tones.HOMOGRAPHS:
                texts = {o["text"] for o in tones.make_question(w)["options"]}
                for reading in tones.HOMOGRAPHS[w["word"]]:
                    self.assertNotIn(tones.sequence_text(reading), texts, w["word"])

    def test_signature_of_options_is_part_of_the_fingerprint(self):
        entry = {"word": "整齐", "pinyin": "zhěngqí", "tones": [3, 2], "ru": "аккуратный", "level": 4}
        before = tones.fingerprint(entry)
        original = dict(tones.HOMOGRAPHS)
        try:
            tones.HOMOGRAPHS["整齐"] = {(3, 4)}
            self.assertNotEqual(before, tones.fingerprint(entry))
        finally:
            tones.HOMOGRAPHS.clear()
            tones.HOMOGRAPHS.update(original)


class GuessingTest(unittest.TestCase):
    """Верный вариант нельзя найти, не зная тонов: он не похож на остальные ни больше, ни меньше других.

    Раньше три неверных были «верный с одной правкой», и верный находился как вариант, самый похожий на
    остальные (80% против 25% случайных): ученики угадывали подстановкой."""

    @classmethod
    def setUpClass(cls):
        words = json.loads((Path(__file__).resolve().parent.parent / "data" / "tone-words.json").read_text(encoding="utf-8"))["words"]
        cls.syllables = {w["word"]: [tones.plain_syllable(x) for x in w["syllables"]] for w in words}
        cls.cases = [(w["word"], tuple(w["tones"])) for w in words]
        # Все сочетания тонов у слов без 不 и 一 (знаки с U+4E20, 一 — U+4E00, 不 — U+4E0D): проверка не
        # зависит от того, какие слова взяли.
        cls.cases += [(chr(0x4e20 + i) + chr(0x4e80 + i), (a, b)) for i, (a, b) in
                      enumerate((a, b) for a in (1, 2, 3, 4) for b in (0, 1, 2, 3, 4))]
        cls.cases += [(chr(0x4e20 + i) + chr(0x4e80 + i) + chr(0x4f00 + i), (a, b, c)) for i, (a, b, c) in
                      enumerate((a, b, c) for a in (1, 2, 3, 4) for b in (0, 1, 2, 3, 4) for c in (0, 1, 2, 3, 4)
                                if b or c)]

    def questions(self):
        for word, seq in self.cases:
            # Слова из данных — как на сайте (с таблицей слогов); синтетические сочетания — без неё.
            syllables = self.syllables.get(word)
            options, correct = tones.make_options(word, seq, syllables, tones.syllable_tones() if syllables else None)
            yield word, seq, [_digits(o["text"]) for o in options], int(correct) - 1

    def test_every_option_is_as_similar_to_the_others_as_the_correct_one(self):
        for word, seq, options, correct in self.questions():
            scores = [sum(_overlap(o, p) for p in options if p is not o) for o in options]
            self.assertEqual(len(set(scores)), 1, f"{word} {seq}: {options}")

    def test_no_syllable_gives_the_answer_by_majority(self):
        for word, seq, options, correct in self.questions():
            for i in range(len(seq)):
                counts = Counter(o[i] for o in options).most_common()
                if len(counts) > 1:
                    self.assertEqual(counts[0][1], counts[1][1], f"{word} {seq}: {options}")

    def test_correct_option_is_not_marked_by_neutral_tone_or_digit_frequency(self):
        # Лёгкий тон у неверного варианта и общий перекос цифр — тоже подсказки.
        total = Counter(d for _, seq in self.cases for d in seq)
        weight = {d: n / sum(total.values()) for d, n in total.items()}
        neutral_hint = prior_hits = 0
        for word, seq, options, correct in self.questions():
            if any(0 in o for o in options) and 0 not in seq:
                neutral_hint += 1
            best = max(range(4), key=lambda k: sum(weight[d] for d in options[k]))
            prior_hits += best == correct
        self.assertEqual(neutral_hint, 0, "лёгкий тон только у неверных вариантов выдаёт верный")
        # Частые тона (четвёртый — около трети) слегка выдают верный: у слова 4-4 он всегда самый «ходовой».
        # Это не устранить, а подсказка слабая (нужна статистика тонов): порог — далеко от прежних 80%.
        self.assertLess(prior_hits / len(self.cases), 0.36)

    def test_two_wrong_options_never_sound_alike(self):
        # 小时 (3-2): 2-3 и 3-3 звучат одинаково — знающий сандхи вычеркнёт оба и останется выбирать из двух.
        for word, seq, options, correct in self.questions():
            wrong = [o for k, o in enumerate(options) if k != correct]
            for a, b in itertools.combinations(wrong, 2):
                self.assertNotIn(a, tones.heard_sequences(word, b), f"{word} {seq}: {a} {b}")
                self.assertNotIn(b, tones.heard_sequences(word, a), f"{word} {seq}: {a} {b}")

    def test_options_still_never_offer_a_heard_form(self):
        for word, seq, options, correct in self.questions():
            self.assertFalse(set(options) & tones.heard_sequences(word, seq), word)

    def test_both_full_syllables_vary_when_the_word_has_two(self):
        # 下午 4-2 / 4-1 / 4-3 / 4-4: тон первого слога виден сразу, вопрос проверяет только второй. Четыре тона
        # одного слога — только у слов, где слогов без лёгкого тона меньше двух (学生, 什么).
        for word, seq, options, correct in self.questions():
            full = [i for i, t in enumerate(seq) if t]
            varying = [i for i in range(len(seq)) if len({o[i] for o in options}) > 1]
            syllables = self.syllables.get(word)
            if len(full) >= 2 and len(varying) == 1 and syllables:
                # Ряд вместо квадрата — только если у неизменного слога в китайском один тон (生日: только rì).
                known = tones.syllable_tones()
                for i in full:
                    if i not in varying:
                        self.assertEqual(set(known.get(syllables[i], {})), {seq[i]}, f"{word} {seq}: {options}")
            elif len(full) >= 2:
                self.assertEqual(len(varying), 2, f"{word} {seq}: {options}")
            else:
                self.assertEqual(varying, full, f"{word} {seq}: {options}")

    def test_order_of_options_does_not_give_the_answer_away(self):
        # Неверные варианты нельзя собирать в одном порядке и вставлять верный в случайное место: по порядку
        # видно, какой вариант выбивается (у «1-0, 3-0, 4-0, 2-0» верный 2-0). Смотрим, какие пары вариантов
        # не имеют общих слогов («диагонали» квадрата) и сколько раз верный стоит на каждом месте.
        seen = {}
        for word, seq, options, correct in self.questions():
            diagonals = tuple((i, j) for i in range(4) for j in range(i + 1, 4) if not _overlap(options[i], options[j]))
            seen.setdefault(diagonals, Counter())[correct] += 1
        for diagonals, spots in seen.items():
            total = sum(spots.values())
            if total >= 40:
                self.assertLess(max(spots.values()) / total, 0.45, f"{diagonals}: {dict(spots)}")
        rising = sum(list(o) == sorted(o) for _, seq, options, _ in self.questions() if seq[-1] == 0 and len(seq) == 2 for o in [[x[0] for x in options]])
        total = sum(1 for _, seq, *_ in self.questions() if seq[-1] == 0 and len(seq) == 2)
        self.assertLess(rising / total, 0.5, "варианты «1-0…4-0» не должны идти по возрастанию")

    def test_no_wrong_option_sounds_like_the_correct_one(self):
        # 苹果 píngguǒ 2-3: 3-3 в речи тоже звучит 2-3 — второй верный «по слуху».
        for word, seq, options, correct in self.questions():
            for k, option in enumerate(options):
                if k != correct:
                    self.assertNotIn(seq, tones.heard_sequences(word, option), f"{word} {seq}: {option}")
        texts = {o["text"] for o in tones.make_options("苹果", (2, 3))[0]}
        self.assertNotIn("3-3", texts)

    def test_neutral_syllable_stays_neutral_in_every_option(self):
        # Лёгкий тон у части вариантов выдавал верный, а полный тон вместо лёгкого бывает слышен (xuéshēng).
        for word, seq, options, correct in self.questions():
            for i, tone in enumerate(seq):
                if tone == 0:
                    self.assertEqual({o[i] for o in options}, {0}, f"{word} {seq}: {options}")


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
