"""Targeted tests for the retrospective editorial generator contract.

These use synthetic records so the rules can be exercised without depending on
the shape of the shipped processed data (which must stay unchanged).

Verification rule under test: a clean parse with citations is NOT verification.
Only an input record that explicitly carries verification_status=="verified"
plus non-empty sources plus an explicit source_excerpt becomes historical_report.
"""
import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.newsroom import (  # noqa: E402
    NewsroomEngine,
    TIMEZONE_CST,
    _disaster_is_precise,
    _disaster_text,
    _distinct_months,
)

Q1 = datetime(2026, 5, 15, tzinfo=TIMEZONE_CST)   # 洪武1年1月
Q2 = datetime(2026, 5, 16, tzinfo=TIMEZONE_CST)   # 洪武1年4月
Q4 = datetime(2026, 5, 18, tzinfo=TIMEZONE_CST)   # 洪武1年10月


def make_engine(timeline=None, disasters=None):
    engine = NewsroomEngine()
    engine.timeline = timeline or []
    engine.disasters = disasters or []
    return engine


def issue_data(engine, when):
    return json.loads(engine.issue_to_json(engine.generate_issue(when, 3), pretty=False))


def articles_of(data):
    return ([data["lead"]] if data.get("lead") else []) + data["articles"]


def ai_eligible(data):
    return [
        a for a in articles_of(data)
        if a["content_type"] == "historical_report"
        and a["verification_status"] == "verified"
        and a["sources"]
        and a["source_excerpt"]
    ]


def legacy_clean_disaster(month_token="五月", location="某地"):
    return {
        "year": 1368,
        "reign": "明太祖洪武元年（1368年）",
        "disaster_type": "水灾",
        "location": location,
        "modern_location": "",
        "description": f"水灾{location}：{month_token}，大水，人多溺死。（《明史》卷28《五行一》）",
        "sources": ["五行一", "明史"],
    }


def timeline_event(**overrides):
    event = {
        "id": "TL_SYN",
        "year": 1368,
        "month": 1,
        "title": "合成史事",
        "description": "正月，某事发生。",
        "event_type": "dynasty",
        "severity": "critical",
        "category": "dynasty",
        "location": {"province": "南直隶", "city": "应天府"},
    }
    event.update(overrides)
    return event


def test_exact_month_tokens_do_not_read_november_as_january():
    assert _distinct_months("十一月，某事。") == {11}
    assert _distinct_months("一月，某事。") == {1}
    assert _distinct_months("十二月") == {12}
    assert _distinct_months("二月") == {2}
    assert _distinct_months("十月") == {10}


def test_contaminated_reign_field_is_not_used_for_month_matching():
    disaster = legacy_clean_disaster("五月")
    disaster["reign"] = "明太祖洪武元年（1368年）十一月"
    assert _disaster_is_precise(disaster)
    assert _distinct_months(_disaster_text(disaster)) == {5}


def test_clean_sourced_legacy_disaster_stays_needs_review_and_not_ai_eligible():
    engine = make_engine(disasters=[legacy_clean_disaster("五月")])
    data = issue_data(engine, Q2)
    report = next(a for a in articles_of(data) if a["id"].startswith("DIS_"))
    assert report["content_type"] == "historical_digest"
    assert report["verification_status"] == "needs_review"
    assert report["time_precision"] == "month"
    # The raw excerpt is preserved for transparency but must not verify anything.
    assert report["source_excerpt"]
    assert "大水，人多溺死" in report["source_excerpt"]
    assert "未经核验" in report["editorial_note"]
    assert ai_eligible(data) == []


def test_explicit_verified_disaster_becomes_report():
    disaster = legacy_clean_disaster("五月")
    disaster["verification_status"] = "verified"
    disaster["source_excerpt"] = "《明史·五行一》五月，大水。"
    engine = make_engine(disasters=[disaster])
    data = issue_data(engine, Q2)
    report = next(a for a in articles_of(data) if a["id"].startswith("DIS_"))
    assert report["content_type"] == "historical_report"
    assert report["verification_status"] == "verified"
    assert report["time_precision"] == "month"
    assert report["sources"] == ["五行一", "明史"]
    assert report["source_excerpt"] == "《明史·五行一》五月，大水。"
    assert len(ai_eligible(data)) == 1


def test_verified_requires_explicit_source_excerpt():
    disaster = legacy_clean_disaster("五月")
    disaster["verification_status"] = "verified"
    engine = make_engine(disasters=[disaster])
    data = issue_data(engine, Q2)
    report = next(a for a in articles_of(data) if a["id"].startswith("DIS_"))
    assert report["verification_status"] == "needs_review"
    assert report["content_type"] == "historical_digest"


