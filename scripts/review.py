"""돌아보기·전망 데이터 (data/review.json)

- 기간별(이번 주·이번 달) 강세/약세 테마·업종 순위
- 주도 테마가 바뀐 흐름 (최근 8주, 3개월)
- 코스피·코스닥 60일 차트 + 한 줄 총평
- 다음 주 '주목할 흐름' (규칙 기반: 모멘텀 지속/새로 부상/식는 중/과열 + 일정) — 매수·매도 권유가 아님
- 앞으로 30일 일정 + 3단계 코멘트: ① 일정 설명 ② 지수 리밸런싱·수급 영향 ③ 과거 패턴(코스피 10년)

update_data.py 의 오후 실행(전 종목 일봉 hist 가 있을 때)에서 build_review() 를 부름.
"""
from __future__ import annotations

import datetime as dt
import statistics as st

# ------------------------------------------------------------------ 일정 (사람이 확인한 날짜)
# 출처: 연준 FOMC 일정(2026.11.12 수정 발표), 한국은행 2027 금통위 일정(2026.10.29 의결), 미 노동통계국(BLS) 발표 일정
FOMC = ["2026-12-09", "2027-01-27", "2027-03-17", "2027-04-28", "2027-06-09", "2027-07-28", "2027-09-15", "2027-11-17"]  # 결정일(미국 시간, 한국은 다음 날 새벽)
FOMC_STRATEGY = ["2027-10-27"]  # 금리 결정 없는 전략 회의
BOK = ["2027-01-14", "2027-02-25", "2027-04-09", "2027-05-27", "2027-07-15", "2027-08-26", "2027-10-15", "2027-11-25"]
US_CPI = ["2026-12-10", "2027-01-13", "2027-02-11", "2027-03-10", "2027-04-13", "2027-05-12", "2027-06-10", "2027-07-14",
          "2027-08-11", "2027-11-10", "2027-12-10"]
US_JOBS = ["2026-12-04", "2027-01-08", "2027-02-05", "2027-04-02"]
# 한국거래소 휴장일 (만기일이 휴장이면 하루 앞당겨짐)
KRX_HOLIDAYS = {"2026-12-25", "2026-12-31", "2027-01-01", "2027-02-08", "2027-02-09", "2027-03-01", "2027-05-05",
                "2027-05-13", "2027-06-03", "2027-08-16", "2027-09-14", "2027-09-15", "2027-09-16", "2027-10-04",
                "2027-10-11", "2027-12-31"}


def _d(s):
    return dt.date.fromisoformat(s)


def is_trading(d: dt.date):
    return d.weekday() < 5 and d.isoformat() not in KRX_HOLIDAYS


def prev_trading(d: dt.date):
    while not is_trading(d):
        d -= dt.timedelta(days=1)
    return d


def second_thursday(y, m):
    d = dt.date(y, m, 1)
    while d.weekday() != 3:
        d += dt.timedelta(days=1)
    return d + dt.timedelta(days=7)


def last_trading_of_month(y, m):
    d = (dt.date(y + (m == 12), m % 12 + 1, 1)) - dt.timedelta(days=1)
    return prev_trading(d)


# ------------------------------------------------------------------ 과거 패턴 (코스피 일봉)
def _closes(rows):
    return [(r["date"], r["close"]) for r in rows if r.get("close")]


def _day_ret(cl, idx):
    return cl[idx][1] / cl[idx - 1][1] - 1 if idx > 0 else None


