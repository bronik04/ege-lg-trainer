"""Проверка данных тренажёра: схема, полнота, ссылки и готовность.

    python3 scripts/validate.py        # код 1 и список ошибок, если что-то не так

Функции проверки используются и сборкой банка, и тестами.
"""

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import QUESTIONS, RULE_CHECKS, RULES, TASK_NUMBERS, TONE_WORDS, TOPICS, content_hash, read_json  # noqa: E402
import tones  # noqa: E402

ORIGINS = {"fipi", "generated", "hsk"}
TONE_LEVELS = (1, 2, 3, 4)
REVIEW_STATUSES = {"imported", "draft", "ready", "conflict", "excluded"}
CONTENT_STATUSES = {"draft", "accepted"}
RULE_CHECK_KINDS = {"choose-form", "identify-rule"}
FRAGMENT_IDS = ["A", "B", "C"]
# Разбор, который ничего не объясняет про конкретный вариант, готовым не считается.
GENERIC = re.compile(r"^(неверно|не подходит|повторите правило|см\. правило)[.!]?$", re.I)
# Отсылка к правилу внутри разбора («Так не говорят, повторите правило о …») — тоже не разбор.
RULE_REFERENCE = re.compile(r"(повторите|перечитайте|см\.|смотрите)\s+правил", re.I)
MIN_EXPLANATION = 25
HAN = re.compile(r"[\u4e00-\u9fff]+")
BLANK = re.compile(r"\s*_{2,}\s*")
# Столько иероглифов подряд, совпавших с заданием банка, уже выдают его сюжет, а не
# словарное сочетание вроде 一条裙子, которое и есть содержание правила.
OVERLAP = 5


def _text_problem(label, text):
    if not isinstance(text, str) or not text.strip():
        return f"{label}: пусто"
    if GENERIC.match(text.strip()):
        return f"{label}: общая фраза вместо разбора"
    if RULE_REFERENCE.search(text):
        return f"{label}: отсылка к правилу вместо разбора"
    if len(text.strip()) < MIN_EXPLANATION:
        return f"{label}: слишком коротко для разбора ({len(text.strip())} зн.)"
    return None


def option_problems(options, correct_id, *, sizes=(3, 4)):
    problems = []
    if not isinstance(options, list) or len(options) not in sizes:
        count = len(options) if isinstance(options, list) else "?"
        problems.append(f"вариантов {count}, нужно {' или '.join(map(str, sizes))}")
        return problems
    ids = [o.get("id") for o in options]
    if len(set(ids)) != len(ids):
        problems.append("повторяются ID вариантов")
    for o in options:
        if not isinstance(o.get("text"), str) or not o["text"].strip():
            problems.append(f"вариант {o.get('id')}: пустой текст")
    texts = [o.get("text", "").strip() for o in options]
    if len(set(texts)) != len(texts):
        problems.append("повторяются тексты вариантов")
    if correct_id not in ids:
        problems.append(f"ключ {correct_id!r} не совпадает ни с одним вариантом")
    return problems


def explanation_problems(explanation, options, correct_id):
    """Разбор должен объяснять верный вариант и каждый неверный — отдельно."""
    if not isinstance(explanation, dict):
        return ["нет разбора"]
    problems = []
    problem = _text_problem("разбор верного ответа", explanation.get("correct"))
    if problem:
        problems.append(problem)
    by_option = explanation.get("options") or {}
    wrong_ids = [o["id"] for o in options if o["id"] != correct_id]
    for option_id in wrong_ids:
        problem = _text_problem(f"разбор варианта {option_id}", by_option.get(option_id))
        if problem:
            problems.append(problem)
    extra = sorted(set(by_option) - set(wrong_ids))
    if extra:
        problems.append("разбор для несуществующих или верного вариантов: " + ", ".join(extra))
    # У каждого неверного варианта — свой разбор, а не общий на двоих.
    seen = {}
    for option_id in wrong_ids:
        text = (by_option.get(option_id) or "").strip()
        if text and text in seen:
            problems.append(f"у вариантов {seen[text]} и {option_id} одинаковый разбор")
        seen.setdefault(text, option_id)
    return problems