def test_explicit_verified_timeline_becomes_report():
    event = timeline_event(
        verification_status="verified",
        sources=["明史·太祖本纪"],
        source_excerpt="洪武元年正月，朱元璋即皇帝位。",
    )
    engine = make_engine(timeline=[event])
    data = issue_data(engine, Q1)
    lead = data["lead"]
    assert lead["content_type"] == "historical_report"
    assert lead["verification_status"] == "verified"
    assert lead["time_precision"] == "month"
    assert lead["sources"] == ["明史·太祖本纪"]
    assert lead["source_excerpt"] == "洪武元年正月，朱元璋即皇帝位。"
    assert lead["byline"] == ""


def test_timeline_verification_requires_sources_and_excerpt():
    for overrides in (
        {"verification_status": "verified", "source_excerpt": "excerpt"},              # no sources
        {"verification_status": "verified", "sources": ["明史·太祖本纪"]},              # no excerpt
        {"sources": ["明史·太祖本纪"], "source_excerpt": "excerpt"},                    # not asserted
    ):
        engine = make_engine(timeline=[timeline_event(**overrides)])
        lead = issue_data(engine, Q1)["lead"]
        assert lead["content_type"] == "historical_digest"
        assert lead["verification_status"] == "needs_review"


def test_multi_record_disaster_is_quarantined_not_smeared_per_quarter():
    disaster = {
        "year": 1368,
        "reign": "明太祖洪武元年（1368年）",
        "disaster_type": "水灾",
        "location": "甲地",
        "modern_location": "",
        "description": (
            "水灾1.甲地：五月，大水，人多溺死。（《明史》卷28《五行一》）"
            "2.乙地：七月，大水。（《明史》卷28《五行一》）"
        ),
        "sources": ["五行一", "明史"],
    }
    assert not _disaster_is_precise(disaster)
    engine = make_engine(disasters=[disaster])
    q2 = issue_data(engine, Q2)
    assert q2["lead"] is None
    assert "灾异志" not in q2["sections"]
    assert "DIS_" not in json.dumps(q2, ensure_ascii=False)

    q4 = issue_data(engine, Q4)
    pending = [a for a in q4["annual_events"] if a["id"].startswith("DIS_")]
    assert pending == []


def test_dangling_source_disaster_is_not_a_precise_event():
    truncated = legacy_clean_disaster("五月")
    truncated["description"] = "水灾某地：五月，大水，人多溺死。（《明史》卷28《"
    assert not _disaster_is_precise(truncated)
    assert issue_data(make_engine(disasters=[truncated]), Q4)["annual_events"] == []


def test_sourced_pending_timeline_preserves_editorial_caution():
    event = timeline_event(sources=["二手资料位置"], source_excerpt="摘录", editorial_note="未校核原本。")
    lead = issue_data(make_engine(timeline=[event]), Q1)["lead"]
    assert "未校核原本" in lead["editorial_note"]
    assert "未附史源" not in lead["editorial_note"]
    assert lead["source_excerpt"] == "摘录"


def test_event_type_classifies_specific_exam_and_appointment_records():
    for event_type, section in (("examination", "科举文教"), ("appointment", "人事任免")):
        event = timeline_event(event_type=event_type, category="institutional")
        assert issue_data(make_engine(timeline=[event]), Q1)["lead"]["section"] == section


def test_duplicate_excerpt_prefers_explicitly_verified_record():
    excerpt = "正月，某地发生水灾，地方有司奏报后朝廷命发仓粮赈济灾民。"
    pending = timeline_event(id="PENDING", title="待核标题", sources=["出处"], source_excerpt=excerpt)
    verified = timeline_event(id="VERIFIED", title="核验标题", sources=["出处"], source_excerpt=excerpt, verification_status="verified")
    data = issue_data(make_engine(timeline=[pending, verified]), Q1)
    assert [article["id"] for article in articles_of(data)] == ["VERIFIED"]


def test_unsourced_known_month_disaster_is_not_called_month_unknown():
    disaster = legacy_clean_disaster("十一月")
    disaster["sources"] = []
    data = issue_data(make_engine(disasters=[disaster]), Q4)
    assert data["lead"] is None
    assert data["annual_events"] == []


