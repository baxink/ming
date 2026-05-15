"""
CBDB (China Biographical Database) 查询接口

基于本地 SQLite 数据库，提供明代人物、官职、关系、地理等结构化查询。
数据库路径由 DatabaseManager 管理，CBDB 注册名为 "人物传记"。

注意：CBDB 使用繁体中文存储，查询时自动处理繁简转换。
"""
import os
from typing import Optional
from src.data.db_manager import get_db


DB_NAME = "人物传记"

_S2T_MAP = None


def _load_s2t():
    """加载简繁映射表（基于 CBDB 内置的常用字映射）"""
    global _S2T_MAP
    if _S2T_MAP is not None:
        return _S2T_MAP
    _S2T_MAP = {}
    pairs = [
        ("张", "張"), ("刘", "劉"), ("赵", "趙"), ("钱", "錢"), ("孙", "孫"),
        ("李", "李"), ("周", "周"), ("吴", "吳"), ("郑", "鄭"), ("王", "王"),
        ("冯", "馮"), ("陈", "陳"), ("褚", "褚"), ("卫", "衛"), ("蒋", "蔣"),
        ("沈", "沈"), ("韩", "韓"), ("杨", "楊"), ("朱", "朱"), ("秦", "秦"),
        ("许", "許"), ("何", "何"), ("吕", "呂"), ("施", "施"), ("严", "嚴"),
        ("华", "華"), ("金", "金"), ("魏", "魏"), ("陶", "陶"), ("姜", "姜"),
        ("谢", "謝"), ("邹", "鄒"), ("苏", "蘇"), ("潘", "潘"), ("范", "范"),
        ("彭", "彭"), ("鲁", "魯"), ("马", "馬"), ("方", "方"), ("袁", "袁"),
        ("柳", "柳"), ("史", "史"), ("唐", "唐"), ("薛", "薛"), ("雷", "雷"),
        ("贺", "賀"), ("罗", "羅"), ("黄", "黃"), ("萧", "蕭"), ("姚", "姚"),
        ("于", "于"), ("叶", "葉"), ("邓", "鄧"), ("卢", "盧"), ("郭", "郭"),
        ("丁", "丁"), ("程", "程"), ("蔡", "蔡"), ("贾", "賈"), ("林", "林"),
        ("徐", "徐"), ("胡", "胡"), ("高", "高"), ("梁", "梁"), ("宋", "宋"),
        ("董", "董"), ("段", "段"), ("顾", "顧"), ("侯", "侯"), ("孟", "孟"),
        ("田", "田"), ("任", "任"), ("乔", "喬"), ("谭", "譚"), ("文", "文"),
        ("万", "萬"), ("汤", "湯"), ("陆", "陸"), ("武", "武"), ("夏", "夏"),
        ("毛", "毛"), ("汪", "汪"), ("龙", "龍"), ("关", "關"), ("蓝", "藍"),
        ("曾", "曾"), ("余", "余"), ("钟", "鍾"), ("孔", "孔"), ("白", "白"),
        ("齐", "齊"), ("廖", "廖"), ("聂", "聶"), ("常", "常"),
        ("阮", "阮"), ("尹", "尹"), ("易", "易"), ("石", "石"), ("崔", "崔"),
        ("康", "康"), ("赖", "賴"), ("阎", "閻"), ("颜", "顏"), ("欧", "歐"),
        ("裴", "裴"), ("翁", "翁"), ("游", "游"), ("温", "溫"), ("葛", "葛"),
        ("戚", "戚"), ("海", "海"), ("解", "解"), ("沐", "沐"), ("牛", "牛"),
        ("阳", "陽"), ("阶", "階"), ("继", "繼"), ("严", "嚴"),
        ("卫", "衛"), ("门", "門"), ("义", "義"), ("书", "書"),
        ("东", "東"), ("尔", "爾"), ("乐", "樂"), ("冈", "岡"),
        ("仑", "侖"), ("仓", "倉"), ("仪", "儀"), ("风", "風"),
        ("巩", "鞏"), ("执", "執"), ("扩", "擴"), ("扫", "掃"),
        ("扬", "揚"), ("尧", "堯"), ("毕", "畢"), ("贞", "貞"),
        ("则", "則"), ("刚", "剛"), ("伦", "倫"), ("伪", "偽"),
        ("会", "會"), ("杀", "殺"), ("爷", "爺"), ("负", "負"),
        ("壮", "壯"), ("冲", "衝"), ("妆", "妝"), ("兴", "興"),
        ("军", "軍"), ("农", "農"), ("寻", "尋"), ("导", "導"),
        ("尽管", "儘管"), ("孙", "孫"), ("寿", "壽"),
        ("违", "違"), ("运", "運"), ("还", "還"), ("进", "進"),
        ("远", "遠"), ("极", "極"), ("劳", "勞"), ("严", "嚴"),
        ("两", "兩"), ("丽", "麗"), ("来", "來"), ("时", "時"),
        ("县", "縣"), ("里", "裏"), ("园", "園"), ("围", "圍"),
        ("坚", "堅"), ("迟", "遲"), ("张", "張"), ("陆", "陸"),
        ("际", "際"), ("鸡", "鷄"), ("麦", "麥"), ("备", "備"),
        ("变", "變"), ("实", "實"), ("审", "審"), ("帘", "簾"),
        ("詩", "诗"), ("诚", "誠"), ("话", "話"), ("肃", "肅"),
        ("录", "録"), ("隶", "隸"), ("参", "參"), ("艰", "艱"),
        ("经", "經"), ("贯", "貫"), ("赵", "趙"), ("荣", "榮"),
        ("带", "帶"), ("胡", "鬍"), ("南", "南"), ("药", "藥"),
        ("标", "標"), ("树", "樹"), ("咸", "鹹"), ("面", "麵"),
        ("牵", "牽"), ("战", "戰"), ("临", "臨"), ("尝", "嘗"),
        ("显", "顯"), ("贵", "貴"), ("虽", "雖"), ("响", "響"),
        ("峡", "峽"), ("勋", "勳"), ("钦", "欽"), ("钩", "鈎"),
        ("选", "選"), ("适", "適"), ("种", "種"), ("复", "復"),
        ("顺", "順"), ("修", "脩"), ("俊", "儁"), ("须", "鬚"),
        ("剑", "劍"), ("独", "獨"), ("狱", "獄"), ("贸", "貿"),
        ("奖", "奬"), ("将", "將"), ("总", "總"), ("炼", "煉"),
        ("觉", "覺"), ("宪", "憲"), ("举", "舉"), ("宫", "宮"),
        ("窃", "竊"), ("语", "語"), ("说", "說"), ("误", "誤"),
        ("诵", "誦"), ("垦", "墾"), ("昼", "晝"), ("费", "費"),
        ("逊", "遜"), ("绝", "絕"), ("统", "統"), ("蚕", "蠶"),
        ("盐", "鹽"), ("聂", "聶"), ("获", "獲"), ("恶", "惡"),
        ("桥", "橋"), ("档", "檔"), ("样", "樣"), ("毙", "斃"),
        ("钱", "錢"), ("铁", "鐵"), ("牺", "犧"), ("敌", "敵"),
        ("积", "積"), ("称", "稱"), ("笔", "筆"), ("笋", "筍"),
        ("债", "債"), ("爱", "愛"), ("胶", "膠"), ("脑", "腦"),
        ("脏", "臟"), ("牺", "犧"), ("留", "留"), ("验", "驗"),
        ("继", "繼"), ("职", "職"), ("梦", "夢"), ("硕", "碩"),
        ("据", "據"), ("悬", "懸"), ("跃", "躍"), ("铜", "銅"),
        ("铳", "銃"), ("银", "銀"), ("矫", "矯"), ("秽", "穢"),
        ("笼", "籠"), ("偿", "償"), ("盘", "盤"), ("衅", "釁"),
        ("领", "領"), ("脚", "腳"), ("脸", "臉"), ("猎", "獵"),
        ("馆", "館"), ("减", "減"), ("凑", "湊"), ("湿", "濕"),
        ("溃", "潰"), ("溅", "濺"), ("湾", "灣"), ("游", "遊"),
        ("愤", "憤"), ("窜", "竄"), ("窝", "窩"), ("窗", "窻"),
        ("裤", "褲"), ("谢", "謝"), ("谦", "謙"), ("属", "屬"),
        ("屡", "屢"), ("强", "強"), ("缘", "緣"), ("编", "編"),
        ("摄", "攝"), ("填", "填"), ("摆", "擺"), ("摊", "攤"),
        ("鉴", "鑒"), ("辞", "辭"), ("筹", "籌"), ("签", "簽"),
        ("简", "簡"), ("毁", "毀"), ("触", "觸"), ("解", "解"),
        ("酱", "醬"), ("韵", "韻"), ("谨", "謹"), ("叠", "曡"),
        ("缚", "縛"), ("缝", "縫"), ("静", "靜"), ("愿", "願"),
        ("颗", "顆"), ("蜡", "蠟"), ("稳", "穩"), ("签", "籤"),
        ("鲜", "鮮"), ("端", "耑"), ("旗", "旂"), ("谱", "譜"),
        ("凳", "櫈"), ("撑", "撐"), ("聪", "聰"), ("霉", "黴"),
        ("题", "題"), ("颜", "顏"), ("额", "額"), ("翻", "繙"),
        ("鹰", "鷹"), ("赞", "贊"), ("簿", "簙"), ("籍", "籍"),
        ("霸", "覇"), ("鉴", "鑑"), ("钥", "鑰"), ("滩", "灘"),
        ("盐", "盬"), ("岭", "嶺"),
    ]
    for s, t in pairs:
        _S2T_MAP[s] = t
    return _S2T_MAP


