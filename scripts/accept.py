"""Принять проверенные черновики: разборы заданий, правила, вопросы по правилам.

    python3 scripts/accept.py --list                 # что ждёт проверки
    python3 scripts/accept.py q20-190b16c0 aspect    # принять по ID
    python3 scripts/accept.py --task 20              # принять все черновые разборы задания 20

Запускает Claude по вердикту ревьюеров (решение автора 24.10.2026) или автор после чтения
data/review/queue.md: это и есть отметка «проверено». После принятия — пересобрать банк
(build_bank.py). Пункт из списка на правку (data/review/fixes.md) не принимается: он ждёт
исправления Claude. Разбор, перепроверенный после правки задания в банке (data/review/recheck.md),
принимается только по ID и только если подходит к новому тексту; иначе — reopen.py и новый разбор.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import AUTHORED, DATA, RULE_CHECKS, RULES, TASK_CONTENT, content_hash, read_json, write_json  # noqa: E402
from review_queue import pending_ids, read_fixes  # noqa: E402
from validate import explanation_problems  # noqa: E402


RAW_DIR = DATA / "raw"


def snapshot_of(record):
    return {"stem": record["stem"], "options": {o["id"]: o["text"] for o in record["options"]},
            "correctOptionId": record["correctOptionId"]}


def drafts():
    found = []
    for path in sorted(AUTHORED.glob("task-*.json")):
        found += [(qid, "задание") for qid, e in read_json(path).items() if e.get("status") == "draft"]
    found += [(r["id"], "правило") for r in read_json(RULES) if r.get("status") == "draft"]
    found += [(c["id"], "вопрос по правилу") for c in read_json(RULE_CHECKS) if c.get("status") == "draft"]
    return found


def accept(ids, task=None, fixes_text=None):
    waiting = pending_ids(read_fixes() if fixes_text is None else fixes_text)
    ids = set(ids)
    accepted = []
    # Задание поправили в банке, ревьюер перепроверил разбор: принять — значит закрепить новый текст.
    current = {r["id"]: r for path in sorted(RAW_DIR.glob("*.json")) for r in read_json(path)}
    for path in sorted(AUTHORED.glob("task-*.json")):
        entries = read_json(path)
        whole_file = task is not None and path.stem == f"task-{task}"
        changed = False
        for qid, entry in entries.items():
            if not (qid in ids or whole_file) or qid in waiting:
                continue
            drifted = qid in current and entry.get("sourceSnapshot") != snapshot_of(current[qid])
            rechecked = entry.get("status") == "accepted" and drifted and qid in ids
            if rechecked:
                task_now = current[qid]
                if explanation_problems(entry.get("explanation"), task_now["options"], task_now["correctOptionId"]):
                    continue
            if entry.get("status") == "draft" or rechecked:
                if drifted:
                    entry["sourceSnapshot"] = snapshot_of(current[qid])
                entry["status"] = "accepted"
                entry["acceptedHash"] = content_hash(entry, TASK_CONTENT)
                accepted.append(qid)
                changed = True
        if changed:
            write_json(path, entries)
    for path, prefix in ((RULES, "rule:"), (RULE_CHECKS, "check:")):
        items = read_json(path)
        changed = False
        for item in items:
            if item["id"] in ids and item.get("status") == "draft" and prefix + item["id"] not in waiting:
                item["status"] = "accepted"
                item["acceptedHash"] = content_hash(item)
                accepted.append(item["id"])
                changed = True
        if changed:
            write_json(path, items)
    return accepted


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("ids", nargs="*")
    parser.add_argument("--task", type=int, help="принять все черновые разборы этого задания")
    parser.add_argument("--list", action="store_true", help="показать черновики")
    args = parser.parse_args()
    if args.list:
        for item_id, kind in drafts():
            print(f"{kind}: {item_id}")
        return
    if not args.ids and args.task is None:
        parser.error("укажите ID или --task")
    accepted = accept(args.ids, args.task)
    waiting = pending_ids(read_fixes())
    held = sorted(i for i in set(args.ids) - set(accepted) if {i, f"rule:{i}", f"check:{i}"} & waiting)
    missing = sorted(set(args.ids) - set(accepted) - set(held))
    print(f"Принято: {len(accepted)}")
    if held:
        print("Ждут правки (data/review/fixes.md), не приняты: " + ", ".join(held))
    if missing:
        print("Не найдено среди черновиков: " + ", ".join(missing))


if __name__ == "__main__":
    main()
