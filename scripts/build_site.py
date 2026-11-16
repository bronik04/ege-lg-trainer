"""Сборка страницы тренажёра: данные + src/ → один самодостаточный HTML.

    python3 scripts/build_site.py            # dist/index.html — только принятое (для публикации)
    python3 scripts/build_site.py --drafts   # review-build/review.html — с черновиками, для проверки автором

Стили, скрипт и банк встроены в страницу. Из сети — только стили шрифтов (Google Fonts,
jsDelivr), без них страница работает на системных; опубликованная страница кладёт рядом
service worker для работы без сети.
"""

import argparse
import hashlib
import json
import re
import shutil
import sys
from html import escape
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import DATA, FORMAT_YEAR, ISSUES_URL, ROOT, SITE_URL, TONE_WORDS, read_json, write_text  # noqa: E402
import tones  # noqa: E402

SRC = ROOT / "src"
PWA = SRC / "pwa"
# Превью ссылки в мессенджерах (Open Graph): только у опубликованной страницы, в том числе при
# аварийном выключении работы без сети. Картинка — src/og/og-image.jpg (перерисовать:
# node scripts/render_og_image.mjs); странице она не нужна, поэтому в кэш sw.js не входит.
OG_IMAGE = SRC / "og" / "og-image.jpg"
TITLE = "Лексика и грамматика ЕГЭ — китайский язык"
# Работа без сети — только у опубликованной страницы: сборка для проверки не кэшируется.
PWA_HEAD = ('<link rel="manifest" href="manifest.webmanifest">\n'
            '<link rel="apple-touch-icon" href="apple-touch-icon.png">\n'
            '<meta name="apple-mobile-web-app-title" content="ЕГЭ 15–27">')
PWA_FILES = ("manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", "icon-maskable-512.png",
             "apple-touch-icon.png")
QUESTION_FIELDS = ("id", "taskNumber", "formatYear", "origin", "prompt", "stem", "fragments", "options",
                   "correctOptionId", "topicIds", "ruleIds", "explanation", "contrast")
SOURCE_FIELDS = ("collection", "fipiId", "specVersion", "paper", "number")


def payload(questions, topics, rules, rule_checks, drafts=False, tone_words=()):
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
        out = {k: v for k, v in item.items() if k not in ("status", "acceptedHash")}
        if item["status"] != "accepted":
            out["draft"] = True
        return out

    def tone_question(entry):
        # Пиньинь и перевод уже в разборе: отдельными полями они странице не нужны.
        out = {k: v for k, v in tones.make_question(entry).items()
               if k not in tones.QUESTION_BASE and k not in ("pinyin", "translation")}
        if entry["status"] != "accepted":
            out["draft"] = True
        return out

    # Слова тренировки тонов: на сайт идут принятые, черновики — только в сборке для проверки.
    shown_tones = [tone_question(e) for e in tone_words if drafts or e["status"] == "accepted"]

    return {
        "meta": {"formatYear": FORMAT_YEAR, "drafts": drafts, "issuesUrl": ISSUES_URL, "offline": not drafts},
        "topics": topics,
        "rules": [content(r) for r in shown_rules],
        "ruleChecks": [content(c) for c in shown_checks],
        "questions": [question(q) for q in shown_questions],
        "toneBase": tones.QUESTION_BASE,
        "tones": shown_tones,
    }


def inline_logic(source):
    """logic.mjs — модуль для тестов; на странице он часть общего скрипта."""
    return re.sub(r"^export\s+", "", source, flags=re.M)


def embed_json(value):
    # «<» экранируется целиком: строка из банка не сможет закрыть тег <script>.
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")


def plural(n, one, few, many):
    if n % 10 == 1 and n % 100 != 11:
        return one
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return few
    return many


def description(data):
    count = len(data["questions"])
    if not count:
        return "Тренажёр заданий 15–27 ЕГЭ по китайскому языку: правила, проверка, практика и полный вариант."
    kinds = {q["origin"] for q in data["questions"]}
    names = ["банка ФИПИ"] + [name for origin, name in (("generated", "новых"), ("hsk", "HSK 4")) if origin in kinds]
    origin = names[0] if len(names) == 1 else ", ".join(names[:-1]) + " и " + names[-1]
    tasks = plural(count, "задание", "задания", "заданий")
    words = len(data.get("tones") or [])
    tones_note = f", {words} {plural(words, 'слово', 'слова', 'слов')} для тренировки тонов" if words else ""
    return (f"Тренажёр заданий 15–27 ЕГЭ по китайскому языку: {count} {tasks} {origin} с разбором "
            f"каждого неверного варианта{tones_note}, правила и полный вариант.")


