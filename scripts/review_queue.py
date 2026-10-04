"""Что ждёт решения автора и запись его решений — для кнопки «Проверка».

Без ввода-вывода: экраны — в review_console.py. Замысел —
docs/superpowers/specs/2026-09-27-review-console-design.md
"""

import datetime
import json
import os
import re
import shlex
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_bank  # noqa: E402
import validate  # noqa: E402
from common import (AUTHORED, ISSUES_URL, QUESTIONS, REVIEW, RULE_CHECKS, RULES, TOPICS,  # noqa: E402
                    read_json, write_json)

FIXES = REVIEW / "fixes.md"
FIXES_HEADER = ("# На правку\n\n"
                "Что автор отметил в «Проверке». Claude исправляет, пункт уходит на проверку заново,\n"
                "строка удаляется.\n")
SECTIONS = {
    "tasks": "Разборы заданий",
    "rules": "Правила и вопросы",
    "conflicts": "Спорные ключи — вернуть с ключом ФИПИ",
    "reports": "Сообщения учеников",
}
NOT_ACCEPTED = "разбор не принят автором"
RULE_NOT_ACCEPTED = re.compile(r"^правило \S+ не принято$")
PENDING = re.compile(r"^- `([^`]+)`", re.M)
ISSUE = re.compile(r"^- `issue:(\d+)`", re.M)
REPORT_TITLE = re.compile(r"^Ошибка: .* · (\S+)$")
DECISIONS = ("hidden", "restore")


# ---------- список на правку ----------

def read_fixes(path=FIXES):
    try:
        return Path(path).read_text(encoding="utf-8")
    except FileNotFoundError:
        return ""


def pending_ids(text):
    """ID пунктов, которые стоят в списке на правку: их не спрашивают, пока Claude не исправит."""
    return set(PENDING.findall(text))


def pending_issues(text):
    """Сообщения учеников, стоящие в списке на правку (строка `issue:N`): Claude держит её,
    пока исправление не опубликовано и сообщение не закрыто."""
    return {int(n) for n in ISSUE.findall(text)}


def add_fix(section, item_id, text, path=FIXES, when=None):
    """Строка в конец своего раздела; раздела нет — он дописывается в конец файла."""
    path = Path(path)
    content = read_fixes(path) or FIXES_HEADER
    heading = f"## {SECTIONS[section]}\n"
    if heading not in content:
        content = content.rstrip("\n") + "\n\n" + heading
    entry = f"- `{item_id}` {text} ({when or datetime.date.today().strftime('%d.%m.%Y')})\n"
    start = content.index(heading) + len(heading)
    following = content.find("\n## ", start)
    if following == -1:
        content = content.rstrip("\n") + "\n" + entry
    else:
        content = content[:following].rstrip("\n") + "\n" + entry + content[following:]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


# ---------- очереди ----------

def load_state():
    """Всё, из чего строятся очереди, — свежим с диска. Несобираемые данные — BuildError."""
    topics = read_json(TOPICS)
    rules = read_json(RULES)
    records = build_bank.load_records()
    authored = build_bank.load_authored()
    questions, pending = build_bank.merge(records, authored, topics, rules)
    return {"topics": topics, "rules": rules, "checks": read_json(RULE_CHECKS), "records": records,
            "authored": authored, "questions": questions, "pending": pending, "fixes": read_fixes()}


def task_queue(questions, pending, authored, fixes_text):
    """(готовые к решению автора, не готовые — [(ID, причины)]).

    Готово: черновой разбор, из причин «не готово» — только непринятый разбор и непринятое
    правило (задание примется, а на сайт выйдет вместе с правилом). Пункты из списка на правку
    не спрашиваются."""
    waiting = pending_ids(fixes_text)
    ready, not_ready = [], []
    for q in questions:
        entry = authored.get(q["id"])
        if q["reviewStatus"] != "draft" or not entry or entry.get("status") != "draft" or q["id"] in waiting:
            continue
        other = [r for r in pending.get(q["id"], []) if r != NOT_ACCEPTED and not RULE_NOT_ACCEPTED.match(r)]
        if other:
            not_ready.append((q["id"], other))
        else:
            ready.append(q)
    return ready, not_ready


def rule_queue(rules, checks, fixes_text):
    """По правилам: черновое правило (draft) и черновые вопросы к нему. Вопрос относится
    к первому правилу из своих ruleIds."""
    waiting = pending_ids(fixes_text)
    draft_checks = [c for c in checks if c.get("status") == "draft" and f"check:{c['id']}" not in waiting]
    groups = []
    for rule in rules:
        rule_draft = rule.get("status") == "draft" and f"rule:{rule['id']}" not in waiting
        own = [c for c in draft_checks if c.get("ruleIds") and c["ruleIds"][0] == rule["id"]]
        if rule_draft or own:
            groups.append({"rule": rule, "draft": rule_draft, "checks": own})
    return groups


def checks_ready(checks, rules):
    """(вопросы, все правила которых приняты; сколько ждут правила). Принятый вопрос к
    непринятому правилу validate.py считает ошибкой — такой вопрос сначала ждёт правило."""
    accepted = {r["id"] for r in rules if r.get("status") == "accepted"}
    ready = [c for c in checks if all(r in accepted for r in c.get("ruleIds") or [])]
    return ready, len(checks) - len(ready)


