#!/usr/bin/env python3
"""Кнопка «Проверка»: автор принимает черновики и решает спорное в Терминале.

    python3 scripts/review_console.py      (двойной клик — «Проверка.command» в корне)

По страницам: разборы заданий, правила и вопросы к ним, спорные ключи ФИПИ, сообщения
учеников. Верное принимается сразу, «не так» уходит в data/review/fixes.md. Содержание кнопка
не пишет, коммитов не делает. Замысел — docs/superpowers/specs/2026-09-27-review-console-design.md
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import accept  # noqa: E402
import console_ui as ui  # noqa: E402
import review_queue as rq  # noqa: E402
from build_bank import BuildError  # noqa: E402
from common import RULES, read_json  # noqa: E402

PAGE = 4
ORIGIN = {"fipi": "Банк ФИПИ", "generated": "Новое задание"}
FIXES_NAME = "data/review/fixes.md"
CANCEL_HINT = "(Enter — без пояснения, 0 — отменить выбор)"


class Tally:
    def __init__(self):
        self.accepted = self.fixes = self.conflicts = self.replies = 0
        self.rebuilt = False
        self.errors = []

    def wrote_data(self):
        return bool(self.accepted or self.fixes or self.conflicts)

    def rebuild(self):
        """Банк — сразу после каждой записи в данные: закроют окно крестиком — он не отстанет."""
        self.errors = rq.rebuild()
        self.rebuilt = True


# ---------- как выглядит пункт ----------

def one_line(text):
    return " ".join(str(text).split())


def stem_lines(q):
    """Условие: фрагменты №26 построчно, иначе строки условия как есть."""
    if q.get("fragments"):
        return [f"{f['id']}) {f['text']}" for f in q["fragments"]]
    return [s for s in str(q.get("stem", "")).split("\n") if s.strip()]


def check_lines(c):
    lines = [s for s in (c.get("prompt"), c.get("sentence")) if s]
    if c.get("sentenceRu"):
        lines.append(f"({c['sentenceRu']})")
    return lines


def origin_label(q):
    """Откуда задание — как на сайте: «Банк ФИПИ», «Новое задание», «HSK 4 · H41001, №56»."""
    if q.get("origin") == "hsk":
        ref = q.get("sourceRef") or {}
        return f"HSK 4 · {ref.get('paper')}, №{ref.get('number')}"
    return ORIGIN.get(q.get("origin"), q.get("origin"))


def task_header(q):
    return f"№{q['taskNumber']} · {origin_label(q)} · {q['id']}"


def task_brief(q):
    return f"№{q['taskNumber']} · " + one_line(" / ".join(stem_lines(q)))


def check_brief(c):
    return one_line(" · ".join(check_lines(c)))


def task_footer(q, state):
    topics = {t["id"]: t["title"] for t in state["topics"]}
    rules = {r["id"]: r["title"] for r in state["rules"]}
    parts = []
    if q.get("topicIds"):
        parts.append("Тема: " + ", ".join(topics.get(t, t) for t in q["topicIds"]))
    if q.get("ruleIds"):
        parts.append("правило: " + ", ".join(rules.get(r, r) for r in q["ruleIds"]))
    return " · ".join(parts)


def show_item(number, header, lines, item, footer=None, mark="✓"):
    """Номер и признаки, условие, варианты с ключом, разбор каждого варианта. Условие и разбор —
    целиком: обрезанное не проверить."""
    head = f"  {number:>2}. " if number else "  "
    indent = " " * len(head)
    print()
    ui.line(head + header)
    for text in lines:
        print(indent + text)
    print(indent + "   ".join(f"{o['id']}) {o['text']}" + (f" {mark}" if o["id"] == item["correctOptionId"] else "")
                               for o in item["options"]))
    explanation = item.get("explanation") or {}
    wrong = explanation.get("options") or {}
    for o in item["options"]:
        if o["id"] == item["correctOptionId"]:
            print(f"{indent}✓ {o['text']} — {explanation.get('correct', '')}")
    for o in item["options"]:
        if o["id"] != item["correctOptionId"]:
            print(f"{indent}✗ {o['id']} {o['text']} — {wrong.get(o['id'], 'разбора нет')}")
    contrast = item.get("contrast")
    if contrast:
        text = f"{contrast.get('zh', '')} — {contrast.get('ru', '')}" if isinstance(contrast, dict) else contrast
        print(f"{indent}Сравните: {text}")
    if footer:
        ui.line(indent + footer)


def show_rule(rule):
    print("\n" + ui.RULE)
    ui.line(f"  Правило · {rule['title']} · {rule['id']}")
    print(f"\n  Суть: {rule.get('summary', '')}")
    if rule.get("usage"):
        print("  Как применять:")
        for text in rule["usage"]:
            print(f"    • {text}")
    if rule.get("examples"):
        print("  Примеры:")
        for e in rule["examples"]:
            print(f"    {e['zh']} — {e['ru']}")
    contrast = rule.get("contrast") or {}
    if contrast.get("pair"):
        print("  Сравните:")
        for e in contrast["pair"]:
            print(f"    {e['zh']} — {e['ru']}")
        if contrast.get("note"):
            print(f"    {contrast['note']}")
    if rule.get("mistake"):
        print(f"  Типичная ошибка: {rule['mistake']}")


def page_hint():
    print("\n  в — все верны · номера через пробел — какие не так (остальные верны)")
    print("  п — пропустить страницу · 0 — в меню")


# ---------- ответы ----------

def ask_page(ask, items, brief):
    """("end" | "exit" | "skip", None) или ("done", [(пункт, не так?, пояснение)]).

    Пояснения спрашиваются до записи: кончится ввод посреди — страница не записана. Перед
    вопросом пункт печатается ещё раз — промахнулись номером, «0», и страница спрашивается заново."""
    while True:
        answer = ask("\n  Ваш ответ: ")
        if answer is None:
            return "end", None
        parsed = ui.parse_page(answer, len(items))
        if parsed.get("error") == "empty":
            print("  Пустой ответ не засчитываю: «в» — если все верны, номера — если нет.")
            continue
        if parsed.get("error"):
            print(f"  Не понял ответ. «в», «п», «0» или номера от 1 до {len(items)}.")
            continue
        if parsed.get("exit"):
            return "exit", None
        if parsed.get("skip"):
            return "skip", None
        wrong = parsed.get("wrong", [])
        notes, cancelled = {}, False
        for n in wrong:
            print("\n  " + brief(items[n - 1]))
            note = ask(f"  Что не так {CANCEL_HINT}: ")
            if note is None:
                return "end", None
            if note.strip() == "0":
                cancelled = True
                break
            notes[n] = note.strip()
        if cancelled:
            print("\n  Выбор отменён, страница не записана — ответьте на неё заново.")
            continue
        return "done", [(item, n in notes, notes.get(n, "")) for n, item in enumerate(items, 1)]


def ask_choice(ask, allowed, hint):
    while True:
        answer = ask("\n  Ваш ответ: ")
        if answer is None:
            return None
        choice = ui.parse_choice(answer, allowed)
        if choice:
            return choice
        print(f"  Не понял ответ. {hint}")


def record_page(marks, tally, kind, section, accept_id, fix_id, brief):
    good = [item for item, wrong, _ in marks if not wrong]
    fresh = [item for item in good if rq.unchanged(kind, item)]
    accepted = accept.accept([accept_id(item) for item in fresh]) if fresh else []
    if len(fresh) < len(good):
        print(f"\n  Изменились, пока вы смотрели: {len(good) - len(fresh)} — не приняты, покажутся заново.")
    fixes = 0
    for item, wrong, note in marks:
        if wrong:
            rq.add_fix(section, fix_id(item), brief(item) + (f" — {note}" if note else ""))
            fixes += 1
    tally.accepted += len(accepted)
    tally.fixes += fixes
    if accepted:
        tally.rebuild()
    print(f"\n  Записано: принято {len(accepted)}" + (f" · на правку {fixes} — в {FIXES_NAME}" if fixes else ""))


def load():
    try:
        return rq.load_state()
    except BuildError as error:
        print(f"\n  Данные не собираются: {error}")
        print("  Раздел не открыт — покажите это Claude.")
        return None


# ---------- разделы ----------

def review_tasks(ask, tally):
    state = load()
    if state is None:
        return "menu"
    ready, _ = rq.task_queue(state["questions"], state["pending"], state["authored"], state["fixes"])
    if not ready:
        print("\n  Разборов на проверку нет.")
        return "menu"
    pages = ui.pages(ready, PAGE, key=lambda q: q["taskNumber"])
    for i, page in enumerate(pages):
        print("\n" + ui.RULE)
        ui.line(f"  Разборы заданий · страница {i + 1} из {len(pages)} · осталось {sum(len(p) for p in pages[i:])}")
        for n, q in enumerate(page, 1):
            show_item(n, task_header(q), stem_lines(q), q, task_footer(q, state))
        page_hint()
        result, marks = ask_page(ask, page, task_brief)
        if result == "end":
            return "end"
        if result == "exit":
            return "menu"
        if result == "done":
            record_page(marks, tally, "task", "tasks", lambda q: q["id"], lambda q: q["id"], task_brief)
    print("\n  Разборы кончились.")
    return "menu"


def review_rules(ask, tally):
    state = load()
    if state is None:
        return "menu"
    groups = rq.rule_queue(state["rules"], state["checks"], state["fixes"])
    if not groups:
        print("\n  Правил и вопросов на проверку нет.")
        return "menu"
    for group in groups:
        rule = group["rule"]
        if group["draft"]:
            show_rule(rule)
            print("\n  в — принять · н — не так · п — пропустить · 0 — в меню")
            while True:
                choice = ask_choice(ask, {"в", "н", "п", "0"}, "«в», «н», «п» или «0».")
                if choice is None:
                    return "end"
                note = ""
                if choice == "н":
                    note = ask(f"  Что не так {CANCEL_HINT}: ")
                    if note is None:
                        return "end"
                    if note.strip() == "0":
                        print("  Выбор отменён — ответьте заново.")
                        continue
                break
            if choice == "0":
                return "menu"
            if choice == "в":
                if rq.unchanged("rule", rule):
                    tally.accepted += len(accept.accept([rule["id"]]))
                    tally.rebuild()
                    print("\n  Правило принято.")
                else:
                    print("\n  Правило изменилось, пока вы смотрели, — не принято, покажется заново.")
            if choice == "н":
                rq.add_fix("rules", f"rule:{rule['id']}", rule["title"] + (f" — {note.strip()}" if note.strip() else ""))
                tally.fixes += 1
                print(f"\n  На правку — в {FIXES_NAME}.")
        checks, blocked = rq.checks_ready(group["checks"], read_json(RULES))
        if blocked:
            print(f"\n  Вопросы к правилу «{rule['title']}» ({blocked}) ждут, пока правило не принято.")
        pages = ui.pages(checks, PAGE, key=lambda c: 0)
        for i, page in enumerate(pages):
            print("\n" + ui.RULE)
            ui.line(f"  Вопросы к правилу «{rule['title']}» · страница {i + 1} из {len(pages)}")
            for n, c in enumerate(page, 1):
                show_item(n, f"Вопрос к правилу · {c['id']}", check_lines(c), c)
            page_hint()
            result, marks = ask_page(ask, page, check_brief)
            if result == "end":
                return "end"
            if result == "exit":
                return "menu"
            if result == "done":
                record_page(marks, tally, "check", "rules", lambda c: c["id"], lambda c: f"check:{c['id']}", check_brief)
    print("\n  Правила и вопросы кончились.")
    return "menu"


def review_conflicts(ask, tally):
    state = load()
    if state is None:
        return "menu"
    queue = rq.conflict_queue(state["questions"], state["authored"])
    if not queue:
        print("\n  Спорных ключей без решения нет.")
        return "menu"
    for i, q in enumerate(queue, 1):
        print("\n" + ui.RULE)
        ui.line(f"  Спорные ключи · {i} из {len(queue)}")
        show_item(0, task_header(q), stem_lines(q), q, mark="✓ по ключу")
        print(f"\n  Спорно: {q.get('conflict', '')}")
        print("\n  1) оставить скрытым   2) вернуть с ключом ФИПИ   3) пропустить   0) в меню")
        choice = ask_choice(ask, {"1", "2", "3", "0"}, "1, 2, 3 или 0.")
        if choice is None:
            return "end"
        if choice == "0":
            return "menu"
        if choice == "1":
            rq.decide_conflict(q["id"], "hidden")
            tally.conflicts += 1
            tally.rebuild()
            print("\n  Оставлено скрытым.")
        if choice == "2":
            # Сначала черновик, потом решение: закроют окно между записями — задание не выйдет
            # на сайт со старым разбором.
            rq.reopen("task", q["id"])
            rq.decide_conflict(q["id"], "restore")
            rq.add_fix("conflicts", q["id"], task_brief(q))
            tally.conflicts += 1
            tally.fixes += 1
            tally.rebuild()
            print(f"\n  Вернуть с ключом ФИПИ: разбор перепишет Claude (строка в {FIXES_NAME}),"
                  " новый разбор придёт к вам в раздел 1.")
    print("\n  Спорные ключи кончились.")
    return "menu"


def show_report(issue, state):
    """Показывает сообщение и пункт банка; возвращает (вид, ID пункта или None)."""
    title = ui.clean(issue.get("title", ""))
    item_id = rq.report_item_id(title)
    kind, item = rq.find_item(item_id, state["questions"], state["checks"])
    ui.line(f"  {title}")
    if kind == "task":
        show_item(0, task_header(item), stem_lines(item), item, task_footer(item, state))
    elif kind == "check":
        show_item(0, f"Вопрос к правилу · {item['id']}", check_lines(item), item)
    else:
        print(f"\n  {item_id or 'ID в заголовке нет'} — такого пункта в банке нет.")
    choice = rq.student_choice(issue.get("body"))
    if choice:
        print(f"\n  Ученик выбрал: {ui.clean(choice)}")
    print("\n  Ученик пишет:")
    for text in ui.clean(rq.student_text(issue.get("body"))).splitlines() or ["(пусто)"]:
        print("    " + text)
    return kind, (item["id"] if item else None)


def review_reports(ask, tally):
    issues, error = rq.list_reports()
    if issues is None:
        print("\n  " + error)
        return "menu"
    state = load()
    if state is None:
        return "menu"
    waiting = rq.pending_issues(state["fixes"])
    queue = [i for i in issues if i["number"] not in waiting]
    if not queue:
        print("\n  Новых сообщений учеников нет.")
        return "menu"
    for k, issue in enumerate(queue, 1):
        number = issue["number"]
        print("\n" + ui.RULE)
        ui.line(f"  Сообщения учеников · {k} из {len(queue)} · #{number} · {ui.clean(issue.get('createdAt', ''))[:10]}")
        kind, item_id = show_report(issue, state)
        print("\n  1) ученик прав — на правку   2) не прав — закрыть с ответом   3) пропустить   0) в меню")
        while True:
            choice = ask_choice(ask, {"1", "2", "3", "0"}, "1, 2, 3 или 0.")
            if choice is None:
                return "end"
            if choice == "1":
                note = ask("  Что исправить (Enter — как пишет ученик, 0 — отменить выбор): ")
                if note is None:
                    return "end"
                if note.strip() == "0":
                    print("  Выбор отменён — ответьте заново.")
                    continue
                said = f": {note.strip()}" if note.strip() else ""
                rq.add_fix("reports", f"issue:{number}", f"{item_id or 'нет в банке'} — ученик прав" + said)
                tally.fixes += 1
                if kind:
                    # Строка с ID пункта держит его до исправления: старый разбор не принять заново.
                    # Claude удалит её, когда перепишет разбор; строку issue:N — после публикации.
                    rq.add_fix("reports", item_id if kind == "task" else f"check:{item_id}",
                               f"по сообщению #{number}" + said)
                if kind and rq.reopen(kind, item_id):
                    tally.rebuild()
                    section = 1 if kind == "task" else 2
                    print(f"\n  Станет черновиком и уйдёт с сайта со следующей публикацией. Claude перепишет разбор,"
                          f" вы примете его в разделе {section}; после публикации Claude закроет сообщение.")
                else:
                    print(f"\n  На правку — в {FIXES_NAME}. Сообщение закроет Claude, когда исправление выйдет.")
            if choice == "2":
                reply = ""
                while not reply:
                    answer = ask("  Ответ ученику (0 — отменить выбор): ")
                    if answer is None:
                        return "end"
                    reply = answer.strip()
                    if not reply:
                        print("  Пустой ответ не отправляю: ученик должен узнать почему.")
                if reply == "0":
                    print("  Выбор отменён — ответьте заново.")
                    continue
                ok, error = rq.close_report(number, reply)
                if ok:
                    tally.replies += 1
                    print(f"\n  Сообщение #{number} закрыто с ответом.")
                else:
                    print("\n  " + error)
            break
        if choice == "0":
            return "menu"
    print("\n  Сообщения кончились.")
    return "menu"


# ---------- меню и итог ----------

SECTIONS = (review_tasks, review_rules, review_conflicts, review_reports)


def finish(tally):
    if tally.rebuilt:
        if tally.errors:
            print("\n  Банк не прошёл проверку — покажите это Claude:")
            for error in tally.errors[:10]:
                print("   - " + error)
        else:
            print("\n  Банк пересобран и проверен.")
    print(f"\n  Принято {tally.accepted} · на правку {tally.fixes} · решено спорных {tally.conflicts}"
          f" · ответов ученикам {tally.replies}")
    if tally.wrote_data():
        print("  Скажите Claude: проверка записана." + (f" Что не так — в {FIXES_NAME}." if tally.fixes else ""))
    elif tally.replies:
        print("  Ответы уже на GitHub, в данных ничего не менялось.")
    else:
        print("  Ничего не записано.")


def main():
    ask = ui.Asker()
    tally = Tally()
    # Строка до чтения данных и gh: иначе двойной клик дал бы на пару секунд пустое окно.
    print("\n  Смотрю черновики и сообщения учеников…")
    reports = rq.list_reports()
    try:
        while True:
            state = load()
            if state is None:
                break
            ready, not_ready = rq.task_queue(state["questions"], state["pending"], state["authored"], state["fixes"])
            groups = rq.rule_queue(state["rules"], state["checks"], state["fixes"])
            rules_waiting = sum(int(g["draft"]) + len(g["checks"]) for g in groups)
            conflicts = rq.conflict_queue(state["questions"], state["authored"])
            issues, _ = reports
            waiting = rq.pending_issues(state["fixes"])
            open_reports = None if issues is None else len([i for i in issues if i["number"] not in waiting])
            counts = [len(ready), rules_waiting, len(conflicts), open_reports or 0]
            items = [
                ("Разборы заданий", f"ждут {len(ready)}"),
                ("Правила и вопросы", f"ждут {rules_waiting}"),
                ("Спорные ключи", f"ждут {len(conflicts)} · решено {rq.decided_conflicts(state['authored'])}"),
                ("Сообщения учеников", "GitHub недоступен — раздел подскажет" if issues is None else f"открыто {open_reports}"),
            ]
            footer = [f"Не готовы к проверке: {len(not_ready)} — покажите Claude."] if not_ready else []
            choice = ui.menu(ask, "Проверка — что ждёт вашего решения", items,
                             "Какой раздел (номер; Enter — первый, где ждут):", footer)
            if choice is None:
                break
            if choice == "enter":
                choice = next((i for i, n in enumerate(counts) if n), None)
                if choice is None:
                    if not_ready:
                        print("\n  Проверять нечего: остальное не готово — покажите Claude.")
                    elif issues is None:
                        print("\n  Проверять нечего. Сообщения учеников не видны — GitHub недоступен.")
                    else:
                        print("\n  Всё проверено.")
                    break
            result = SECTIONS[choice](ask, tally)
            if choice == 3:
                reports = rq.list_reports()
            if result == "end":
                print("\n  Ввод кончился — незаписанная страница ждёт следующего раза.")
                break
    except KeyboardInterrupt:
        print("\n\n  Прервано. Записанное до этого момента сохранено.")
    finish(tally)


if __name__ == "__main__":
    main()
