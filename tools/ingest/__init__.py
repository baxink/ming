"""
数据采集工具

负责从各数据源采集原始史料数据

API 密钥配置: 复制 .env.example 为 .env 并填入密钥
"""
import json
import os
from typing import Optional
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
from src.config import get_config, AppConfig


class DataIngestor:
    """通用数据采集器"""

    def __init__(self, output_dir: str):
        self.output_dir = output_dir
        os.makedirs(output_dir, exist_ok=True)

    def save_json(self, filename: str, data):
        path = os.path.join(self.output_dir, filename)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def load_json(self, filename: str) -> Optional[dict]:
        path = os.path.join(self.output_dir, filename)
        if not os.path.exists(path):
            return None
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)


class CBDBIngestor(DataIngestor):
    """CBDB (China Biographical Database) 数据采集器"""

    def __init__(self, output_dir: str = "data/processed/persons/"):
        super().__init__(output_dir)
        self.config = get_config().cbdb

    def check_available(self) -> bool:
        """检查 CBDB API 是否可达"""
        import urllib.request
        try:
            req = urllib.request.Request(self.config.api_url, method="HEAD")
            urllib.request.urlopen(req, timeout=10)
            return True
        except Exception:
            return False

    def download_dump(self):
        raise NotImplementedError("需手动下载 CBDB SQLite 数据库，参见 https://cbdb.fas.harvard.edu/")

    def query_person(self, name: str = "", limit: int = 10) -> Optional[list]:
        """通过 API 查询人物"""
        import urllib.request
        import urllib.parse
        params = urllib.parse.urlencode({"q": name, "limit": limit})
        url = f"{self.config.api_url}/persons?{params}"
        try:
            req = urllib.request.Request(url)
            if self.config.api_key:
                req.add_header("Authorization", f"Bearer {self.config.api_key}")
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read())
        except Exception as e:
            print(f"CBDB 查询失败: {e}")
            return None

    def parse_person_records(self, db_path: str) -> list[dict]:
        raise NotImplementedError("需连接 SQLite 数据库进行解析")


class CtextIngestor(DataIngestor):
    """中国哲学书电子化计划 (ctext.org) 数据采集器"""

    def __init__(self, output_dir: str = "data/raw/正史/"):
        super().__init__(output_dir)
        self.config = get_config().ctext

    def check_available(self) -> bool:
        import urllib.request
        try:
            req = urllib.request.Request(self.config.api_url or "https://ctext.org/", method="HEAD")
            urllib.request.urlopen(req, timeout=10)
            return True
        except Exception:
            return False

    def search_text(self, query: str) -> Optional[list]:
        """搜索文献"""
        import urllib.request
        import urllib.parse
        params = urllib.parse.urlencode({"q": query})
        url = f"{self.config.api_url}/search?{params}"
        try:
            req = urllib.request.Request(url)
            if self.config.api_key:
                req.add_header("Authorization", f"Bearer {self.config.api_key}")
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read())
        except Exception as e:
            print(f"ctext 查询失败: {e}")
            return None

    def fetch_text(self, ctext_urn: str) -> Optional[str]:
        raise NotImplementedError("ctext.org API 接口待对接")


def create_seed_timeline() -> list[dict]:
    """生成种子时间线数据"""
    return [
        {"year": 1368, "event": "朱元璋称帝，建元洪武，定都南京"},
        {"year": 1380, "event": "胡惟庸案，废中书省，罢丞相"},
        {"year": 1399, "event": "靖难之役爆发"},
        {"year": 1402, "event": "朱棣攻入南京，即位为帝"},
        {"year": 1405, "event": "郑和首次下西洋"},
        {"year": 1421, "event": "迁都北京"},
        {"year": 1449, "event": "土木之变，英宗被俘"},
        {"year": 1457, "event": "夺门之变，英宗复辟"},
        {"year": 1522, "event": "嘉靖即位，大礼议开始"},
        {"year": 1550, "event": "庚戌之变，俺答围北京"},
        {"year": 1567, "event": "隆庆开关，海禁稍弛"},
        {"year": 1572, "event": "万历即位，张居正任首辅"},
        {"year": 1573, "event": "张居正推行考成法"},
        {"year": 1581, "event": "一条鞭法全面推行"},
        {"year": 1582, "event": "张居正去世，遭清算"},
        {"year": 1592, "event": "壬辰倭乱，援朝抗倭"},
        {"year": 1616, "event": "努尔哈赤建立后金"},
        {"year": 1619, "event": "萨尔浒之战，明军大败"},
        {"year": 1628, "event": "崇祯即位，铲除魏忠贤"},
        {"year": 1644, "event": "李自成破北京，崇祯自缢，明亡"},
    ]
