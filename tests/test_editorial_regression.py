"""Compare both generators over sixteen retrospective-history issues without writing previews."""
import contextlib
from datetime import datetime, timedelta
import io
import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from generate_news import generate_issue_data, validate_issue_data
from src.newsroom import NewsroomEngine, TIMEZONE_CST


class EditorialRegressionTests(unittest.TestCase):
    def test_all_history_quarters_match_worker(self):
        start = datetime(2026, 5, 15, tzinfo=TIMEZONE_CST)
        dates = [(start + timedelta(days=index)).strftime("%Y-%m-%d") for index in range(1106)]
        script = """
import { readFileSync } from 'node:fs';
import { generateIssue } from './cloudflare/worker/src/generator.js';
const history = {
  timeline: JSON.parse(readFileSync('data/processed/timeline/ming_timeline.json', 'utf8')),
  disasters: JSON.parse(readFileSync('data/processed/timeline/ming_disasters.json', 'utf8')),
};
console.log(JSON.stringify(JSON.parse(process.argv[1]).map(date => generateIssue(date, history))));
"""
        result = subprocess.run(
            ["node", "--input-type=module", "-e", script, json.dumps(dates)],
            cwd=ROOT, check=True, text=True, capture_output=True,
        )
        worker_issues = json.loads(result.stdout)
        engine = NewsroomEngine()
        for date, worker_issue in zip(dates, worker_issues):
            issue = generate_issue_data(engine, datetime.fromisoformat(date).replace(tzinfo=TIMEZONE_CST))
            with contextlib.redirect_stdout(io.StringIO()):
                validate_issue_data(issue)
                validate_issue_data(worker_issue)
            self.assertEqual(issue, worker_issue, f"Generator divergence on {date}")
        self.assertEqual(len(worker_issues), 1106)

    def test_curated_sample_excerpts_are_traceable_to_local_source(self):
        timeline = json.loads((ROOT / "data/processed/timeline/ming_timeline.json").read_text(encoding="utf-8"))
        raw = (ROOT / "data/raw/灾害通史/中国灾害通史明代卷.md").read_text(encoding="utf-8")
        records = [record for record in timeline if record["id"].startswith("CUR")]
        self.assertEqual(len(records), 15)
        self.assertEqual(len({record["id"] for record in timeline}), len(timeline))
        for record in records:
            self.assertIn(record["source_excerpt"], raw)
            self.assertTrue(record["sources"])
            self.assertEqual(record["verification_status"], "needs_review")
            self.assertIn("未", record["editorial_note"])

    def test_sixteen_issues_match_worker_and_preserve_evidence_boundaries(self):
        start = datetime(2026, 5, 15, tzinfo=TIMEZONE_CST) + timedelta(days=(1403 - 1368) * 4)
        dates = [(start + timedelta(days=index)).strftime("%Y-%m-%d") for index in range(16)]
        script = """
import { readFileSync } from 'node:fs';
import { generateIssue } from './cloudflare/worker/src/generator.js';
const history = {
  timeline: JSON.parse(readFileSync('data/processed/timeline/ming_timeline.json', 'utf8')),
  disasters: JSON.parse(readFileSync('data/processed/timeline/ming_disasters.json', 'utf8')),
};
console.log(JSON.stringify(JSON.parse(process.argv[1]).map(date => generateIssue(date, history))));
"""
        result = subprocess.run(
            ["node", "--input-type=module", "-e", script, json.dumps(dates)],
            cwd=ROOT, check=True, text=True, capture_output=True,
        )
        worker_issues = json.loads(result.stdout)
        engine = NewsroomEngine()
        summary = []
        published_bodies = set()
        annual_ids = set()
        fields = (
            "id", "headline", "body", "sources", "source_excerpt", "content_type",
            "time_precision", "verification_status", "background", "later_effects", "editorial_note",
        )
        for date, worker_issue in zip(dates, worker_issues):
            issue = generate_issue_data(engine, datetime.fromisoformat(date).replace(tzinfo=TIMEZONE_CST))
            with contextlib.redirect_stdout(io.StringIO()):
                validate_issue_data(issue)
                validate_issue_data(worker_issue)
            self.assertEqual(issue["date"], worker_issue["date"])
            self.assertEqual(issue["period"], worker_issue["period"])
            self.assertEqual(list(issue["sections"]), list(worker_issue["sections"]))
            for collection in ("articles", "annual_events"):
                self.assertEqual(
                    [{field: article[field] for field in fields} for article in issue[collection]],
                    [{field: article[field] for field in fields} for article in worker_issue[collection]],
                )
            self.assertEqual(
                {field: issue["lead"][field] for field in fields} if issue["lead"] else None,
                {field: worker_issue["lead"][field] for field in fields} if worker_issue["lead"] else None,
            )
            articles = ([issue["lead"]] if issue["lead"] else []) + issue["articles"]
            for article in articles + issue["annual_events"]:
                self.assertFalse(article["id"].startswith(("BG_", "SUP_", "OP_")))
                self.assertEqual(article["verification_status"], "needs_review")
                self.assertNotEqual(article["content_type"], "opinion")
            for article in articles:
                self.assertEqual(article["time_precision"], "month")
                if article["body"]:
                    self.assertNotIn(article["body"], published_bodies, "Quarterly body repeated across issues")
                    published_bodies.add(article["body"])
            for article in issue["annual_events"]:
                self.assertEqual(issue["period"]["start_month"], 10)
                self.assertEqual(article["time_precision"], "year")
                self.assertNotIn(article["id"], annual_ids)
                annual_ids.add(article["id"])
            summary.append({
                "real_date": date,
                "period": issue["period"]["label"],
                "quarterly_records": len(articles),
                "annual_records": len(issue["annual_events"]),
            })
        self.assertEqual(len(worker_issues), 16)
        self.assertGreaterEqual(sum(row["quarterly_records"] > 0 for row in summary), 15)
        print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    unittest.main()
