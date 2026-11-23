"""K-Market Intelligence 자동 갱신 스크립트.

GitHub Actions에서 장 마감 후 실행되어 data/ 폴더의 JSON을 새로 씁니다.
- 시세: 네이버 금융 일봉 (실패 시 FinanceDataReader)
- 재무·분기 실적: 네이버 증권 모바일 API (실패 시 네이버 금융 종목 페이지 표)
- 뉴스: 네이버 증권 종목 뉴스

한 종목이 실패해도 전체가 멈추지 않고, 그 종목은 직전 값을 유지하며 failures 에 기록됩니다.
로컬 실행:  python scripts/update_data.py
"""
from __future__ import annotations

import datetime as dt
import html
import io
import json
import re
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent))
from scoring import compute_themes, momentum  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
KST = dt.timezone(dt.timedelta(hours=9))
UA = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Referer": "https://finance.naver.com/",
}
SESSION = requests.Session()
SESSION.headers.update(UA)

# 제목 키워드 가중치 (클수록 강한 신호). 참고용 자동 분류입니다.
POS = {"흑자전환": 3, "어닝 서프라이즈": 3, "어닝서프라이즈": 3, "사상 최대": 3, "역대 최대": 3, "최대 실적": 3, "상한가": 3,
       "공급계약": 3, "수주": 2.5, "목표가 상향": 3, "목표주가 상향": 3, "신고가": 2, "급등": 2, "호실적": 2, "승인": 1.5,
       "자사주 매입": 2, "자사주 소각": 2.5, "배당 확대": 2, "증익": 2, "실적 개선": 2, "턴어라운드": 2, "수혜": 1.5,
       "강세": 1, "상승": 1, "증가": 0.7, "개선": 1, "기대": 0.7, "선정": 1, "돌파": 1, "순매수": 1}
NEG = {"적자전환": 3, "어닝 쇼크": 3, "어닝쇼크": 3, "하한가": 3, "거래정지": 3, "상장폐지": 3, "감사의견": 3, "횡령": 3,
       "배임": 3, "압수수색": 3, "목표가 하향": 3, "목표주가 하향": 3, "유상증자": 2.5, "전환사채": 1.5,
       "소송": 2, "리콜": 2, "급락": 2, "신저가": 2, "적자": 2, "손실": 1.5, "불성실": 2.5, "제재": 2, "과징금": 2,
       "하락": 1, "약세": 1, "감소": 0.7, "부진": 1.2, "우려": 1, "둔화": 1, "순매도": 1, "매도": 0.7, "공매도": 1}
