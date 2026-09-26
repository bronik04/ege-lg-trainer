"""Добавить черновые разборы заданий (волну) в data/authored/task-NN.json.

    python3 scripts/add_explanations.py wave.json

wave.json: {"q20-190b16c0": {"topicIds": [...], "ruleIds": [...],
            "explanation": {"correct": "...", "options": {"1": "...", "3": "..."}},
            "contrast": {"zh": "...", "ru": "..."}  # необязательно
           }, ...}

Каждая запись получает статус draft и снимок условия, вариантов и ключа из банка:
если источник потом изменится, сборка остановится и попросит перепроверить разбор.
Принятые записи не перезаписываются.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_bank import load_records  # noqa: E402
from common import AUTHORED, read_json, write_json  # noqa: E402

FIELDS = ("topicIds", "ruleIds", "explanation", "contrast", "keyConflict", "note")


def add(wave):
    records = {r["id"]: r for r in load_records()}
    unknown = sorted(set(wave) - set(records))
    if unknown:
        raise SystemExit("Нет в банке: " + ", ".join(unknown))
    by_file = {}
    for qid, entry in wave.items():
        by_file.setdefault(f"task-{records[qid]['taskNumber']}.json", []).append((qid, entry))
    added, skipped = [], []
    for name, items in sorted(by_file.items()):
        path = AUTHORED / name
        current = read_json(path) if path.exists() else {}
        for qid, entry in items:
            if current.get(qid, {}).get("status") == "accepted":
                skipped.append(qid)
                continue
            rec = records[qid]
            current[qid] = {
                "status": "draft",
                **{k: entry[k] for k in FIELDS if k in entry},
                "sourceSnapshot": {
                    "stem": rec["stem"],
                    "options": {o["id"]: o["text"] for o in rec["options"]},
                    "correctOptionId": rec["correctOptionId"],
                },
            }
            added.append(qid)
        write_json(path, dict(sorted(current.items())))
    return added, skipped


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    added, skipped = add(read_json(sys.argv[1]))
    print(f"Добавлено черновиков: {len(added)}")
    if skipped:
        print("Уже приняты, не тронуты: " + ", ".join(skipped))


if __name__ == "__main__":
    main()
