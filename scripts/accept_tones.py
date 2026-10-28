"""Принять слова тренировки тонов после ревью.

    python3 scripts/accept_tones.py --list                # сколько слов ждёт принятия по уровням
    python3 scripts/accept_tones.py --level 1 --level 2   # принять все черновые слова уровней
    python3 scripts/accept_tones.py 整齐 学生               # принять слова по написанию
    python3 scripts/accept_tones.py --all                 # принять все черновые слова

Запускает Claude по вердикту двух независимых ревьюеров (как у заданий банка). Принятое привязано
к отпечатку слова (иероглифы, пиньинь, тоны, перевод, уровень и всё, от чего зависят варианты: схема,
таблица слогов, омографы): правка слова, overrides.json или таблицы слогов возвращает его в черновик при
следующем build_tones.py.
"""

import argparse
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import tones  # noqa: E402
from common import TONE_WORDS, read_json, write_json  # noqa: E402


def accept(data, words=(), levels=(), everything=False):
    """Принимает подходящие черновики на месте; возвращает написания принятых слов."""
    accepted = []
    for entry in data["words"]:
        if entry["status"] != "draft":
            continue
        if everything or entry["word"] in words or entry["level"] in levels:
            entry["status"] = "accepted"
            entry["acceptedHash"] = tones.fingerprint(entry)
            accepted.append(entry["word"])
    return accepted


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("words", nargs="*")
    parser.add_argument("--level", type=int, action="append", default=[])
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--list", action="store_true")
    args = parser.parse_args()
    data = read_json(TONE_WORDS)
    if args.list:
        drafts = Counter(e["level"] for e in data["words"] if e["status"] == "draft")
        done = Counter(e["level"] for e in data["words"] if e["status"] == "accepted")
        for level in (1, 2, 3, 4):
            print(f"HSK {level}: черновиков {drafts[level]}, принято {done[level]}")
        return
    if not (args.words or args.level or args.all):
        parser.error("укажите слова, --level или --all")
    accepted = accept(data, args.words, args.level, args.all)
    write_json(TONE_WORDS, data)
    unknown = sorted(set(args.words) - {e["word"] for e in data["words"]})
    print(f"Принято слов: {len(accepted)}")
    if unknown:
        print("Нет среди слов тренировки: " + ", ".join(unknown))


if __name__ == "__main__":
    main()
