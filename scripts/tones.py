"""Тренировка тонов (№15) по словам HSK 2.0: пиньинь → тоны, варианты ответа, разбор.

Чистые функции: их используют сборка (build_tones.py, build_site.py) и тесты. Файл читается один раз — таблица
слогов sources/words/syllable-tones.json (syllable_tones), ею make_question выбирает существующие слоги в вариантах.
Правила записи — как в правиле «Тоны в словах»: тон словарный, 1–4, лёгкий — 0.
"""

import hashlib
import html
import itertools
import random
import re
import unicodedata

import json

from common import FORMAT_YEAR, INSTRUCTIONS, SOURCES

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


SYLLABLE_TONES = SOURCES / "words" / "syllable-tones.json"
_known = None


def syllable_tones():
    """{слог без тона: {тон 1–4: число иероглифов учебной лексики с таким чтением}} — снимок
    sources/words/syllable-tones.json. Чем больше иероглифов, тем обычнее тон для слога; 0 — чтение есть только у
    редких иероглифов (xín), нет тона в словаре слога — такого слога в китайском нет (zái)."""
    global _known
    if _known is None:
        table = json.loads(SYLLABLE_TONES.read_text(encoding="utf-8"))["syllables"]
        _known = {syllable: {int(t): n for t, n in tones.items()} for syllable, tones in table.items()}
    return _known


def options_signature():
    """Отпечаток всего, от чего зависят варианты, кроме слова: таблица слогов, омографы, версия схемы. Он входит в
    отпечаток принятого слова: сменилась таблица — варианты другие, слово возвращается на ревью."""
    table = hashlib.sha256(SYLLABLE_TONES.read_bytes()).hexdigest()[:12]
    homographs = sorted((w, sorted(v)) for w, v in HOMOGRAPHS.items())
    return f"{OPTIONS_VERSION}:{table}:{homographs}"


def plain_syllable(syllable):
    """Слог без тонового знака, ü как v: «nǚ» → «nv»."""
    text = "".join(ch for ch in unicodedata.normalize("NFD", syllable.lower()) if ch not in TONE_MARKS)
    return unicodedata.normalize("NFC", text.replace("u\u0308", "v")).replace("ü", "v")


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
# на ревью, а ID слов сменятся (ответ ученика хранится по id варианта, и после смены порядка он указывал бы
# на другой вариант, а старая статистика слова относилась бы к другим вариантам).
OPTIONS_VERSION = "2"


def word_id(word):
    return "w15-" + hashlib.sha1(f"{OPTIONS_VERSION}:{word}".encode("utf-8")).hexdigest()[:8]


def _rng(word):
    return random.Random(int(hashlib.sha1(word.encode("utf-8")).hexdigest()[:8], 16))


# Другое слово с теми же иероглифами и другим чтением: ученик, знающий его, выбрал бы вариант с полным правом.
HOMOGRAPHS = {"结果": {(1, 3)}}  # jiēguǒ «плодоносить»


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