def pattern_stats(kospi_rows):
    """코스피 과거 패턴: 만기일 당일, 쿼드러플위칭, 달별 계절성, 연말 배당락일, 월말·월초"""
    cl = _closes(kospi_rows)
    if len(cl) < 300:
        return {}
    pos = {d: i for i, (d, _) in enumerate(cl)}
    dates = [_d(d) for d, _ in cl]

    def at_or_before(day: dt.date):
        k = day.isoformat()
        while k not in pos and day > dates[0]:
            day -= dt.timedelta(days=1)
            k = day.isoformat()
        return pos.get(k)

    def summ(xs):
        xs = [x for x in xs if x is not None]
        if len(xs) < 4:
            return None
        return {"n": len(xs), "avg": round(st.mean(xs), 5), "up": round(sum(1 for x in xs if x > 0) / len(xs), 3)}

    exp, quad, months = [], [], {m: [] for m in range(1, 13)}
    for y in range(dates[0].year, dates[-1].year + 1):
        for m in range(1, 13):
            i = at_or_before(second_thursday(y, m))
            if i and dates[i] >= dates[0] + dt.timedelta(days=10) and dates[i].month == m:
                r = _day_ret(cl, i)
                exp.append(r)
                if m in (3, 6, 9, 12):
                    quad.append(r)
            # 달별 수익률: 전달 마지막 거래일 → 그달 마지막 거래일
            a = at_or_before(dt.date(y, m, 1) - dt.timedelta(days=1))
            b = at_or_before(dt.date(y + (m == 12), m % 12 + 1, 1) - dt.timedelta(days=1))
            if a and b and b > a and dates[b].month == m and dates[b] < dates[-1]:
                months[m].append(cl[b][1] / cl[a][1] - 1)
    # 연말 배당락일 = 12월 마지막 거래일의 전 거래일
    divx = []
    for y in range(dates[0].year, dates[-1].year):
        b = at_or_before(dt.date(y, 12, 31))
        if b and dates[b].month == 12 and b - 1 > 0:
            divx.append(_day_ret(cl, b - 1))
    # 월말 마지막 2일 + 월초 첫 2일
    tom = []
    for i in range(3, len(cl) - 2):
        if dates[i].month != dates[i + 1].month:
            tom.append(cl[i + 2][1] / cl[i - 2][1] - 1)
    return {"expiry": summ(exp), "quad": summ(quad), "dividend_ex": summ(divx), "turn_of_month": summ(tom),
            "months": {str(m): summ(v) for m, v in months.items()}, "years": f"{dates[0].year}~{dates[-1].year}"}


def _pat(p, word):
    if not p:
        return "과거 자료가 부족해요."
    return f"지난 {p['n']}번 {word} 코스피는 평균 {p['avg'] * 100:+.2f}%, 오른 비율 {p['up'] * 100:.0f}%였어요."


