import json
from pathlib import Path
import sys
from datetime import datetime

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import generate_news
from src.newsroom import NewsroomEngine, TIMEZONE_CST


CONTENT_TYPES = {"historical_report", "historical_digest", "historical_analysis", "opinion"}
TIME_PRECISIONS = {"month", "year", "range", "unknown"}
VERIFICATION_STATUSES = {"verified", "needs_review"}


def _issue_data(day: int, month: int = 5):
    engine = NewsroomEngine()
    issue = engine.generate_issue(datetime(2026, month, day, tzinfo=TIMEZONE_CST), 3)
    return json.loads(engine.issue_to_json(issue, pretty=False))


def _all_articles(data):
    return ([data["lead"]] if data.get("lead") else []) + data["articles"]


def test_generate_standalone_html_removes_runtime_config_script(tmp_path):
    data = {
        "date": {"real_date": "2026年05月15日"},
        "period": {"label": "洪武1年第1季度"},
        "lead": None,
        "sections": {},
        "articles": [],
    }
    output_path = tmp_path / "standalone.html"

    generate_news.generate_standalone_html(data, str(output_path))
    html = output_path.read_text(encoding="utf-8")

    assert '<script src="config.js"></script>' not in html
    assert '<script src="js/news.js"></script>' not in html
    assert "window.__MING_ISSUE__" in html
    assert json.dumps(data, ensure_ascii=False) in html


def test_write_issue_outputs_does_not_write_worker_static_data(tmp_path):
    data = {
        "date": {"real_date": "2026年05月15日"},
        "period": {"label": "洪武1年第1季度"},
        "lead": None,
        "sections": {},
        "articles": [],
    }
    output_dir = tmp_path / "web"

    generate_news.write_issue_outputs(data, str(output_dir), str(tmp_path))

    assert (output_dir / "data" / "issue.json").exists()
    assert not (tmp_path / "cloudflare" / "worker" / "data" / "issue.json").exists()
    assert not (tmp_path / "cloudflare" / "worker" / "src" / "issue-data.js").exists()


def test_epoch_issue_reports_retrospective_digest_with_provenance():
    data = _issue_data(15)
    assert data["period"]["label"] == "洪武1年第1季度"

    lead = data["lead"]
    assert lead["headline"] == "朱元璋称帝，建元洪武"
    assert lead["content_type"] == "historical_digest"
    assert lead["verification_status"] == "needs_review"
    assert lead["time_precision"] == "month"
    assert lead["byline"] == ""
    assert lead["sources"] == []
    assert "未附史源" in lead["editorial_note"]
    assert "公历" in lead["editorial_note"]


def test_every_article_declares_editorial_contract_fields():
    for day in (15, 16, 17, 18):
        data = _issue_data(day)
        assert data["period"]["calendar_note"]
        for article in _all_articles(data) + data["annual_events"]:
            assert article["content_type"] in CONTENT_TYPES
            assert article["time_precision"] in TIME_PRECISIONS
            assert article["verification_status"] in VERIFICATION_STATUSES
            assert isinstance(article["source_excerpt"], str)
            assert isinstance(article["editorial_note"], str)
            assert isinstance(article["background"], str)
            assert isinstance(article["later_effects"], str)


def test_timeline_causes_and_consequences_are_separated_not_guessed():
    engine = NewsroomEngine()
    engine.timeline = [{
        "id": "TL_SYNTH",
        "year": 1368,
        "month": 1,
        "title": "合成事件",
        "description": "正月，某事发生，此后应另有其果。",
        "event_type": "dynasty",
        "severity": "critical",
        "category": "dynasty",
        "location": {"province": "南直隶", "city": "应天府"},
        "causes": ["显式起因甲"],
        "consequences": ["显式后果乙"],
    }]
    engine.disasters = []
    issue = engine.generate_issue(datetime(2026, 5, 15, tzinfo=TIMEZONE_CST), 3)
    article = json.loads(engine.issue_to_json(issue, pretty=False))["lead"]
    assert article["background"] == "显式起因甲"
    assert article["later_effects"] == "显式后果乙"
    assert "显式起因甲" not in article["body"]
    assert "此后应另有其果" in article["body"]


def test_no_generic_background_or_supplement_filler():
    for day in (15, 16, 17, 18):
        text = json.dumps(_issue_data(day), ensure_ascii=False)
        assert "SUP_" not in text
        assert "BG_" not in text
        for phrase in ("开国整饬期", "本季朝局", "时局综述", "边防观察", "黄册、鱼鳞图册"):
            assert phrase not in text


def test_generator_does_not_emit_rule_built_opinion():
    data = _issue_data(15)
    assert "评论" not in data["sections"]
    for article in _all_articles(data):
        assert article["content_type"] != "opinion"
        assert article["event_type"] != "opinion"


