"""Какие слоги пиньиня бывают с каким тоном: снимок для вариантов ответа тренировки тонов.

    python3 scripts/extract_syllables.py      # нужен пакет pypinyin (pip install pypinyin), только здесь

Берёт все чтения иероглифов, которые встречаются в словах HSK 1–4 (sources/words/hsk2-words.json) и в заданиях
банка (sources/bank/export.json), из pypinyin и считает, у скольких таких иероглифов слог читается с тоном 1–4. Сочетания, которые бывают только у
остальных иероглифов U+4E00–U+9FFF (редкие чтения вроде xín), записаны с нулём; несуществующих сочетаний (zái,
nuān) в файле нет. Нужно, чтобы варианты ответа не содержали слогов, которых нет в китайском: такой вариант
отбрасывают, не зная слова. Результат — sources/words/syllable-tones.json ({"слог": {"тон": число иероглифов}});
чем больше иероглифов, тем обычнее тон для слога. Сборка сайта pypinyin
не требует, только этот снимок. Руками файл не правят.
"""

import json
import re
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, write_json  # noqa: E402

OUT = ROOT / "sources" / "words" / "syllable-tones.json"


HAN = re.compile("[\u4e00-\u9fff]")


def corpus_characters():
    words = json.loads((ROOT / "sources" / "words" / "hsk2-words.json").read_text(encoding="utf-8"))["words"]
    export = json.loads((ROOT / "sources" / "bank" / "export.json").read_text(encoding="utf-8"))
    chars = set()
    for word in words:
        chars |= set(HAN.findall(word["word"]))
    for block in export["blocks"]:
        chars |= set(HAN.findall(block["prompt"]))
        for option in block["options"]:
            chars |= set(HAN.findall(option["text"]))
    return sorted(chars)


def main():
    import pypinyin
    from pypinyin import Style, pinyin

    chars = corpus_characters()
    learner = set(chars)
    found = {}
    for code in range(0x4E00, 0xA000):
        char = chr(code)
        seen = set()
        for readings in pinyin(char, style=Style.TONE3, heteronym=True, neutral_tone_with_five=True):
            for reading in readings:
                if reading[-1] in "1234":
                    seen.add((reading[:-1].replace("ü", "v"), int(reading[-1])))
        for syllable, tone in seen:
            counts = found.setdefault(syllable, {})
            counts[tone] = counts.get(tone, 0) + (char in learner)
    write_json(OUT, {
        "source": {"pypinyin": pypinyin.__version__, "characters": len(chars), "from": "hsk2-words.json, bank/export.json (счётчики); все иероглифы U+4E00–U+9FFF (нули)",
                   "extractedAt": date.today().isoformat()},
        "syllables": {syllable: {str(t): n for t, n in sorted(counts.items())} for syllable, counts in sorted(found.items())},
    })
    print(f"Иероглифов {len(chars)}, слогов {len(found)}, сочетаний слог+тон {sum(len(c) for c in found.values())} → {OUT}")


if __name__ == "__main__":
    main()
