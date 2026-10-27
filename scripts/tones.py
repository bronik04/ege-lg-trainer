"""Тренировка тонов (№15) по словам HSK 2.0: пиньинь → тоны, варианты ответа, разбор.

Чистые функции без чтения файлов: их используют сборка (build_tones.py, build_site.py) и тесты.
Правила записи — как в правиле «Тоны в словах»: тон словарный, 1–4, лёгкий — 0.
"""

import hashlib
import html
import itertools
import random
import re
import unicodedata

from common import FORMAT_YEAR, INSTRUCTIONS

TONE_MARKS = {"̄": 1, "́": 2, "̌": 3, "̀": 4, "̆": 3}  # бреве — набор «ǎ» с опечаткой
INITIALS = ["", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x", "zh", "ch", "sh", "r", "z",
            "c", "s", "y", "w"]
FINALS = ["a", "o", "e", "i", "u", "v", "ai", "ei", "ui", "ao", "ou", "iu", "ie", "ve", "ue", "er", "an", "en", "in",
          "un", "vn", "ang", "eng", "ing", "ong", "ia", "iao", "ian", "iang", "iong", "ua", "uo", "uai", "uan",
          "uang", "van", "ueng"]
# Слоги пиньиня с запасом: лишнее сочетание вреда не делает — число слогов сверяется с числом иероглифов.
# Без согласного начала слог бывает только на эти финали (ōng, ī, ū отдельным слогом не бывают).
ZERO_INITIAL = {"a", "o", "e", "ai", "ei", "ao", "ou", "an", "en", "ang", "eng", "er"}
SYLLABLES = {i + f for i in INITIALS if i for f in FINALS} | ZERO_INITIAL
SEPARATORS = re.compile(r"//|[\s'’\-·]+")

ORDINAL = {1: "первый", 2: "второй", 3: "третий", 4: "четвёртый", 0: "лёгкий"}
INSTRUMENTAL = {1: "первым", 2: "вторым", 3: "третьим", 4: "четвёртым", 0: "лёгким"}
SYLLABLE_ORDINAL = ["первый", "второй", "третий"]


def _units(text):
    """Пиньинь → [(буквы со знаком, основа, тон)] или None, если в строке что-то кроме пиньиня."""
    text = html.unescape(text).replace("\xa0", " ").lower()
    out = []
    for ch in unicodedata.normalize("NFD", text):
        if ch in TONE_MARKS:
            if not out:
                return None
            out[-1][0] += ch
            out[-1][2] = TONE_MARKS[ch]
        elif ch == "̈":  # ü
            if not out or out[-1][1] != "u":
                return None
            out[-1][0] += ch
            out[-1][1] = "v"
        elif "a" <= ch <= "z":
            out.append([ch, ch, 0])
        else:
            return None
    return [(unicodedata.normalize("NFC", s), base, tone) for s, base, tone in out]


def _segmentations(units, n):
    """Все деления букв на ровно n слогов: список списков (текст слога, тон)."""
    found = []

    def walk(i, left, acc):
        if i == len(units):
            if left == 0:
                found.append(list(acc))
            return
        if left == 0:
            return
        for j in range(i + 1, min(len(units), i + 6) + 1):
            if "".join(u[1] for u in units[i:j]) not in SYLLABLES:
                continue
            marks = {u[2] for u in units[i:j] if u[2]}
            if len(marks) > 1:
                continue
            acc.append(("".join(u[0] for u in units[i:j]), marks.pop() if marks else 0))
            walk(j, left - 1, acc)
            acc.pop()

    walk(0, n, [])
    return found


def _syllables(text, n):
    """Деления текста на n слогов: по пробелам и апострофам, если они есть и сошлись, иначе по буквам."""
    parts = [p for p in SEPARATORS.split(html.unescape(text).strip()) if p]
    if len(parts) == n:
        cut = []
        for part in parts:
            units = _units(part)
            segs = _segmentations(units, 1) if units else []
            if len(segs) != 1:
                cut = None
                break
            cut.append(segs[0][0])
        if cut:
            return [cut]
    units = _units("".join(parts))
    return _segmentations(units, n) if units else []


def tone_sequence(pinyin, count):
    """Тоны по слогам или None: слогов не столько, сколько иероглифов, или деление даёт разные тоны."""
    sequences = {tuple(t for _, t in seg) for seg in _syllables(pinyin, count)}
    return sequences.pop() if len(sequences) == 1 else None