# ------------------------------------------------------------------ 일정 목록 + 3단계 코멘트
def upcoming_events(today: dt.date, pats: dict, days=35):
    """[{date, title, kind, tags, steps:[일정, 수급·리밸런싱, 과거 패턴]}]"""
    end = today + dt.timedelta(days=days)
    ev = []

    def add(date, title, kind, s1, s2, s3, tags=()):
        if today <= date <= end:
            ev.append({"date": date.isoformat(), "title": title, "kind": kind, "tags": list(tags), "steps": [s1, s2, s3]})

    for k in range(0, 3):
        y, m = today.year + (today.month - 1 + k) // 12, (today.month - 1 + k) % 12 + 1
        exp = prev_trading(second_thursday(y, m))
        if m in (3, 6, 9, 12):
            add(exp, "쿼드러플 위칭데이 (선물·옵션 동시 만기)", "만기",
                "주가지수 선물·옵션, 개별주식 선물·옵션이 한꺼번에 만기되는 날이에요. 장 마감 동시호가에 거래가 몰려요.",
                "프로그램 매매(차익거래) 청산 물량이 나오면 대형주 위주로 장 막판 변동이 커질 수 있어요."
                + (" 이번 만기 다음 날 코스피200 정기변경이 적용돼, 편입·편출 종목에 지수 추종 자금이 움직여요." if m in (6, 12) else ""),
                _pat(pats.get("quad"), "쿼드러플 위칭데이에"), ["만기", "리밸런싱"] if m in (6, 12) else ["만기"])
            if m in (6, 12):
                add(exp + dt.timedelta(days=1), "코스피200 정기변경 적용", "리밸런싱",
                    "코스피200 구성 종목이 바뀌어 적용되는 날이에요(만기일 다음 거래일).",
                    "편입 종목은 지수 추종 펀드 매수, 편출 종목은 매도가 미리 반영되는 경우가 많아요. 발표 후 적용일까지 미리 움직이는 경향이 있어요.",
                    "편입 기대감은 발표~적용 사이에 먼저 반영되고, 적용 당일에는 오히려 차익 실현이 나오는 일이 잦아요.", ["리밸런싱"])
        else:
            add(exp, "선물·옵션 만기일", "만기",
                "코스피200 옵션 등 파생상품 만기일이에요(매달 둘째 목요일).",
                "장 마감 무렵 프로그램 매매로 대형주 변동이 커질 수 있어요.",
                _pat(pats.get("expiry"), "만기일에"), ["만기"])
        if m in (2, 5, 8, 11):
            add(last_trading_of_month(y, m), "MSCI 분기 리뷰 적용", "리밸런싱",
                "MSCI 지수 구성 변경이 그달 마지막 거래일 장 마감에 반영돼요.",
                "MSCI 지수를 따라가는 외국인 패시브 자금이 장 마감 동시호가에 대규모로 사고팔아요. 편입·편출 종목은 마감 직전 변동이 커요.",
                "편입 발표(보통 그달 중순) 뒤 적용일까지 미리 오르고, 적용일 마감에 거래량이 폭발하는 패턴이 흔해요.", ["리밸런싱", "외국인"])
        if m == 12:
            last = last_trading_of_month(y, 12)
            add(prev_trading(last - dt.timedelta(days=1)), "연말 배당락일", "배당",
                "12월 결산 배당주는 이날부터 배당 권리가 없어져 주가가 배당만큼 낮아져 출발해요.",
                "배당을 노린 매수 → 배당락 뒤 매도 흐름, 연말 대주주 양도세 회피 매도(개인)가 겹쳐 중소형주 변동이 커질 수 있어요. 최근에는 배당 기준일을 이듬해로 바꾼 회사도 많아요.",
                _pat(pats.get("dividend_ex"), "연말 배당락일에"), ["배당", "수급"])
        # 실적 시즌 (잠정 실적 발표 집중 시기)
        if m in (1, 4, 7, 10):
            add(dt.date(y, m, 7) if is_trading(dt.date(y, m, 7)) else prev_trading(dt.date(y, m, 7)), "실적 시즌 시작 (삼성전자 등 잠정 실적)", "실적",
                "분기가 끝난 뒤 첫 주부터 대형주 잠정 실적이 나오기 시작해 한 달간 실적 발표가 이어져요.",
                "실적이 기대보다 좋거나 나쁜 업종으로 자금이 빠르게 옮겨 가요. 증권사 목표주가 조정도 몰려요.",
                "실적 시즌에는 테마보다 실적·업황이 좋은 업종의 상대 강도가 높아지는 경향이 있어요.", ["실적"])
        # 월말·월초
        add(last_trading_of_month(y, m), "월말 (다음 날 월초)", "계절성",
            "한 달이 바뀌는 구간이에요.",
            "월초에는 연기금·펀드 신규 자금 집행이 몰리는 편이에요.",
            _pat(pats.get("turn_of_month"), "월말 2일~월초 2일 동안"), ["계절성"])

    for s in FOMC:
        add(_d(s) + dt.timedelta(days=1), "미국 FOMC 금리 결정 (한국 시간 새벽)", "해외",
            "미국 연준이 기준금리를 정하는 회의예요. 결과는 한국 시간 다음 날 새벽 4시쯤 나와요.",
            "금리·달러 방향이 외국인 수급과 성장주(반도체·2차전지·바이오) 밸류에 바로 영향을 줘요. 회의 전에는 관망, 결과 뒤 방향성이 생기는 경우가 많아요.",
            "결과보다 '앞으로 금리 경로' 발언이 시장을 더 크게 움직이는 일이 잦아요.", ["해외", "금리"])
    for s in FOMC_STRATEGY:
        add(_d(s) + dt.timedelta(days=1), "미국 FOMC 전략 회의 (금리 결정 없음)", "해외",
            "이번 회의는 금리를 정하지 않고 장기 통화정책 전략만 논의해요.",
            "결정이 없어 영향은 작을 수 있지만, 전략 변화 메시지가 나오면 금리 기대가 바뀔 수 있어요.",
            "처음 열리는 형식이라 과거 패턴이 없어요.", ["해외", "금리"])
    for s in BOK:
        add(_d(s), "한국은행 금통위 기준금리 결정", "국내",
            "한국은행이 기준금리를 정하는 날이에요(오전 발표, 총재 기자간담회).",
            "금리 동결·인상·인하에 따라 은행·증권·건설·부동산 관련주와 원화 환율이 먼저 반응해요.",
            "결정 자체보다 '앞으로' 발언(소수의견, 총재 발언)이 채권·은행주 방향을 정하는 일이 많아요.", ["국내", "금리"])
    for s in US_CPI:
        add(_d(s), "미국 소비자물가(CPI) 발표 (한국 시간 밤 10:30)", "해외",
            "미국 물가 지표예요. 한국 시간 밤 10시 30분(서머타임 땐 9시 30분)에 나와요.",
            "예상보다 높으면 금리 인하 기대가 줄어 다음 날 성장주에 부담, 낮으면 반대예요.",
            "발표 다음 날 코스피는 미국 증시 반응을 그대로 따라가는 경향이 강해요.", ["해외", "물가"])
    for s in US_JOBS:
        add(_d(s), "미국 고용보고서 발표 (한국 시간 밤 10:30)", "해외",
            "미국 일자리·실업률 지표예요.",
            "고용이 너무 강하면 금리 부담, 너무 약하면 경기 걱정 — 어느 쪽이든 다음 날 변동이 커질 수 있어요.",
            "발표 다음 날 외국인 매매 방향이 바뀌는 일이 종종 있어요.", ["해외", "고용"])
    ev.sort(key=lambda e: e["date"])
    return ev


