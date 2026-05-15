import json
from pathlib import Path
import sys
from datetime import datetime

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import generate_news
from src.newsroom import NewsroomEngine, TIMEZONE_CST


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


def test_generate_issue_has_minimum_articles():
    engine = NewsroomEngine()
    issue = engine.generate_issue(datetime(2026, 5, 15, tzinfo=TIMEZONE_CST), 3)
    data = json.loads(engine.issue_to_json(issue, pretty=False))
    total_articles = len(data["articles"]) + (1 if data.get("lead") else 0)
    assert total_articles >= 8
    assert data["period"]["label"] == "洪武1年第1季度"


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


def test_supplementary_articles_are_era_aware():
    engine = NewsroomEngine()
    issue = engine.generate_issue(datetime(2026, 5, 15, tzinfo=TIMEZONE_CST), 3)
    text = json.dumps(json.loads(engine.issue_to_json(issue, pretty=False)), ensure_ascii=False)
    assert "开国整饬期" in text
    assert "黄册" in text or "鱼鳞图册" in text


def test_quarterly_issue_does_not_read_like_no_news():
    engine = NewsroomEngine()
    issue = engine.generate_issue(datetime(2026, 5, 18, tzinfo=TIMEZONE_CST), 3)
    data = json.loads(engine.issue_to_json(issue, pretty=False))
    text = json.dumps(data, ensure_ascii=False)

    assert len(data["articles"]) + (1 if data.get("lead") else 0) >= 6
    for phrase in ["史料稀疏", "未见", "暂无", "不足时", "无明确月份"]:
        assert phrase not in text


def test_editorial_quality_controls_apply():
    engine = NewsroomEngine()
    issue = engine.generate_issue(datetime(2026, 5, 15, tzinfo=TIMEZONE_CST), 3)
    data = json.loads(engine.issue_to_json(issue, pretty=False))
    all_articles = ([data["lead"]] if data.get("lead") else []) + data["articles"]
    assert data["lead"]["headline"] == "朱元璋称帝，建元洪武"
    assert all(a["section"] for a in all_articles)
    assert len({(a["section"], a["headline"]) for a in all_articles}) == len(all_articles)
    assert len(data["sections"].get("朝政要闻", [])) <= 3


if __name__ == "__main__":
    class TempPath:
        def __truediv__(self, name):
            import tempfile
            path = Path(tempfile.mkdtemp()) / name
            return path

    test_generate_standalone_html_removes_runtime_config_script(TempPath())
    test_generate_issue_has_minimum_articles()
    test_next_real_day_generates_next_ming_quarter()
    test_issue_schema_validation_accepts_generated_issue()
    test_supplementary_articles_are_era_aware()
    test_quarterly_issue_does_not_read_like_no_news()
    test_editorial_quality_controls_apply()
    print("✓ 独立 HTML 生成会移除运行时配置脚本")
    print("✓ 季报生成达到最低文章数")
    print("✓ 季报 JSON 通过 schema 校验")
    print("✓ 补稿内容已按朝代阶段生成")
    print("✓ 编辑质量控制已生效")
    print("\n✅ 报纸生成脚本测试通过")
