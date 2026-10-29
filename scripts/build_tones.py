"""Слова для тренировки тонов: sources/words + data/words/overrides.json → data/tone-words.json.

    python3 scripts/build_tones.py

Слово берётся, если чтение однозначно: источники (таблицы автора, Anki) сходятся в тонах, пиньинь делится на
слоги по числу иероглифов, слова нет среди заданий №15 банка (тренировка не подсказывает ключ).
Остальные — в data/review/tones-report.md: автор решает по ним и вписывает чтение в data/words/overrides.json:

    { "слово": { "pinyin": "fǎn gǎn", "why": "почему так" } }   # чтение вписано
    { "слово": { "skip": true, "why": "почему не берём" } }       # слово не берётся

Принятое (status accepted + acceptedHash) переносится, если отпечаток слова не изменился; иначе слово
возвращается в черновик и попадает в отчёт.
"""

import html
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import tones  # noqa: E402
from common import DATA, REVIEW, ROOT, TONE_WORDS, read_json, write_json, write_text  # noqa: E402

WORDS = ROOT / "sources" / "words" / "hsk2-words.json"
OVERRIDES = DATA / "words" / "overrides.json"
REPORT = REVIEW / "tones-report.md"


def short_translation(ru):
    """Первое значение перевода: до точки с запятой, без хвоста «(сч. слово …)»."""
    first = re.split(r"[;；]", ru)[0].strip()
    return re.sub(r"\s+", " ", first).rstrip(".,")


def fipi_stems(questions):
    """Слова заданий №15 банка, которые идут на сайт, без знаков в конце: «整齐。» → «整齐». Черновик ключа ученику
    не покажет; выйдет задание на сайт — слово уйдёт из тренировки при следующей сборке."""
    return {re.sub(r"[\s.。]+$", "", q["stem"]) for q in questions if q["taskNumber"] == 15 and q.get("reviewStatus") == "ready"}


def build(source, overrides, stems, previous):
    """Слова с чтением и список не взятых: (entries, skipped[(слово, уровень, причина)], reopened[слово])."""
    kept, skipped, reopened = [], [], []
    old = {e["word"]: e for e in previous}
    for item in source["words"]:
        word, level = item["word"], item["level"]
        decision = overrides.get(word, {})
        if decision.get("skip"):
            skipped.append((word, level, f"решение автора: {decision.get('why', 'не берётся')}"))
            continue
        if word in stems:
            skipped.append((word, level, "есть среди заданий №15 банка"))
            continue
        candidates = [decision["pinyin"]] if decision.get("pinyin") else item["table"] + item["anki"]
        reading = tones.read_candidates(candidates, len(word))
        if "problem" in reading:
            skipped.append((word, level, f"{reading['problem']} (таблицы: {', '.join(item['table']) or '—'}; "
                                         f"Anki: {html.unescape(', '.join(item['anki'])) or '—'})"))
            continue
        entry = {"word": word, "level": level, "pinyin": reading["pinyin"], "syllables": reading["syllables"],
                 "tones": reading["tones"], "ru": decision.get("ru") or short_translation(item["ru"]),
                 "status": "draft"}
        before = old.get(word)
        if before and before.get("status") == "accepted":
            if before.get("acceptedHash") == tones.fingerprint(entry):
                entry["status"], entry["acceptedHash"] = "accepted", before["acceptedHash"]
            else:
                reopened.append(word)
        kept.append(entry)
    return kept, skipped, reopened


def report_text(kept, skipped, reopened):
    lines = ["# Слова для тренировки тонов — отчёт сборки", "",
             f"Взято слов: {len(kept)}, принято: {sum(1 for e in kept if e['status'] == 'accepted')}. "
             f"Не взято: {len(skipped)}.", ""]
    if reopened:
        lines += ["## Вернулись в черновик (изменились после принятия)", "", ", ".join(reopened), ""]
    reasons = {}
    for word, level, why in skipped:
        reasons.setdefault(re.split(r" \(| — ", why)[0], []).append((word, level, why))
    for reason, items in sorted(reasons.items(), key=lambda kv: -len(kv[1])):
        lines += [f"## Не взяты: {reason} ({len(items)})", ""]
        lines += [f"- {word} (HSK {level}) — {why}" for word, level, why in items]
        lines.append("")
    lines += ["Решение по слову — `data/words/overrides.json` (чтение или `skip`), затем `python3 scripts/build_tones.py`.", ""]
    return "\n".join(lines)


def main():
    source = read_json(WORDS)
    overrides = read_json(OVERRIDES) if OVERRIDES.exists() else {}
    previous = read_json(TONE_WORDS)["words"] if TONE_WORDS.exists() else []
    kept, skipped, reopened = build(source, overrides, fipi_stems(read_json(DATA / "questions.json")), previous)
    write_json(TONE_WORDS, {"source": source["source"], "words": kept})
    write_text(REPORT, report_text(kept, skipped, reopened))
    print(f"Слов в тренировке: {len(kept)}; не взято: {len(skipped)}; вернулось в черновик: {len(reopened)}")


if __name__ == "__main__":
    main()
