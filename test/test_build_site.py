import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

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
        self.assertRegex(data["meta"]["issuesUrl"], r"^https://github\.com/[^/]+/[^/]+/issues/new$")
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
        # Из сети — только стили шрифтов, и они не блокируют страницу: подключены «для печати»
        # и включаются после загрузки. Висящий хост не должен оставлять ученика с пустым экраном.
        tags = re.findall(r"<link[^>]+stylesheet[^>]*>", html)
        self.assertTrue(tags, "стили шрифтов подключены")
        for tag in tags:
            href = re.search(r'href="([^"]+)"', tag).group(1)
            self.assertTrue(href.startswith(("https://fonts.googleapis.com/css2?",
                                             "https://cdn.jsdelivr.net/npm/lxgw-wenkai-screen-webfont@1.7.0/")), href)
            self.assertIn('media="print"', tag)
            self.assertIn("onload=\"this.media='all'\"", tag)
        self.assertNotRegex(html, r"<script[^>]+src=")
        self.assertNotIn("src=\"http", html)

class OfflineTest(unittest.TestCase):
    """Работа без сети: манифест, иконки и service worker — только у опубликованной страницы."""

    def build(self, *args):
        root = Path(__file__).resolve().parent.parent
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        out = tmp / "index.html"
        subprocess.run([sys.executable, str(root / "scripts" / "build_site.py"), "--data-dir",
                        str(root / "test" / "fixtures"), "--out", str(out), *args], check=True, capture_output=True)
        return tmp, out.read_text(encoding="utf-8")

    def test_published_page_works_offline(self):
        tmp, html = self.build()
        self.assertIn('<link rel="manifest" href="manifest.webmanifest">', html)
        manifest = json.loads((tmp / "manifest.webmanifest").read_text(encoding="utf-8"))
        for icon in manifest["icons"]:
            self.assertTrue((tmp / icon["src"]).exists(), icon["src"])
        self.assertTrue((tmp / "apple-touch-icon.png").exists())
        worker = (tmp / "sw.js").read_text(encoding="utf-8")
        version = re.search(r"const VERSION = '([0-9a-f]{12})';", worker)
        self.assertIsNotNone(version, "версия подставлена")
        for name in re.findall(r"'([\w.-]+\.(?:png|svg|webmanifest|html))'", worker):
            self.assertTrue((tmp / name).exists(), f"в кэше несуществующий файл {name}")
        self.assertTrue(json.loads(re.search(r'id="trainer-data">(.*?)</script>', html, re.S).group(1))["meta"]["offline"])

    def test_same_page_same_version_new_page_new_version(self):
        first, _ = self.build()
        again, _ = self.build()
        drafts_dir, _ = self.build("--drafts")
        read = lambda d: re.search(r"VERSION = '(\w+)'", (d / "sw.js").read_text(encoding="utf-8")).group(1)
        self.assertEqual(read(first), read(again), "сборка детерминирована — кэш не сбрасывается зря")
        self.assertFalse((drafts_dir / "sw.js").exists(), "сборка для проверки не кэшируется")
        self.assertFalse((drafts_dir / "manifest.webmanifest").exists())

    def test_kill_switch_removes_offline(self):
        tmp, html = self.build("--no-offline")
        self.assertNotIn("manifest.webmanifest", html)
        self.assertFalse(json.loads(re.search(r'id="trainer-data">(.*?)</script>', html, re.S).group(1))["meta"]["offline"])
        worker = (tmp / "sw.js").read_text(encoding="utf-8")
        self.assertIn("unregister()", worker, "под именем sw.js — выключатель")
        self.assertNotIn("VERSION", worker)

if __name__ == "__main__":
    unittest.main()
