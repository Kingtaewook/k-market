"""큰 체결(5,000만원 이상) 하루 집계 — 거래대금 상위 40종목을 장 내내 실시간으로 지켜봄

- 한국투자증권 실시간 체결(웹소켓 H0STCNT0, 한 연결에 최대 40종목)
- 체결마다 금액 = 가격 × 수량, 체결구분(1 매수 / 5 매도)은 증권사가 주는 값 그대로
- 30초마다 Supabase 표 big_trades_day(code, d, data) 에 종목별 집계를 덮어씀
    data = {count, buy, sell, buy_amt, sell_amt, slots:[[매수횟수, 매도횟수, 전체거래대금] × 14칸(30분 단위)], recent:[...]}
- 30분마다 거래대금 상위 40종목을 다시 골라 구독을 바꿈
- 끝나는 시각(UNTIL, 한국시간 HH:MM)이 되면 저장하고 종료 (GitHub 작업은 6시간 제한 → 오전·오후 두 번 실행)

필요한 환경 변수: KIS_APP_KEY, KIS_APP_SECRET, SUPABASE_SERVICE_KEY, (선택) UNTIL, THRESHOLD
"""
from __future__ import annotations

import asyncio
import datetime as dt
import json
import os
import sys
import time

import requests
import websockets

KST = dt.timezone(dt.timedelta(hours=9))
SB_URL = "https://unqahkpxfasufcvpbeai.supabase.co"
KIS = "https://openapi.koreainvestment.com:9443"
WS_URL = "ws://ops.koreainvestment.com:21000/tryitout"
THRESHOLD = float(os.environ.get("THRESHOLD") or 50_000_000)
MAX_SUBS = 40
NF = 46  # H0STCNT0 한 체결당 항목 수
SLOT0, SLOTS = 9 * 60, 14  # 09:00 부터 30분 칸 14개 (마지막 칸 = 15:30 마감 동시호가)


def now():
    return dt.datetime.now(KST)


def sb_headers():
    k = os.environ["SUPABASE_SERVICE_KEY"]
    return {"apikey": k, "authorization": f"Bearer {k}", "content-type": "application/json"}


def until_time():
    hh, mm = (os.environ.get("UNTIL") or "15:35").split(":")
    t = now().replace(hour=int(hh), minute=int(mm), second=0, microsecond=0)
    return t


def approval_key():
    r = requests.post(f"{KIS}/oauth2/Approval", json={"grant_type": "client_credentials", "appkey": os.environ["KIS_APP_KEY"],
                                                     "secretkey": os.environ["KIS_APP_SECRET"]}, timeout=20)
    j = r.json()
    if not j.get("approval_key"):
        raise RuntimeError(f"웹소켓 접속키 실패: {j}")
    return j["approval_key"]


def top_codes(n=MAX_SUBS):
    """서버 5분 시세(live_cache id=1)에서 거래대금 상위 n종목"""
    r = requests.get(f"{SB_URL}/rest/v1/live_cache?id=eq.1&select=data", headers=sb_headers(), timeout=20)
    rows = (r.json() or [{}])[0].get("data", {}).get("rows", {})
    ranked = sorted(((c, v[2] or 0) for c, v in rows.items() if len(v) > 2), key=lambda x: x[1], reverse=True)
    return [c for c, _ in ranked[:n]]


