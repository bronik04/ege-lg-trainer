"""Небольшой согласованный набор данных для тестов страницы (test/fixtures/*.json).

    python3 test/fixtures/make_fixture.py

Задания условные: по одному на позицию 15–27, у 20 и 21 три варианта, у остальных четыре;
плюс второе задание 22 (тема «наречия» встречается и в 27), одно сгенерированное и один черновик.
"""

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
LONG = "Разбор этого варианта: почему он подходит или не подходит в этом предложении."

TOPICS = [
    {"id": "aspect", "title": "Глагольные суффиксы 了, 过, 着", "description": "…", "codifierCodes": ["2.4.35"], "taskNumbers": [20]},
    {"id": "adverbs", "title": "Наречия", "description": "…", "codifierCodes": ["2.4.27"], "taskNumbers": [22]},
    {"id": "other", "title": "Прочие темы", "description": "…", "codifierCodes": [], "taskNumbers": [15, 16, 17, 18, 19, 21, 23, 24, 25, 26, 27]},
]

RULES = [
    {"id": "aspect-suffixes", "title": "了, 过 и 着", "topicIds": ["aspect"], "status": "accepted",
     "summary": "了 — действие состоялось, 过 — был такой опыт, 着 — действие или состояние длится.",
     "usage": ["了 после глагола — результат есть.", "过 — «когда-то уже».", "着 — «в процессе, в состоянии»."],
     "examples": [{"zh": "我吃了饭。", "ru": "Я поел."}, {"zh": "我去过北京。", "ru": "Я бывал в Пекине."}],
     "contrast": {"pair": [{"zh": "他穿了大衣。", "ru": "Он надел пальто."}, {"zh": "他穿着大衣。", "ru": "Он в пальто."}],
                  "note": "了 — действие совершилось, 着 — состояние сохраняется."},
     "mistake": "Ставят 了 там, где речь о длящемся состоянии."},
    {"id": "jiu-cai", "title": "就 и 才", "topicIds": ["adverbs"], "status": "accepted",
     "summary": "就 — раньше или легче ожидаемого, 才 — позже или труднее.",
     "usage": ["就 — «уже», быстро.", "才 — «только», поздно."],
     "examples": [{"zh": "他八点就来了。", "ru": "Он пришёл уже в восемь."}, {"zh": "他十点才来。", "ru": "Он пришёл только в десять."}],
     "contrast": {"pair": [{"zh": "我五分钟就到了。", "ru": "Я дошёл всего за пять минут."}, {"zh": "我一个小时才到。", "ru": "Я добрался лишь через час."}],
                  "note": "Оценка времени говорящим решает выбор."},
     "mistake": "Ставят 就 после долгого срока."},
    {"id": "draft-rule", "title": "Черновое правило", "topicIds": ["other"], "status": "draft",
     "summary": "Черновик.", "usage": ["…"], "examples": [{"zh": "一", "ru": "один"}, {"zh": "二", "ru": "два"}],
     "contrast": {"pair": [{"zh": "一", "ru": "1"}, {"zh": "二", "ru": "2"}], "note": "…"}, "mistake": "…"},
]

CHECKS = [
    {"id": "check-jiu", "kind": "choose-form", "ruleIds": ["jiu-cai"], "status": "accepted",
     "prompt": "Какое наречие показывает, что действие произошло раньше, чем ожидалось?",
     "options": [{"id": "a", "text": "就"}, {"id": "b", "text": "才"}], "correctOptionId": "a",
     "explanation": {"correct": "就 подчёркивает, что всё случилось рано и легко.", "options": {"b": "才 говорит об обратном: поздно или с трудом."}}},
    {"id": "check-cai", "kind": "identify-rule", "ruleIds": ["jiu-cai"], "status": "accepted",
     "prompt": "Что выражает наречие в этом предложении?", "sentence": "他十点才来。", "sentenceRu": "Он пришёл только в десять.",
     "options": [{"id": "a", "text": "Раньше ожидаемого"}, {"id": "b", "text": "Позже ожидаемого"}], "correctOptionId": "b",
     "explanation": {"correct": "才 после указания времени: говорящий считает, что это поздно.", "options": {"a": "Раньше ожидаемого выражает 就, а не 才."}}},
]