def conflict_queue(questions, authored):
    """Спорные ключи автора (keyConflict в разборе) без его решения."""
    return [q for q in questions
            if q["reviewStatus"] == "conflict" and authored.get(q["id"], {}).get("keyConflict")
            and not authored[q["id"]].get("keyDecision")]


def decided_conflicts(authored):
    return sum(1 for e in authored.values() if e.get("keyConflict") and e.get("keyDecision"))


def decide_conflict(qid, decision, authored_dir=AUTHORED):
    """keyDecision в разборе: hidden — оставить скрытым, restore — вернуть с ключом ФИПИ."""
    if decision not in DECISIONS:
        raise ValueError(f"неизвестное решение {decision!r}")
    for path in sorted(Path(authored_dir).glob("task-*.json")):
        entries = read_json(path)
        if qid in entries:
            entries[qid]["keyDecision"] = decision
            write_json(path, entries)
            return True
    return False


def reopen(kind, item_id, authored_dir=AUTHORED, checks_path=RULE_CHECKS):
    """Принятое — снова черновик: задание или вопрос уходит с сайта до исправления, а новый
    разбор Claude пишет волной и автор принимает его заново. True — статус сменён."""
    if kind == "task":
        for path in sorted(Path(authored_dir).glob("task-*.json")):
            entries = read_json(path)
            if item_id in entries:
                if entries[item_id].get("status") != "accepted":
                    return False
                entries[item_id]["status"] = "draft"
                write_json(path, entries)
                return True
        return False
    if kind == "check":
        checks = read_json(checks_path)
        for c in checks:
            if c["id"] == item_id and c.get("status") == "accepted":
                c["status"] = "draft"
                write_json(checks_path, checks)
                return True
        return False
    raise ValueError(f"неизвестный вид {kind!r}")


def unchanged(kind, shown):
    """Пункт на диске тот же, что автор видел: иначе Claude успел переписать черновик, и
    принять можно только новый текст — после того как автор его увидит."""
    if kind == "task":
        entry = build_bank.load_authored().get(shown["id"]) or {}
        return (entry.get("status") == "draft"
                and entry.get("explanation") == shown.get("explanation")
                and list(entry.get("topicIds") or []) == list(shown.get("topicIds") or [])
                and list(entry.get("ruleIds") or []) == list(shown.get("ruleIds") or [])
                and (entry.get("contrast") or None) == (shown.get("contrast") or None))
    source = RULE_CHECKS if kind == "check" else RULES
    return next((x for x in read_json(source) if x["id"] == shown["id"]), None) == shown


# ---------- сообщения учеников (gh) ----------

def repo_slug(url=ISSUES_URL):
    return re.search(r"github\.com/([^/]+/[^/]+)/issues", url).group(1)


def run_gh(args, timeout=60):
    """(получилось, вывод, ошибка для автора). Путь к gh подменяется переменной REVIEW_GH."""
    command = shlex.split(os.environ.get("REVIEW_GH", "gh"))
    try:
        done = subprocess.run(command + list(args), capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError:
        return False, "", "Не найден gh. Установить: brew install gh, затем gh auth login."
    except subprocess.TimeoutExpired:
        return False, "", f"GitHub не ответил за {timeout} с — проверьте сеть."
    if done.returncode != 0:
        first = (done.stderr or done.stdout or "").strip().splitlines()[:1]
        reason = first[0] if first else f"код {done.returncode}"
        return False, "", f"gh не смог: {reason}. Если ещё не входили — gh auth login."
    return True, done.stdout, ""


def list_reports():
    """Открытые сообщения «Ошибка: …»: ([{number, title, body, createdAt}], "") или (None, ошибка)."""
    ok, out, error = run_gh(["issue", "list", "--repo", repo_slug(), "--state", "open", "--limit", "1000",
                             "--json", "number,title,body,createdAt"], timeout=20)
    if not ok:
        return None, error
    try:
        issues = json.loads(out)
    except json.JSONDecodeError:
        return None, "gh ответил не тем — покажите это Claude."
    return [i for i in issues if str(i.get("title", "")).startswith("Ошибка:")], ""


def close_report(number, comment):
    ok, _, error = run_gh(["issue", "close", str(number), "--repo", repo_slug(), "--comment", comment])
    return ok, error


def report_item_id(title):
    """ID из заголовка «Ошибка: задание 22 · q22-…» (так его пишет ссылка на странице)."""
    match = REPORT_TITLE.match(str(title).strip())
    return match.group(1) if match else None


def student_text(body):
    """Что написал ученик: текст после «Что не так:»; нет метки — всё сообщение."""
    body = str(body or "")
    marker = "Что не так:"
    return (body.split(marker, 1)[1] if marker in body else body).strip()


def student_choice(body):
    """Какой ответ выбрал ученик — строка «Выбранный ответ: …» из сообщения."""
    match = re.search(r"^Выбранный ответ: (.*)$", str(body or ""), re.M)
    return match.group(1).strip() if match else None


def find_item(item_id, questions, checks):
    for q in questions:
        if q["id"] == item_id:
            return "task", q
    for c in checks:
        if c["id"] == item_id:
            return "check", c
    return None, None


# ---------- после проверки ----------

def rebuild():
    """Пересобрать банк и проверить его: без этого публикация остановится на сверке данных."""
    try:
        build_bank.build()
    except build_bank.BuildError as error:
        return [f"сборка банка остановлена: {error}"]
    return validate.check_all(read_json(QUESTIONS), read_json(TOPICS), read_json(RULES), read_json(RULE_CHECKS))
