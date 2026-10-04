"""Импорт заданий, подготовленных навыком ege-chinese: sources/generated/ → data/raw/generated.json.

Принимаются партии двух видов:

1. JSON (sources/generated/<партия>.json):
   {"generator": "навык ege-chinese", "specVersion": "ЕГЭ 2026",
    "tasks": [{"taskNumber": 22, "stem": "…___…", "options": ["还", "再", "又", "就"], "key": 3}]}
   key — номер верного варианта с единицы, как в series.json навыка. Для №26 фрагменты
   A, B, C пишутся прямо в stem, как в банке ФИПИ.

2. Markdown в формате ответа навыка (sources/generated/<партия>.md): задания вида
   «**22.** Укажите…», затем условие и строка «1) 还  2) 再  3) 又  4) 就»; ключи — строки
   «**22 — ответ: 3**» во второй части. Если заданий одного номера несколько, ключи
   сопоставляются по порядку. Версия спецификации — строка «Спецификация: ЕГЭ 2026».

Необязательное поле JSON-партии "replaces": "q16-15173f0c" — задание исправляет спорное задание
ФИПИ: то же условие, спорный вариант заменён. Пока автор держит оригинал скрытым, а разбор
оригинала принят, сборка не считает копию повтором (build_bank.py).

ID задания вычисляется из номера, условия и вариантов: повторный импорт даёт тот же ID,
и прогресс учеников не теряется. Всё, что не удалось прочитать, — в отчёт, а не в банк.
Разборы добавляются потом волной через add_explanations.py, как и для заданий ФИПИ.
"""

import hashlib
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import DATA, INSTRUCTIONS, REVIEW, SOURCES, TASK_NUMBERS, read_json, write_json, write_text  # noqa: E402
from import_constructor import parse_fragments  # noqa: E402

GENERATED = SOURCES / "generated"
RAW_GENERATED = DATA / "raw" / "generated.json"
TASK_HEAD = re.compile(r"^\*\*(\d{2})\.\*\*\s*(.*)$")
KEY_LINE = re.compile(r"^\*\*(\d{2})\s*[—–-]\s*ответ:\s*(\d)\*\*")
# Номер варианта «N)» — в начале строки или после пробела: варианты читаются по номерам, а не по
# двойным пробелам между ними (один пробел склеил бы два варианта, и ключ указал бы на другой).
OPTION_MARK = re.compile(r"(?:^|(?<=\s))(\d)\)\s*")
SPEC = re.compile(r"^Спецификация:\s*(.+)$", re.M)
# Как в ЕГЭ и в банке ФИПИ: у заданий 20 и 21 три варианта, у остальных — четыре.
OPTION_COUNT = {20: 3, 21: 3}
CYRILLIC = re.compile(r"[А-Яа-яЁё]")
# ID задания ФИПИ, которое исправляет копия: q + номер + 8 знаков блока конструктора.
FIPI_ID = re.compile(r"^q(\d{2})-[0-9a-f]{8}$")


def generated_id(task_number, stem, options):
    digest = hashlib.sha1(f"{task_number}|{stem}|{'|'.join(options)}".encode("utf-8")).hexdigest()
    return f"g{task_number}-{digest[:8]}"


def record(task, batch_name, generator, spec_version):
    """Запись банка из задания партии; (запись | None, список проблем)."""
    problems = []
    n = task.get("taskNumber")
    if n not in TASK_NUMBERS:
        return None, [f"номер задания {n!r} вне 15–27"]
    stem = (task.get("stem") or "").strip()
    options = [str(o).strip() for o in task.get("options") or []]
    key = task.get("key")
    if not stem:
        problems.append("пустое условие")
    if CYRILLIC.search(stem):
        problems.append("в условии русский текст — инструкция попала в условие?")
    expected = OPTION_COUNT.get(n, 4)
    if len(options) != expected:
        problems.append(f"вариантов {len(options)}, у задания {n} их {expected}")
    if any(not o for o in options):
        problems.append("пустой вариант")
    if len(set(options)) != len(options):
        problems.append("повторяются варианты")
    if not isinstance(key, int) or not 1 <= key <= len(options):
        problems.append(f"ключ {key!r} не номер варианта")
    replaces = task.get("replaces")
    if "replaces" in task:
        match = FIPI_ID.match(replaces) if isinstance(replaces, str) else None
        if not match or int(match.group(1)) != n:
            problems.append(f"replaces {replaces!r} — нужен ID задания ФИПИ того же номера (q{n}-…)")
    if problems:
        return None, problems
    rec = {
        "id": generated_id(n, stem, options),
        "taskNumber": n,
        "formatYear": int(re.search(r"\d{4}", spec_version).group()) if re.search(r"\d{4}", spec_version) else None,
        "origin": "generated",
        "sourceRef": {
            "collection": generator,
            "specVersion": spec_version,
            "batch": batch_name,
        },
        "codifierCodes": list(task.get("codifierCodes") or []),
        "prompt": INSTRUCTIONS[n],
        "stem": stem,
        "options": [{"id": str(i), "text": text} for i, text in enumerate(options, 1)],
        "correctOptionId": str(key),
    }
    if replaces:
        rec["replaces"] = replaces
    if n == 26:
        fragments = parse_fragments(stem)
        if fragments is None:
            rec["issues"] = ["не удалось выделить фрагменты A, B, C"]
        else:
            rec["fragments"] = fragments
    return rec, []