def _to_traditional(name: str) -> str:
    """简体中文姓名转繁体"""
    _load_s2t()
    return "".join(_S2T_MAP.get(c, c) for c in name)


def _query(sql: str, params: tuple = ()) -> list[dict]:
    return get_db().query(DB_NAME, sql, params)


def _query_one(sql: str, params: tuple = ()) -> Optional[dict]:
    return get_db().query_one(DB_NAME, sql, params)


def _query_value(sql: str, params: tuple = ()):
    return get_db().query_value(DB_NAME, sql, params)


_SQLITE_FTS_AVAILABLE = None


def _ensure_fts():
    """确保 FTS5 全文索引可用（按需创建）"""
    global _SQLITE_FTS_AVAILABLE
    if _SQLITE_FTS_AVAILABLE is not None:
        return _SQLITE_FTS_AVAILABLE
    try:
        db = get_db()
        db.execute(DB_NAME, """
            CREATE VIRTUAL TABLE IF NOT EXISTS BIOG_MAIN_FTS USING fts5(
                c_name_chn, c_name, c_surname_chn, c_mingzi_chn,
                content=BIOG_MAIN, content_rowid=c_personid
            )
        """)
        db.execute(DB_NAME, "INSERT INTO BIOG_MAIN_FTS(BIOG_MAIN_FTS) VALUES('rebuild')")
        _SQLITE_FTS_AVAILABLE = True
    except Exception:
        _SQLITE_FTS_AVAILABLE = False
    return _SQLITE_FTS_AVAILABLE


