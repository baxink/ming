"""
明代科举制度查询

从 CBDB 的 ENTRY_DATA / ENTRY_CODES / OFFICE_CODES 提取科举体系。
"""
from typing import Optional
from src.data.db_manager import get_db

DB_NAME = "人物传记"

def _query(sql: str, params: tuple = ()) -> list[dict]:
    return get_db().query(DB_NAME, sql, params)

def _query_one(sql: str, params: tuple = ()) -> Optional[dict]:
    return get_db().query_one(DB_NAME, sql, params)

def _query_value(sql: str, params: tuple = ()):
    return get_db().query_value(DB_NAME, sql, params)

# === 人物科举 ===

def get_person_exams(person_id: int) -> list[dict]:
    """获取人物所有科举/入仕记录"""
    return _query("""
        SELECT ed.c_entry_code, ec.c_entry_desc_chn, ed.c_year, ed.c_exam_rank,
               ed.c_age, ed.c_notes
        FROM ENTRY_DATA ed
        JOIN ENTRY_CODES ec ON ed.c_entry_code = ec.c_entry_code
        WHERE ed.c_personid = ?
        ORDER BY ed.c_year
    """, (person_id,))

def get_person_highest_degree(person_id: int) -> Optional[dict]:
    """获取人物最高学位"""
    degrees = {
        36: "进士",  # jinshi (general)
        37: "进士(八行科)",
        124: "进士(国子监)",
        44: "武进士",
        39: "举人",   # juren
        47: "生员",   # 庠生
        311: "贡士",
        109: "贡生",
        110: "监生",
    }
    records = _query("""
        SELECT ed.c_entry_code, ec.c_entry_desc_chn, ed.c_year, ed.c_exam_rank
        FROM ENTRY_DATA ed
        JOIN ENTRY_CODES ec ON ed.c_entry_code = ec.c_entry_code
        WHERE ed.c_personid = ? AND ed.c_entry_code IN (36,37,44,124,39,47,311,109,110)
        ORDER BY CASE ed.c_entry_code WHEN 36 THEN 1 WHEN 37 THEN 2 WHEN 124 THEN 3 
            WHEN 44 THEN 4 WHEN 311 THEN 5 WHEN 39 THEN 6 WHEN 109 THEN 7 
            WHEN 110 THEN 8 WHEN 47 THEN 9 END
        LIMIT 1
    """, (person_id,))
    return records[0] if records else None

# === 科年查询 ===

def get_jinshi_by_year(year: int) -> list[dict]:
    """获取某年中进士者"""
    return _query("""
        SELECT bm.c_personid, bm.c_name_chn, bm.c_birthyear, ed.c_exam_rank
        FROM ENTRY_DATA ed
        JOIN BIOG_MAIN bm ON ed.c_personid = bm.c_personid
        WHERE ed.c_entry_code IN (36,37,124) AND ed.c_year = ?
        ORDER BY ed.c_exam_rank
    """, (year,))

def get_juren_by_year(year: int) -> list[dict]:
    """获取某年中举人者"""
    return _query("""
        SELECT bm.c_personid, bm.c_name_chn, bm.c_birthyear
        FROM ENTRY_DATA ed
        JOIN BIOG_MAIN bm ON ed.c_personid = bm.c_personid
        WHERE ed.c_entry_code = 39 AND ed.c_year = ?
        ORDER BY bm.c_name_chn
    """, (year,))

def get_exam_years() -> list[int]:
    """获取所有有进士的年份"""
    rows = _query("""
        SELECT DISTINCT ed.c_year FROM ENTRY_DATA ed
        JOIN BIOG_MAIN bm ON ed.c_personid = bm.c_personid
        WHERE ed.c_entry_code IN (36,37,124) 
        AND bm.c_index_year BETWEEN 1368 AND 1644
        AND ed.c_year >= 1368
        ORDER BY ed.c_year
    """)
    return [r['c_year'] for r in rows]

# === 统计 ===

def exam_stats() -> dict:
    return {
        "total_jinshi": _query_value("""
            SELECT COUNT(*) FROM ENTRY_DATA ed
            JOIN BIOG_MAIN bm ON ed.c_personid = bm.c_personid
            WHERE ed.c_entry_code IN (36,37,124) AND bm.c_index_year BETWEEN 1368 AND 1644
        """),
        "total_juren": _query_value("""
            SELECT COUNT(*) FROM ENTRY_DATA ed
            JOIN BIOG_MAIN bm ON ed.c_personid = bm.c_personid
            WHERE ed.c_entry_code = 39 AND bm.c_index_year BETWEEN 1368 AND 1644
        """),
        "total_shengyuan": _query_value("""
            SELECT COUNT(*) FROM ENTRY_DATA ed
            JOIN BIOG_MAIN bm ON ed.c_personid = bm.c_personid
            WHERE ed.c_entry_code IN (47,324,325,326) AND bm.c_index_year BETWEEN 1368 AND 1644
        """),
        "exam_years": len(get_exam_years()),
    }
