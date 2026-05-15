"""
数据清洗工具

负责将原始史料数据清洗、标准化、结构化
"""
import re
from typing import Optional


def clean_person_name(name: str) -> str:
    """清洗人物姓名"""
    name = name.strip()
    name = re.sub(r'[（(].*?[）)]', '', name)
    return name


def extract_office_rank(text: str) -> Optional[str]:
    """从文本中提取品级信息"""
    rank_patterns = [
        r'正一品', r'从一品', r'正二品', r'从二品', r'正三品', r'从三品',
        r'正四品', r'从四品', r'正五品', r'从五品', r'正六品', r'从六品',
        r'正七品', r'从七品', r'正八品', r'从八品', r'正九品', r'从九品',
        r'未入流',
    ]
    for pattern in rank_patterns:
        if pattern in text:
            return pattern
    return None


def parse_year_from_text(text: str) -> Optional[int]:
    """从文本中提取年份"""
    match = re.search(r'(\d{4})年', text)
    if match:
        return int(match.group(1))

    ming_reigns = {
        '洪武': 1368, '建文': 1399, '永乐': 1403, '洪熙': 1424,
        '宣德': 1426, '正统': 1436, '景泰': 1450, '天顺': 1457,
        '成化': 1465, '弘治': 1488, '正德': 1506, '嘉靖': 1522,
        '隆庆': 1567, '万历': 1573, '泰昌': 1620, '天启': 1621,
        '崇祯': 1628,
    }

    for reign, base_year in ming_reigns.items():
        pattern = rf'{reign}.*?(\d+)年'
        match = re.search(pattern, text)
        if match:
            return base_year + int(match.group(1)) - 1

    return None


def normalize_region_name(name: str) -> str:
    """标准化地名"""
    name = name.strip()
    name = name.replace('等处承宣布政使司', '')
    name = name.replace('布政司', '')
    return name


def extract_relation(text: str) -> Optional[dict]:
    """从文本中提取人物关系"""
    relation_keywords = {
        '同乡': ['同乡', '同里', '同邑'],
        '同年': ['同年', '同榜', '同科'],
        '座主': ['座主', '座师', '主考'],
        '门生': ['门生', '门人', '学生', '受业'],
        '姻亲': ['姻亲', '妻父', '女婿', '连襟'],
    }

    for rel_type, keywords in relation_keywords.items():
        for kw in keywords:
            if kw in text:
                return {"type": rel_type, "raw_text": text}

    return None
