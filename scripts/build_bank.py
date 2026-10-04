"""Сборка канонического банка: data/raw/*.json + data/authored/ → data/questions.json.

Слои:
  1. импортированные записи (без правки текста);
  2. поиск дубликатов и расхождений ключей, автопроверка ключей задания 19;
  3. разборы, темы и правила из data/authored/task-NN.json.

Статус задания:
  imported — разбора нет;  draft — разбор написан, но не принят автором;
  ready — разбор принят, правила приняты, всё заполнено;
  conflict — спорный ключ;  excluded — повтор другого задания.
В тренажёр попадают только ready. Отчёты — в data/review/.
"""

import re
import sys
from collections import defaultdict
from difflib import SequenceMatcher
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (  # noqa: E402
    AUTHORED, DATA, QUESTIONS, REVIEW, ROOT, RULE_CHECKS, RULES, TASK_CONTENT, TASK_NUMBERS, TOPICS,
    content_hash, read_json, write_json, write_text,
)
from validate import BLANK, _strings, explanation_problems  # noqa: E402

RAW_DIR = DATA / "raw"
NOISE = re.compile(r"[\s_.,。，、!?！？\"“”'‘’:：;；()（）…—-]+")
ZH_DIGITS = {"零": 0, "〇": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
ZH_SMALL = {"十": 10, "百": 100, "千": 1000}
HAN = re.compile(r"[\u4e00-\u9fff]")
HAN_RUN = re.compile(r"[\u4e00-\u9fff]+")
# Сгенерированное задание с условием, похожим на задание ФИПИ хотя бы на столько, — повтор.
NEAR_DUPLICATE = 0.8


class BuildError(Exception):
    pass


def parse_zh_number(text):
    """七百零九万零五百 → 7090500. None, если запись не разобрать."""
    text = text.strip().rstrip("。.")
    if not text:
        return None
    total = section = number = 0
    for ch in text:
        if ch in ZH_DIGITS:
            number = ZH_DIGITS[ch]
        elif ch in ZH_SMALL:
            section += (number or 1) * ZH_SMALL[ch]
            number = 0
        elif ch == "万":
            total += (section + number) * 10_000
            section = number = 0
        elif ch == "亿":
            total = (total + section + number) * 100_000_000
            section = number = 0
        else:
            return None
    return total + section + number


def check_numeral_key(record):
    """Для №19 ключ проверяется вычислением. Возвращает причину спора или None."""
    value = parse_zh_number(record["stem"])
    if value is None:
        return None
    by_value = {}
    for option in record["options"]:
        digits = option["text"].replace(" ", "")
        if digits.isdigit():
            by_value.setdefault(int(digits), []).append(option["id"])
    matches = by_value.get(value, [])
    if matches == [record["correctOptionId"]]:
        return None
    if not matches:
        return f"автопроверка: запись равна {value:,}".replace(",", " ") + ", такого варианта нет"
    return (f"автопроверка: запись равна {value:,}".replace(",", " ")
            + f", это вариант {', '.join(matches)}, а ключ — {record['correctOptionId']}")


def stem_key(record):
    return NOISE.sub("", record["stem"]).lower()


def option_key(record):
    return tuple(sorted(NOISE.sub("", o["text"]) for o in record["options"]))


def similarity(a, b, task_number):
    """Доля совпадения условий. Урезанная копия («他昨天来…» из «你看，他昨天来…») тоже повтор,
    поэтому берётся и доля совпавших иероглифов от более короткого условия. У №15 и №19 условие —
    одно слово или число: похожие записи там не повтор, считается только полное совпадение."""
    if task_number in (15, 19):
        return 1.0 if a == b else 0.0
    if not a or not b:
        return 0.0
    matcher = SequenceMatcher(None, a, b)
    matched = sum(block.size for block in matcher.get_matching_blocks())
    return max(matcher.ratio(), matched / min(len(a), len(b)))


def fipi_twin(record, fipi_records):
    """Самое похожее задание ФИПИ того же номера: (id, сходство) или (None, 0)."""
    mine = "".join(HAN.findall(record["stem"]))
    best = (None, 0.0)
    for other in fipi_records:
        if other["taskNumber"] != record["taskNumber"]:
            continue
        ratio = similarity(mine, "".join(HAN.findall(other["stem"])), record["taskNumber"])
        if ratio > best[1]:
            best = (other["id"], ratio)
    return best


def hidden_conflict(entry):
    """Спорный ключ в разборе, и автор не вернул задание с ключом ФИПИ: задание скрыто."""
    return bool(entry and entry.get("keyConflict") and entry.get("keyDecision") != "restore")


def correct_text(record):
    return next((o["text"] for o in record["options"] if o["id"] == record["correctOptionId"]), None)


def find_duplicates(records):
    """Группы одинаковых заданий (тот же номер, условие и набор вариантов).

    Возвращает (excluded: id → id основной записи, conflicts: id → причина, groups, similar)."""
    groups = defaultdict(list)
    by_stem = defaultdict(list)
    for r in records:
        groups[(r["taskNumber"], stem_key(r), option_key(r))].append(r)
        by_stem[(r["taskNumber"], stem_key(r))].append(r)
    excluded, conflicts, dup_groups = {}, {}, []
    for members in groups.values():
        if len(members) < 2:
            continue
        members = sorted(members, key=lambda r: (r["origin"] != "fipi", r["sourceRef"].get("fipiId") is None, r["id"]))
        dup_groups.append(members)
        keys = {NOISE.sub("", correct_text(m) or "") for m in members}
        if len(keys) > 1:
            for m in members:
                conflicts[m["id"]] = "у одинаковых заданий разные ключи: " + ", ".join(x["id"] for x in members)
            continue
        for m in members[1:]:
            excluded[m["id"]] = members[0]["id"]
    similar = [ms for ms in by_stem.values()
               if len(ms) > 1 and len({option_key(m) for m in ms}) > 1]
    return excluded, conflicts, dup_groups, similar


def load_authored(directory=AUTHORED):
    entries = {}
    for path in sorted(Path(directory).glob("task-*.json")):
        for qid, entry in read_json(path).items():
            if qid in entries:
                raise BuildError(f"{path.name}: разбор {qid} уже есть в другом файле")
            entries[qid] = dict(entry, _file=path.name)
    return entries


def snapshot_problems(entry, record):
    """Разбор писался к конкретному тексту. Изменился источник — разбор надо перепроверить."""
    snap = entry.get("sourceSnapshot") or {}
    problems = []
    if snap.get("stem") != record["stem"]:
        problems.append("изменилось условие")
    if snap.get("options") != {o["id"]: o["text"] for o in record["options"]}:
        problems.append("изменились варианты")
    if snap.get("correctOptionId") != record["correctOptionId"]:
        problems.append("изменился ключ")
    return problems


def default_topic(task_number, topics):
    return next((t["id"] for t in topics if task_number in t.get("taskNumbers", [])), None)


def merge(records, authored, topics, rules):
    """Канонический банк и список «почему не готово» для отчёта очереди."""
    rules_by_id = {r["id"]: r for r in rules}
    known = {r["id"] for r in records}
    unknown = sorted(set(authored) - known)
    if unknown:
        raise BuildError("разборы к несуществующим заданиям: " + ", ".join(unknown))

    excluded, conflicts, _, _ = find_duplicates(records)
    # Сгенерированное задание, повторяющее или почти повторяющее задание ФИПИ, в банк не идёт.
    # Кроме исправленной копии (replaces) спорного задания, пока автор держит оригинал скрытым, а
    # разбор оригинала принят — решение закреплено отпечатком: ученик оригинал не видит. Вернёт
    # автор оригинал с ключом ФИПИ или разбор оригинала откроют — копия снова повтор.
    fipi_records = [r for r in records if r["origin"] == "fipi"]
    for r in records:
        if r["origin"] != "generated" or r["id"] in excluded:
            continue
        twin, ratio = fipi_twin(r, fipi_records)
        original = authored.get(twin)
        replacement = r.get("replaces") == twin and hidden_conflict(original) and original["status"] == "accepted"
        if twin and ratio >= NEAR_DUPLICATE and not replacement:
            excluded[r["id"]] = twin
    pending = {}
    questions = []
    for record in records:
        q = {k: v for k, v in record.items()}
        topic = default_topic(record["taskNumber"], topics)
        q["topicIds"] = [topic] if topic else []
        q["ruleIds"] = []
        q["explanation"] = None
        entry = authored.get(record["id"])
        reasons = []

        if entry is not None:
            drift = snapshot_problems(entry, record)
            if drift:
                raise BuildError(f"{entry['_file']}: {record['id']}: {', '.join(drift)} — перепроверьте разбор "
                                 "и обновите sourceSnapshot")
            if entry.get("status") not in ("draft", "accepted"):
                raise BuildError(f"{entry['_file']}: {record['id']}: статус должен быть draft или accepted")
            if entry["status"] == "accepted" and entry.get("acceptedHash") != content_hash(entry, TASK_CONTENT):
                raise BuildError(f"{entry['_file']}: {record['id']}: разбор изменён после принятия — верните в черновик "
                                 f"(python3 scripts/reopen.py {record['id']}), автор примет заново")
            q["topicIds"] = list(entry.get("topicIds") or [])
            q["ruleIds"] = list(entry.get("ruleIds") or [])
            q["explanation"] = entry.get("explanation")
            if entry.get("contrast"):
                q["contrast"] = entry["contrast"]
            problems = explanation_problems(q["explanation"], record["options"], record["correctOptionId"])
            if not q["topicIds"]:
                problems.append("нет темы")
            if not q["ruleIds"]:
                problems.append("нет правила")
            for rule_id in q["ruleIds"]:
                if rule_id not in rules_by_id:
                    problems.append(f"нет правила {rule_id!r}")
            if problems and entry["status"] == "accepted":
                raise BuildError(f"{entry['_file']}: {record['id']} принят, но: " + "; ".join(problems))
            reasons += problems
            if entry["status"] == "draft":
                reasons.append("разбор не принят автором")
            for rule_id in q["ruleIds"]:
                rule = rules_by_id.get(rule_id)
                if rule and rule["status"] != "accepted":
                    reasons.append(f"правило {rule_id} не принято")

        conflict = conflicts.get(record["id"])
        if record["taskNumber"] == 19 and not conflict:
            conflict = check_numeral_key(record)
        # «Вернуть с ключом ФИПИ» — решение автора: задание больше не спорное и идёт обычной
        # дорогой (черновик → раздел 1 → принятие), даже если пометка keyConflict осталась.
        if hidden_conflict(entry):
            conflict = entry["keyConflict"]

        if record["id"] in excluded:
            q["reviewStatus"] = "excluded"
            q["duplicateOf"] = excluded[record["id"]]
        elif conflict:
            q["reviewStatus"] = "conflict"
            q["conflict"] = conflict
        elif entry is None:
            q["reviewStatus"] = "imported"
        elif reasons or record.get("issues"):
            q["reviewStatus"] = "draft"
            pending[record["id"]] = reasons + list(record.get("issues") or [])
        else:
            q["reviewStatus"] = "ready"
        questions.append(q)
    return questions, pending


def load_records():
    records = []
    for path in sorted(RAW_DIR.glob("*.json")):
        records += read_json(path)
    records.sort(key=lambda r: (r["taskNumber"], r["origin"], r["id"]))
    return records


# ---------- отчёты ----------

def _option_lines(q):
    explanation = q.get("explanation") or {}
    lines = []
    for o in q["options"]:
        if o["id"] == q["correctOptionId"]:
            lines.append(f"{o['id']}) **{o['text']}** ✓ — {explanation.get('correct', '—')}")
        else:
            lines.append(f"{o['id']}) {o['text']} ✗ — {(explanation.get('options') or {}).get(o['id'], '—')}")
    return lines


def coverage_report(questions, topics):
    statuses = ["ready", "draft", "imported", "conflict", "excluded"]
    names = {"ready": "готово", "draft": "черновик", "imported": "без разбора",
             "conflict": "спорный ключ", "excluded": "повтор"}
    lines = ["# Покрытие банка", "", "| Задание | всего | " + " | ".join(names[s] for s in statuses) + " |",
             "| --- | --- | " + " | ".join("---" for _ in statuses) + " |"]
    missing = []
    for n in TASK_NUMBERS:
        group = [q for q in questions if q["taskNumber"] == n]
        counts = [sum(1 for q in group if q["reviewStatus"] == s) for s in statuses]
        if counts[0] == 0:
            missing.append(n)
        lines.append(f"| {n} | {len(group)} | " + " | ".join(map(str, counts)) + " |")
    lines += ["", "## Полный вариант", ""]
    lines.append("Собирается: по каждой позиции 15–27 есть готовое задание." if not missing
                 else "Не собирается. Нет готовых заданий для позиций: " + ", ".join(map(str, missing)) + ".")
    lines += ["", "## Готовые задания по темам", "", "| Тема | готово | черновик |", "| --- | --- | --- |"]
    for t in topics:
        ready = sum(1 for q in questions if t["id"] in q["topicIds"] and q["reviewStatus"] == "ready")
        draft = sum(1 for q in questions if t["id"] in q["topicIds"] and q["reviewStatus"] == "draft")
        lines.append(f"| {t['title']} | {ready} | {draft} |")
    by_origin = defaultdict(int)
    for q in questions:
        if q["reviewStatus"] == "ready":
            by_origin[q["origin"]] += 1
    lines += ["", "## Готовые задания по происхождению", ""]
    lines += [f"- {origin}: {count}" for origin, count in sorted(by_origin.items())] or ["- нет"]
    return "\n".join(lines) + "\n"


def key_hints(q):
    """Ключ вместе с соседними иероглифами (до двух с каждой стороны): встретится такое в другом
    тексте — тот текст подсказывает ответ. Только задания с одним пропуском в предложении."""
    if q["taskNumber"] in (15, 19, 26):
        return []
    parts = BLANK.split(q["stem"])
    key = "".join(HAN_RUN.findall(correct_text(q) or ""))
    if len(parts) != 2 or not key:
        return []
    before, after = ("".join(HAN_RUN.findall(part)) for part in parts)
    hints = {before[len(before) - b:] + key + after[:a]
             for b in range(min(2, len(before)) + 1) for a in range(min(2, len(after)) + 1) if b or a}
    hints = {h for h in hints if len(h) >= 3}
    return sorted(h for h in hints if not any(o != h and o in h for o in hints))


def hint_pairs(questions, rules, rule_checks):
    """(задание, подсказка, где встретилась): ключ с соседями — в условии или фрагменте другого задания,
    в карточке правила, в вопросе к правилу, то есть в том, что ученик видит до ответа. Пары, где
    оба задания из ФИПИ, не нужны: банк ФИПИ не правят."""
    shown = [q for q in questions if q["reviewStatus"] in ("ready", "draft")]
    texts = [(q["id"], q["origin"], text) for q in shown
             for text in [q["stem"]] + [f["text"] for f in q.get("fragments") or []]]
    texts += [(f"правило {r['id']}", None, text)
              for r in rules for text in _strings({k: v for k, v in r.items() if k not in ("id", "status", "topicIds")})]
    texts += [(f"вопрос {c['id']}", None, text) for c in rule_checks for text in (c.get("prompt"), c.get("sentence")) if text]
    runs = [(label, origin, HAN_RUN.findall(BLANK.sub(" ", text))) for label, origin, text in texts]
    pairs = set()
    for q in shown:
        for hint in key_hints(q):
            for label, origin, found in runs:
                if label == q["id"] or (origin == "fipi" and q["origin"] == "fipi"):
                    continue
                if any(hint in run for run in found):
                    pairs.add((q["id"], hint, label))
    return sorted(pairs)


def duplicates_report(records, questions, rules=(), rule_checks=()):
    _, _, groups, similar = find_duplicates(records)
    status = {q["id"]: q for q in questions}
    lines = ["# Дубликаты и спорные ключи", ""]
    lines += ["## Одинаковые задания", ""]
    if not groups:
        lines.append("Нет.")
    for members in groups:
        head = members[0]
        lines.append(f"- №{head['taskNumber']} «{head['stem']}»: " + ", ".join(
            f"`{m['id']}` ({status[m['id']]['reviewStatus']})" for m in members))
    lines += ["", "## Спорные ключи", ""]
    conflicted = [q for q in questions if q["reviewStatus"] == "conflict"]
    if not conflicted:
        lines.append("Нет.")
    for q in conflicted:
        lines.append(f"- `{q['id']}` (№{q['taskNumber']}) «{q['stem']}»: {q['conflict']}")
    lines += ["", "## Сгенерированные задания, похожие на ФИПИ", ""]
    fipi_records = [r for r in records if r["origin"] == "fipi"]
    near = [(r, *fipi_twin(r, fipi_records)) for r in records if r["origin"] == "generated"]
    near = [(r, twin, ratio) for r, twin, ratio in near if twin and ratio >= 0.6]
    if not near:
        lines.append("Нет.")
    for r, twin, ratio in near:
        if ratio < NEAR_DUPLICATE:
            verdict = "проверить вручную"
        elif status[r["id"]]["reviewStatus"] == "excluded":
            verdict = "исключено как повтор"
            if r.get("replaces") == twin:
                verdict += " (оригинал не скрыт или его разбор не принят)"
        else:
            verdict = "исправленная копия скрытого спорного задания"
        lines.append(f"- `{r['id']}` ~ `{twin}`: сходство {round(ratio * 100)}% — {verdict}")
    lines += ["", "## То же условие, другие варианты (проверить вручную)", ""]
    if not similar:
        lines.append("Нет.")
    for members in similar:
        lines.append(f"- №{members[0]['taskNumber']} «{members[0]['stem']}»: "
                     + ", ".join(f"`{m['id']}`" for m in members))
    lines += ["", "## Подсказки между заданиями и правилами (проверить вручную)", "",
              "Ключ задания вместе с соседним иероглифом встречается там, где ученик видит его до ответа: в другом",
              "задании, в карточке правила, в вопросе к правилу. Пары, где оба задания из ФИПИ, не показаны:",
              "банк ФИПИ не правят.", ""]
    grouped = defaultdict(list)
    for qid, hint, label in hint_pairs(questions, rules, rule_checks):
        grouped[(qid, hint)].append(label if " " in label else f"`{label}`")
    if not grouped:
        lines.append("Нет.")
    for (qid, hint), labels in sorted(grouped.items()):
        lines.append(f"- `{qid}` «{hint}»: " + ", ".join(labels))
    return "\n".join(lines) + "\n"


def queue_report(questions, pending, rules, rule_checks):
    lines = [
        "# Очередь проверки",
        "",
        "Здесь всё, что написано, но ещё не принято. Принимает автор — кнопкой «Проверка»",
        "или командой в чате (`python3 scripts/accept.py ID …`), затем банк пересобирается.",
        "",
    ]
    draft_rules = [r for r in rules if r["status"] != "accepted"]
    lines += [f"## Правила ({len(draft_rules)})", ""]
    for r in draft_rules:
        lines += [f"### `{r['id']}` — {r['title']}", "", r["summary"], ""]
        lines += [f"- {u}" for u in r.get("usage", [])]
        lines += [""] + [f"- {e['zh']} — {e['ru']}" for e in r.get("examples", [])]
        pair = (r.get("contrast") or {}).get("pair") or []
        if pair:
            lines += ["", "Контраст: " + " / ".join(f"{p['zh']} ({p['ru']})" for p in pair),
                      "", r["contrast"].get("note", "")]
        lines += ["", f"Типичная ошибка: {r.get('mistake', '')}", ""]
    draft_checks = [c for c in rule_checks if c["status"] != "accepted"]
    lines += [f"## Вопросы по правилам ({len(draft_checks)})", ""]
    for c in draft_checks:
        lines += [f"### `{c['id']}` — {', '.join(c['ruleIds'])}", "", c["prompt"]]
        if c.get("sentence"):
            lines += ["", c["sentence"]]
        lines += [""] + _option_lines(dict(c, explanation=c.get("explanation"))) + [""]
    drafts = [q for q in questions if q["reviewStatus"] == "draft"]
    lines += [f"## Задания ({len(drafts)})", ""]
    for q in drafts:
        lines += [f"### `{q['id']}` · №{q['taskNumber']} · темы: {', '.join(q['topicIds'])}"
                  f" · правила: {', '.join(q['ruleIds'])}", ""]
        lines += [f"Ждёт: {'; '.join(pending.get(q['id'], []))}", "", q["prompt"], "", q["stem"], ""]
        lines += _option_lines(q) + [""]
        if q.get("contrast"):
            lines += [f"Контрастный пример: {q['contrast']['zh']} — {q['contrast']['ru']}", ""]
    return "\n".join(lines) + "\n"


def build():
    topics = read_json(TOPICS)
    rules = read_json(RULES)
    rule_checks = read_json(RULE_CHECKS)
    records = load_records()
    questions, pending = merge(records, load_authored(), topics, rules)
    write_json(QUESTIONS, questions)
    write_text(REVIEW / "coverage.md", coverage_report(questions, topics))
    write_text(REVIEW / "duplicates.md", duplicates_report(records, questions, rules, rule_checks))
    write_text(REVIEW / "queue.md", queue_report(questions, pending, rules, rule_checks))
    return questions


def main():
    try:
        questions = build()
    except BuildError as error:
        print(f"Сборка банка остановлена: {error}")
        sys.exit(1)
    counts = defaultdict(int)
    for q in questions:
        counts[q["reviewStatus"]] += 1
    print(f"Банк: {len(questions)} заданий → {QUESTIONS.relative_to(ROOT)} "
          + "(" + ", ".join(f"{k}: {v}" for k, v in sorted(counts.items())) + ")")


if __name__ == "__main__":
    main()