# ------------------------------------------------------------------ 기간별 테마·업종
def _group_daily(groups, hist, dates):
    """그룹별 날짜별 평균 등락률 (구성 종목 단순 평균)"""
    pos = {}
    for c, rows in hist.items():
        m = {r["date"]: r["close"] for r in rows if r.get("close")}
        pos[c] = m
    out = {}
    for g in groups:
        series = []
        for i, d in enumerate(dates):
            if i == 0:
                series.append(None)
                continue
            ch = []
            for c in g.get("codes", []):
                m = pos.get(c)
                if m and d in m and dates[i - 1] in m and m[dates[i - 1]]:
                    ch.append(m[d] / m[dates[i - 1]] - 1)
            series.append(round(st.mean(ch), 5) if len(ch) >= 3 else None)
        out[str(g["no"])] = series
    return out


def _compound(xs):
    v, n = 1.0, 0
    for x in xs:
        if x is not None:
            v *= 1 + x
            n += 1
    return v - 1 if n else None


def _rank(daily, idxs, top=7):
    arr = [(no, _compound([s[i] for i in idxs])) for no, s in daily.items()]
    arr = [(no, r) for no, r in arr if r is not None]
    arr.sort(key=lambda x: x[1], reverse=True)
    return {"top": [[int(no), round(r, 4)] for no, r in arr[:top]], "bottom": [[int(no), round(r, 4)] for no, r in arr[-top:][::-1]]}