# === 人物基础查询 ===

def search_person(name: str, limit: int = 20) -> list[dict]:
    """按姓名搜索人物（支持简体/繁体/字号输入）"""
    trad = _to_traditional(name)

    # 精确匹配优先
    exact = _query(
        """SELECT c_personid, c_name_chn, c_birthyear, c_deathyear, c_index_year,
                  c_female, c_surname_chn, c_mingzi_chn
           FROM BIOG_MAIN
           WHERE c_name_chn = ? OR c_name_chn = ?
           LIMIT ?""",
        (name, trad, limit),
    )

    # 模糊匹配（姓名包含）
    fuzzy = _query(
        """SELECT c_personid, c_name_chn, c_birthyear, c_deathyear, c_index_year,
                  c_female, c_surname_chn, c_mingzi_chn
           FROM BIOG_MAIN
           WHERE (c_name_chn LIKE ? OR c_name_chn LIKE ?)
             AND c_personid NOT IN (SELECT c_personid FROM BIOG_MAIN WHERE c_name_chn = ? OR c_name_chn = ?)
           ORDER BY c_index_year
           LIMIT ?""",
        (f"%{trad}%", f"%{name}%", name, trad, limit),
    )

    results = exact + fuzzy

    # 字号/别名搜索（同时搜索全名和仅名字部分）
    # 提取名字部分（去姓）：如果输入含常见单/双姓，尝试分离
    surname_candidates = ["欧阳", "司马", "上官", "诸葛", "慕容"]
    given_name = name
    for s in surname_candidates:
        if name.startswith(s):
            given_name = name[len(s):]
            break
    if given_name == name and len(name) >= 2:
        given_name = name[1:] if len(name) <= 3 else name

    given_trad = _to_traditional(given_name)

    alt = _query(
        """SELECT DISTINCT bm.c_personid, bm.c_name_chn, bm.c_birthyear, bm.c_deathyear,
                bm.c_index_year, bm.c_female
           FROM ALTNAME_DATA ad
           JOIN BIOG_MAIN bm ON ad.c_personid = bm.c_personid
           WHERE ad.c_alt_name_chn LIKE ? OR ad.c_alt_name_chn LIKE ?
              OR ad.c_alt_name_chn LIKE ? OR ad.c_alt_name_chn LIKE ?
           LIMIT ?""",
        (f"%{trad}%", f"%{name}%", f"%{given_trad}%", f"%{given_name}%", limit),
    )
    existing_ids = {r["c_personid"] for r in results}
    for r in alt:
        if r["c_personid"] not in existing_ids:
            results.append(r)

    return results[:limit]


