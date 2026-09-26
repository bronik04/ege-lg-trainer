"""Принять проверенные черновики: разборы заданий, правила, вопросы по правилам.

    python3 scripts/accept.py --list                 # что ждёт проверки
    python3 scripts/accept.py q20-190b16c0 aspect    # принять по ID
    python3 scripts/accept.py --task 20              # принять все разборы задания 20

Запускает только автор после чтения data/review/queue.md: это и есть отметка
«проверено». После принятия — пересобрать банк (build_bank.py).
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import AUTHORED, RULE_CHECKS, RULES, read_json, write_json  # noqa: E402


def drafts():
    found = []
    for path in sorted(AUTHORED.glob("task-*.json")):
        found += [(qid, "задание") for qid, e in read_json(path).items() if e.get("status") == "draft"]
    found += [(r["id"], "правило") for r in read_json(RULES) if r.get("status") == "draft"]
    found += [(c["id"], "вопрос по правилу") for c in read_json(RULE_CHECKS) if c.get("status") == "draft"]
    return found


def accept(ids, task=None):
    ids = set(ids)
    accepted = []
    for path in sorted(AUTHORED.glob("task-*.json")):
        entries = read_json(path)
        whole_file = task is not None and path.stem == f"task-{task}"
        changed = False
        for qid, entry in entries.items():
            if (qid in ids or whole_file) and entry.get("status") == "draft":
                entry["status"] = "accepted"
                accepted.append(qid)
                changed = True
        if changed:
            write_json(path, entries)
    for path in (RULES, RULE_CHECKS):
        items = read_json(path)
        changed = False
        for item in items:
            if item["id"] in ids and item.get("status") == "draft":
                item["status"] = "accepted"
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
    missing = sorted(set(args.ids) - set(accepted))
    print(f"Принято: {len(accepted)}")
    if missing:
        print("Не найдено среди черновиков: " + ", ".join(missing))


if __name__ == "__main__":
    main()
