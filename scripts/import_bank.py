"""Задания 15–27 из снимка единого банка → data/raw/bank.json.

Банк — единственный источник заданий (с 24.10.2026, решение автора): снимок конструктора, партии
generated/ и снимок HSK4 больше не читаются. ID задания задаётся один раз и хранится в банке
(`lgIds`): правка текста ID не меняет, прогресс учеников сохраняется. Заданию без ID присваивается
<q|h|g><номер>-<8 знаков ID блока>, а пара «ID → блок банка» пишется в data/review/new-links.json —
её записывают в банк командой `link lg --file`. Задание HSK узнаётся и по источнику «HSK4», и по тегу
«HSK4 <пробник> №N» (спорные HSK пришли в банк из тренажёра). Варианты не по формату номера — в
замечания: задание остаётся черновиком и на сайт не идёт.

    python3 scripts/import_bank.py
"""

import json
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (  # noqa: E402
    AUTHORED, FORMAT_YEAR, INSTRUCTIONS, RAW_BANK, REVIEW, load_bank_snapshot, option_problems, parse_fragments,
    quality_notes, write_json, write_text,
)

ORIGIN = {"ФИПИ": "fipi", "HSK4": "hsk"}
PREFIX = {"fipi": "q", "hsk": "h", "generated": "g"}
FIPI_TAG = re.compile(r"^ФИПИ ([0-9A-Fa-f]{6})$")
KES_TAG = re.compile(r"^КЭС ФИПИ ([0-9.]+)$")
HSK_TAG = re.compile(r"^HSK4 (.+?) №(\d+)$")
BATCH_NOTE = re.compile(r"партия ([^,\s]+)")
SNAPSHOT_FILE = "sources/bank/export.json"


def source_ref(block, origin):
    tags = block["tags"]
    ref = {"bankId": block["id"], "file": SNAPSHOT_FILE}
    if origin == "fipi":
        fipi = [m.group(1) for m in map(FIPI_TAG.match, tags) if m]
        ref.update({
            "collection": "Открытый банк заданий ФИПИ",
            "fipiId": fipi[0] if fipi else None,
            "kes": [m.group(1) for m in map(KES_TAG.match, tags) if m],
            "constructorBlockId": block["id"],
        })
    elif origin == "hsk":
        paper = next((m for m in map(HSK_TAG.match, tags) if m), None)
        ref.update({"collection": "HSK 4", "paper": paper.group(1) if paper else None,
                    "number": int(paper.group(2)) if paper else None})
    else:
        batch = BATCH_NOTE.search(block.get("note") or "")
        ref.update({"collection": block["source"], "specVersion": f"ЕГЭ {FORMAT_YEAR}",
                    "batch": batch.group(1) if batch else block.get("batch")})
    return ref


def origin_of(block):
    if block["source"] in ORIGIN:
        return ORIGIN[block["source"]]
    return "hsk" if any(map(HSK_TAG.match, block["tags"])) else "generated"


def records_from_export(export, authored):
    """(записи, новые связи {ID: ID блока}, замечания) из выгрузки банка и разборов (по ID).

    Два ID тренажёра у одного задания банка — ошибка: какой из них сохранит прогресс учеников,
    решает банк (`unlink` лишнего), а не порядок в списке."""
    records, new_links, problems = [], {}, []
    for block in export["blocks"]:
        n = block["taskNumber"]
        origin = origin_of(block)
        if len(block["lgIds"]) > 1:
            raise ValueError(f"задание банка {block['id']}: несколько ID тренажёра ({', '.join(block['lgIds'])}) — "
                             "в банке должен остаться один (unlink lg лишнего)")
        if block["lgIds"]:
            qid = block["lgIds"][0]
        else:
            qid = f"{PREFIX[origin]}{n}-{block['id'][:8]}"
            new_links[qid] = block["id"]
        options = [{"id": str(o["id"]), "text": o["text"]} for o in block["options"]]
        record = {
            "id": qid,
            "taskNumber": n,
            "formatYear": FORMAT_YEAR,
            "origin": origin,
            "sourceRef": source_ref(block, origin),
            "codifierCodes": list(block["codifierCodes"]),
            "prompt": INSTRUCTIONS[n],
            "stem": block["prompt"],
            "options": options,
            "correctOptionId": block["correct"],
        }
        issues = option_problems(n, options)
        if block["correct"] not in {o["id"] for o in options}:
            issues.append(f"ключ {block['correct']!r} не совпадает ни с одним вариантом")
        if n == 26:
            fragments = parse_fragments(block["prompt"])
            if fragments is None:
                issues.append("не удалось выделить фрагменты A, B, C")
            else:
                record["fragments"] = fragments
        replaces = (authored.get(qid) or {}).get("replaces")
        if replaces:
            record["replaces"] = replaces
        notes = quality_notes(n, options)
        if issues:
            record["issues"] = issues
            problems += [f"`{qid}`: {i}" for i in issues]
        if notes:
            record["notes"] = notes
        records.append(record)
    seen = Counter(r["id"] for r in records)
    problems += [f"`{qid}` у нескольких заданий банка" for qid, k in seen.items() if k > 1]
    return sorted(records, key=lambda r: (r["taskNumber"], r["id"])), new_links, problems


def load_authored():
    entries = {}
    for path in sorted(AUTHORED.glob("task-*.json")):
        entries.update(json.loads(path.read_text(encoding="utf-8")))
    return entries


def import_report(export, records, new_links, problems):
    counts = Counter(r["origin"] for r in records)
    lines = ["# Импорт из единого банка", "", f"Снимок от {export['generatedAt']}: заданий {len(records)} "
             f"(ФИПИ {counts['fipi']}, HSK {counts['hsk']}, новые {counts['generated']}).", "",
             f"Новых ID (записать в банк: `link lg --file data/review/new-links.json`): {len(new_links)}.",
             f"Не идут на сайт (сняты в банке или ждут решения): {len(export.get('withdrawn', []))}."]
    if problems:
        lines += ["", "## Замечания", ""] + [f"- {p}" for p in problems]
    notes = [f"- `{r['id']}`: {note}" for r in records for note in r.get("notes", [])]
    if notes:
        lines += ["", "## Заметки об источнике", "", "Публикации не мешают, но стоят взгляда при проверке.", ""] + notes
    return "\n".join(lines) + "\n"


def main():
    export = load_bank_snapshot()
    try:
        records, new_links, problems = records_from_export(export, load_authored())
    except ValueError as error:
        raise SystemExit(f"Импорт из банка остановлен: {error}")
    write_json(RAW_BANK, records)
    write_json(REVIEW / "new-links.json", new_links)
    write_text(REVIEW / "import-report.md", import_report(export, records, new_links, problems))
    print(f"Импорт из банка: {len(records)} заданий, новых ID {len(new_links)}, замечаний {len(problems)}")


if __name__ == "__main__":
    main()