def get_person(person_id: int) -> Optional[dict]:
    """获取人物完整基本信息"""
    return _query_one(
        """SELECT c_personid, c_name_chn, c_name, c_birthyear, c_deathyear,
                  c_index_year, c_female, c_surname_chn, c_mingzi_chn,
                  c_by_nh_code, c_by_nh_year, c_dy_nh_code, c_dy_nh_year,
                  c_death_age, c_notes
           FROM BIOG_MAIN
           WHERE c_personid = ?""",
        (person_id,),
    )


def get_person_basic(person_id: int) -> Optional[dict]:
    """获取人物简要信息（姓名、生卒年）"""
    return _query_one(
        "SELECT c_personid, c_name_chn, c_birthyear, c_deathyear, c_index_year FROM BIOG_MAIN WHERE c_personid = ?",
        (person_id,),
    )


def search_ming_people(limit: int = 100, offset: int = 0) -> list[dict]:
    """查询明代人物（按 index_year 在 1368-1644 范围）"""
    return _query(
        """SELECT c_personid, c_name_chn, c_birthyear, c_deathyear, c_index_year
           FROM BIOG_MAIN
           WHERE c_index_year BETWEEN 1368 AND 1644 AND c_name_chn != ''
           ORDER BY c_index_year
           LIMIT ? OFFSET ?""",
        (limit, offset),
    )


def search_people_by_year_range(start_year: int, end_year: int, limit: int = 100) -> list[dict]:
    """按活跃年份范围搜索人物"""
    return _query(
        """SELECT c_personid, c_name_chn, c_birthyear, c_deathyear, c_index_year
           FROM BIOG_MAIN
           WHERE c_index_year BETWEEN ? AND ? AND c_name_chn != ''
           ORDER BY c_index_year
           LIMIT ?""",
        (start_year, end_year, limit),
    )


def count_ming_people() -> int:
    return _query_value(
        "SELECT COUNT(*) FROM BIOG_MAIN WHERE c_index_year BETWEEN 1368 AND 1644 AND c_name_chn != ''"
    )