def og_image_url():
    # ?v= — отпечаток картинки: мессенджеры кэшируют превью по URL и иначе не увидят новую.
    return f"{SITE_URL}og-image.jpg?v={hashlib.sha256(OG_IMAGE.read_bytes()).hexdigest()[:8]}"


def share_head(data):
    text = escape(description(data))
    image = og_image_url()
    return "\n".join((
        '<meta property="og:type" content="website">',
        '<meta property="og:locale" content="ru_RU">',
        f'<meta property="og:title" content="{TITLE}">',
        f'<meta property="og:description" content="{text}">',
        f'<meta property="og:url" content="{SITE_URL}">',
        f'<meta property="og:image" content="{image}">',
        '<meta property="og:image:width" content="1200">',
        '<meta property="og:image:height" content="630">',
        '<meta name="twitter:card" content="summary_large_image">',
        f'<meta name="twitter:title" content="{TITLE}">',
        f'<meta name="twitter:description" content="{text}">',
        f'<meta name="twitter:image" content="{image}">',
    ))


def render(data):
    template = (SRC / "template.html").read_text(encoding="utf-8")
    script = inline_logic((SRC / "logic.mjs").read_text(encoding="utf-8")) + "\n" + (SRC / "app.js").read_text(encoding="utf-8")
    # Токены системы «Тушь и киноварь» — первыми: стили страницы пишутся поверх них.
    # Комментарии токенов в страницу не идут: в них образец <link> со шрифтами.
    tokens = re.sub(r"/\*.*?\*/", "", (SRC / "ink" / "ink-tokens.css").read_text(encoding="utf-8"), flags=re.S)
    css = tokens + "\n" + (SRC / "app.css").read_text(encoding="utf-8")
    values = {"/*APP_CSS*/": css, "/*APP_JS*/": script,
              "/*DATA_JSON*/": embed_json(data), "/*DESCRIPTION*/": description(data),
              "/*PWA_HEAD*/": PWA_HEAD if data["meta"]["offline"] else "",
              "/*SHARE_HEAD*/": "" if data["meta"]["drafts"] else share_head(data)}
    for marker in values:
        if marker not in template:
            raise SystemExit(f"В шаблоне нет метки {marker}")
    # Один проход по шаблону: такая же строка в тексте банка или в скрипте остаётся как есть.
    pattern = "|".join(re.escape(marker) for marker in values)
    return re.sub(pattern, lambda m: values[m.group(0)], template)


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


def vsosh_explanation(explanation, wrong_ids, label):
    correct_note = explanation.get("correct") if isinstance(explanation, dict) else None
    wrong_notes = explanation.get("options") if isinstance(explanation, dict) else None
    if (not isinstance(correct_note, str) or not correct_note.strip()
            or not isinstance(wrong_notes, dict) or set(wrong_notes) != wrong_ids
            or any(not isinstance(note, str) or not note.strip() for note in wrong_notes.values())):
        raise ValueError(f"{label}: нужен разбор верного и каждого неверного ответа")
    return explanation


def vsosh_new_texts(path):
    collection = read_json(path)
    contexts = []
    questions = []
    for passage in collection["passages"]:
        context_id = passage["id"]
        markers = re.findall(r"\{\{(\d+)\}\}", passage["text"])
        numbers = [str(gap["number"]) for gap in passage["gaps"]]
        if markers != numbers or numbers != ["18", "19", "20"]:
            raise ValueError(f"{context_id}: ожидаются пропуски 18–20 по порядку")
        contexts.append({"id": context_id, "label": passage["title"], "text": passage["text"]})
        for gap in passage["gaps"]:
            number = gap["number"]
            options = gap["options"]
            if set(options) != set("ABCD") or len(set(options.values())) != 4 or gap["correctId"] not in options:
                raise ValueError(f"{context_id}, № {number}: нужны четыре разных варианта и один ключ")
            explanation = vsosh_explanation(gap.get("explanation"), set(options) - {gap["correctId"]},
                                            f"{context_id}, № {number}")
            questions.append({
                "id": f"{context_id}-{number}",
                "kind": "passageGap",
                "topicId": "cloze-vocabulary",
                "contextId": context_id,
                "taskNumber": number,
                "gapNumber": number,
                "prompt": collection["instruction"],
                "options": [{"id": key, "text": options[key]} for key in "ABCD"],
                "correctId": gap["correctId"],
                "explanation": explanation,
            })
    return {"schemaVersion": 1, "contexts": contexts, "questions": questions}