STEMS = {
    15: ("整齐.", ["2-3", "3-2", "1-2", "3-4"], "2"),
    16: ("这个戏只演了一___。", ["对", "场", "个", "件"], "2"),
    17: ("喝茶的风气是很长时间前在中国___的。", ["造成", "形成", "成为", "变成"], "2"),
    18: ("小王有时候___一些公司翻译资料。", ["从", "由", "为", "被"], "3"),
    19: ("七百零九万零五百", ["70 905 000", "700 950 000", "7 090 500", "7 900 500"], "3"),
    20: ("老板正开___会，不方便接电话。", ["了", "着", "过"], "2"),
    21: ("请大家一个一个___办登机手续。", ["地", "的", "得"], "1"),
    22: ("坐地铁要坐一个多小时___能到。", ["才", "只", "就", "再"], "1"),
    23: ("我虽然做___了，但是不知道做对没做对。", ["上", "错", "完", "好"], "3"),
    24: ("可是现在找___。", ["得到", "不到", "不好", "不了"], "2"),
    25: ("看到你在我前边走___，我就知道没有什么好事。", ["过来", "进来", "下去", "出来"], "1"),
    26: ("A) 这是社会发展的必然趋势\nB) 所以你一定要提高自己的业务水平\nC) 现代社会是一个竞争日趋激烈的社会",
         ["CAB", "BAC", "ACB", "BCA"], "1"),
    27: ("学汉语___可以帮助我在中国生活，___可以帮助我了解中国。", ["只有……，才……", "除了……以外，……", "虽然……，但是……", "不但……，而且……"], "4"),
}


def question(n, suffix="a", status="ready", origin="fipi", **extra):
    stem, options, correct = STEMS[n]
    topic = {20: "aspect", 22: "adverbs"}.get(n, "other")
    rule = {20: "aspect-suffixes", 22: "jiu-cai"}.get(n, "aspect-suffixes")
    q = {
        "id": f"q{n}-{suffix}", "taskNumber": n, "formatYear": 2026, "origin": origin,
        "sourceRef": {"collection": "Открытый банк заданий ФИПИ", "fipiId": "3872A5" if n == 15 else None},
        "prompt": f"Инструкция к заданию {n}.", "stem": stem,
        "options": [{"id": str(i), "text": t} for i, t in enumerate(options, 1)],
        "correctOptionId": correct, "topicIds": [topic], "ruleIds": [rule],
        "explanation": {"correct": f"Верно: {LONG}",
                        "options": {str(i): f"Вариант {t}. {LONG}" for i, t in enumerate(options, 1) if str(i) != correct}},
        "reviewStatus": status,
    }
    if n == 26:
        q["fragments"] = [{"id": "A", "text": "这是社会发展的必然趋势"}, {"id": "B", "text": "所以你一定要提高自己的业务水平"},
                          {"id": "C", "text": "现代社会是一个竞争日趋激烈的社会"}]
    if origin == "generated":
        q["sourceRef"] = {"collection": "Навык ege-chinese", "specVersion": "ЕГЭ 2026"}
    q.update(extra)
    return q


def main():
    questions = [question(n) for n in range(15, 28)]
    questions.append(question(22, "b", stem="他八点___来了。", options=[{"id": "1", "text": "就"}, {"id": "2", "text": "才"}, {"id": "3", "text": "再"}, {"id": "4", "text": "又"}],
                              correctOptionId="1", explanation={"correct": f"就: {LONG}", "options": {"2": f"才: {LONG}", "3": f"再: {LONG}", "4": f"又: {LONG}"}}))
    questions.append(question(27, "gen", origin="generated", topicIds=["adverbs", "other"]))
    questions.append(question(20, "draft", status="draft"))
    for name, value in (("topics", TOPICS), ("rules", RULES), ("rule-checks", CHECKS), ("questions", questions)):
        (HERE / f"{name}.json").write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