# === 官职履历 ===

def get_person_career(person_id: int) -> list[dict]:
    """获取人物官职履历（含品级、任职年份、地点）"""
    return _query(
        """SELECT pto.c_office_id, oc.c_office_chn, oc.c_office_pinyin,
                  pto.c_firstyear, pto.c_lastyear,
                  pto.c_appt_code, at.c_appt_type_desc as appt_type,
                  COALESCE(pta_addr.c_name_chn, addr.c_name_chn) as location
           FROM POSTED_TO_OFFICE_DATA pto
           JOIN OFFICE_CODES oc ON pto.c_office_id = oc.c_office_id
           LEFT            JOIN APPOINTMENT_TYPES at ON pto.c_appt_code = at.c_appt_type_code
           LEFT JOIN POSTED_TO_ADDR_DATA pta ON pto.c_posting_id = pta.c_posting_id AND pto.c_office_id = pta.c_office_id
           LEFT JOIN ADDR_CODES pta_addr ON pta.c_addr_id = pta_addr.c_addr_id
           LEFT JOIN BIOG_ADDR_DATA bad ON pto.c_personid = bad.c_personid
           LEFT JOIN ADDR_CODES addr ON bad.c_addr_id = addr.c_addr_id AND bad.c_addr_type = 0
           WHERE pto.c_personid = ?
           ORDER BY pto.c_firstyear""",
        (person_id,),
    )


def get_person_offices_by_year(person_id: int, year: int) -> list[dict]:
    """获取人物在特定年份的任职"""
    return _query(
        """SELECT pto.c_office_id, oc.c_office_chn, pto.c_firstyear, pto.c_lastyear
           FROM POSTED_TO_OFFICE_DATA pto
           JOIN OFFICE_CODES oc ON pto.c_office_id = oc.c_office_id
           WHERE pto.c_personid = ? AND pto.c_firstyear <= ? AND (pto.c_lastyear >= ? OR pto.c_lastyear IS NULL)
           ORDER BY pto.c_firstyear""",
        (person_id, year, year),
    )


# === 关系网络 ===

def get_person_kinship(person_id: int) -> list[dict]:
    """获取人物亲属关系"""
    return _query(
        """SELECT kd.c_kin_id, bm.c_name_chn as kin_name, bm.c_birthyear, bm.c_deathyear,
                  kc.c_kinrel_chn as relation, kc.c_kinrel,
                  kd.c_notes
           FROM KIN_DATA kd
           JOIN BIOG_MAIN bm ON kd.c_kin_id = bm.c_personid
           JOIN KINSHIP_CODES kc ON kd.c_kin_code = kc.c_kincode
           WHERE kd.c_personid = ?
           ORDER BY kc.c_upstep, kc.c_dwnstep""",
        (person_id,),
    )


def get_person_associations(person_id: int, limit: int = 50) -> list[dict]:
    """获取人物社会关系（同乡、同年、师生、同僚等）"""
    return _query(
        """SELECT ad.c_assoc_id, bm.c_name_chn as assoc_name, bm.c_birthyear, bm.c_deathyear,
                  ac.c_assoc_desc_chn as association,
                  ad.c_assoc_first_year, ad.c_assoc_last_year,
                  addr.c_name_chn as location, ad.c_notes
           FROM ASSOC_DATA ad
           JOIN BIOG_MAIN bm ON ad.c_assoc_id = bm.c_personid
           JOIN ASSOC_CODES ac ON ad.c_assoc_code = ac.c_assoc_code
           LEFT JOIN ADDR_CODES addr ON ad.c_addr_id = addr.c_addr_id
           WHERE ad.c_personid = ?
           ORDER BY ad.c_assoc_first_year
           LIMIT ?""",
        (person_id, limit),
    )


# === 科举入仕 ===