def make_options(word, seq, syllables=None, known=None):
    """Четыре варианта (id «1»–«4») и id верного. Варианты — «квадрат» по двум слогам: верный (a-b), (x-b),
    (a-y), (x-y); остальные слоги одинаковы во всех. У каждого варианта то же сходство с остальными, в каждом
    слоге два тона по два варианта — угадать подстановкой («самый похожий на остальные», «чаще встречающийся
    тон») нельзя, нужно знать тон хотя бы одного слога. Лёгкий слог не меняется и стоит во всех вариантах:
    лёгкий тон только у части вариантов отбрасывал бы остальные, а полный тон вместо лёгкого бывает слышен
    (xuésheng — xuéshēng). Если слогов без лёгкого тона меньше двух (学生, 什么), варианты — четыре тона
    единственного слога (так бывает и у слов с двумя свободными слогами, когда квадрат хуже). Все четыре варианта перемешиваются: порядок не должен выдавать верный.

    Вариант не берётся, если он слышен в речи как верный (3-3 для 2-3: 3+3 звучит 2+3), если верный слышен
    как он, или это другое слово тех же иероглифов (HOMOGRAPHS). Если даны слоги слова без тонов и таблица
    known (syllable_tones), выбираются варианты с наименьшим числом слогов, которых нет в китайском (zái), а потом
    редких чтений (xín): такой вариант отбрасывают, не зная слова. Выбор случайный, но зависит только от слова."""
    rng = _rng(word)
    base = tuple(seq)
    heard = heard_sequences(word, base) | HOMOGRAPHS.get(word, set())

    def put(item, i, tone):
        return item[:i] + (tone,) + item[i + 1:]

    def allowed(option):
        return option not in heard and base not in heard_sequences(word, option)

    def missing(option):
        """Несуществующий слог (zái) весит как сто редких чтений (xín): сначала избегаем его."""
        if not (syllables and known):
            return 0
        total = 0
        for i, tone in enumerate(option):
            if tone:
                count = known.get(syllables[i], {}).get(tone)
                total += 100 if count is None else (count == 0)
        return total

    def twins(options):
        """Два неверных варианта, из которых один звучит как другой (3-3 и 2-3): знающий сандхи вычеркнёт оба."""
        return any(a in heard_sequences(word, b) or b in heard_sequences(word, a) for a, b in itertools.combinations(options, 2))

    def common(position, tone):
        """Насколько тон обычен для слога: число иероглифов с таким чтением, в квадрате (1, если таблицы нет)."""
        if not (syllables and known):
            return 1
        return (known.get(syllables[position], {}).get(tone, 0) + 1) ** 2

    free = [i for i, tone in enumerate(base) if tone]
    found = []  # («цена» неверных вариантов: несуществующие и редкие слоги, вес, неверные варианты)
    for i, j in itertools.combinations(free, 2):
        for x, y in itertools.product((1, 2, 3, 4), repeat=2):
            if x == base[i] or y == base[j]:
                continue
            square = [put(base, i, x), put(base, j, y), put(put(base, i, x), j, y)]
            if all(map(allowed, square)) and not twins(square):
                found.append((sum(map(missing, square)), common(i, x) * common(j, y), square))
    for i in free:
        line = [put(base, i, tone) for tone in (1, 2, 3, 4) if tone != base[i]]
        if all(map(allowed, line)) and not twins(line):
            weight = 1
            for tone in (1, 2, 3, 4):
                if tone != base[i]:
                    weight *= common(i, tone)
            found.append((sum(map(missing, line)), weight, line))
    if not found:
        raise ValueError(f"слово {word!r} ({sequence_text(base)}): не из чего составить варианты")
    best = min(score for score, _, _ in found)
    pool = [(weight, option) for score, weight, option in found if score == best]
    # Неверные тоны — не равновероятно: тон, обычный для слога, чаще встречается и среди верных, и подсказывал бы
    # верный. Вес набора — квадрат числа иероглифов с таким чтением, чтобы приманки были так же правдоподобны (до конца
    # не выровнять: обычный для слога тон — это уже знание).
    picked = rng.choices([option for _, option in pool], weights=[weight for weight, _ in pool])[0]
    # Перемешиваются все четыре: неверные в фиксированном порядке и верный в случайном месте выдавали верный
    # (в квадрате по расположению «диагоналей», в ряду 1-0…4-0 — по выбивающемуся из возрастания).
    ordered = [base] + picked
    rng.shuffle(ordered)
    return [{"id": str(i), "text": sequence_text(t)} for i, t in enumerate(ordered, 1)], str(ordered.index(base) + 1)


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
    options, correct = make_options(entry["word"], seq, [plain_syllable(s) for s in _syllables_of(entry)], syllable_tones())
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
                      str(entry["level"]), options_signature()])
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:12]
