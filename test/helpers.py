"""Заготовки записей для тестов конвейера."""

import copy
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

EXPLAIN = "Объяснение достаточной длины, чтобы пройти проверку на содержательность."


def record(task=20, qid=None, options=("了", "着", "过"), correct="2", stem="老板正开___会，不方便接电话。", **extra):
    rec = {
        "id": qid or f"q{task}-00000001",
        "taskNumber": task,
        "formatYear": 2026,
        "origin": "fipi",
        "sourceRef": {"collection": "Открытый банк заданий ФИПИ", "fipiId": None, "kes": [],
                      "constructorBlockId": "00000001-x", "file": "sources/constructor-bank/x.json"},
        "codifierCodes": [],
        "prompt": "Укажите, какой глагольный суффикс пропущен в данном предложении.",
        "stem": stem,
        "options": [{"id": str(i), "text": t} for i, t in enumerate(options, 1)],
        "correctOptionId": correct,
    }
    rec.update(extra)
    return rec


def explanation_for(rec):
    return {
        "correct": EXPLAIN,
        "options": {o["id"]: EXPLAIN for o in rec["options"] if o["id"] != rec["correctOptionId"]},
    }


def authored_for(rec, status="accepted", rule_ids=("aspect-suffixes",), topic_ids=("aspect",)):
    return {
        "status": status,
        "topicIds": list(topic_ids),
        "ruleIds": list(rule_ids),
        "sourceSnapshot": {
            "stem": rec["stem"],
            "options": {o["id"]: o["text"] for o in rec["options"]},
            "correctOptionId": rec["correctOptionId"],
        },
        "explanation": explanation_for(rec),
        "_file": "task-test.json",
    }


def ready_question(**kw):
    q = record(**kw)
    q.update(topicIds=["aspect"], ruleIds=["aspect-suffixes"], explanation=explanation_for(q), reviewStatus="ready")
    return q


TOPICS = [{"id": "aspect", "title": "了, 过, 着", "taskNumbers": [20]},
          {"id": "sentence-order", "title": "Порядок", "taskNumbers": [26]}]


def rule(rule_id="aspect-suffixes", status="accepted"):
    return {
        "id": rule_id, "title": "Суффиксы", "topicIds": ["aspect"], "status": status,
        "summary": "Кратко.", "usage": ["условие"],
        "examples": [{"zh": "我吃了饭。", "ru": "Я поел."}, {"zh": "我吃过。", "ru": "Я пробовал."}],
        "contrast": {"pair": [{"zh": "他去了。", "ru": "Он ушёл."}, {"zh": "他去过。", "ru": "Он бывал."}],
                     "note": "Разница."},
        "mistake": "Путают 了 и 过.",
    }


def clone(value):
    return copy.deepcopy(value)
