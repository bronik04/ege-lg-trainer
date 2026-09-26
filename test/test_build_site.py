import json
import unittest

from test.helpers import ready_question, rule

import build_site as bs

TOPICS = [{"id": "aspect", "title": "了, 过, 着", "taskNumbers": [20]}]


def check(check_id, rule_ids, status="accepted"):
    return {"id": check_id, "kind": "choose-form", "status": status, "ruleIds": list(rule_ids), "prompt": "?",
            "options": [], "correctOptionId": "a", "explanation": {}}


class PayloadTest(unittest.TestCase):
    def setUp(self):
        self.questions = [
            ready_question(qid="q20-ready"),
            dict(ready_question(qid="q20-draft"), reviewStatus="draft"),
            dict(ready_question(qid="q20-imported"), reviewStatus="imported", explanation=None),
            dict(ready_question(qid="q20-conflict"), reviewStatus="conflict"),
        ]
        self.rules = [rule("aspect-suffixes"), rule("draft-rule", status="draft")]
        self.checks = [check("c-ok", ["aspect-suffixes"]), check("c-draft", ["aspect-suffixes"], "draft"),
                       check("c-on-draft-rule", ["draft-rule"])]

    def test_published_has_only_ready_and_accepted(self):
        data = bs.payload(self.questions, TOPICS, self.rules, self.checks)
        self.assertEqual([q["id"] for q in data["questions"]], ["q20-ready"])
        self.assertEqual([r["id"] for r in data["rules"]], ["aspect-suffixes"])
        self.assertEqual([c["id"] for c in data["ruleChecks"]], ["c-ok"])
        self.assertFalse(data["meta"]["drafts"])
        self.assertNotIn("draft", data["questions"][0])
        self.assertNotIn("status", data["rules"][0])

    def test_review_build_marks_drafts(self):
        data = bs.payload(self.questions, TOPICS, self.rules, self.checks, drafts=True)
        self.assertEqual([q["id"] for q in data["questions"]], ["q20-ready", "q20-draft"])
        self.assertTrue(data["questions"][1]["draft"])
        self.assertTrue(next(r for r in data["rules"] if r["id"] == "draft-rule")["draft"])
        self.assertEqual(len(data["ruleChecks"]), 3)
        self.assertTrue(data["meta"]["drafts"])

    def test_source_reference_is_trimmed(self):
        q = ready_question(qid="q20-src")
        q["sourceRef"]["fipiId"] = "3872A5"
        data = bs.payload([q], TOPICS, self.rules, [])
        self.assertEqual(data["questions"][0]["sourceRef"],
                         {"collection": "Открытый банк заданий ФИПИ", "fipiId": "3872A5"})


class RenderTest(unittest.TestCase):
    def test_json_cannot_close_script(self):
        embedded = bs.embed_json({"stem": "</script><script>alert(1)</script>"})
        self.assertNotIn("<", embedded)
        self.assertEqual(json.loads(embedded)["stem"], "</script><script>alert(1)</script>")

    def test_logic_inlined_without_exports(self):
        self.assertEqual(bs.inline_logic("export function a() {}\nexport const B = 1;\n"),
                         "function a() {}\nconst B = 1;\n")

    def test_page_has_everything_inline(self):
        html = bs.render(bs.payload([ready_question()], TOPICS, [rule()], []))
        for marker in ("/*APP_CSS*/", "/*APP_JS*/", "/*DATA_JSON*/", "/*DESCRIPTION*/"):
            self.assertNotIn(marker, html)
        self.assertNotIn("export ", html.split('id="trainer-data"')[1])
        self.assertNotIn("<link rel=\"stylesheet\"", html)
        self.assertNotIn("src=\"http", html)


if __name__ == "__main__":
    unittest.main()
