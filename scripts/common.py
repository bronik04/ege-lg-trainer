"""Общие пути и константы конвейера данных."""

import hashlib
import json
import os
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
# Сообщения об ошибках в заданиях ученик оставляет в issues этого репозитория.
ISSUES_URL = "https://github.com/bronik04/ege-lg-trainer/issues/new"
# Постоянный адрес сайта: превью ссылок в мессенджерах берёт картинку только по полному URL.
SITE_URL = "https://bronik04.github.io/ege-lg-trainer/"

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


# Что автор принимает в разборе задания: то, что видит ученик, и текст источника, к которому
# разбор написан. Пометка спорного ключа и решение по нему не входят: они только прячут задание.
TASK_CONTENT = ("topicIds", "ruleIds", "explanation", "contrast", "sourceSnapshot")


def content_hash(item, fields=None):
    """Отпечаток принятого: accept.py записывает его в acceptedHash. Изменилось после принятия —
    сборка останавливается, пока пункт не вернут в черновик и автор не примет его заново."""
    value = ({k: item[k] for k in fields if k in item} if fields
             else {k: v for k, v in item.items() if k not in ("status", "acceptedHash")})
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()[:12]


def read_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def write_json(path, value):
    """Пишет JSON детерминированно: повторный прогон даёт тот же байтовый результат."""
    write_text(path, json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def write_text(path, text):
    """Через временный файл рядом: закрытое посреди записи окно «Проверки» не оставит пустой файл."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.tmp")
    try:
        temp.write_text(text, encoding="utf-8")
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)