def syllabify(pinyin, count):
    """Пиньинь по слогам или None, если деление неоднозначно (fǎngǎn — fǎn-gǎn или fǎng-ǎn)."""
    segs = _syllables(pinyin, count)
    return [s for s, _ in segs[0]] if len(segs) == 1 else None


def join_syllables(syllables):
    """Слитно; апостроф перед слогом на a, o, e — по правилам пиньиня (xī'ān). Если слитная запись
    читается по-другому (tángāngqín — tán-gāng-qín или táng-āng-qín), слоги разделены пробелами."""
    out = syllables[0]
    for s in syllables[1:]:
        first = unicodedata.normalize("NFD", s)[0]
        out += ("'" if first in "aoe" else "") + s
    if syllabify(out, len(syllables)) != list(syllables):
        return " ".join(syllables)
    return out


def sequence_text(seq):
    return "-".join(str(t) for t in seq)


def _spelling(part):
    """Запись без пробелов, апострофов и регистра; бреве — как знак третьего тона."""
    text = unicodedata.normalize("NFD", html.unescape(part).lower()).replace("\u0306", "\u030c")
    return unicodedata.normalize("NFC", SEPARATORS.sub("", text))


def read_candidates(candidates, count):
    """Чтение слова по записям источников. Результат: {pinyin, syllables, tones} или {problem}.

    Слово не берётся, если записи расходятся в тонах (лёгкий тон бывает обязательным и необязательным),
    пиньинь не делится на слоги по числу иероглифов или деление неоднозначно.
    """
    parts = []
    for candidate in candidates:
        for part in re.split(r"\|", html.unescape(candidate or "")):
            part = part.replace("\xa0", " ").strip()
            if part and part not in parts:
                parts.append(part)
    if not parts:
        return {"problem": "нет пиньиня в источниках"}
    readings = {}
    for part in parts:
        seq = tone_sequence(part, count)
        if seq is None:
            return {"problem": f"пиньинь «{part}» не делится на слоги по числу иероглифов ({count})"}
        readings.setdefault(seq, []).append(part)
    if len(readings) > 1:
        shown = "; ".join(f"{sequence_text(seq)}: {', '.join(texts)}" for seq, texts in readings.items())
        return {"problem": f"источники расходятся в тонах — {shown}"}
    (seq, texts), = readings.items()
    if len({_spelling(text) for text in texts}) > 1:
        # Тоны совпали, а буквы или знак нет (bīngxīang — bīngxiāng): ученик увидит пиньинь, опечатка недопустима.
        return {"problem": f"пиньинь пишется по-разному: {', '.join(texts)}"}
    for text in texts:
        syllables = syllabify(text, count)
        if syllables:
            return {"pinyin": join_syllables(syllables), "syllables": syllables, "tones": list(seq)}
    return {"problem": f"деление «{texts[0]}» на слоги неоднозначно: впишите чтение с пробелом между слогами"}


# ---------- варианты ответа ----------


# Меняете make_options или разбор — поднимите версию: отпечатки принятых слов устареют, слова вернутся
# на ревью (ответ ученика хранится по id варианта, и после смены порядка он указывал бы на другой вариант).
OPTIONS_VERSION = "1"


def word_id(word):
    return "w15-" + hashlib.sha1(word.encode("utf-8")).hexdigest()[:8]


def _rng(word):
    return random.Random(int(hashlib.sha1(word.encode("utf-8")).hexdigest()[:8], 16))


def heard_sequences(word, seq):
    """Как слово может прозвучать в речи при изменении тона: 3+3 → 2+3, 不 перед 4-м тоном → 2, 一 → 2 перед
    4-м и 4 перед остальными. Это не словарная запись: такие варианты в ответы не попадают (второго верного
    ответа «по слуху» быть не должно), а разбор верного ответа о них предупреждает."""
    choices = []
    for i, tone in enumerate(seq):
        options = {tone}
        following = seq[i + 1] if i + 1 < len(seq) else None
        if tone == 3 and following == 3:
            options.add(2)
        if word[i] == "不" and following == 4:
            options.add(2)
        if word[i] == "一" and following is not None:
            options.add(2 if following == 4 else 4)
        choices.append(sorted(options))
    return {c for c in itertools.product(*choices)} - {tuple(seq)}