class Book:
    """종목별 오늘 집계"""

    def __init__(self, day):
        self.day = day
        self.data: dict[str, dict] = {}
        self.dirty: set[str] = set()

    def load(self, codes):
        if not codes:
            return
        q = ",".join(codes)
        r = requests.get(f"{SB_URL}/rest/v1/big_trades_day?d=eq.{self.day}&code=in.({q})&select=code,data", headers=sb_headers(), timeout=20)
        for row in r.json() if r.ok else []:
            self.data[row["code"]] = row["data"]

    def get(self, code):
        if code not in self.data:
            self.data[code] = {"count": 0, "buy": 0, "sell": 0, "buy_amt": 0, "sell_amt": 0,
                               "slots": [[0, 0, 0] for _ in range(SLOTS)], "recent": [], "threshold": THRESHOLD}
        return self.data[code]

    def add(self, code, hhmmss, px, vol, side):
        amt = px * vol
        d = self.get(code)
        m = int(hhmmss[:2]) * 60 + int(hhmmss[2:4])
        s = max(0, min(SLOTS - 1, (m - SLOT0) // 30))
        d["slots"][s][2] += amt  # 이 시간대 전체 거래대금 (몰림 그래프용)
        if amt >= THRESHOLD:
            d["count"] += 1
            if side == "buy":
                d["buy"] += 1; d["buy_amt"] += amt; d["slots"][s][0] += 1
            elif side == "sell":
                d["sell"] += 1; d["sell_amt"] += amt; d["slots"][s][1] += 1
            d["recent"] = ([{"t": f"{hhmmss[:2]}:{hhmmss[2:4]}:{hhmmss[4:6]}", "px": px, "vol": vol, "amt": amt, "side": side}] + d["recent"])[:30]
        self.dirty.add(code)

    def flush(self):
        if not self.dirty:
            return
        rows = [{"code": c, "d": self.day, "data": self.data[c], "updated_at": dt.datetime.now(dt.timezone.utc).isoformat()} for c in self.dirty]
        h = {**sb_headers(), "prefer": "resolution=merge-duplicates,return=minimal"}
        r = requests.post(f"{SB_URL}/rest/v1/big_trades_day", headers=h, data=json.dumps(rows), timeout=30)
        if r.ok:
            self.dirty.clear()
        else:
            print(f"[저장 실패] {r.status_code} {r.text[:200]}", flush=True)


def sub_msg(key, code, on=True):
    return json.dumps({"header": {"approval_key": key, "custtype": "P", "tr_type": "1" if on else "2", "content-type": "utf-8"},
                       "body": {"input": {"tr_id": "H0STCNT0", "tr_key": code}}})


async def run():
    end = until_time()
    day = now().date().isoformat()
    book = Book(day)
    key = approval_key()
    subs: list[str] = []
    last_flush = last_pick = 0.0
    n_trades = 0
    while now() < end:
        try:
            async with websockets.connect(WS_URL, ping_interval=None, max_size=2 ** 22) as ws:
                want = top_codes()
                book.load(want)
                for c in want:
                    await ws.send(sub_msg(key, c)); await asyncio.sleep(0.05)
                subs = want
                last_pick = time.time()
                print(f"[구독] {len(subs)}종목: {', '.join(subs[:10])} …", flush=True)
                while now() < end:
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=5)
                    except asyncio.TimeoutError:
                        raw = None
                    if raw:
                        if raw[0] in "01":
                            p = raw.split("|")
                            if len(p) >= 4 and p[1] == "H0STCNT0":
                                f, cnt = p[3].split("^"), int(p[2] or 1)
                                for i in range(cnt):
                                    r = f[i * NF:(i + 1) * NF]
                                    if len(r) < 22:
                                        continue
                                    try:
                                        px, vol = float(r[2]), float(r[12])
                                    except ValueError:
                                        continue
                                    side = {"1": "buy", "5": "sell"}.get(r[21], "?")
                                    book.add(r[0], r[1], px, vol, side)
                                    n_trades += 1
                        else:
                            try:
                                j = json.loads(raw)
                            except ValueError:
                                j = {}
                            if j.get("header", {}).get("tr_id") == "PINGPONG":
                                await ws.send(raw)  # 살아 있다고 답하기
                            elif j.get("body", {}).get("rt_cd") not in (None, "0"):
                                print(f"[응답] {j.get('body', {}).get('msg1')}", flush=True)
                    t = time.time()
                    if t - last_flush > 30:
                        book.flush(); last_flush = t
                        print(f"[{now():%H:%M:%S}] 체결 {n_trades}건 처리, 저장 완료", flush=True)
                    if t - last_pick > 1800:  # 30분마다 거래대금 상위 다시 고르기
                        want = top_codes()
                        out, new = [c for c in subs if c not in want], [c for c in want if c not in subs]
                        for c in out:
                            await ws.send(sub_msg(key, c, False)); await asyncio.sleep(0.05)
                        book.load(new)
                        for c in new:
                            await ws.send(sub_msg(key, c)); await asyncio.sleep(0.05)
                        subs, last_pick = want, t
                        if out or new:
                            print(f"[구독 변경] -{len(out)} +{len(new)}", flush=True)
        except Exception as e:
            print(f"[연결 끊김] {e} → 5초 뒤 다시", flush=True)
            book.flush()
            await asyncio.sleep(5)
    book.flush()
    print("끝", flush=True)


if __name__ == "__main__":
    if not os.environ.get("SUPABASE_SERVICE_KEY") or not os.environ.get("KIS_APP_KEY"):
        print("SUPABASE_SERVICE_KEY / KIS 키가 없어서 종료")
        sys.exit(0)
    asyncio.run(run())