def question_problems(q, topic_ids, rules_by_id):
    """Ошибки одной записи банка. Пустой список — запись корректна."""
    problems = []
    if q.get("taskNumber") not in TASK_NUMBERS:
        problems.append(f"номер задания {q.get('taskNumber')!r} вне 15–27")
    if q.get("origin") not in ORIGINS:
        problems.append(f"происхождение {q.get('origin')!r} не из {sorted(ORIGINS)}")
    if not isinstance(q.get("formatYear"), int):
        problems.append("нет года формата")
    if not q.get("sourceRef"):
        problems.append("нет реквизитов источника")
    if q.get("origin") == "generated" and not (q.get("sourceRef") or {}).get("specVersion"):
        problems.append("у сгенерированного задания нет версии спецификации")
    if q.get("origin") == "hsk" and not ((q.get("sourceRef") or {}).get("paper") and (q.get("sourceRef") or {}).get("number")):
        problems.append("у задания HSK нет варианта или номера в источнике")
    for field in ("prompt", "stem"):
        if not isinstance(q.get(field), str) or not q[field].strip():
            problems.append(f"пустое поле {field}")
    problems += option_problems(q.get("options"), q.get("correctOptionId"))
    if q.get("taskNumber") == 26:
        fragments = q.get("fragments") or []
        if [f.get("id") for f in fragments] != FRAGMENT_IDS:
            problems.append("у задания 26 нет фрагментов A, B, C")
    status = q.get("reviewStatus")
    if status not in REVIEW_STATUSES:
        problems.append(f"статус {status!r} не из {sorted(REVIEW_STATUSES)}")
    for topic_id in q.get("topicIds") or []:
        if topic_id not in topic_ids:
            problems.append(f"нет темы {topic_id!r}")
    for rule_id in q.get("ruleIds") or []:
        if rule_id not in rules_by_id:
            problems.append(f"нет правила {rule_id!r}")
    if status == "ready":
        if not q.get("topicIds"):
            problems.append("готовое задание без темы")
        if not q.get("ruleIds"):
            problems.append("готовое задание без правила")
        for rule_id in q.get("ruleIds") or []:
            rule = rules_by_id.get(rule_id)
            if rule and rule.get("status") != "accepted":
                problems.append(f"готовое задание ссылается на непринятое правило {rule_id!r}")
        if q.get("issues"):
            problems.append("готовое задание с непрочитанными полями: " + "; ".join(q["issues"]))
        if not isinstance(q.get("options"), list):
            return problems
        problems += explanation_problems(q.get("explanation"), q["options"], q.get("correctOptionId"))
    return problems


def rule_problems(rule, topic_ids):
    problems = []
    for field in ("id", "title", "summary", "mistake"):
        if not isinstance(rule.get(field), str) or not rule[field].strip():
            problems.append(f"пустое поле {field}")
    if rule.get("status") not in CONTENT_STATUSES:
        problems.append(f"статус {rule.get('status')!r} не из {sorted(CONTENT_STATUSES)}")
    if not rule.get("topicIds"):
        problems.append("правило без темы")
    for topic_id in rule.get("topicIds") or []:
        if topic_id not in topic_ids:
            problems.append(f"нет темы {topic_id!r}")
    if not rule.get("usage"):
        problems.append("нет условий употребления")
    examples = rule.get("examples") or []
    if len(examples) < 2:
        problems.append("нужно хотя бы два примера")
    for i, ex in enumerate(examples, 1):
        if not ex.get("zh") or not ex.get("ru"):
            problems.append(f"пример {i}: нужны zh и ru")
    contrast = rule.get("contrast") or {}
    pair = contrast.get("pair") or []
    if len(pair) != 2 or not all(p.get("zh") and p.get("ru") for p in pair) or not contrast.get("note"):
        problems.append("контрастная пара: нужны два примера с переводом и пояснение")
    return problems


def rule_check_problems(check, rules_by_id):
    problems = []
    if check.get("kind") not in RULE_CHECK_KINDS:
        problems.append(f"вид {check.get('kind')!r} не из {sorted(RULE_CHECK_KINDS)}")
    if check.get("status") not in CONTENT_STATUSES:
        problems.append(f"статус {check.get('status')!r} не из {sorted(CONTENT_STATUSES)}")
    if not isinstance(check.get("prompt"), str) or not check["prompt"].strip():
        problems.append("пустая формулировка")
    if not check.get("ruleIds"):
        problems.append("вопрос не связан с правилом")
    for rule_id in check.get("ruleIds") or []:
        if rule_id not in rules_by_id:
            problems.append(f"нет правила {rule_id!r}")
        elif check.get("status") == "accepted" and rules_by_id[rule_id].get("status") != "accepted":
            problems.append(f"принятый вопрос ссылается на непринятое правило {rule_id!r}")
    option_list = check.get("options")
    problems += option_problems(option_list, check.get("correctOptionId"), sizes=(2, 3, 4))
    if isinstance(option_list, list):
        problems += explanation_problems(check.get("explanation"), option_list, check.get("correctOptionId"))
    return problems


