"""Вернуть принятое в черновик, чтобы поправить: разбор задания, правило, вопрос по правилу.

    python3 scripts/reopen.py q20-16926dc2 de-particles check-de-first

Принятое привязано к тексту (acceptedHash): правка принятого без этого шага остановит сборку.
Черновик уходит с сайта и возвращается, когда автор примет его заново. Правило уводит с собой
свои принятые вопросы: принятый вопрос к непринятому правилу validate.py не пропустит.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import AUTHORED, RULE_CHECKS, RULES, read_json, write_json  # noqa: E402


def to_draft(item):
    item["status"] = "draft"
    item.pop("acceptedHash", None)


def reopen(ids):
    ids = set(ids)
    done = []
    for path in sorted(AUTHORED.glob("task-*.json")):
        entries = read_json(path)
        hit = [qid for qid, entry in entries.items() if qid in ids and entry.get("status") == "accepted"]
        for qid in hit:
            to_draft(entries[qid])
        if hit:
            write_json(path, entries)
            done += hit
    rules = read_json(RULES)
    reopened_rules = {r["id"] for r in rules if r["id"] in ids and r.get("status") == "accepted"}
    for r in rules:
        if r["id"] in reopened_rules:
            to_draft(r)
    if reopened_rules:
        write_json(RULES, rules)
        done += sorted(reopened_rules)
    checks = read_json(RULE_CHECKS)
    hit = [c for c in checks if c.get("status") == "accepted"
           and (c["id"] in ids or reopened_rules & set(c.get("ruleIds") or []))]
    for c in hit:
        to_draft(c)
    if hit:
        write_json(RULE_CHECKS, checks)
        done += [c["id"] for c in hit]
    return done


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    done = reopen(sys.argv[1:])
    print(f"В черновики: {len(done)}" + (": " + ", ".join(done) if done else ""))
    missing = sorted(set(sys.argv[1:]) - set(done))
    if missing:
        print("Не найдено среди принятого: " + ", ".join(missing))


if __name__ == "__main__":
    main()
