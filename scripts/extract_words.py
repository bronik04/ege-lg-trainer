"""Выписка слов HSK 2.0 (уровни 1–4) для тренировки тонов: таблицы автора + колоды Anki.

    python3 scripts/extract_words.py [папка с HSK1–4.xlsx] [collection.anki2]

Берёт слова из 2–3 иероглифов; пиньинь — из таблиц и из поля «Транскрипция» всех колод Anki
(записи сверяет build_tones.py: расхождение — слово не берётся). Результат —
sources/words/hsk2-words.json; сборка сайта выписку не читает по Диску, только этот снимок.
Руками выписку не правят: обновили таблицы — запустите заново.
"""

import hashlib
import html
import re
import shutil
import sqlite3
import sys
import tempfile
import zipfile
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, write_json  # noqa: E402

DEFAULT_TABLES = Path.home() / "Yandex.Disk.localized/Китайский язык/02-Навыки/Лексика/HSK по темам"
DEFAULT_ANKI = Path.home() / "Library/Application Support/Anki2/bronik04/collection.anki2"
OUT = ROOT / "sources" / "words" / "hsk2-words.json"
LEVELS = (1, 2, 3, 4)
HANZI = re.compile(r"^[㐀-鿿]+$")
BRACKETED = re.compile(r"^[(\[（](.+?)[)\]）]$")
LATIN = re.compile(r"^[A-Za-züÜāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜńň\s'’\-/]+$")
# В книгах автора листы 2 и далее — рабочие копии с поехавшими столбцами (в HSK3 пиньинь «āyí» у сотен слов):
# слова и пиньинь берутся только с первого листа.
FIRST_SHEET = "xl/worksheets/sheet1.xml"


def _shared_strings(archive):
    xml = archive.read("xl/sharedStrings.xml").decode("utf-8")
    return [html.unescape("".join(re.findall(r"<t[^>]*>(.*?)</t>", item, re.S))).strip()
            for item in re.findall(r"<si>(.*?)</si>", xml, re.S)]


def _column(ref):
    letters = re.match(r"[A-Z]+", ref).group(0)
    value = 0
    for ch in letters:
        value = value * 26 + ord(ch) - 64
    return value


def parse_xlsx(path):
    """[(слово, пиньинь или None, перевод или '')] с первого листа, в порядке строк."""
    rows = []
    with zipfile.ZipFile(path) as archive:
        strings = _shared_strings(archive)
        for name in (FIRST_SHEET,):
            for row in re.findall(r"<row\b[^>]*?(?<!/)>(.*?)</row>", archive.read(name).decode("utf-8"), re.S):
                cells = []
                for ref, attrs, inner in re.findall(r'<c r="([A-Z]+\d+)"([^>]*?)(?:/>|>(.*?)</c>)', row, re.S):
                    value = re.search(r"<v>(.*?)</v>", inner or "")
                    if value and 't="s"' in attrs:
                        cells.append((_column(ref), strings[int(value.group(1))]))
                    elif value:
                        cells.append((_column(ref), html.unescape(value.group(1))))
                cells = [text for _, text in sorted(cells)]
                at = next((i for i, text in enumerate(cells) if HANZI.match(text)), None)
                if at is None:
                    continue
                rest = cells[at + 1:]
                pinyin = None
                if rest and BRACKETED.match(rest[0]):
                    pinyin = BRACKETED.match(rest[0]).group(1).strip()
                elif rest and LATIN.match(rest[0]):
                    pinyin = rest[0].strip()
                rows.append((cells[at], pinyin, rest[1 if pinyin else 0] if len(rest) > (1 if pinyin else 0) else ""))
    return rows


def anki_pinyin(collection):
    """{слово: {записи «Транскрипция»}} из всех колод. Копия во временной папке: Anki может быть открыт."""
    found = {}
    with tempfile.TemporaryDirectory() as tmp:
        for suffix in ("", "-wal"):
            source = Path(str(collection) + suffix)
            if source.exists():
                shutil.copyfile(source, Path(tmp) / f"collection.anki2{suffix}")
        db = sqlite3.connect(Path(tmp) / "collection.anki2")
        db.create_collation("unicase", lambda a, b: (a.lower() > b.lower()) - (a.lower() < b.lower()))
        positions = {}
        for ntid, name, ord_ in db.execute("select ntid, name, ord from fields"):
            positions.setdefault(ntid, {})[name] = ord_
        for mid, flds in db.execute("select mid, flds from notes"):
            pos = positions.get(mid, {})
            if "Термин" not in pos or "Транскрипция" not in pos:
                continue
            fields = flds.split("\x1f")
            word, pinyin = fields[pos["Термин"]].strip(), fields[pos["Транскрипция"]].strip()
            if HANZI.match(word) and pinyin:
                found.setdefault(word, set()).add(pinyin)
        db.close()
    return found


def extract(tables, collection):
    words, level_of = {}, {}
    sources = {}
    for level in LEVELS:
        path = Path(tables) / f"HSK{level}.xlsx"
        sources[f"HSK{level}.xlsx"] = hashlib.sha256(path.read_bytes()).hexdigest()
        for word, pinyin, translation in parse_xlsx(path):
            if not 2 <= len(word) <= 3:
                continue
            entry = words.setdefault(word, {"word": word, "level": level, "ru": translation, "table": []})
            level_of.setdefault(word, level)
            entry["level"] = min(entry["level"], level)
            if not entry["ru"] and translation:
                entry["ru"] = translation
            if pinyin and pinyin not in entry["table"]:
                entry["table"].append(pinyin)
    anki = anki_pinyin(collection)
    for word, entry in words.items():
        entry["anki"] = sorted(anki.get(word, ()))
    ordered = sorted(words.values(), key=lambda e: (e["level"], e["word"]))
    return {"source": {"tables": sources, "anki": "collection.anki2 (поле «Транскрипция»)",
                       "extractedAt": date.today().isoformat(), "levels": "HSK 2.0, уровни 1–4"},
            "words": ordered}


def main():
    tables = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_TABLES
    collection = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_ANKI
    data = extract(tables, collection)
    write_json(OUT, data)
    missing = sum(1 for w in data["words"] if not w["table"] and not w["anki"])
    print(f"Слов: {len(data['words'])} (без пиньиня в источниках: {missing}) → {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
