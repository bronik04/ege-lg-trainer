"""Импорт заданий HSK 4 (№26): sources/hsk4/ → data/raw/hsk.json.

Файл автора — блоки «ЕГЭ Конструктора»:

    # Блок: задание 26
    теги: HSK4, Порядок фрагментов, HSK4 H41001 №56, добавлено 2026-09
    ## Задание
    стем:
    A) …
    B) …
    C) …
    1. CAB
    2. ABC
    3. CBA
    4. BAC
    ответ: 1

Источник задания — тег «HSK4 <вариант или сборник> №N». Тексты переносятся без правки; блоки
из EXCLUDED_SOURCES не берутся (решение автора). ID вычисляется из условия и вариантов, как у
новых заданий: повторный импорт даёт тот же ID. Всё, что не удалось прочитать, — в отчёт, а не
в банк.
"""

import hashlib
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import FORMAT_YEAR, HSK_SOURCE, INSTRUCTIONS, RAW_HSK, REVIEW, ROOT, write_json, write_text  # noqa: E402

BLOCK_HEAD = re.compile(r"^# Блок: задание (\d+)\s*$", re.M)
TAGS = re.compile(r"^теги:\s*(.*)$", re.M)
SOURCE_TAG = re.compile(r"^HSK4 (.+?) №(\d+)$")
FRAGMENT_LINE = re.compile(r"^([ABC])\)\s*(.+?)\s*$", re.M)
OPTION_LINE = re.compile(r"^\d\.\s*(\S+)\s*$", re.M)
ANSWER = re.compile(r"^ответ:\s*(\S+)\s*$", re.M)
ORDERS = {"ABC", "ACB", "BAC", "BCA", "CAB", "CBA"}
# Решение автора 04.10.2026: задания Blue book распознаны со скана и не сверены — не берутся.
EXCLUDED_SOURCES = ("Blue book",)


def hsk_id(stem, options):
    digest = hashlib.sha1(f"26|{stem}|{'|'.join(options)}".encode("utf-8")).hexdigest()
    return f"h26-{digest[:8]}"


def split_blocks(text):
    """[(номер задания, текст блока)] по заголовкам «# Блок: задание N»."""
    heads = list(BLOCK_HEAD.finditer(text))
    ends = [m.start() for m in heads[1:]] + [len(text)]
    return [(int(m.group(1)), text[m.end():end]) for m, end in zip(heads, ends)]


def source_of(body):
    """(вариант или сборник, номер) из тега «HSK4 H41001 №56»; нет такого тега — None."""
    tags = TAGS.search(body)
    for tag in tags.group(1).split(",") if tags else []:
        match = SOURCE_TAG.match(tag.strip())
        if match:
            return match.group(1), int(match.group(2))
    return None


def record(body, file_name):
    """Запись банка из блока задания 26: (запись | None, проблемы)."""
    source = source_of(body)
    if source is None:
        return None, ["нет тега источника «HSK4 … №N»"]
    paper, number = source
    problems = []
    fragments = FRAGMENT_LINE.findall(body)
    if [letter for letter, _ in fragments] != ["A", "B", "C"]:
        problems.append("нужны фрагменты A), B), C) — по одному")
    options = OPTION_LINE.findall(body)
    if len(options) != 4 or len(set(options)) != 4 or not set(options) <= ORDERS:
        problems.append("варианты — не четыре разные последовательности A, B, C")
    answer = ANSWER.search(body)
    key = answer.group(1) if answer else None
    if key not in {"1", "2", "3", "4"}:
        problems.append(f"ответ {key!r} — не номер варианта 1–4")
    if problems:
        return None, problems
    stem = "\n".join(f"{letter}) {text}" for letter, text in fragments)
    return {
        "id": hsk_id(stem, options),
        "taskNumber": 26,
        "formatYear": FORMAT_YEAR,
        "origin": "hsk",
        "sourceRef": {"collection": "HSK 4", "paper": paper, "number": number, "file": f"sources/hsk4/{file_name}"},
        "codifierCodes": [],
        "prompt": INSTRUCTIONS[26],
        "stem": stem,
        "options": [{"id": str(i), "text": text} for i, text in enumerate(options, 1)],
        "correctOptionId": key,
        "fragments": [{"id": letter, "text": text} for letter, text in fragments],
    }, []


def load(directory=HSK_SOURCE):
    """(записи, замечания, пропущено по решению автора: {источник: заданий})."""
    records, problems, skipped = [], [], Counter()
    for path in sorted(Path(directory).glob("*.md")):
        if path.name == "README.md":
            continue
        for index, (number, body) in enumerate(split_blocks(path.read_text(encoding="utf-8")), 1):
            where = f"{path.name}, блок {index}"
            if number != 26:
                problems.append(f"{where}: задание {number} — берутся только задания 26")
                continue
            source = source_of(body)
            excluded = next((name for name in EXCLUDED_SOURCES if source and name in source[0]), None)
            if excluded:
                skipped[excluded] += 1
                continue
            rec, errors = record(body, path.name)
            if errors:
                label = f"{where} ({source[0]} №{source[1]})" if source else where
                problems.append(f"{label}: " + "; ".join(errors))
            else:
                records.append(rec)
    by_id = {}
    for rec in records:
        by_id.setdefault(rec["id"], []).append(rec)
    repeated = sorted(qid for qid, same in by_id.items() if len(same) > 1)
    if repeated:
        problems.append("одинаковые задания (оставлено первое): " + ", ".join(repeated))
    records = sorted((same[0] for same in by_id.values()), key=lambda r: r["id"])
    return records, problems, dict(skipped)


def report(records, problems, skipped):
    lines = ["# Импорт заданий HSK 4", "", f"Записей: {len(records)}."]
    if skipped:
        lines += ["", "Не берутся по решению автора: "
                  + ", ".join(f"{name} — {count}" for name, count in sorted(skipped.items())) + "."]
    by_paper = Counter(r["sourceRef"]["paper"] for r in records)
    lines += ["", "## По источникам", "", "| Вариант или сборник | Заданий |", "| --- | --- |"]
    lines += [f"| {paper} | {count} |" for paper, count in sorted(by_paper.items())]
    lines += ["", "## Замечания", ""]
    lines += [f"- {line}" for line in problems] or ["Нет."]
    return "\n".join(lines) + "\n"


def main():
    records, problems, skipped = load()
    write_json(RAW_HSK, records)
    write_text(REVIEW / "hsk-import.md", report(records, problems, skipped))
    print(f"Задания HSK: {len(records)} → {RAW_HSK.relative_to(ROOT)}"
          + (f", замечаний: {len(problems)}" if problems else ""))


if __name__ == "__main__":
    main()