def filled_stem(q):
    """Условие с ключом на месте пропуска — то, что ученик запомнит как «ответ»."""
    key = next((o["text"] for o in q.get("options") or [] if o.get("id") == q.get("correctOptionId")), "")
    stem = q.get("stem") or ""
    blanks = len(BLANK.findall(stem))
    parts = [p.strip() for p in re.split(r"…+|\.{3,}|,|，", key) if p.strip()]
    if blanks == 1:
        stem = BLANK.sub(key, stem)
    elif blanks == 2 and len(parts) >= 2:
        pieces = iter(parts)
        stem = BLANK.sub(lambda _: next(pieces), stem)
    return "".join(HAN.findall(stem))


def _strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for v in value.values():
            yield from _strings(v)
    elif isinstance(value, list):
        for v in value:
            yield from _strings(v)


def bank_overlap_problems(item, bank_texts, n=OVERLAP):
    """Китайский текст правила или вопроса к нему, повторяющий задание банка. Иероглифы строки
    склеиваются через знаки препинания, как и условие задания в filled_stem: иначе «如果明天下雨，
    我们就不去» не совпало бы с «如果明天不下雨，我们就去爬山» из-за запятой."""
    problems = []
    for text in _strings({k: v for k, v in item.items() if k not in ("id", "status", "ruleIds", "topicIds")}):
        joined = "".join(HAN.findall(text))
        for i in range(len(joined) - n + 1):
            gram = joined[i:i + n]
            hit = next((qid for qid, filled in bank_texts if gram in filled), None)
            if hit:
                problems.append(f"«{text}» повторяет задание {hit} ({gram}) — возьмите пример на другой лексике")
                break
    return sorted(set(problems))


def check_key_order(rule_checks):
    """Страница варианты не перемешивает: у вопросов одного правила ключ не стоит на одном месте
    три раза подряд (вопрос относится к первому правилу из своих ruleIds)."""
    by_rule = {}
    for c in rule_checks:
        ids = [o.get("id") for o in c.get("options") or []]
        if c.get("ruleIds") and c.get("correctOptionId") in ids:
            by_rule.setdefault(c["ruleIds"][0], []).append((c.get("id"), ids.index(c["correctOptionId"])))
    problems = []
    for rule_id, items in by_rule.items():
        for i in range(len(items) - 2):
            run = items[i:i + 3]
            if len({place for _, place in run}) == 1:
                problems.append(f"правило {rule_id}: у вопросов {', '.join(cid for cid, _ in run)} "
                                "ключ на одном месте три раза подряд")
    return problems


def _duplicates(items, label):
    seen, problems = set(), []
    for item in items:
        if item.get("id") in seen:
            problems.append(f"{label}: повторяется ID {item.get('id')!r}")
        seen.add(item.get("id"))
    return problems


def tone_word_problems(entries, bank_stems=()):
    """Слова тренировки тонов: чтение, тоны, варианты, разбор и принятие."""
    errors = _duplicates([{"id": e.get("word")} for e in entries], "слова тренировки тонов")
    ids = {}
    for e in entries:
        word = e.get("word", "")
        where = f"слово {word!r}"
        wid = tones.word_id(word)
        if wid in ids:
            errors.append(f"{where}: ID {wid} совпал со словом {ids[wid]!r}")
        ids[wid] = word
        if not (2 <= len(word) <= 3 and HAN.fullmatch(word)):
            errors.append(f"{where}: не 2–3 иероглифа")
            continue
        if word in bank_stems:
            errors.append(f"{where}: есть среди заданий №15 на сайте — тренировка подсказала бы ключ (python3 scripts/build_tones.py)")
        if e.get("level") not in TONE_LEVELS:
            errors.append(f"{where}: уровень HSK {e.get('level')!r} вне 1–4")
        seq = e.get("tones")
        if not (isinstance(seq, list) and len(seq) == len(word) and all(t in (0, 1, 2, 3, 4) for t in seq)):
            errors.append(f"{where}: тонов {seq!r} не столько, сколько иероглифов, или вне 0–4")
            continue
        if seq[0] == 0:
            errors.append(f"{where}: первый слог не бывает лёгким")
        if tones.tone_sequence(e.get("pinyin", ""), len(word)) != tuple(seq):
            errors.append(f"{where}: тоны {tones.sequence_text(seq)} не сходятся с пиньинем {e.get('pinyin')!r}")
        if e.get("syllables") and tones.join_syllables(e["syllables"]) != e.get("pinyin"):
            errors.append(f"{where}: слоги {e['syllables']!r} не складываются в пиньинь {e.get('pinyin')!r}")
        if not str(e.get("ru", "")).strip():
            errors.append(f"{where}: нет перевода")
        if e.get("status") not in CONTENT_STATUSES:
            errors.append(f"{where}: статус {e.get('status')!r}")
        elif e["status"] == "accepted" and e.get("acceptedHash") != tones.fingerprint(e):
            errors.append(f"{where}: изменено после принятия — верните в черновик, ревью и принятие заново")
        q = tones.make_question(e)
        texts = [o["text"] for o in q["options"]]
        if len(set(texts)) != 4 or texts.count(tones.sequence_text(seq)) != 1:
            errors.append(f"{where}: варианты повторяются или верного нет ровно один раз")
        wrong = {o["id"] for o in q["options"]} - {q["correctOptionId"]}
        if set(q["explanation"]["options"]) != wrong:
            errors.append(f"{where}: нет разбора неверного варианта")
        for label, text in [("разбор верного", q["explanation"]["correct"])] + list(q["explanation"]["options"].items()):
            problem = _text_problem(f"{where}: {label}", text)
            if problem:
                errors.append(problem)
    return errors


