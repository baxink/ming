#!/usr/bin/env python3
"""
大明新闻季报 — 报纸生成脚本

用法:
    python generate_news.py                    # 生成今日报纸
    python generate_news.py --date 2026-06-01  # 生成指定日期报纸
    python generate_news.py --standalone       # 生成本地独立 HTML 预览
    python generate_news.py --serve            # 启动本地服务器预览 web/

输出:
    web/data/issue.json    — 本地预览数据 JSON（线上前端默认读取 Worker API）
    web/standalone.html    — 本地独立 HTML 预览（不提交）
"""
import sys
import os
import json
import argparse
from datetime import datetime, timezone, timedelta
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

from jsonschema import Draft7Validator

TIMEZONE_CST = timezone(timedelta(hours=8))

sys.path.insert(0, os.path.dirname(__file__))
from src.newsroom import NewsroomEngine, TIMEZONE_CST as NZ_CST
from src.world.time import real_time_status


def parse_date(date_str: str) -> datetime:
    fmts = ["%Y-%m-%d", "%Y/%m/%d", "%Y%m%d"]
    for f in fmts:
        try:
            return datetime.strptime(date_str, f).replace(tzinfo=TIMEZONE_CST)
        except ValueError:
            continue
    raise ValueError(f"无法解析日期: {date_str}")


def generate_issue_data(engine: NewsroomEngine, now: datetime,
                         window_months: int = 3) -> dict:
    issue = engine.generate_issue(now, window_months)
    data = json.loads(engine.issue_to_json(issue, pretty=False))
    return data


def validate_issue_data(data: dict, schema_path: str | None = None):
    if schema_path is None:
        schema_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schemas", "issue.schema.json")

    with open(schema_path, "r", encoding="utf-8") as f:
        schema = json.load(f)

    validator = Draft7Validator(schema)
    errors = sorted(validator.iter_errors(data), key=lambda e: list(e.path))
    if errors:
        first = errors[0]
        path = ".".join(str(p) for p in first.path) or "<root>"
        raise ValueError(f"issue.json 不符合 schema: {path}: {first.message}") from first

    total_articles = len(data.get("articles", [])) + (1 if data.get("lead") else 0)
    if total_articles == 0:
        raise ValueError("issue.json 至少需要一篇文章或头条")

    sections = data.get("sections", {})
    article_ids = {a.get("id") for a in data.get("articles", []) if isinstance(a, dict)}
    for section_name, items in sections.items():
        if not isinstance(items, list):
            raise ValueError(f"issue.json sections.{section_name} 必须是数组")
        for item in items:
            if isinstance(item, dict) and item.get("id") not in article_ids:
                raise ValueError(f"sections.{section_name} 含有未同步到 articles 的文章: {item.get('id')}")

    print(f"  ✓ issue.json schema 校验通过: {os.path.relpath(schema_path, os.path.dirname(os.path.abspath(__file__)))}")


def write_json(data: dict, path: str):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"  ✓ JSON 数据写入: {path}")


def write_issue_outputs(data: dict, out_dir: str, base_dir: str):
    web_json_path = os.path.join(out_dir, "data", "issue.json")
    write_json(data, web_json_path)


def serve_directory(directory: str, port: int):
    handler = lambda *args, **kwargs: SimpleHTTPRequestHandler(*args, directory=directory, **kwargs)
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    print(f"\n  🌐 本地预览: http://127.0.0.1:{port}/")
    print("  按 Ctrl+C 停止服务")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  已停止本地预览服务")
    finally:
        server.server_close()


def generate_standalone_html(data: dict, output_path: str):
    script_dir = os.path.dirname(os.path.abspath(__file__))
    html_path = os.path.join(script_dir, "web", "template.html")
    css_path = os.path.join(script_dir, "web", "css", "style.css")
    js_path = os.path.join(script_dir, "web", "js", "news.js")

    with open(html_path, "r", encoding="utf-8") as f:
        html = f.read()

    with open(css_path, "r", encoding="utf-8") as f:
        css = f.read()

    with open(js_path, "r", encoding="utf-8") as f:
        js = f.read()

    json_data = json.dumps(data, ensure_ascii=False)

    html = html.replace('<link rel="stylesheet" href="css/style.css">',
                         f'<style>\n{css}\n</style>')

    html = html.replace('<script src="config.js"></script>\n', '')

    html = html.replace('<script src="js/news.js"></script>',
                         f'<script>\nwindow.__MING_ISSUE__ = {json_data};\n{js}\n</script>')

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"  ✓ 独立 HTML 写入: {output_path}")


def print_status(data: dict):
    d = data["date"]
    print(f"""
╔══════════════════════════════════════╗
║       大 明 新 闻 季 报              ║
║       THE MING POST                  ║
╠══════════════════════════════════════╣
║ 真实时间 : {d['real_date']:<25} ║
║ 明朝时间 : {d['ming_reign']}{d['ming_year']}年{d['ming_month']}月 ({d['season']}季){'':<10} ║
║ 当期季度 : {data['period']['label']:<25} ║
║ 时间范围 : {data['period']['start_label']}—{data['period']['end_label']:<11} ║
║ 皇帝     : {d['emperor']:<25} ║
║ 文章数   : {(len(data['articles']) + (1 if data.get('lead') else 0)):<25} ║
╚══════════════════════════════════════╝
""")


def main():
    parser = argparse.ArgumentParser(description="大明新闻季报 — 报纸生成器")
    parser.add_argument("--date", type=str, default=None,
                        help="指定真实日期 (YYYY-MM-DD)，默认为今天")
    parser.add_argument("--window", type=int, default=3,
                        help="时间窗口（月），默认 3 个月（一个季度）")
    parser.add_argument("--output", type=str, default=None,
                        help="自定义输出目录（默认 web/）")
    parser.add_argument("--standalone", action="store_true",
                        help="额外生成 web/standalone.html 单文件预览")
    parser.add_argument("--serve", action="store_true",
                        help="启动 web/ 的本地静态服务器预览")
    parser.add_argument("--port", type=int, default=4173,
                        help="本地预览端口，默认 4173")
    parser.add_argument("--status", action="store_true",
                        help="仅显示当前时间状态")
    args = parser.parse_args()

    base_dir = os.path.dirname(os.path.abspath(__file__))
    out_dir = args.output or os.path.join(base_dir, "web")

    if args.status:
        status = real_time_status()
        print(json.dumps(status, ensure_ascii=False, indent=2))
        return

    now = parse_date(args.date) if args.date else datetime.now(TIMEZONE_CST)

    print(f"📰 大明新闻季报 · 报纸生成器")
    print(f"   真实时间: {now.strftime('%Y-%m-%d %H:%M %Z')}")
    print(f"   时间窗口: {args.window} 个月")

    engine = NewsroomEngine()
    data = generate_issue_data(engine, now, args.window)
    validate_issue_data(data)

    print_status(data)

    write_issue_outputs(data, out_dir, base_dir)

    preview_path = os.path.join(out_dir, "index.html")
    if args.standalone:
        standalone_path = os.path.join(out_dir, "standalone.html")
        generate_standalone_html(data, standalone_path)
        preview_path = standalone_path

    print(f"\n  🔗 浏览器打开: file://{preview_path}")

    print(f"\n  ✅ 报纸生成完成。")

    if args.serve:
        serve_directory(out_dir, args.port)


if __name__ == "__main__":
    main()
