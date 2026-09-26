"""Импорт снимка банка Конструктора: sources/constructor-bank/ → data/raw/fipi.json.

Формулировки, варианты и их порядок переносятся без правки. Всё, что не удалось
прочитать однозначно, попадает в `issues` записи и в отчёт импорта, а не исправляется.
"""

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (  # noqa: E402
    FORMAT_YEAR, INSTRUCTIONS, RAW, REVIEW, ROOT, SNAPSHOT, TASK_NUMBERS, read_json, write_json, write_text,
)

FIPI_ID = re.compile(r"^ФИПИ ([0-9A-Fa-f]{6})$")
KES = re.compile(r"^КЭС ФИПИ ([0-9.]+)$")
# Фрагменты задания 26: «A) …\nB) …» или «A … B … C …» в одну строку.
FRAGMENT = re.compile(r"(?:^|\s)([ABC])\)?\s+(.+?)(?=\s+[ABC]\)?\s+|\s*$)", re.S)
NUMBER_OPTION = re.compile(r"^\d{1,3}( \d{3})*$")


def question_id(task_number, block_id):
    return f"q{task_number}-{block_id[:8]}"


def parse_fragments(stem):
    found = [(letter, text.strip()) for letter, text in FRAGMENT.findall(stem)]
    if [letter for letter, _ in found] != ["A", "B", "C"]:
        return None
    return [{"id": letter, "text": text} for letter, text in found]


def convert(block, snapshot_name):
    """Одна запись банка из блока Конструктора и список найденных проблем."""
    issues = []
    task_number = int(block["type"].split("-")[1])
    tasks = block.get("tasks", [])
    if len(tasks) != 1:
        issues.append(f"в блоке {len(tasks)} заданий вместо одного")
    task = tasks[0]
    positions = task.get("positions", [])
    if len(positions) != 1:
        issues.append(f"в задании {len(positions)} позиций ответа вместо одной")
    correct = positions[0]["correct"] if positions else None

    options = [{"id": str(o["id"]), "text": o["text"]} for o in task.get("options", [])]
    if correct not in {o["id"] for o in options}:
        issues.append(f"ключ {correct!r} не совпадает ни с одним вариантом")

    tags = block.get("tags", [])
    fipi_ids = [m.group(1) for m in map(FIPI_ID.match, tags) if m]
    kes = [m.group(1) for m in map(KES.match, tags) if m]

    record = {
        "id": question_id(task_number, block["id"]),
        "taskNumber": task_number,
        "formatYear": FORMAT_YEAR,
        "origin": "fipi",
        "sourceRef": {
            "collection": "Открытый банк заданий ФИПИ",
            "fipiId": fipi_ids[0] if fipi_ids else None,
            "kes": kes,
            "constructorBlockId": block["id"],
            "file": f"sources/constructor-bank/{snapshot_name}",
        },
        "codifierCodes": list(block.get("codifierCodes", [])),
        "prompt": INSTRUCTIONS[task_number],
        "stem": task["prompt"],
        "options": options,
        "correctOptionId": correct,
    }
    if task_number == 26:
        fragments = parse_fragments(task["prompt"])
        if fragments is None:
            issues.append("не удалось выделить фрагменты A, B, C")
        else:
            record["fragments"] = fragments
    notes = []
    if task_number == 19:
        odd = [o["text"] for o in options if not NUMBER_OPTION.match(o["text"])]
        if odd:
            notes.append("нестандартная запись числа в вариантах: " + ", ".join(odd))
    if issues:
        record["issues"] = issues
    if notes:
        record["notes"] = notes
    return record


def load_snapshot(snapshot=SNAPSHOT):
    records = []
    for path in sorted(Path(snapshot).glob("*.json")):
        block = read_json(path)
        kind = block.get("type", "")
        if not kind.startswith("grammar-") or int(kind.split("-")[1]) not in TASK_NUMBERS:
            continue
        records.append(convert(block, path.name))
    records.sort(key=lambda r: (r["taskNumber"], r["id"]))
    return records


def report(records):
    lines = ["# Отчёт импорта", "", f"Записей: {len(records)}.", ""]
    lines += ["| Задание | Записей | С ID ФИПИ | Не прочитано | С заметками |", "| --- | --- | --- | --- | --- |"]
    for n in TASK_NUMBERS:
        group = [r for r in records if r["taskNumber"] == n]
        with_id = sum(1 for r in group if r["sourceRef"]["fipiId"])
        with_issues = sum(1 for r in group if r.get("issues"))
        with_notes = sum(1 for r in group if r.get("notes"))
        lines.append(f"| {n} | {len(group)} | {with_id} | {with_issues} | {with_notes} |")
    for title, field in (("Непрочитанные поля (задание не может стать готовым)", "issues"),
                         ("Заметки об источнике (готовности не мешают)", "notes")):
        lines += ["", f"## {title}", ""]
        flagged = [r for r in records if r.get(field)]
        if not flagged:
            lines.append("Нет.")
        for r in flagged:
            lines.append(f"- `{r['id']}` (№{r['taskNumber']}): " + "; ".join(r[field]))
    lines += [
        "",
        "## Поля, которых нет в источнике",
        "",
        "- Год формата: в банке не указан; всем записям проставлен формат "
        f"{FORMAT_YEAR} (открытый банк ФИПИ текущего года).",
        "- Разборы, темы и правила: в банке отсутствуют; пишутся в `data/authored/`.",
        "- Коды кодификатора в блоках Конструктора одинаковы для всех заданий одного номера; "
        "коды конкретного задания (`КЭС ФИПИ …`) есть только у части записей — поле `sourceRef.kes`.",
        "",
    ]
    return "\n".join(lines)


def main():
    records = load_snapshot()
    write_json(RAW, records)
    write_text(REVIEW / "import-report.md", report(records))
    print(f"Импорт: {len(records)} записей → {RAW.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