def test_balanced_but_truncated_disaster_is_not_published():
    disaster = legacy_clean_disaster("三月")
    disaster["description"] = "地震安县（今四川安县）三月戊寅，成都府安县"
    engine = make_engine(disasters=[disaster])
    assert issue_data(engine, Q1)["lead"] is None
    assert issue_data(engine, Q4)["annual_events"] == []


def test_complete_unknown_month_disaster_remains_annual_pending():
    disaster = legacy_clean_disaster()
    disaster["description"] = "某地水灾，记载未详月份。"
    data = issue_data(make_engine(disasters=[disaster]), Q4)
    assert len(data["annual_events"]) == 1
    assert data["annual_events"][0]["time_precision"] == "year"


def test_unknown_month_timeline_only_lists_in_q4_annual_events():
    event = timeline_event(id="TL_NOMONTH", title="仅系年事件", description="年内某事，月份不详。")
    event.pop("month", None)
    engine = make_engine(timeline=[event])
    q1 = issue_data(engine, Q1)
    assert q1["lead"] is None
    assert q1["annual_events"] == []

    q4 = issue_data(engine, Q4)
    annual = [a for a in q4["annual_events"] if a["id"] == "TL_NOMONTH"]
    assert len(annual) == 1
    assert annual[0]["time_precision"] == "year"
    assert annual[0]["verification_status"] == "needs_review"
    assert "月份不详" in annual[0]["editorial_note"]
    assert all((a or {}).get("id") != "TL_NOMONTH" for a in [q4["lead"]] + q4["articles"])
    assert "TL_NOMONTH" not in json.dumps(q4["sections"], ensure_ascii=False)


def test_all_unknown_month_items_are_preserved_in_q4():
    events = [
        timeline_event(id=f"TL_NM_{i}", title=f"仅系年{i}", description="月份不详。")
        for i in range(3)
    ]
    for event in events:
        event.pop("month", None)
    engine = make_engine(timeline=events)
    annual_ids = {a["id"] for a in issue_data(engine, Q4)["annual_events"]}
    assert {"TL_NM_0", "TL_NM_1", "TL_NM_2"} <= annual_ids


def test_annual_verified_input_preserves_verification_but_not_quarter_placement():
    event = timeline_event(
        id="TL_ANNUAL_VERIFIED",
        verification_status="verified",
        sources=["明史·太祖本纪"],
        source_excerpt="洪武元年，某事。",
    )
    event.pop("month", None)
    engine = make_engine(timeline=[event])
    annual = issue_data(engine, Q4)["annual_events"]
    assert annual[0]["content_type"] == "historical_report"
    assert annual[0]["verification_status"] == "verified"
    assert annual[0]["time_precision"] == "year"
    assert ai_eligible(issue_data(engine, Q4)) == []


def test_precise_timeline_month_is_pending_record_under_its_category():
    engine = make_engine(timeline=[timeline_event(id="TL_MONTH", title="正月事件")])
    data = issue_data(engine, Q1)
    lead = data["lead"]
    assert lead["id"] == "TL_MONTH"
    assert lead["content_type"] == "historical_digest"
    assert lead["verification_status"] == "needs_review"
    assert lead["time_precision"] == "month"
    assert "未附史源" in lead["editorial_note"]


def test_non_standard_window_is_rejected():
    engine = make_engine()
    for bad in (1, 2, 4, 6):
        try:
            engine.generate_issue(Q1, bad)
            raised = False
        except ValueError:
            raised = True
        assert raised, f"window {bad} should be rejected"
    try:
        engine.get_events_in_period(1368, 1, 2)
        raised = False
    except ValueError:
        raised = True
    assert raised


if __name__ == "__main__":
    test_exact_month_tokens_do_not_read_november_as_january()
    test_contaminated_reign_field_is_not_used_for_month_matching()
    test_clean_sourced_legacy_disaster_stays_needs_review_and_not_ai_eligible()
    test_explicit_verified_disaster_becomes_report()
    test_verified_requires_explicit_source_excerpt()
    test_explicit_verified_timeline_becomes_report()
    test_timeline_verification_requires_sources_and_excerpt()
    test_multi_record_disaster_is_quarantined_not_smeared_per_quarter()
    test_dangling_source_disaster_is_not_a_precise_event()
    test_unknown_month_timeline_only_lists_in_q4_annual_events()
    test_all_unknown_month_items_are_preserved_in_q4()
    test_annual_verified_input_preserves_verification_but_not_quarter_placement()
    test_precise_timeline_month_is_pending_record_under_its_category()
    test_non_standard_window_is_rejected()
    print("\n✅ 编辑生成器定向测试通过")