def split_options(line):
    """Варианты по их номерам: «1) 还  2) 再 3) 又» → (["还", "再", "又"], None) или (None, причина)."""
    marks = list(OPTION_MARK.finditer(line))
    numbers = [int(m.group(1)) for m in marks]
    if numbers != list(range(1, len(numbers) + 1)):
        return None, "варианты пронумерованы не по порядку: " + " ".join(f"{n})" for n in numbers)
    ends = [m.start() for m in marks[1:]] + [len(line)]
    options = [line[m.end():end].strip() for m, end in zip(marks, ends)]
    if any(not o for o in options):
        return None, "пустой вариант в строке «" + line + "»"
    return options, None


def parse_markdown(text):
    """Задания и ключи из ответа навыка. Возвращает (spec, tasks, problems)."""
    spec_match = SPEC.search(text)
    spec = spec_match.group(1).strip() if spec_match else None
    # Навык нумерует как на бланке: три задания 27 — это три «**27.**» и три ключа «27 — ответ».
    keys = {}
    for m in map(KEY_LINE.match, text.splitlines()):
        if m:
            keys.setdefault(int(m.group(1)), []).append(int(m.group(2)))
    tasks, problems = [], []
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        head = TASK_HEAD.match(lines[i].strip())
        if not head or int(head.group(1)) not in TASK_NUMBERS:
            i += 1
            continue
        n = int(head.group(1))
        body = []
        i += 1
        while i < len(lines) and not TASK_HEAD.match(lines[i].strip()) and not lines[i].startswith("#"):
            if lines[i].strip() and not lines[i].strip().startswith("Ответ:"):
                body.append(lines[i].strip())
            i += 1
        option_lines = [line for line in body if re.match(r"^1\)", line)]
        if not option_lines:
            problems.append(f"№{n}: нет строки вариантов «1) … 2) …»")
            continue
        options, problem = split_options(option_lines[0])
        stem_lines = body[:body.index(option_lines[0])]
        # Задание со сломанными вариантами остаётся в списке до раздачи ключей: ключи идут по
        # порядку внутри номера, и соседние задания не должны получить чужой ключ.
        tasks.append({"taskNumber": n, "stem": "\n".join(stem_lines), "options": options or [], "problem": problem})
    for n in sorted({t["taskNumber"] for t in tasks}):
        group = [t for t in tasks if t["taskNumber"] == n]
        found = keys.get(n, [])
        if len(found) != len(group):
            problems.append(f"№{n}: заданий {len(group)}, ключей «**{n} — ответ: N**» {len(found)} — партия этого номера пропущена")
            tasks = [t for t in tasks if t["taskNumber"] != n]
            continue
        for task, key in zip(group, found):
            task["key"] = key
    problems += [f"№{t['taskNumber']}: {t['problem']}" for t in tasks if t["problem"]]
    tasks = [{k: v for k, v in t.items() if k != "problem"} for t in tasks if not t["problem"]]
    if not tasks and not problems:
        problems.append("в партии нет заданий 15–27")
    return spec, tasks, problems


def load_batches(directory=GENERATED):
    records, report = [], []
    for path in sorted(Path(directory).glob("*")):
        if path.name.lower() == "readme.md":
            continue
        if path.suffix == ".json":
            batch = read_json(path)
            spec = batch.get("specVersion")
            generator = batch.get("generator") or "навык ege-chinese"
            tasks, problems = batch.get("tasks") or [], []
        elif path.suffix == ".md":
            spec, tasks, problems = parse_markdown(path.read_text(encoding="utf-8"))
            generator = "навык ege-chinese"
        else:
            continue
        if not spec:
            report.append(f"{path.name}: не указана версия спецификации — партия пропущена")
            continue
        report += [f"{path.name}: {p}" for p in problems]
        for index, task in enumerate(tasks, 1):
            rec, errors = record(task, path.stem, generator, spec)
            if errors:
                report.append(f"{path.name}, задание {index}: " + "; ".join(errors))
            else:
                records.append(rec)
    by_id = {}
    for r in records:
        by_id.setdefault(r["id"], []).append(r)
    duplicates = sorted(qid for qid, same in by_id.items() if len(same) > 1)
    if duplicates:
        report.append("одинаковые задания в партиях (оставлено одно): " + ", ".join(duplicates))
        # ID не зависит от ключа: одно задание с разными ключами — спорный ключ, а не повтор.
        conflicting = [qid for qid in duplicates if len({r["correctOptionId"] for r in by_id[qid]}) > 1]
        if conflicting:
            report.append("у одинаковых заданий разные ключи (оставлен ключ первой партии — проверьте): "
                          + ", ".join(conflicting))
        records = [same[0] for same in by_id.values()]
    records.sort(key=lambda r: (r["taskNumber"], r["id"]))
    return records, report


def main():
    records, report = load_batches()
    write_json(RAW_GENERATED, records)
    lines = ["# Импорт сгенерированных заданий", "", f"Записей: {len(records)}.", "", "## Замечания", ""]
    lines += [f"- {line}" for line in report] or ["Нет."]
    write_text(REVIEW / "generated-import.md", "\n".join(lines) + "\n")
    print(f"Сгенерированные задания: {len(records)} → {RAW_GENERATED.relative_to(DATA.parent)}"
          + (f", замечаний: {len(report)}" if report else ""))


if __name__ == "__main__":
    main()
