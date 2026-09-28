"""Сборка страницы тренажёра: данные + src/ → один самодостаточный HTML.

    python3 scripts/build_site.py            # dist/index.html — только принятое (для публикации)
    python3 scripts/build_site.py --drafts   # review-build/review.html — с черновиками, для проверки автором

Страница не ходит в сеть: стили, скрипт и банк встроены в неё.
"""

import argparse
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import DATA, FORMAT_YEAR, ISSUES_URL, ROOT, read_json, write_text  # noqa: E402

SRC = ROOT / "src"
PWA = SRC / "pwa"
# Работа без сети — только у опубликованной страницы: сборка для проверки не кэшируется.
PWA_HEAD = ('<link rel="manifest" href="manifest.webmanifest">\n'
            '<link rel="apple-touch-icon" href="apple-touch-icon.png">\n'
            '<meta name="apple-mobile-web-app-title" content="ЕГЭ 15–27">')
PWA_FILES = ("manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", "icon-maskable-512.png",
             "apple-touch-icon.png")
QUESTION_FIELDS = ("id", "taskNumber", "formatYear", "origin", "prompt", "stem", "fragments", "options",
                   "correctOptionId", "topicIds", "ruleIds", "explanation", "contrast")
SOURCE_FIELDS = ("collection", "fipiId", "specVersion")


def payload(questions, topics, rules, rule_checks, drafts=False):
    """Что увидит ученик. Без --drafts — только принятое и готовое."""
    if drafts:
        shown_rules = rules
        shown_checks = rule_checks
        shown_questions = [q for q in questions if q["reviewStatus"] in ("ready", "draft") and q.get("explanation")]
    else:
        shown_rules = [r for r in rules if r["status"] == "accepted"]
        accepted = {r["id"] for r in shown_rules}
        shown_checks = [c for c in rule_checks
                        if c["status"] == "accepted" and all(r in accepted for r in c["ruleIds"])]
        shown_questions = [q for q in questions if q["reviewStatus"] == "ready"]

    def question(q):
        out = {k: q[k] for k in QUESTION_FIELDS if q.get(k) is not None}
        out["sourceRef"] = {k: q["sourceRef"][k] for k in SOURCE_FIELDS if q["sourceRef"].get(k)}
        if q["reviewStatus"] != "ready":
            out["draft"] = True
        return out

    def content(item):
        out = {k: v for k, v in item.items() if k != "status"}
        if item["status"] != "accepted":
            out["draft"] = True
        return out

    return {
        "meta": {"formatYear": FORMAT_YEAR, "drafts": drafts, "issuesUrl": ISSUES_URL, "offline": not drafts},
        "topics": topics,
        "rules": [content(r) for r in shown_rules],
        "ruleChecks": [content(c) for c in shown_checks],
        "questions": [question(q) for q in shown_questions],
    }


def inline_logic(source):
    """logic.mjs — модуль для тестов; на странице он часть общего скрипта."""
    return re.sub(r"^export\s+", "", source, flags=re.M)


def embed_json(value):
    # «<» экранируется целиком: строка из банка не сможет закрыть тег <script>.
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")


def description(data):
    count = len(data["questions"])
    if not count:
        return "Тренажёр заданий 15–27 ЕГЭ по китайскому языку: правила, проверка, практика и полный вариант."
    origin = ("банка ФИПИ и новых" if any(q["origin"] == "generated" for q in data["questions"])
              else "банка ФИПИ")
    return (f"Тренажёр заданий 15–27 ЕГЭ по китайскому языку: {count} заданий {origin} с разбором "
            "каждого неверного варианта, правила и полный вариант.")


def render(data):
    template = (SRC / "template.html").read_text(encoding="utf-8")
    script = inline_logic((SRC / "logic.mjs").read_text(encoding="utf-8")) + "\n" + (SRC / "app.js").read_text(encoding="utf-8")
    css = (SRC / "app.css").read_text(encoding="utf-8")
    html = template
    for marker, value in (("/*APP_CSS*/", css), ("/*APP_JS*/", script),
                          ("/*DATA_JSON*/", embed_json(data)), ("/*DESCRIPTION*/", description(data)),
                          ("/*PWA_HEAD*/", PWA_HEAD if data["meta"]["offline"] else "")):
        if marker not in html:
            raise SystemExit(f"В шаблоне нет метки {marker}")
        html = html.replace(marker, value)
    return html


def write_offline(directory, html):
    """Рядом со страницей: манифест, иконки и service worker с версией — отпечатком страницы,
    файлов рядом и самого worker: сменили только иконку — у учеников всё равно новая версия."""
    digest = hashlib.sha256(html.encode("utf-8"))
    for name in PWA_FILES:
        shutil.copyfile(PWA / name, directory / name)
        digest.update((PWA / name).read_bytes())
    template = (PWA / "sw.js").read_text(encoding="utf-8")
    digest.update(template.encode("utf-8"))
    version = digest.hexdigest()[:12]
    write_text(directory / "sw.js", template.replace("/*VERSION*/", version))
    return version


def write_offline_off(directory):
    """Аварийное выключение: под именем sw.js — worker, который удаляет кэши и снимает себя."""
    shutil.copyfile(PWA / "sw-off.js", directory / "sw.js")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--drafts", action="store_true", help="показать черновики (страница для проверки)")
    parser.add_argument("--data-dir", type=Path, default=DATA)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--no-offline", action="store_true",
                        help="аварийно выключить работу без сети у всех, кто открывал сайт (кладёт sw-off.js как sw.js)")
    args = parser.parse_args()
    out = args.out or (ROOT / ("review-build/review.html" if args.drafts else "dist/index.html"))
    d = args.data_dir
    data = payload(read_json(d / "questions.json"), read_json(d / "topics.json"),
                   read_json(d / "rules.json"), read_json(d / "rule-checks.json"), drafts=args.drafts)
    if args.no_offline:
        data["meta"]["offline"] = False
    html = render(data)
    write_text(out, html)
    if data["meta"]["offline"]:
        write_offline(out.parent, html)
    elif args.no_offline:
        write_offline_off(out.parent)
    print(f"Страница: {out} — заданий {len(data['questions'])}, правил {len(data['rules'])}, "
          f"вопросов по правилам {len(data['ruleChecks'])}")


if __name__ == "__main__":
    main()
