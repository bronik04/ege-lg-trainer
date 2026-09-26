"""Общие пути и константы конвейера данных."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "sources"
SNAPSHOT = SOURCES / "constructor-bank"
MANIFEST = SOURCES / "manifest.json"
DATA = ROOT / "data"
RAW = DATA / "raw" / "fipi.json"
TOPICS = DATA / "topics.json"
RULES = DATA / "rules.json"
RULE_CHECKS = DATA / "rule-checks.json"
AUTHORED = DATA / "authored"
QUESTIONS = DATA / "questions.json"
REVIEW = DATA / "review"

TASK_NUMBERS = tuple(range(15, 28))
FORMAT_YEAR = 2026

# Формулировки заданий дословно по демоверсии ЕГЭ 2026 (стр. 12–15).
INSTRUCTIONS = {
    15: "Укажите, какое сочетание тонов соответствует сочетанию тонов в слове",
    16: "Укажите, какое счётное слово пропущено в данном предложении.",
    17: "Укажите, какая лексическая единица пропущена в данном предложении.",
    18: "Укажите, какой предлог пропущен в данном предложении.",
    19: "Укажите, какое числительное представлено в иероглифической записи.",
    20: "Укажите, какой глагольный суффикс пропущен в данном предложении.",
    21: "Укажите, какое служебное слово пропущено в данном предложении.",
    22: "Укажите, какое наречие пропущено в данном предложении.",
    23: "Укажите, какая результативная морфема пропущена в данном предложении.",
    24: "Укажите, какой дополнительный элемент пропущен в данном предложении.",
    25: "Укажите, какой дополнительный элемент пропущен в данном предложении.",
    26: "Укажите, какая последовательность расположения фрагментов предложения является верной с точки зрения грамматики.",
    27: "Укажите, какая грамматическая конструкция пропущена в данном предложении.",
}


def read_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def write_json(path, value):
    """Пишет JSON детерминированно: повторный прогон даёт тот же байтовый результат."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    path.write_text(text, encoding="utf-8")


def write_text(path, text):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