def build_review(groups_json, hist, kospi_rows, kosdaq_rows, journal, today: dt.date):
    themes, inds = groups_json.get("themes") or [], groups_json.get("industries") or []
    kcl = _closes(kospi_rows)
    dates = [d for d, _ in kcl][-61:]
    td = {"themes": _group_daily(themes, hist, dates), "industries": _group_daily(inds, hist, dates)}
    D = [_d(x) for x in dates]
    last = D[-1]
    wk = [i for i, d in enumerate(D) if d.isocalendar()[:2] == last.isocalendar()[:2] and i > 0]
    mo = [i for i, d in enumerate(D) if (d.year, d.month) == (last.year, last.month) and i > 0]
    periods = {}
    for key, idxs in (("week", wk), ("month", mo)):
        if not idxs:
            continue
        kret = kcl[-61:][idxs[-1]][1] / kcl[-61:][idxs[0] - 1][1] - 1
        periods[key] = {"from": dates[idxs[0]], "to": dates[idxs[-1]], "days": len(idxs), "kospi": round(kret, 4),
                        "themes": _rank(td["themes"], idxs), "industries": _rank(td["industries"], idxs, top=5)}
    # 주도 테마 흐름: 최근 8주 (주별 1위~3위), 최근 3개월 (월별 1~3위)
    weeks = {}
    for i, d in enumerate(D):
        if i:
            weeks.setdefault(d.isocalendar()[:2], []).append(i)
    rot_w = []
    for k in sorted(weeks)[-8:]:
        idxs = weeks[k]
        r = _rank(td["themes"], idxs, top=3)
        rot_w.append({"label": f"{D[idxs[0]]:%m/%d}~{D[idxs[-1]]:%m/%d}", "top": r["top"]})
    months_ = {}
    for i, d in enumerate(D):
        if i:
            months_.setdefault((d.year, d.month), []).append(i)
    rot_m = [{"label": f"{k[1]}월", "top": _rank(td["themes"], v, top=3)["top"]} for k, v in sorted(months_.items())[-3:]]

    # 지수 차트 60일
    def ser(rows):
        c = _closes(rows)[-60:]
        return [[d[5:], round(v, 2)] for d, v in c]
    kser, qser = ser(kospi_rows), ser(kosdaq_rows) if kosdaq_rows else []

    # 한 줄 총평 (이번 주·이번 달)
    def verdict(p, name):
        if not p:
            return ""
        k = p["kospi"]
        tone = "크게 올랐어요" if k > 0.03 else "올랐어요" if k > 0.005 else "크게 내렸어요" if k < -0.03 else "내렸어요" if k < -0.005 else "제자리걸음이었어요"
        t1 = next((g["name"] for g in themes if g["no"] == p["themes"]["top"][0][0]), "") if p["themes"]["top"] else ""
        b1 = next((g["name"] for g in themes if g["no"] == p["themes"]["bottom"][0][0]), "") if p["themes"]["bottom"] else ""
        return f"{name} 코스피는 {k * 100:+.1f}%로 {tone}. 가장 강한 테마는 '{t1}', 가장 약한 테마는 '{b1}'."
    for key, name in (("week", "이번 주"), ("month", "이번 달")):
        if key in periods:
            periods[key]["comment"] = verdict(periods[key], name)

    # 다음 주 주목할 흐름 (규칙 기반)
    outlook = []
    kc = [v for _, v in kcl]
    if len(kc) >= 21:
        ma20 = st.mean(kc[-20:])
        r5 = kc[-1] / kc[-6] - 1
        pos_ = "20일 평균 위" if kc[-1] > ma20 else "20일 평균 아래"
        outlook.append({"kind": "시장", "text": f"코스피는 {pos_}({(kc[-1] / ma20 - 1) * 100:+.1f}%), 최근 5일 {r5 * 100:+.1f}%. "
                        + ("상승 추세가 이어지는 구간이에요." if kc[-1] > ma20 and r5 > 0 else
                           "단기 반등 중이지만 추세 확인이 필요해요." if kc[-1] <= ma20 and r5 > 0 else
                           "오름세가 쉬어 가는 구간이에요." if kc[-1] > ma20 else "약세 흐름이라 보수적으로 보는 편이 좋아요.")})
    days_ = sorted((journal or {}).get("days", {}).items())[-5:]
    ups = [(v.get("close") or {}).get("breadth") for _, v in days_]
    ups = [b["up"] / max(1, b["up"] + b["down"]) for b in ups if b]
    if len(ups) >= 3:
        avg = st.mean(ups)
        outlook.append({"kind": "체온", "text": f"최근 {len(ups)}일 평균 상승 종목 비율 {avg * 100:.0f}% — "
                        + ("오르는 종목이 많아 시장 전반이 뜨거워요." if avg > 0.6 else "내리는 종목이 많아 체감은 차가워요." if avg < 0.4 else "종목별로 엇갈리는 장이에요.")})
    if "week" in periods and "month" in periods:
        name = {g["no"]: g["name"] for g in themes}
        w_top = [no for no, _ in periods["week"]["themes"]["top"]]
        m_top = [no for no, _ in periods["month"]["themes"]["top"]]
        w_bot = [no for no, _ in periods["week"]["themes"]["bottom"]]
        keep = [name[n] for n in w_top if n in m_top][:3]
        new = [name[n] for n in w_top if n not in m_top][:3]
        cool = [name[n] for n in m_top if n in w_bot][:3]
        hot = [name[no] for no, r in periods["week"]["themes"]["top"] if r > 0.2][:3]
        if keep:
            outlook.append({"kind": "지속", "text": f"한 달 내내 강했고 이번 주에도 강한 테마: {', '.join(keep)} — 추세가 이어질지 지켜볼 만해요."})
        if new:
            outlook.append({"kind": "부상", "text": f"이번 주 새로 떠오른 테마: {', '.join(new)} — 뉴스·공시로 이유를 확인해 보세요."})
        if cool:
            outlook.append({"kind": "식는 중", "text": f"한 달간 강했지만 이번 주 약해진 테마: {', '.join(cool)} — 차익 실현이 나오는지 살펴보세요."})
        if hot:
            outlook.append({"kind": "과열", "text": f"일주일 새 20% 넘게 오른 테마: {', '.join(hot)} — 단기 과열로 변동성이 커질 수 있어요."})
    return {"as_of": dates[-1], "periods": periods, "rotation": {"weeks": rot_w, "months": rot_m},
            "index": {"kospi": kser, "kosdaq": qser}, "outlook": outlook}