def check_all(questions, topics, rules, rule_checks, tone_words=()):
    """Все ошибки данных одним списком строк «где: что»."""
    errors = []
    topic_ids = {t["id"] for t in topics}
    rules_by_id = {r["id"]: r for r in rules}
    errors += _duplicates(topics, "темы")
    errors += _duplicates(rules, "правила")
    errors += _duplicates(rule_checks, "вопросы по правилам")
    errors += _duplicates(questions, "банк")
    # Принимают по ID: общий ID у правила и вопроса принял бы заодно и непоказанный пункт.
    rule_ids = {r.get("id") for r in rules}
    errors += [f"ID {c.get('id')!r} есть и у правила, и у вопроса по правилу" for c in rule_checks
               if c.get("id") in rule_ids]
    for t in topics:
        if not t.get("title"):
            errors.append(f"тема {t.get('id')}: нет названия")
        if any(n not in TASK_NUMBERS for n in t.get("taskNumbers", [])):
            errors.append(f"тема {t.get('id')}: номер задания вне 15–27")
    # Исключённое (повтор, задание HSK с подсказкой ключа ФИПИ) ученик не видит — с ним не сверяем.
    bank_texts = [(q.get("id"), filled_stem(q)) for q in questions if q.get("reviewStatus") != "excluded"]
    for r in rules:
        errors += [f"правило {r.get('id')}: {p}" for p in rule_problems(r, topic_ids)]
        errors += [f"правило {r.get('id')}: {p}" for p in bank_overlap_problems(r, bank_texts)]
    for c in rule_checks:
        errors += [f"вопрос по правилу {c.get('id')}: {p}" for p in rule_check_problems(c, rules_by_id)]
        errors += [f"вопрос по правилу {c.get('id')}: {p}" for p in bank_overlap_problems(c, bank_texts)]
    errors += check_key_order(rule_checks)
    # Принятое — ровно то, что принял автор: правка после принятия возвращает пункт автору.
    for kind, items in (("правило", rules), ("вопрос по правилу", rule_checks)):
        errors += [f"{kind} {item.get('id')}: изменено после принятия — верните в черновик "
                   f"(python3 scripts/reopen.py {item.get('id')}), автор примет заново"
                   for item in items if item.get("status") == "accepted" and item.get("acceptedHash") != content_hash(item)]
    for q in questions:
        errors += [f"задание {q.get('id')}: {p}" for p in question_problems(q, topic_ids, rules_by_id)]
    # Только задания на сайте: черновик №15 ключа ученику не покажет (build_tones.fipi_stems).
    stems = {re.sub(r"[\s.。]+$", "", q.get("stem", "")) for q in questions
             if q.get("taskNumber") == 15 and q.get("reviewStatus") == "ready"}
    errors += tone_word_problems(tone_words, stems)
    return errors


def main():
    words = read_json(TONE_WORDS)["words"] if TONE_WORDS.exists() else []
    errors = check_all(read_json(QUESTIONS), read_json(TOPICS), read_json(RULES), read_json(RULE_CHECKS), words)
    if errors:
        print(f"Ошибок: {len(errors)}")
        for e in errors:
            print(" -", e)
        sys.exit(1)
    print("Данные в порядке.")


if __name__ == "__main__":
    main()
