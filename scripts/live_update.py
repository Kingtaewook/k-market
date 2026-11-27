"""장중·시간외 빠른 시세 갱신 → data/live.json

GitHub Actions 에서 장중 15분마다(09:05~15:35), 11:02(브리핑), 15:47(장 마감 브리핑), 20:12(NXT 마감) 실행.
- 한국투자증권(KIS) 키가 있으면 KIS 멀티종목 시세(30종목/1회)로 전 종목을 받음
  · 환경변수 KIS_APP_KEY, KIS_APP_SECRET (GitHub Secrets)
  · --nxt 면 넥스트레이드(NX) 가격
- 키가 없으면 네이버 증권 시가총액 목록으로 대신 받음 (NXT 는 키가 있어야 함)

옵션
  --brief  10초 브리핑 스냅샷(코스피·상승/하락·테마 등락)도 함께 저장
  --nxt    넥스트레이드 마감 가격 기준 (밤 8시 이후)
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from update_data import DATA, KST, get, load, num, save, SESSION  # noqa: E402

KIS = "https://openapi.koreainvestment.com:9443"
FIELDS = ["close", "chg", "amount"]


# ---------------------------------------------------------------- 한국투자증권
def kis_token(key, secret):
    try:  # 같은 실행에서 update_data.py 가 받아 둔 토큰이 있으면 그대로 (발급은 1분에 1번만 허용)
        import sources
        return sources.kis_token()
    except Exception as e:
        print(f"[KIS] 공유 토큰 없음 → 새로 발급 ({e})")
    r = SESSION.post(f"{KIS}/oauth2/tokenP", json={"grant_type": "client_credentials", "appkey": key, "appsecret": secret},
                     headers={"content-type": "application/json"}, timeout=20)
    j = r.json()
    if not j.get("access_token"):
        raise RuntimeError(f"KIS 토큰 발급 실패: {str(j)[:200]}")
    return j["access_token"]


def kis_get(path, tr_id, params, key, secret, token):
    h = {"authorization": f"Bearer {token}", "appkey": key, "appsecret": secret, "tr_id": tr_id, "custtype": "P",
         "content-type": "application/json; charset=utf-8"}
    for i in range(4):
        r = SESSION.get(f"{KIS}{path}", headers=h, params=params, timeout=20)
        j = r.json()
        if j.get("rt_cd") == "0":
            return j
        if "EGW00201" in str(j.get("msg_cd")):  # 초당 호출 초과 → 잠깐 쉬고 다시
            time.sleep(0.6 * (i + 1))
            continue
        raise RuntimeError(f"{tr_id} {j.get('msg_cd')} {j.get('msg1')}")
    raise RuntimeError(f"{tr_id} 호출 한도 초과")


def kis_all(codes, market):
    key, secret = os.environ["KIS_APP_KEY"], os.environ["KIS_APP_SECRET"]
    token = kis_token(key, secret)
    rows, fails = {}, 0
    for i in range(0, len(codes), 30):
        chunk = codes[i:i + 30]
        params = {}
        for n, c in enumerate(chunk, 1):
            params[f"FID_COND_MRKT_DIV_CODE_{n}"] = market
            params[f"FID_INPUT_ISCD_{n}"] = c
        try:
            j = kis_get("/uapi/domestic-stock/v1/quotations/intstock-multprice", "FHKST11300006", params, key, secret, token)
            for o in j.get("output") or []:
                c, px = o.get("inter_shrn_iscd"), num(o.get("inter2_prpr"))
                if c and px:
                    rows[c] = [px, (num(o.get("prdy_ctrt")) or 0) / 100, num(o.get("acml_tr_pbmn"))]
        except Exception as e:
            fails += 1
            print(f"[KIS] {i}~ 실패: {e}")
        time.sleep(0.08)  # 초당 20건 한도 아래로
    kospi = None
    try:
        j = kis_get("/uapi/domestic-stock/v1/quotations/inquire-index-price", "FHPUP02100000",
                    {"FID_COND_MRKT_DIV_CODE": "U", "FID_INPUT_ISCD": "0001"}, key, secret, token)
        o = j.get("output") or {}
        kospi = {"close": num(o.get("bstp_nmix_prpr")), "chg": (num(o.get("bstp_nmix_prdy_ctrt")) or 0) / 100}
    except Exception as e:
        print(f"[KIS] 코스피 지수 실패: {e}")
    return rows, kospi, fails


# ---------------------------------------------------------------- 네이버 (키가 없을 때)
def naver_all():
    rows = {}
    for mk in ("KOSPI", "KOSDAQ"):
        for page in range(1, 60):
            j = get(f"https://m.stock.naver.com/api/stocks/marketValue/{mk}?page={page}&pageSize=100").json()
            items = j.get("stocks") or []
            if not items:
                break
            for s in items:
                c, px = s.get("itemCode"), num(s.get("closePrice"))
                if c and px:
                    amt = num(s.get("accumulatedTradingValue"))  # 백만원
                    rows[c] = [px, (num(s.get("fluctuationsRatio")) or 0) / 100, amt * 1e6 if amt else None]
            time.sleep(0.1)
    kospi = None
    try:
        j = get("https://m.stock.naver.com/api/index/KOSPI/basic").json()
        kospi = {"close": num(j.get("closePrice")), "chg": (num(j.get("fluctuationsRatio")) or 0) / 100}
    except Exception as e:
        print(f"[네이버] 코스피 지수 실패: {e}")
    return rows, kospi, 0


# ---------------------------------------------------------------- 브리핑 스냅샷
def brief_snapshot(rows, kospi, label, now):
    allp = load(DATA / "market_all.json", {})
    F = allp.get("fields", [])
    base = {c: dict(zip(F, v)) for c, v in (allp.get("rows") or {}).items()}
    up = sum(1 for v in rows.values() if v[1] > 0)
    down = sum(1 for v in rows.values() if v[1] < 0)
    high52 = sum(1 for c, v in rows.items() if base.get(c, {}).get("hi52") and v[0] >= base[c]["hi52"] * 0.995)
    low52 = sum(1 for c, v in rows.items() if base.get(c, {}).get("lo52") and v[0] <= base[c]["lo52"] * 1.005)
    groups = load(DATA / "groups.json", {})
    gchg = {}
    for g in groups.get("themes") or []:
        ch = [rows[c][1] for c in g.get("codes", []) if c in rows]
        if len(ch) >= 3:
            gchg[str(g["no"])] = [round(sum(ch) / len(ch), 5), sum(1 for x in ch if x > 0), sum(1 for x in ch if x < 0)]
    return {"at": now.isoformat(timespec="minutes"), "label": label, "kospi": kospi,
            "breadth": {"up": up, "down": down, "high52": high52, "low52": low52, "total": len(rows)}, "themes": gchg}


def main():
    brief, nxt = "--brief" in sys.argv, "--nxt" in sys.argv
    now = dt.datetime.now(KST)
    codes = [r[1] for r in load(DATA / "stocks.json", [])]
    use_kis = bool(os.environ.get("KIS_APP_KEY") and os.environ.get("KIS_APP_SECRET"))
    if nxt and not use_kis:
        print("NXT 가격은 한국투자증권 키가 있어야 받을 수 있어요 → 이번에는 건너뜀")
        return
    t0 = time.time()
    rows, kospi, fails = kis_all(codes, "NX" if nxt else "J") if use_kis else naver_all()
    src = ("한국투자증권" if use_kis else "네이버 금융") + (" · NXT" if nxt else "")
    print(f"[{src}] {len(rows)}종목, 실패 묶음 {fails}, {time.time() - t0:.0f}초")
    if len(rows) < 500:
        sys.exit("받은 종목이 너무 적어 저장하지 않음")
    prev = load(DATA / "live.json", {})
    out = {"updated_at": now.isoformat(timespec="minutes"), "date": now.date().isoformat(),
           "session": "nxt" if nxt else "regular", "source": src, "kospi": kospi or prev.get("kospi"),
           "fields": FIELDS, "rows": {c: v for c, v in sorted(rows.items())}, "brief": prev.get("brief")}
    if brief:
        hm = now.hour * 60 + now.minute
        label = "NXT 마감" if nxt else ("장 마감" if hm >= 15 * 60 + 30 else f"{now:%H:%M} 기준")
        out["brief"] = brief_snapshot(rows, kospi, label, now)
    save(DATA / "live.json", out, compact=True)
    print("live.json 저장" + (" + 브리핑" if brief else ""))


if __name__ == "__main__":
    main()
