"""
ctext.org JSON API 封装

API 基址: https://api.ctext.org/
认证: 未登录用户可读部分经典文本，登录/订阅用户可读更多
明代关键文本需获取正确 URN 后调用 gettext
"""
import urllib.request, ssl, json
from urllib.parse import urlencode, quote
from typing import Optional

API_BASE = "https://api.ctext.org"
_CTX = ssl.create_default_context()
_CTX.check_hostname = False
_CTX.verify_mode = ssl.CERT_NONE

def _call(func: str, **params) -> dict:
    p = urlencode(params)
    url = f"{API_BASE}/{func}?{p}" if p else f"{API_BASE}/{func}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15, context=_CTX) as resp:
        return json.loads(resp.read())

def getstatus() -> dict:
    """获取当前用户状态"""
    return _call("getstatus")

def gettext(urn: str) -> dict:
    """获取文本内容。返回 {fulltext: [...], subsections: [...], title: ...}"""
    return _call("gettext", urn=urn)

def getlink(urn: str, redirect: str = "0") -> dict:
    """将 URN 转为 ctext.org 链接"""
    return _call("getlink", urn=urn, redirect=redirect)

def readlink(url: str) -> dict:
    """将 ctext.org 链接转回 URN"""
    return _call("readlink", url=url)

# === 已知可用的经典 URN ===
KNOWN_URNS = {
    "论语": "ctp:analects",
    "孟子": "ctp:mengzi",
    "道德经": "ctp:dao-de-jing",
    "孙子兵法": "ctp:art-of-war",
    "史记": "ctp:shiji",
    "汉书": "ctp:han-shu",
    "三国志": "ctp:sanguozhi",
    "资治通鉴": "ctp:zizhi-tongjian",
}

def search_readable(text_urn: str) -> Optional[str]:
    """获取文本章节全文（拼接）"""
    result = gettext(text_urn)
    if "fulltext" in result and result["fulltext"]:
        return "\n".join(result["fulltext"])
    if "error" in result:
        return None
    return None

def get_subsections(text_urn: str) -> list[str]:
    """获取文本所有子章节 URN"""
    result = gettext(text_urn)
    return result.get("subsections", [])