def vsosh_practice_drafts(paths, bank, status="draft", accepted=None):
    collections = [read_json(path) for path in paths]
    if not bank or any(item["schemaVersion"] != 1 or item["status"] != status for item in collections):
        raise ValueError(f"Для практики ВсОШ нужен основной банк и набор со статусом {status}")

    known_banks = (bank, accepted or {})
    ids = {item["id"] for known in known_banks for key in ("questions", "contexts") for item in known.get(key, [])}
    topics = {topic["id"] for known in known_banks for topic in known.get("topics", [])}
    extra_topics = [topic for collection in collections for topic in collection.get("topics", [])]
    for topic in extra_topics:
        topic_id = topic.get("id")
        label = topic.get("label")
        if not isinstance(topic_id, str) or not topic_id.strip() or topic_id in topics:
            raise ValueError(f"Повтор или пустой идентификатор темы ВсОШ: {topic_id!r}")
        if not isinstance(label, str) or not label.strip():
            raise ValueError(f"{topic_id}: нужно название темы ВсОШ")
        topics.add(topic_id)

    questions = [question for collection in collections for question in collection["questions"]]
    for question in questions:
        label = question["id"]
        if label in ids or question["topicId"] not in topics:
            raise ValueError(f"{label}: повтор идентификатора или неизвестная тема")
        if question["origin"] != "generated" or question["stage"] != "final":
            raise ValueError(f"{label}: ожидается авторское задание заключительного этапа")
        ids.add(label)
        options = question["options"]
        correct = question["correctId"]
        if ([option["id"] for option in options] != list("ABCD")
                or len({o["text"] for o in options}) != 4 or correct not in set("ABCD")):
            raise ValueError(f"{label}: нужны четыре разных варианта и один ключ")
        if question["kind"] == "wordPlacement":
            if (re.findall(r"\{\{([A-D])\}\}", question["stem"]) != list("ABCD")
                    or not question.get("insertionText") or [o["text"] for o in options] != list("ABCD")):
                raise ValueError(f"{label}: нужны слово для вставки и четыре позиции в предложении")
        elif question["kind"] == "singleChoice":
            blanks = len(re.findall(r"_{2,}", question["stem"]))
            if blanks not in (1, 2) or any(
                    len([part for part in o["text"].split("……") if part.strip()]) != blanks for o in options):
                raise ValueError(f"{label}: число пропусков не совпадает с вариантами ответа")
        else:
            raise ValueError(f"{label}: неизвестный вид задания")
        vsosh_explanation(question.get("explanation"), set("ABCD") - {correct}, label)
        if not question.get("sentenceRu") or not all(o.get("ru") for o in options):
            raise ValueError(f"{label}: нужны перевод и значения вариантов")
    return {"schemaVersion": 1, "contexts": [], "topics": extra_topics, "questions": questions}