def test_unknown_month_timeline_never_enters_q1():
    engine = NewsroomEngine()
    engine.timeline = [{
        "id": "TL_NOMONTH",
        "year": 1368,
        "title": "仅系年事件",
        "description": "年内某事，月份不详。",
        "event_type": "dynasty",
        "severity": "major",
        "category": "dynasty",
        "location": {"province": "南直隶", "city": "应天府"},
    }]
    engine.disasters = []
    q1 = json.loads(engine.issue_to_json(
        engine.generate_issue(datetime(2026, 5, 15, tzinfo=TIMEZONE_CST), 3), pretty=False))
    assert q1["lead"] is None
    assert q1["articles"] == []
    assert q1["annual_events"] == []
    assert "仅系年事件" not in json.dumps(q1, ensure_ascii=False)


def test_sparse_quarter_allows_null_lead():
    data = _issue_data(16)
    assert data["period"]["label"] == "洪武1年第2季度"
    assert data["lead"] is None
    assert data["articles"] == []
    assert data["sections"] == {}
    assert data["annual_events"] == []


def test_multi_record_disaster_is_not_a_quarterly_event():
    data = _issue_data(16)
    assert data["lead"] is None
    assert "灾异志" not in data["sections"]
    assert "DIS_" not in json.dumps(data, ensure_ascii=False)


def test_annual_events_only_appear_in_q4_with_year_precision():
    engine = NewsroomEngine()
    engine.timeline = [{"id": "YEAR_ONLY", "year": 1368, "month": None, "title": "仅系年记录", "description": "月份不详。"}]
    engine.disasters = []
    q4 = json.loads(engine.issue_to_json(engine.generate_issue(datetime(2026, 5, 18, tzinfo=TIMEZONE_CST)), pretty=False))
    assert q4["period"]["label"] == "洪武1年第4季度"
    assert q4["annual_events"]
    for article in q4["annual_events"]:
        assert article["time_precision"] == "year"
        assert article["verification_status"] == "needs_review"
        assert article["section"] not in q4["sections"]
    for day in (15, 16, 17):
        earlier = json.loads(engine.issue_to_json(engine.generate_issue(datetime(2026, 5, day, tzinfo=TIMEZONE_CST)), pretty=False))
        assert earlier["annual_events"] == []


def test_next_real_day_generates_next_ming_quarter():
    engine = NewsroomEngine()
    same_day_issue = engine.generate_issue(datetime(2026, 5, 15, 18, tzinfo=TIMEZONE_CST), 3)
    same_day_data = json.loads(engine.issue_to_json(same_day_issue, pretty=False))
    assert same_day_data["date"]["ming_month"] == 1
    assert same_day_data["period"]["start_label"] == "洪武1年1月"
    assert same_day_data["period"]["end_label"] == "洪武1年3月"

    issue = engine.generate_issue(datetime(2026, 5, 16, tzinfo=TIMEZONE_CST), 3)
    data = json.loads(engine.issue_to_json(issue, pretty=False))

    assert data["date"]["ming_month"] == 4
    assert data["period"]["label"] == "洪武1年第2季度"
    assert data["period"]["start_label"] == "洪武1年4月"
    assert data["period"]["end_label"] == "洪武1年6月"
    assert "1 真实日对应 1 明朝季度" in data["editorial_note"]


def test_issue_schema_validation_accepts_generated_issue():
    engine = NewsroomEngine()
    data = generate_news.generate_issue_data(engine, datetime(2026, 5, 15, tzinfo=TIMEZONE_CST), 3)
    generate_news.validate_issue_data(data)


def test_window_must_be_standard_quarter():
    engine = NewsroomEngine()
    for bad in (2, 4, 6):
        try:
            engine.generate_issue(datetime(2026, 5, 15, tzinfo=TIMEZONE_CST), bad)
            returned = True
        except ValueError:
            returned = False
        assert returned is False


def test_editorial_quality_controls_apply():
    data = _issue_data(15)
    all_articles = _all_articles(data)
    assert data["lead"]["headline"] == "朱元璋称帝，建元洪武"
    assert all(a["section"] for a in all_articles)
    assert len({(a["section"], a["headline"]) for a in all_articles}) == len(all_articles)


if __name__ == "__main__":
    class TempPath:
        def __truediv__(self, name):
            import tempfile
            path = Path(tempfile.mkdtemp()) / name
            return path

    test_generate_standalone_html_removes_runtime_config_script(TempPath())
    test_write_issue_outputs_does_not_write_worker_static_data(TempPath())
    test_epoch_issue_reports_retrospective_digest_with_provenance()
    test_every_article_declares_editorial_contract_fields()
    test_timeline_causes_and_consequences_are_separated_not_guessed()
    test_no_generic_background_or_supplement_filler()
    test_generator_does_not_emit_rule_built_opinion()
    test_unknown_month_timeline_never_enters_q1()
    test_sparse_quarter_allows_null_lead()
    test_multi_record_disaster_is_not_a_quarterly_event()
    test_annual_events_only_appear_in_q4_with_year_precision()
    test_next_real_day_generates_next_ming_quarter()
    test_issue_schema_validation_accepts_generated_issue()
    test_window_must_be_standard_quarter()
    test_editorial_quality_controls_apply()
    print("\n✅ 报纸生成脚本测试通过")