def get_person_entry(person_id: int) -> list[dict]:
    """获取人物科举/入仕记录"""
    return _query(
        """SELECT ed.c_entry_code, ec.c_entry_desc_chn, ed.c_year, ed.c_exam_rank,
                  ed.c_age, ed.c_notes
           FROM ENTRY_DATA ed
           JOIN ENTRY_CODES ec ON ed.c_entry_code = ec.c_entry_code
           WHERE ed.c_personid = ?
           ORDER BY ed.c_year""",
        (person_id,),
    )


# === 籍贯与地址 ===

def get_person_addresses(person_id: int) -> list[dict]:
    """获取人物地址信息（籍贯、居住地等）"""
    return _query(
        """SELECT bad.c_addr_id, ac.c_name_chn, bad.c_addr_type,
                  bad.c_firstyear, bad.c_lastyear, bad.c_sequence
           FROM BIOG_ADDR_DATA bad
           JOIN ADDR_CODES ac ON bad.c_addr_id = ac.c_addr_id
           WHERE bad.c_personid = ?
           ORDER BY bad.c_sequence""",
        (person_id,),
    )


def get_address_info(addr_id: int) -> Optional[dict]:
    """获取地址详细信息"""
    return _query_one(
        "SELECT c_addr_id, c_name, c_name_chn, c_firstyear, c_lastyear, x_coord, y_coord, c_admin_type FROM ADDR_CODES WHERE c_addr_id = ?",
        (addr_id,),
    )


def search_address(name: str, limit: int = 10) -> list[dict]:
    """按名称搜索地址"""
    return _query(
        """SELECT c_addr_id, c_name, c_name_chn, c_firstyear, c_lastyear, x_coord, y_coord, c_admin_type
           FROM ADDR_CODES WHERE c_name_chn LIKE ? LIMIT ?""",
        (f"%{name}%", limit),
    )


# === 官职查询 ===

def search_office(name: str, limit: int = 10) -> list[dict]:
    """按名称搜索官职"""
    return _query(
        """SELECT c_office_id, c_office_chn, c_office_pinyin
           FROM OFFICE_CODES WHERE c_office_chn LIKE ? OR c_office_pinyin LIKE ? LIMIT ?""",
        (f"%{name}%", f"%{name}%", limit),
    )


def get_office_holders(office_id: int, limit: int = 20) -> list[dict]:
    """获取担任过某官职的人物列表"""
    return _query(
        """SELECT DISTINCT pto.c_personid, bm.c_name_chn, bm.c_birthyear, bm.c_deathyear,
                  pto.c_firstyear, pto.c_lastyear
           FROM POSTED_TO_OFFICE_DATA pto
           JOIN BIOG_MAIN bm ON pto.c_personid = bm.c_personid
           WHERE pto.c_office_id = ?
           ORDER BY pto.c_firstyear
           LIMIT ?""",
        (office_id, limit),
    )


# === 综合人物档案 ===

def build_person_profile(person_id: int) -> dict:
    """构建完整人物档案"""
    basic = get_person(person_id) or {}
    return {
        "id": person_id,
        "name": basic.get("c_name_chn", "未知"),
        "pinyin": basic.get("c_name", ""),
        "birth_year": basic.get("c_birthyear"),
        "death_year": basic.get("c_deathyear"),
        "index_year": basic.get("c_index_year"),
        "is_female": bool(basic.get("c_female")),
        "death_age": basic.get("c_death_age"),
        "addresses": get_person_addresses(person_id),
        "career": get_person_career(person_id),
        "entry": get_person_entry(person_id),
        "kinship": get_person_kinship(person_id),
        "associations": get_person_associations(person_id),
    }


def stats() -> dict:
    """CBDB 数据库统计"""
    return {
        "total_people": _query_value("SELECT COUNT(*) FROM BIOG_MAIN"),
        "ming_people": count_ming_people(),
        "total_offices": _query_value("SELECT COUNT(*) FROM OFFICE_CODES"),
        "total_addresses": _query_value("SELECT COUNT(*) FROM ADDR_CODES"),
        "total_kinships": _query_value("SELECT COUNT(*) FROM KIN_DATA"),
        "total_associations": _query_value("SELECT COUNT(*) FROM ASSOC_DATA"),
    }