def add_vsosh_reviews(bank, path):
    review = read_json(path)
    questions = review["questions"]
    passages = review["contexts"]
    # Файл разборов относится к полным комплектам. У карточек дополнительной
    # практики собственные пояснения, они не привязаны к комплекту через sourceId.
    set_questions = [q for q in bank["questions"] if q.get("sourceId")]
    if set(questions) != {q["id"] for q in set_questions}:
        raise ValueError("Разборы ВсОШ должны покрывать все задания полных комплектов")
    if set(passages) != {c["id"] for c in bank["contexts"]}:
        raise ValueError("Переводы ВсОШ должны покрывать все общие тексты")
    for q in set_questions:
        row = questions[q["id"]]
        if (not isinstance(row["ru"], str) or not row["ru"].strip()
                or any(len(row[key]) != len(q["options"]) for key in ("gloss", "why"))
                or not all(isinstance(x, str) and x.strip() for key in ("gloss", "why") for x in row[key])):
            raise ValueError(f'{q["id"]}: нужны перевод и разбор каждого варианта')
        notes = dict(zip((o["id"] for o in q["options"]), row["why"]))
        q["explanation"] = {"correct": notes.pop(q["correctId"]), "options": notes}
        q["sentenceRu"] = row["ru"]
        for option, gloss in zip(q["options"], row["gloss"]):
            option["ru"] = gloss
        if row.get("note"):
            q["reviewNote"] = row["note"]
    for context in bank["contexts"]:
        translation = passages[context["id"]]
        if not isinstance(translation, str) or not translation.strip():
            raise ValueError(f'{context["id"]}: нужен перевод всего текста')
        context["textRu"] = translation


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--drafts", action="store_true", help="показать черновики (страница для проверки)")
    parser.add_argument("--data-dir", type=Path, default=DATA)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--vsosh-new-texts", type=Path, help="локальная подборка текстов ВсОШ для сборки с --drafts")
    parser.add_argument("--vsosh-practice-drafts", type=Path, action="append",
                        help="локальная подборка практики ВсОШ для сборки с --drafts, можно указать несколько раз")
    parser.add_argument("--vsosh-review", type=Path, help="локальные разборы официальных заданий ВсОШ для сборки с --drafts")
    parser.add_argument("--no-offline", action="store_true",
                        help="аварийно выключить работу без сети у всех, кто открывал сайт (кладёт sw-off.js как sw.js)")
    args = parser.parse_args()
    if args.vsosh_new_texts and not args.drafts:
        parser.error("--vsosh-new-texts требует --drafts")
    if args.vsosh_practice_drafts and not args.drafts:
        parser.error("--vsosh-practice-drafts требует --drafts")
    if args.vsosh_review and not args.drafts:
        parser.error("--vsosh-review требует --drafts")
    out = args.out or (ROOT / ("review-build/review.html" if args.drafts else "dist/index.html"))
    d = args.data_dir
    words_file = d / TONE_WORDS.name
    vsosh_file = d / "vsosh-zh-lg.json"
    data = payload(read_json(d / "questions.json"), read_json(d / "topics.json"),
                   read_json(d / "rules.json"), read_json(d / "rule-checks.json"), drafts=args.drafts,
                   tone_words=read_json(words_file)["words"] if words_file.exists() else [])
    if vsosh_file.exists():
        data["vsosh"] = read_json(vsosh_file)
    practice_file = d / "vsosh-practice.json"
    if practice_file.exists():
        data["vsoshPractice"] = vsosh_practice_drafts([practice_file], data.get("vsosh"), "accepted")
    review_file = args.vsosh_review or d / "vsosh-review.json"
    if args.vsosh_review or review_file.exists():
        if "vsosh" not in data:
            raise ValueError("Разборы ВсОШ требуют основной банк заданий")
        add_vsosh_reviews(data["vsosh"], review_file)
    if args.vsosh_new_texts:
        data["vsoshNewTexts"] = vsosh_new_texts(args.vsosh_new_texts)
    if args.vsosh_practice_drafts:
        data["vsoshPracticeDrafts"] = vsosh_practice_drafts(
            args.vsosh_practice_drafts, data.get("vsosh"), accepted=data.get("vsoshPractice"),
        )
    if args.no_offline:
        data["meta"]["offline"] = False
    html = render(data)
    write_text(out, html)
    if not args.drafts:
        shutil.copyfile(OG_IMAGE, out.parent / OG_IMAGE.name)
    if data["meta"]["offline"]:
        write_offline(out.parent, html)
    elif args.no_offline:
        write_offline_off(out.parent)
    print(f"Страница: {out} — заданий {len(data['questions'])}, правил {len(data['rules'])}, "
          f"вопросов по правилам {len(data['ruleChecks'])}, слов для тонов {len(data['tones'])}, "
          f"заданий ВсОШ {len(data.get('vsosh', {}).get('questions', []))}")


if __name__ == "__main__":
    main()
