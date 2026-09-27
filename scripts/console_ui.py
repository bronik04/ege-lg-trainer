"""Терминал для кнопки «Проверка»: ввод, ширина иероглифа, меню, чужой текст.

Приёмы — из кнопок учителя проекта slide-builder (scripts/teacher/терминал.js).
"""

import re
import shutil
import sys

WIDTH = 120
RULE = "─" * 42

# Иероглиф и полноширинная пунктуация занимают в Терминале две клетки (East Asian Wide и
# Fullwidth). Без этого столбцы после китайского слова разъезжаются.
WIDE = ((0x1100, 0x115F), (0x2E80, 0x303E), (0x3041, 0x33FF), (0x3400, 0x4DBF), (0x4E00, 0x9FFF),
        (0xA000, 0xA4CF), (0xAC00, 0xD7A3), (0xF900, 0xFAFF), (0xFE30, 0xFE4F), (0xFF00, 0xFF60),
        (0xFFE0, 0xFFE6), (0x20000, 0x3FFFD))

# Управляющие символы (C0 кроме перевода строки, DEL, C1): чужой текст — сообщение ученика —
# мог бы ими командовать Терминалом.
CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f-\x9f]")

# Ответ, набранный в латинской раскладке: те же клавиши, что «в», «н», «п».
LAYOUT = {"d": "в", "y": "н", "g": "п"}


def cells(ch):
    code = ord(ch)
    return 2 if any(a <= code <= b for a, b in WIDE) else 1


def columns(text):
    return sum(cells(ch) for ch in str(text))


def clip(text, width):
    """Режет по клеткам и иероглиф пополам не режет: не влезает — уходит целиком, вместо него «…»."""
    text = str(text)
    if columns(text) <= width:
        return text
    out, used = "", 0
    for ch in text:
        if used + cells(ch) > width - 1:
            break
        out += ch
        used += cells(ch)
    return out + "…"


def pad(text, width):
    text = str(text)
    return text + " " * max(0, width - columns(text))


def window_width():
    return shutil.get_terminal_size((WIDTH, 50)).columns


def line(text=""):
    """Служебная строка — по ширине окна. Условие и разбор печатаются целиком, через print."""
    print(clip(text, window_width()))


def clean(text):
    """Чужой текст без управляющих символов; переводы строк остаются, табуляция — пробелы."""
    return CONTROL.sub("", str(text).replace("\r\n", "\n").replace("\t", "    "))


def _normal(answer):
    text = (answer or "").strip().lower()
    return LAYOUT.get(text, text)


def parse_page(answer, count):
    """Ответ на страницу. Пустой не засчитывается: случайный двойной Enter одобрил бы страницу,
    которую автор не видел."""
    text = _normal(answer)
    if text == "в":
        return {"all": True}
    if text == "п":
        return {"skip": True}
    if text == "0":
        return {"exit": True}
    if not text:
        return {"error": "empty"}
    parts = [p for p in re.split(r"[\s,]+", text) if p]
    if not all(p.isdigit() and 1 <= int(p) <= count for p in parts):
        return {"error": "number"}
    return {"wrong": sorted({int(p) for p in parts})}


def parse_choice(answer, allowed):
    text = _normal(answer)
    return text if text in allowed else None


def pages(items, size, key):
    """Страницы до size пунктов; пункты с разным key на одну страницу не попадают.
    items уже упорядочены по key."""
    out = []
    for item in items:
        if out and len(out[-1]) < size and key(out[-1][0]) == key(item):
            out[-1].append(item)
        else:
            out.append([item])
    return out


def menu(ask, title, items, question, footer=()):
    """items — [(метка, состояние)]. Номер пункта с нуля, "enter" или None (0 или конец ввода).
    Промах переспрашивается: нельзя уйти уверенным, что выбрал."""
    print("\n" + RULE)
    print("  " + title)
    print(RULE)
    width = max((columns(label) for label, _ in items), default=0)
    for i, (label, state) in enumerate(items, 1):
        line(f"  {i:>2}) {pad(label, width)}   {state}")
    line("   0) закончить")
    if footer:
        print()
        for text in footer:
            line("  " + text)
    while True:
        answer = ask("\n" + question + " ")
        if answer is None or answer.strip() == "0":
            return None
        text = answer.strip()
        if not text:
            return "enter"
        if text.isdigit() and 1 <= int(text) <= len(items):
            return int(text) - 1
        print(f"  Не понял ответ. Номер от 1 до {len(items)}, 0 — закончить.")


class Asker:
    """Вопрос и ответ строкой. Ввод из канала (так гоняются проверки) приходит пачкой:
    readline берёт по строке и ничего не теряет. Конец ввода — None."""

    def __init__(self, stream=None):
        self.stream = stream or sys.stdin

    def __call__(self, prompt):
        sys.stdout.write(prompt)
        sys.stdout.flush()
        answer = self.stream.readline()
        if not answer:
            print()
            return None
        return answer.strip()
