"""Общие пути и константы конвейера данных."""

import hashlib
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "sources"
DATA = ROOT / "data"
TOPICS = DATA / "topics.json"
RULES = DATA / "rules.json"
RULE_CHECKS = DATA / "rule-checks.json"
AUTHORED = DATA / "authored"
QUESTIONS = DATA / "questions.json"
REVIEW = DATA / "review"
BANK_SOURCE = SOURCES / "bank"
RAW_BANK = DATA / "raw" / "bank.json"

TASK_NUMBERS = tuple(range(15, 28))
BANK_SCHEMA = 1
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


# Что автор принимает в разборе задания: то, что видит ученик, текст источника, к которому разбор
# написан, и пометка спорного ключа с решением по ней — снять её значит открыть задание ученикам.
TASK_CONTENT = ("topicIds", "ruleIds", "explanation", "contrast", "sourceSnapshot", "keyConflict", "keyDecision")


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


def load_bank_snapshot(source=None):
    """Выгрузка единого банка из снимка sources/bank: сверяет контрольную сумму с манифестом.

    Сайт собирается в GitHub Actions, где Диска нет, поэтому конвейер читает только этот снимок;
    правка снимка руками ломает сверку с банком и не принимается.
    """
    source = Path(source) if source else BANK_SOURCE
    export, manifest = source / "export.json", source / "manifest.json"
    if not export.exists() or not manifest.exists():
        raise SystemExit(f"нет снимка банка в {source}: запустите scripts/snapshot_bank.py <выгрузка>")
    raw = export.read_bytes()
    if hashlib.sha256(raw).hexdigest() != json.loads(manifest.read_text(encoding="utf-8"))["sha256"]:
        raise SystemExit(f"снимок банка {export} изменён вручную: возьмите новую выгрузку и snapshot_bank.py")
    data = json.loads(raw.decode("utf-8"))
    if data.get("schemaVersion") != BANK_SCHEMA:
        raise SystemExit(f"выгрузка банка: schemaVersion {data.get('schemaVersion')!r}, ожидается {BANK_SCHEMA}")
    return data


# Фрагменты задания 26: «A) …\nB) …» или «A … B … C …» в одну строку.
FRAGMENT = re.compile(r"(?:^|\s)([ABC])\)?\s+(.+?)(?=\s+[ABC]\)?\s+|\s*$)", re.S)
NUMBER_OPTION = re.compile(r"^\d{1,3}( \d{3})*$")


def parse_fragments(stem):
    """Фрагменты A, B, C задания 26 или None, если выделить их нельзя."""
    found = [(letter, text.strip()) for letter, text in FRAGMENT.findall(stem)]
    if [letter for letter, _ in found] != ["A", "B", "C"]:
        return None
    return [{"id": letter, "text": text} for letter, text in found]


def quality_notes(task_number, options):
    """Замечания к заданию, которые не мешают публикации, но стоят отчёта."""
    texts = [o["text"] for o in options]
    notes = []
    if task_number == 19:
        odd = [t for t in texts if not NUMBER_OPTION.match(t)]
        if odd:
            notes.append("нестандартная запись числа в вариантах: " + ", ".join(odd))
    if task_number == 24 and not any(("得" in t or "不" in t) for t in texts):
        notes.append("в вариантах нет 得/不: по формату это задание 23 (результативная морфема), а не 24")
    return notes