def make_options(word, seq):
    """Четыре варианта (id «1»–«4») и id верного. Неверные — как в заданиях ФИПИ: один слог другим тоном,
    те же тоны в другом порядке, лёгкий тон вместо полного. Лёгкий тон первого слога не бывает.
    Выбор случайный, но зависит только от слова."""
    rng = _rng(word)
    base = tuple(seq)
    main, neutral = [], []
    for i, t in itertools.product(range(len(base)), (1, 2, 3, 4)):
        if t != base[i]:
            main.append(base[:i] + (t,) + base[i + 1:])
    for perm in itertools.permutations(base):
        if perm != base and perm[0] != 0 and perm not in main:
            main.append(perm)
    for i in range(1, len(base)):
        if base[i] != 0:
            neutral.append(base[:i] + (0,) + base[i + 1:])
    heard = heard_sequences(word, base)
    main = [c for c in main if c not in heard]
    neutral = [c for c in neutral if c not in heard and c.count(0) <= 1]  # «4-0-0» так не говорят
    picked = rng.sample(main, 3)
    if neutral and rng.random() < 0.25:
        picked[2] = rng.choice(neutral)
    texts = [sequence_text(p) for p in picked]
    position = rng.randrange(4)
    texts.insert(position, sequence_text(base))
    return [{"id": str(i), "text": t} for i, t in enumerate(texts, 1)], str(position + 1)


# ---------- разбор ----------


def _syllables_of(entry):
    return entry.get("syllables") or syllabify(entry["pinyin"], len(entry["word"]))


def explain_correct(entry):
    """«整齐 zhěngqí «аккуратный»: 整 zhěng — третий тон, 齐 qí — второй тон. Запись: 3-2.»"""
    parts = [f"{ch} {py} — {ORDINAL[t]} тон" for ch, py, t in zip(entry["word"], _syllables_of(entry), entry["tones"])]
    text = f"{entry['word']} {entry['pinyin']} «{entry['ru']}»: {', '.join(parts)}. Запись: {sequence_text(entry['tones'])}."
    heard = sorted(heard_sequences(entry["word"], tuple(entry["tones"])))
    if heard:
        text += (f" В речи тон может меняться ({' или '.join(sequence_text(h) for h in heard)}), "
                 "но в записи — словарный тон.")
    return text


def explain_wrong(entry, given):
    """Какие слоги в варианте названы неверно и каким тоном они читаются на самом деле."""
    parts = []
    for i, (ch, py, t, g) in enumerate(zip(entry["word"], _syllables_of(entry), entry["tones"], given)):
        if t == g:
            continue
        parts.append(f"{SYLLABLE_ORDINAL[i]} слог {ch} {py} произносится {INSTRUMENTAL[t]} тоном, а не {INSTRUMENTAL[g]}")
    return f"{sequence_text(given)}: {'; '.join(parts)}."


# То, что у всех вопросов тренировки одинаково: страница получает это один раз (build_site.py, toneBase).
QUESTION_BASE = {
    "taskNumber": 15,
    "formatYear": FORMAT_YEAR,
    "origin": "words",
    "prompt": INSTRUCTIONS[15],
    "topicIds": ["tones"],
    "ruleIds": ["tones-in-words"],
}


def make_question(entry):
    """Слово → вопрос в том же виде, что задание №15: его показывает общий код карточки и разбора."""
    seq = tuple(entry["tones"])
    options, correct = make_options(entry["word"], seq)
    explanation = {"correct": explain_correct(entry), "options": {}}
    for option in options:
        if option["id"] != correct:
            given = tuple(int(d) for d in option["text"].split("-"))
            explanation["options"][option["id"]] = explain_wrong(entry, given)
    return {
        **QUESTION_BASE,
        "id": word_id(entry["word"]),
        "stem": entry["word"],
        "options": options,
        "correctOptionId": correct,
        "explanation": explanation,
        "level": entry["level"],
        "pinyin": entry["pinyin"],
        "translation": entry["ru"],
    }


def fingerprint(entry):
    """Отпечаток принятого: слово, чтение, тоны и перевод. Правка любого из них требует нового принятия."""
    syllables = " ".join(entry.get("syllables") or [])
    value = "|".join([entry["word"], entry["pinyin"], syllables, sequence_text(entry["tones"]), entry["ru"],
                      str(entry["level"]), OPTIONS_VERSION])
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:12]