# ---------------------------------------------------------------- 공통 유틸
def load(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def save(path: Path, obj, compact=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    if compact:
        txt = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    else:
        txt = json.dumps(obj, ensure_ascii=False, indent=1)
    path.write_text(txt, encoding="utf-8")


def get(url, **kw):
    last = None
    for i in range(3):
        try:
            r = SESSION.get(url, timeout=15, **kw)
            r.raise_for_status()
            return r
        except Exception as e:  # 네트워크 일시 오류는 재시도
            last = e
            time.sleep(1.5 * (i + 1))
    raise last


def num(v):
    """'1,234.5배' / '12.3%' / '-' 같은 문자열을 숫자로."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).replace(",", "").replace("배", "").replace("원", "").replace("%", "").strip()
    if s in ("", "-", "N/A", "nan"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def eok(v):
    """'1,083조 4,350억' → 10834350 (억원)."""
    if v is None:
        return None
    s = str(v).replace(",", "").replace(" ", "")
    m = re.match(r"(?:(\d+(?:\.\d+)?)조)?(?:(\d+(?:\.\d+)?)억)?", s)
    if m and (m.group(1) or m.group(2)):
        return float(m.group(1) or 0) * 10000 + float(m.group(2) or 0)
    return num(s)


def classify(title: str) -> str:
    t = title.replace("‘", "'").replace("’", "'")
    p = sum(w for k, w in POS.items() if k in t)
    n = sum(w for k, w in NEG.items() if k in t)
    if re.search(r"목표(주)?가.{0,8}(낮|하향|내려|깎)", t):
        n += 3
    if re.search(r"목표(주)?가.{0,8}(높|상향|올려)", t):
        p += 3
    n += sum(1.5 for k in ("추락", "폭락", "피눈물", "쇼크", "경고", "위기") if k in t)
    p += sum(1.5 for k in ("훨훨", "껑충", "날개", "러브콜", "질주") if k in t)
    if n - p >= 1:
        return "주의"
    if p - n >= 1:
        return "긍정"
    return "중립"


def aliases(name: str):
    """종목명 별칭: '한화에어로스페이스' → 한화에어로스페이스, 한화에어로 / 'SK하이닉스' → 하이닉스 / 삼성전자 → 삼전."""
    a = {name, name.replace(" ", "")}
    base = re.sub(r"(우|우B|\(.*\)|홀딩스|지주)$", "", name)
    a.add(base)
    for p in ("SK", "LG", "HD", "CJ", "GS", "LS", "KT", "DL", "HL"):
        if base.startswith(p) and len(base) > len(p) + 1:
            a.add(base[len(p):])
    extra = {"삼성전자": ["삼전"], "SK하이닉스": ["하이닉스", "닉스"], "현대자동차": ["현대차"], "LG에너지솔루션": ["LG엔솔", "엔솔"],
             "한국항공우주": ["KAI", "카이"], "한화에어로스페이스": ["한화에어로"], "에코프로비엠": ["에코프로"], "삼성바이오로직스": ["삼성바이오"]}
    a.update(extra.get(name, []))
    return [x for x in a if len(x) >= 2]


def walk(obj):
    """중첩 JSON 안의 모든 dict 를 순회."""
    if isinstance(obj, dict):
        yield obj
        for v in obj.values():
            yield from walk(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from walk(v)


# ---------------------------------------------------------------- 시세
def parse_sise_json(text: str):
    """네이버 siseJson 응답(작은따옴표 섞인 배열) → [{date, open, high, low, close, volume}]."""
    rows = json.loads(text.strip().replace("'", '"'))
    out = []
    for r in rows[1:]:
        if not r or len(r) < 6:
            continue
        d = str(r[0]).strip()
        out.append({"date": f"{d[:4]}-{d[4:6]}-{d[6:8]}", "open": float(r[1]), "high": float(r[2]),
                    "low": float(r[3]), "close": float(r[4]), "volume": float(r[5])})
    return out


def history(symbol: str, days=400):
    end = dt.datetime.now(KST).date()
    start = end - dt.timedelta(days=days)
    try:
        url = ("https://api.finance.naver.com/siseJson.naver?symbol={s}&requestType=1"
               "&startTime={a}&endTime={b}&timeframe=day").format(
            s=symbol, a=start.strftime("%Y%m%d"), b=end.strftime("%Y%m%d"))
        rows = parse_sise_json(get(url).text)
        if rows:
            return rows
    except Exception as e:
        print(f"  [시세] 네이버 실패 {symbol}: {e}")
    import FinanceDataReader as fdr  # 대체 경로
    df = fdr.DataReader("KS11" if symbol == "KOSPI" else symbol, start.isoformat())
    return [{"date": i.strftime("%Y-%m-%d"), "open": float(r["Open"]), "high": float(r["High"]),
             "low": float(r["Low"]), "close": float(r["Close"]), "volume": float(r.get("Volume", 0) or 0)}
            for i, r in df.iterrows()]


def price_stats(rows):
    rows = [r for r in rows if r["close"] > 0]
    if not rows:
        return None
    last = rows[-1]
    ld = dt.date.fromisoformat(last["date"])

    def ret(days):
        cut = (ld - dt.timedelta(days=days)).isoformat()
        base = [r for r in rows if r["date"] <= cut]
        return last["close"] / base[-1]["close"] - 1 if base else None

    yr = [r for r in rows if r["date"] > (ld - dt.timedelta(days=365)).isoformat()]
    hi = max(r["high"] for r in yr)
    lo = min(r["low"] for r in yr)
    vol = [r["volume"] for r in rows[-20:]]
    r1, r3 = ret(30), ret(91)
    return {"close": last["close"], "last_date": last["date"], "r1m": r1, "r3m": r3,
            "hi52": hi, "lo52": lo, "pos52": (last["close"] - lo) / (hi - lo) if hi > lo else None,
            "vol20": sum(vol) / len(vol) if vol else None, "momentum": momentum(r1, r3)}


# ---------------------------------------------------------------- 재무
QROWS = {"매출액": "revenue", "영업이익": "op_income", "당기순이익": "net_income",
         "영업이익률": "op_margin", "ROE": "roe", "부채비율": "debt_ratio"}


def _qrow_key(title: str):
    t = title.replace(" ", "")
    for k, v in sorted(QROWS.items(), key=lambda kv: -len(kv[0])):  # '영업이익률'을 '영업이익'보다 먼저
        if t.startswith(k):
            return v
    return None


def fundamentals_mobile(code):
    f = {}
    j = get(f"https://m.stock.naver.com/api/stock/{code}/integration").json()
    for d in walk(j):
        c, val = d.get("code"), d.get("value")
        if c == "per":
            f["per"] = num(val)
        elif c == "pbr":
            f["pbr"] = num(val)
        elif c == "marketValue":
            f["market_cap_eok"] = eok(val)
        elif c == "cnsPer":
            f["cns_per"] = num(val)
        elif c == "cnsEps":
            f["cns_eps"] = num(val)
        elif c == "dividendYieldRatio":
            f["dividend_yield"] = (num(val) or 0) / 100 if num(val) is not None else None

    for d in walk(j):
        if "priceTargetMean" in d or "recommMean" in d:
            f["target"] = num(d.get("priceTargetMean"))
            f["recomm"] = num(d.get("recommMean"))
            break
    quarters = []
    j = get(f"https://m.stock.naver.com/api/stock/{code}/finance/quarter").json()
    info = next((d for d in walk(j) if "rowList" in d and "trTitleList" in d), None)
    if info:
        cols = [t for t in info["trTitleList"] if str(t.get("isConsensus", "N")).upper() != "Y"]
        table = {}
        for row in info["rowList"]:
            key = _qrow_key(row.get("title", ""))
            if not key:
                continue
            for c in cols:
                cell = (row.get("columns") or {}).get(c["key"]) or {}
                table.setdefault(c["key"], {})[key] = num(cell.get("value"))
        for c in cols:
            q = table.get(c["key"], {})
            if any(v is not None for v in q.values()):
                quarters.append({"period": c.get("title", c["key"]).rstrip("."), **q})
    return f, quarters


def fundamentals_html(code):
    """대체 경로: 네이버 금융 종목 메인의 '기업실적분석' 표."""
    import pandas as pd
    r = get(f"https://finance.naver.com/item/main.naver?code={code}")
    r.encoding = "euc-kr"
    tables = pd.read_html(io.StringIO(r.text))
    t = next(t for t in tables if any("매출액" in str(x) for x in t.iloc[:, 0].tolist()))
    t = t.set_index(t.columns[0])
    cols = list(t.columns)
    qcols = [c for c in cols if "분기" in str(c[1] if isinstance(c, tuple) else c)]
    quarters = []
    for c in qcols:
        label = str(c[2] if isinstance(c, tuple) and len(c) > 2 else c)
        if "(E)" in label:
            continue
        q = {"period": label.replace("(IFRS연결)", "").strip().rstrip(".")}
        for idx, val in t[c].items():
            key = _qrow_key(str(idx[0] if isinstance(idx, tuple) else idx))
            if key and key not in q:
                q[key] = num(val)
        quarters.append(q)
    f = {}
    m = re.search(r'id="_per">([\d,.]+)<', r.text)
    f["per"] = num(m.group(1)) if m else None
    m = re.search(r'id="_pbr">([\d,.]+)<', r.text)
    f["pbr"] = num(m.group(1)) if m else None
    m = re.search(r'시가총액.*?<em id="_market_sum">(.*?)</em>', r.text, re.S)
    if m:
        f["market_cap_eok"] = eok(re.sub(r"<[^>]+>|\s", "", m.group(1)))
    return f, quarters


def normalize_quarters(quarters):
    """최신 분기가 앞, 최대 5개, 비율은 소수(0.123)로."""
    qs = sorted(quarters, key=lambda q: q["period"], reverse=True)[:5]
    for q in qs:
        for k in ("op_margin", "roe", "debt_ratio"):
            if q.get(k) is not None:
                q[k] = q[k] / 100
    return qs


def fundamentals(code):
    try:
        f, qs = fundamentals_mobile(code)
        if qs:
            return f, normalize_quarters(qs), "네이버 증권"
    except Exception as e:
        print(f"  [재무] 모바일 API 실패 {code}: {e}")
    f, qs = fundamentals_html(code)
    return f, normalize_quarters(qs), "네이버 금융"


# ---------------------------------------------------------------- 뉴스
def clean(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()


def news(code, n=6, name=None):
    """종목 뉴스. 제목·요약에 종목명(별칭)이 들어간 기사만 남기고, 같은 제목은 하나로."""
    items = []
    try:
        j = get(f"https://m.stock.naver.com/api/news/stock/{code}?pageSize=20&page=1").json()
        for d in walk(j):
            if "title" in d and ("articleId" in d or "aid" in d):
                oid, aid = d.get("officeId") or d.get("oid"), d.get("articleId") or d.get("aid")
                raw = str(d.get("datetime") or d.get("dt") or "")
                date = f"{raw[:4]}-{raw[4:6]}-{raw[6:8]}" if len(raw) >= 8 else None
                title = clean(d.get("titleFull") or d["title"])
                items.append({"date": date, "time": f"{raw[8:10]}:{raw[10:12]}" if len(raw) >= 12 else None,
                              "title": title, "source": d.get("officeName", ""),
                              "summary": clean(d.get("body", ""))[:160],
                              "url": d.get("mobileNewsUrl") or f"https://n.news.naver.com/mnews/article/{oid}/{aid}",
                              "impact": classify(title), "auto": True})
    except Exception as e:
        print(f"  [뉴스] 실패 {code}: {e}")
    if name:
        al = aliases(name)
        rel = [it for it in items if any(a in it["title"] for a in al)]
        rel += [it for it in items if it not in rel and any(a in it["summary"][:80] for a in al)]
        items = rel
    seen, out = set(), []
    for it in items:
        key = re.sub(r"[^가-힣A-Za-z0-9]", "", it["title"])[:18]
        if key not in seen:
            seen.add(key)
            out.append(it)
    out.sort(key=lambda x: (x["date"] or "", x["time"] or ""), reverse=True)
    return out[:n]


def flows(code, days=20):
    """투자자별 순매수 (외국인·기관·개인, 주 단위 수량)."""
    j = get(f"https://m.stock.naver.com/api/stock/{code}/trend?pageSize={days}").json()
    out = []
    for d in j if isinstance(j, list) else []:
        b = str(d.get("bizdate", ""))
        out.append([f"{b[:4]}-{b[4:6]}-{b[6:8]}", num(d.get("foreignerPureBuyQuant")), num(d.get("organPureBuyQuant")),
                    num(d.get("individualPureBuyQuant")), num(d.get("closePrice")),
                    (num(d.get("foreignerHoldRatio")) or 0) / 100 if d.get("foreignerHoldRatio") else None])
    return sorted(out)


def disclosures(code, n=6):
    j = get(f"https://m.stock.naver.com/api/stock/{code}/disclosure?page=1&pageSize={n}").json()
    return [{"date": str(d.get("datetime", ""))[:10], "title": clean(d.get("title", "")), "id": d.get("disclosureId")}
            for d in (j if isinstance(j, list) else [])]


def fetch_groups(kind):
    """네이버 테마(theme)·업종(industry) 목록과 소속 종목. [{no, name, chg, rise, fall, total, codes}]"""
    groups, page = [], 1
    while page < 20:
        j = get(f"https://m.stock.naver.com/api/stocks/{kind}?page={page}&pageSize=100").json()
        g = j.get("groups") or []
        groups += [{"no": x["no"], "name": x["name"], "chg": (num(x.get("changeRate")) or 0) / 100,
                    "rise": x.get("riseCount"), "fall": x.get("fallCount"), "total": x.get("totalCount")} for x in g]
        if len(groups) >= (j.get("totalCount") or 0) or not g:
            break
        page += 1
    from concurrent.futures import ThreadPoolExecutor

    def members(gr):
        codes, p = [], 1
        try:
            while p < 10:
                j = get(f"https://m.stock.naver.com/api/stocks/{kind}/{gr['no']}?page={p}&pageSize=100").json()
                st = j.get("stocks") or []
                codes += [str(x.get("itemCode") or x.get("reutersCode") or "")[:6] for x in st]
                if not st or len(codes) >= (j.get("totalCount") or 0):
                    break
                p += 1
        except Exception as e:
            print(f"  [{kind}] {gr['name']} 소속 종목 실패: {e}")
        gr["codes"] = [c for c in codes if c.isdigit()]
        return gr

    with ThreadPoolExecutor(6) as ex:
        groups = list(ex.map(members, groups))
    return groups


# ---------------------------------------------------------------- 전 종목 목록·시세
def load_listing():
    """KRX 전 종목 [이름, 코드, 시장, 업종]. 실패하면 기존 목록 유지."""
    old = load(DATA / "stocks.json", [])
    old_sector = {r[1]: (r[3] if len(r) > 3 else "") for r in old}
    snap = {}
    try:
        import FinanceDataReader as fdr
        df = fdr.StockListing("KRX")
        rows = []
        for _, r in df.iterrows():
            code = str(r["Code"]).zfill(6)
            if not code.isdigit():
                continue
            rows.append([str(r["Name"]), code, str(r["Market"]), old_sector.get(code, "")])
            snap[code] = {"close": num(r.get("Close")), "chg": (num(r.get("ChagesRatio")) or 0) / 100,
                          "amount": num(r.get("Amount")), "marcap": (num(r.get("Marcap")) or 0) / 1e8}
        try:
            desc = fdr.StockListing("KRX-DESC")
            sec = {str(r["Code"]).zfill(6): str(r.get("Sector") or "") for _, r in desc.iterrows()}
            for row in rows:
                row[3] = sec.get(row[1], row[3]) if sec.get(row[1], "nan") != "nan" else row[3]
        except Exception as e:
            print(f"[목록] 업종 정보 생략: {e}")
        if len(rows) > 2000:
            rows.sort()
            save(DATA / "stocks.json", rows, compact=True)
            print(f"종목 목록: {len(rows)}개")
            return rows, snap
    except Exception as e:
        print(f"[목록] 갱신 실패, 기존 목록 사용: {e}")
    return [r if len(r) > 3 else r + [""] for r in old], snap


def fetch_all_history(codes, workers=8):
    """전 종목 일봉을 병렬로 받기. {code: rows}"""
    from concurrent.futures import ThreadPoolExecutor
    out, fails = {}, []

    def job(c):
        try:
            return c, history(c, days=380)
        except Exception as e:
            return c, e

    with ThreadPoolExecutor(workers) as ex:
        for i, (c, res) in enumerate(ex.map(job, codes), 1):
            if isinstance(res, Exception) or not res:
                fails.append(c)
            else:
                out[c] = res
            if i % 300 == 0:
                print(f"  시세 {i}/{len(codes)}")
    return out, fails


def weekly(rows, weeks=60):
    """일봉 → 주봉 종가 (그 주 마지막 거래일)."""
    wk = {}
    for r in rows:
        d = dt.date.fromisoformat(r["date"])
        wk[d.isocalendar()[:2]] = [r["date"], r["close"]]
    return list(wk.values())[-weeks:]


# ---------------------------------------------------------------- 사용자 포트폴리오 (Supabase)
def supabase_conf():
    import os
    key = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
    url = os.environ.get("SUPABASE_URL", "").strip()
    if not url:
        m = re.search(r'url:\s*"([^"]+)"', (ROOT / "assets" / "config.js").read_text(encoding="utf-8")) \
            if (ROOT / "assets" / "config.js").exists() else None
        url = m.group(1) if m else ""
    return (url.rstrip("/"), key) if url and key and "YOUR" not in url else (None, None)


def sb(method, path, body=None, params=None):
    url, key = supabase_conf()
    headers = {"apikey": key, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"}
    if key.startswith("eyJ"):  # 예전 형식(JWT) service_role 키
        headers["Authorization"] = f"Bearer {key}"
    r = requests.request(method, f"{url}/rest/v1/{path}", params=params, json=body, timeout=30, headers=headers)
    r.raise_for_status()
    return r.json() if r.text else None


def user_codes():
    """모든 사용자의 보유·관심 종목 코드 (뉴스·차트 수집 대상에 포함)."""
    if not supabase_conf()[0]:
        return set()
    codes = set()
    try:
        for t in sb("GET", "trades", params={"select": "code"}):
            codes.add(t["code"])
        for t in sb("GET", "watchlist", params={"select": "code"}):
            codes.add(t["code"])
    except Exception as e:
        print(f"[포트폴리오] 사용자 종목 조회 실패: {e}")
    return codes


def positions_from_trades(trades):
    """이동평균법으로 보유 수량·평단·실현손익 계산."""
    pos, realized, bought = {}, 0.0, 0.0
    for t in sorted(trades, key=lambda x: (x["trade_date"], x.get("created_at") or "")):
        p = pos.setdefault(t["code"], {"code": t["code"], "name": t["name"], "qty": 0.0, "avg": 0.0})
        q, price, fee = float(t["qty"]), float(t["price"]), float(t.get("fee") or 0)
        if t["side"] == "buy":
            p["avg"] = (p["avg"] * p["qty"] + price * q + fee) / (p["qty"] + q)
            p["qty"] += q
            bought += price * q + fee
        else:
            q = min(q, p["qty"])
            realized += (price - p["avg"]) * q - fee
            p["qty"] -= q
    return {c: p for c, p in pos.items() if p["qty"] > 1e-9}, realized, bought


def write_journals(allrows, kospi_chg, today):
    if not supabase_conf()[0]:
        print("[일지] Supabase 키가 없어 건너뜀")
        return
    try:
        trades = sb("GET", "trades", params={"select": "*", "trade_date": f"lte.{today}"})
    except Exception as e:
        print(f"[일지] 거래 조회 실패: {e}")
        return
    by_user = {}
    for t in trades:
        by_user.setdefault(t["user_id"], []).append(t)
    rows = []
    for uid, ts in by_user.items():
        pos, realized, bought = positions_from_trades(ts)
        plist, total, cost, day = [], 0.0, 0.0, 0.0
        events = []
        for c, p in pos.items():
            a = allrows.get(c, {})
            close = a.get("close") or p["avg"]
            chg = a.get("chg") or 0
            val = close * p["qty"]
            dp = val - val / (1 + chg) if chg > -1 else 0
            total += val
            cost += p["avg"] * p["qty"]
            day += dp
            plist.append({"code": c, "name": p["name"], "qty": p["qty"], "avg": round(p["avg"], 2), "close": close,
                          "value": round(val), "pnl": round(val - p["avg"] * p["qty"]),
                          "pnl_pct": (close / p["avg"] - 1) if p["avg"] else None, "chg": chg})
            if abs(chg) >= 0.05:
                events.append({"type": "move", "code": c, "name": p["name"],
                               "text": f"{p['name']} {'급등' if chg > 0 else '급락'} {chg * 100:+.1f}%"})
            pos52 = a.get("pos52")
            if pos52 is not None and pos52 >= 0.98:
                events.append({"type": "high", "code": c, "name": p["name"], "text": f"{p['name']} 52주 신고가 근처"})
            elif pos52 is not None and pos52 <= 0.02:
                events.append({"type": "low", "code": c, "name": p["name"], "text": f"{p['name']} 52주 신저가 근처"})
            comp = load(DATA / "companies" / f"{c}.json", {})
            for n in [n for n in comp.get("news", []) if n.get("date") == today][:2]:
                events.append({"type": "news", "code": c, "name": p["name"], "text": n["title"],
                               "url": n.get("url"), "impact": n.get("impact")})
        for t in [t for t in ts if t["trade_date"] == today]:
            events.append({"type": "trade", "code": t["code"], "name": t["name"],
                           "text": f"{t['name']} {'매수' if t['side'] == 'buy' else '매도'} {float(t['qty']):g}주 @ {float(t['price']):,.0f}"})
        plist.sort(key=lambda x: -x["value"])
        unreal = total - cost
        rows.append({"user_id": uid, "date": today, "total_value": round(total), "cost_basis": round(cost),
                     "invested": round(bought), "realized": round(realized), "day_pnl": round(day),
                     "day_ret": day / (total - day) if total - day > 0 else None,
                     "cum_ret": (unreal + realized) / bought if bought else None,
                     "kospi_ret": kospi_chg, "positions": plist, "events": events,
                     "updated_at": dt.datetime.now(KST).isoformat()})
    if rows:
        sb("POST", "journal?on_conflict=user_id,date", rows)
    print(f"[일지] {len(rows)}명 기록")


# ---------------------------------------------------------------- 메인
def main():
    config = load(DATA / "config.json", None)
    if not config:
        sys.exit("data/config.json 이 없습니다.")
    prev = load(DATA / "market.json", {"stocks": {}})
    failures = []
    now = dt.datetime.now(KST)
    morning = now.hour < 12  # 아침 실행: 뉴스만 갱신
    today = now.date().isoformat()

    listing, snap = load_listing()
    lmap = {r[1]: r for r in listing}

    # ---- 네이버 테마·업종 (오후 실행): 주도 테마 자동 발굴 + 종목 업종
    if not morning:
        try:
            gt, gi = fetch_groups("theme"), fetch_groups("industry")
            if gt and gi:
                save(DATA / "groups.json", {"as_of": today, "themes": gt, "industries": gi}, compact=True)
                ind = {}
                for g in gi:
                    for c in g["codes"]:
                        ind.setdefault(c, g["name"])
                for r in listing:
                    r[3] = ind.get(r[1], r[3])
                save(DATA / "stocks.json", listing, compact=True)
                print(f"테마 {len(gt)}개, 업종 {len(gi)}개")
        except Exception as e:
            failures.append({"code": "*", "step": "테마·업종", "error": str(e)[:200]})

    kospi, kospi_chg = prev.get("kospi"), None
    try:
        krows = history("KOSPI")
        ks = price_stats(krows)
        kospi = {k: ks[k] for k in ("close", "r1m", "r3m", "last_date")}
        kospi_chg = krows[-1]["close"] / krows[-2]["close"] - 1
        kospi["chg"] = kospi_chg
    except Exception as e:
        failures.append({"code": "KOSPI", "step": "시세", "error": str(e)[:200]})

    # 상세 수집 대상: 테마 종목 + 추가 종목 + 사용자 보유·관심 종목
    watch = {}
    for t in config["themes"]:
        for s in t["stocks"]:
            watch[s["code"]] = {"name": s["name"], "theme": t["name"]}
    for c in list(config.get("extra_companies", [])) + sorted(user_codes()):
        if c in lmap:
            watch.setdefault(c, {"name": lmap[c][0], "theme": None})

    # ---- 전 종목 시세 (오후 실행)
    hist = {}
    allp = load(DATA / "market_all.json", {}).get("rows", {})
    if not morning:
        codes = [r[1] for r in listing]
        hist, hfails = fetch_all_history(codes)
        print(f"전 종목 시세: 성공 {len(hist)}, 실패 {len(hfails)}")
        if hfails:
            failures.append({"code": "*", "step": "전종목 시세", "error": f"{len(hfails)}개 실패 (직전 값 유지)"})
        newp = {}
        for r in listing:
            c = r[1]
            st = price_stats(hist[c]) if c in hist else None
            old = dict(zip(ALL_FIELDS, allp[c])) if c in allp else {}
            sn = snap.get(c, {})
            if st:
                rows_ = hist[c]
                chg = rows_[-1]["close"] / rows_[-2]["close"] - 1 if len(rows_) > 1 else None
                ld = dt.date.fromisoformat(st["last_date"])
                base = [x for x in rows_ if x["date"] <= (ld - dt.timedelta(days=7)).isoformat()]
                r1w = st["close"] / base[-1]["close"] - 1 if base else None
                rec = {"close": st["close"], "chg": chg, "r1w": r1w, "r1m": st["r1m"], "r3m": st["r3m"],
                       "pos52": st["pos52"], "hi52": st["hi52"], "lo52": st["lo52"],
                       "amount": sn.get("amount") or rows_[-1]["close"] * rows_[-1]["volume"],
                       "marcap": sn.get("marcap") or old.get("marcap"), "last_date": st["last_date"]}
            else:
                rec = {**old, **{k: v for k, v in sn.items() if v}}
            newp[c] = rec
        allp = {c: [round(v, 5) if isinstance(v, float) and abs(v) < 10 else (round(v) if isinstance(v, float) else v)
                    for v in (rec.get(f) for f in ALL_FIELDS)] for c, rec in newp.items()}
        save(DATA / "market_all.json", {"as_of": max((v[-1] for v in allp.values() if v and v[-1]), default=today),
                                        "fields": ALL_FIELDS, "rows": allp}, compact=True)
    allrows = {c: dict(zip(ALL_FIELDS, v)) for c, v in allp.items()}

    # ---- 상세 종목: 차트·재무·뉴스
    stocks, theme_auto = {}, {}
    for i, (code, meta) in enumerate(watch.items(), 1):
        print(f"[{i}/{len(watch)}] {meta['name']} ({code})")
        cpath = DATA / "companies" / f"{code}.json"
        comp = load(cpath, {})
        rec = dict(prev["stocks"].get(code, {}))
        rec.update({"name": meta["name"], "theme": meta["theme"],
                    "market": lmap.get(code, ["", "", rec.get("market")])[2]})
        if not morning:
            try:
                rows = hist.get(code) or history(code)
                st = price_stats(rows)
                rec.update(st)
                comp["history"] = [[r["date"], r["close"]] for r in rows[-250:]]
                comp["price"] = {k: st[k] for k in ("close", "r1m", "r3m", "pos52", "hi52", "lo52", "vol20", "last_date")}
            except Exception as e:
                failures.append({"code": code, "name": meta["name"], "step": "시세", "error": str(e)[:200]})
            try:
                f, qs, src = fundamentals(code)
                merge_fund(comp, f, qs, src)
            except Exception as e:
                failures.append({"code": code, "name": meta["name"], "step": "재무", "error": str(e)[:200]})
        nw = news(code, name=meta["name"])
        try:
            comp["disclosures"] = disclosures(code)
        except Exception as e:
            print(f"  [공시] 실패 {code}: {e}")
        if not morning:
            try:
                comp["flows"] = flows(code)
            except Exception as e:
                failures.append({"code": code, "name": meta["name"], "step": "수급", "error": str(e)[:200]})
        if nw:
            comp["news"] = nw
            if meta["theme"]:
                theme_auto.setdefault(meta["theme"], []).extend([{**n, "stock": meta["name"]} for n in nw[:3]])
        comp.update({"code": code, "name": meta["name"], "market": rec.get("market"), "tracked": True,
                     "as_of": rec.get("last_date") or today})
        save(cpath, comp)
        if meta["theme"]:
            stocks[code] = rec
        time.sleep(0.2)

    # ---- 나머지 종목 재무: 평일마다 1/5씩 돌아가며 (1주일에 전 종목 한 바퀴)
    if not morning and now.weekday() < 5:
        bucket = [r for r in listing if int(r[1]) % 5 == now.weekday() and r[1] not in watch]
        print(f"재무 순환 수집: {len(bucket)}개 (그룹 {now.weekday()})")
        from concurrent.futures import ThreadPoolExecutor

        def fjob(r):
            try:
                return r, fundamentals(r[1]), None
            except Exception as e:
                return r, None, e

        nf = 0
        with ThreadPoolExecutor(6) as ex:
            for r, res, err in ex.map(fjob, bucket):
                cpath = DATA / "companies" / f"{r[1]}.json"
                comp = load(cpath, {})
                if res:
                    merge_fund(comp, *res)
                else:
                    nf += 1
                if r[1] in hist:
                    comp["history_w"] = weekly(hist[r[1]])
                comp.update({"code": r[1], "name": r[0], "market": r[2], "tracked": False,
                             "as_of": comp.get("as_of") if not res else today})
                save(cpath, comp)
        if nf:
            failures.append({"code": "*", "step": "재무 순환", "error": f"{nf}개 실패"})

    for th, items in theme_auto.items():
        items.sort(key=lambda x: x.get("date") or "", reverse=True)
        seen, out = set(), []
        for it in items:
            if it["title"] not in seen:
                seen.add(it["title"])
                out.append(it)
        theme_auto[th] = out[:6]
    tn = load(DATA / "theme_news.json", {"curated": []})
    tn["auto"] = theme_auto or tn.get("auto", {})
    tn["auto_as_of"] = today
    save(DATA / "theme_news.json", tn)

    if not morning:
        dates = [s.get("last_date") for s in stocks.values() if s.get("last_date")]
        breadth = {"up": sum(1 for v in allrows.values() if (v.get("chg") or 0) > 0),
                   "down": sum(1 for v in allrows.values() if (v.get("chg") or 0) < 0),
                   "high52": sum(1 for v in allrows.values() if (v.get("pos52") or 0) >= 0.995),
                   "low52": sum(1 for v in allrows.values() if v.get("pos52") is not None and v["pos52"] <= 0.005),
                   "total": len(allrows)}
        market = {"as_of": max(dates) if dates else prev.get("as_of"),
                  "updated_at": now.isoformat(timespec="minutes"),
                  "source": "네이버 금융 자동 수집", "kospi": kospi, "breadth": breadth, "stocks": stocks,
                  "themes": compute_themes(config, stocks, kospi), "failures": failures}
        save(DATA / "market.json", market)
        # 장이 열린 날에만 일지 작성
        if market["as_of"] == today:
            write_journals(allrows, kospi_chg, today)
    else:
        m = load(DATA / "market.json", {})
        m["news_updated_at"] = now.isoformat(timespec="minutes")
        save(DATA / "market.json", m)
    print(f"완료: 실패 {len(failures)}건")
    for f in failures:
        print("  실패:", f)


ALL_FIELDS = ["close", "chg", "r1w", "r1m", "r3m", "pos52", "hi52", "lo52", "amount", "marcap", "last_date"]


def merge_fund(comp, f, qs, src):
    if qs:
        for k in ("roe", "debt_ratio", "op_margin"):
            if f.get(k) is None:
                f[k] = next((q.get(k) for q in qs if q.get(k) is not None), None)
        comp["quarters"] = qs
    comp["fundamentals"] = {**comp.get("fundamentals", {}), **{k: v for k, v in f.items() if v is not None}}
    comp["source"] = src
    comp["unit"] = "억원"


if __name__ == "__main__":
    main()
