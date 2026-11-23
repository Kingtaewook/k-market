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

POSITIVE = ["수주", "흑자", "최대", "신고가", "급등", "상승", "계약", "호실적", "성장", "증가", "개선",
            "승인", "선정", "협력", "강세", "상향", "돌파", "수혜"]
CAUTION = ["적자", "하락", "급락", "소송", "과열", "유상증자", "감소", "리콜", "부진", "약세", "하향",
           "손실", "우려", "제재", "횡령", "배임", "불성실", "투자주의", "경고", "매도"]


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
    p = sum(k in title for k in POSITIVE)
    n = sum(k in title for k in CAUTION)
    if n > p:
        return "주의"
    if p > n:
        return "긍정"
    return "중립"


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
        elif c == "dividendYieldRatio":
            f["dividend_yield"] = (num(val) or 0) / 100 if num(val) is not None else None

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


def news(code, n=6):
    items = []
    try:
        j = get(f"https://m.stock.naver.com/api/news/stock/{code}?pageSize={n}&page=1").json()
        for d in walk(j):
            if "title" in d and ("articleId" in d or "aid" in d):
                oid, aid = d.get("officeId") or d.get("oid"), d.get("articleId") or d.get("aid")
                raw = str(d.get("datetime") or d.get("dt") or "")
                date = f"{raw[:4]}-{raw[4:6]}-{raw[6:8]}" if len(raw) >= 8 else None
                title = clean(d["title"])
                items.append({"date": date, "title": title, "source": d.get("officeName", ""),
                              "summary": clean(d.get("body", ""))[:140],
                              "url": f"https://n.news.naver.com/mnews/article/{oid}/{aid}",
                              "impact": classify(title), "auto": True})
    except Exception as e:
        print(f"  [뉴스] 실패 {code}: {e}")
    seen, out = set(), []
    for it in items:
        if it["title"] not in seen:
            seen.add(it["title"])
            out.append(it)
    return out[:n]


# ---------------------------------------------------------------- 종목 목록
def refresh_listing():
    try:
        import FinanceDataReader as fdr
        df = fdr.StockListing("KRX")
        rows = [[str(r["Name"]), str(r["Code"]).zfill(6), str(r["Market"])] for _, r in df.iterrows()
                if str(r["Code"]).isdigit()]
        if len(rows) > 2000:
            save(DATA / "stocks.json", sorted(rows), compact=True)
            print(f"종목 목록 갱신: {len(rows)}개")
    except Exception as e:
        print(f"[목록] 갱신 생략 (기존 목록 유지): {e}")


# ---------------------------------------------------------------- 메인
def main():
    config = load(DATA / "config.json", None)
    if not config:
        sys.exit("data/config.json 이 없습니다.")
    prev = load(DATA / "market.json", {"stocks": {}})
    failures = []
    now = dt.datetime.now(KST)

    refresh_listing()
    listing = {c: (n, m) for n, c, m in load(DATA / "stocks.json", [])}

    kospi = None
    try:
        ks = price_stats(history("KOSPI"))
        kospi = {k: ks[k] for k in ("close", "r1m", "r3m", "last_date")}
    except Exception as e:
        failures.append({"code": "KOSPI", "step": "시세", "error": str(e)[:200]})
        kospi = prev.get("kospi")

    watch = {}
    for t in config["themes"]:
        for s in t["stocks"]:
            watch[s["code"]] = {"name": s["name"], "theme": t["name"]}
    for c in config.get("extra_companies", []):
        watch.setdefault(c, {"name": listing.get(c, (c, ""))[0], "theme": None})

    stocks, theme_auto = {}, {}
    for i, (code, meta) in enumerate(watch.items(), 1):
        print(f"[{i}/{len(watch)}] {meta['name']} ({code})")
        cpath = DATA / "companies" / f"{code}.json"
        comp = load(cpath, {})
        rec = dict(prev["stocks"].get(code, {}))
        rec.update({"name": meta["name"], "theme": meta["theme"],
                    "market": listing.get(code, ("", rec.get("market")))[1] or rec.get("market")})
        try:
            rows = history(code)
            st = price_stats(rows)
            rec.update(st)
            comp["history"] = [[r["date"], r["close"]] for r in rows[-250:]]
            comp["price"] = {k: st[k] for k in ("close", "r1m", "r3m", "pos52", "hi52", "lo52", "vol20", "last_date")}
        except Exception as e:
            failures.append({"code": code, "name": meta["name"], "step": "시세", "error": str(e)[:200]})
        try:
            f, qs, src = fundamentals(code)
            if qs:
                latest = qs[0]
                f.setdefault("roe", latest.get("roe"))
                f.setdefault("debt_ratio", latest.get("debt_ratio"))
                f.setdefault("op_margin", latest.get("op_margin"))
                # 최근 분기에 값이 없으면 직전 분기에서 보완
                for k in ("roe", "debt_ratio", "op_margin"):
                    if f.get(k) is None:
                        f[k] = next((q.get(k) for q in qs if q.get(k) is not None), None)
                comp["quarters"] = qs
            comp["fundamentals"] = {**comp.get("fundamentals", {}), **{k: v for k, v in f.items() if v is not None}}
            comp["source"] = src
            comp["unit"] = "억원"
        except Exception as e:
            failures.append({"code": code, "name": meta["name"], "step": "재무", "error": str(e)[:200]})
        nw = news(code)
        if nw:
            comp["news"] = nw
            if meta["theme"]:
                theme_auto.setdefault(meta["theme"], []).extend(
                    [{**n, "stock": meta["name"]} for n in nw[:3]])
        comp.update({"code": code, "name": meta["name"], "market": rec.get("market"),
                     "as_of": rec.get("last_date") or now.date().isoformat()})
        save(cpath, comp)
        if meta["theme"]:
            stocks[code] = rec
        time.sleep(0.3)

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
    tn["auto_as_of"] = now.date().isoformat()
    save(DATA / "theme_news.json", tn)

    dates = [s.get("last_date") for s in stocks.values() if s.get("last_date")]
    market = {"as_of": max(dates) if dates else prev.get("as_of"),
              "updated_at": now.isoformat(timespec="minutes"),
              "source": "네이버 금융 자동 수집", "kospi": kospi, "stocks": stocks,
              "themes": compute_themes(config, stocks, kospi), "failures": failures}
    save(DATA / "market.json", market)
    print(f"완료: 종목 {len(stocks)}개, 실패 {len(failures)}건")
    for f in failures:
        print("  실패:", f)


if __name__ == "__main__":
    main()
