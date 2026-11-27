"""뉴스·공시·경고 추가 출처 (네이버 증권은 예비로 계속 사용)

- DART 전자공시 (금융감독원 OpenDART, 환경변수 DART_API_KEY)
    · 최근 며칠 전체 상장사 공시 목록 → 종목코드별로 묶음, 제목으로 긍정/악재 분류
- 한국투자증권 종합 시황·공시 제목 (환경변수 KIS_APP_KEY, KIS_APP_SECRET)
    · 시장 전체 최신 뉴스 몇 페이지 + 관심 종목별 뉴스
- 한국투자증권 현재가의 시장경고 정보 → 투자주의·경고·위험, 거래정지, 단기과열, 관리종목
    · KIND(한국거래소)에 올라오는 지정 내역과 같은 내용을 종목별로 받음

키가 없으면 해당 출처는 조용히 건너뜀.
"""
from __future__ import annotations

import datetime as dt
import os
import re
import time
from urllib.parse import quote

import requests

KIS = "https://openapi.koreainvestment.com:9443"
DART = "https://opendart.fss.or.kr/api"
S = requests.Session()
S.headers.update({"user-agent": "Mozilla/5.0 (K-Market data bot)"})

# ---------------------------------------------------------------- DART 공시
# 공시 제목 → 분류. 먼저 맞는 규칙이 이김 (악재 먼저: '공급계약해지'가 '공급계약'보다 우선)
DART_NEG = ["해지", "취소", "철회", "정정명령", "유상증자", "전환사채", "신주인수권부사채", "교환사채", "감자", "횡령", "배임",
            "소송", "거래정지", "매매거래정지", "관리종목", "상장폐지", "상장적격성", "불성실공시", "영업정지", "회생절차",
            "파산", "부도", "감사의견", "투자경고", "투자위험", "단기과열", "손상차손", "최대주주변경", "자기주식처분"]
DART_POS = ["단일판매ㆍ공급계약체결", "단일판매·공급계약체결", "공급계약체결", "자기주식취득", "자기주식 취득", "자기주식소각",
            "주식소각", "현금ㆍ현물배당", "현금·현물배당", "배당", "무상증자", "특허권취득", "신규시설투자", "기술이전", "품목허가",
            "임상시험계획승인", "수주"]


def dart_classify(title: str) -> str:
    t = title.replace(" ", "")
    if any(k.replace(" ", "") in t for k in DART_NEG):
        return "주의"
    if any(k.replace(" ", "") in t for k in DART_POS):
        return "긍정"
    return "중립"


def dart_recent(days=5, max_pages=20):
    """최근 days 일 동안 유가·코스닥 상장사 공시 → {종목코드: [{date,time,title,source,url,impact,kind}]}"""
    key = os.environ.get("DART_API_KEY")
    if not key:
        print("[DART] 키 없음 → 건너뜀")
        return {}
    end = dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).date()
    bgn = end - dt.timedelta(days=days)
    out: dict[str, list] = {}
    n = 0
    for cls in ("Y", "K"):  # Y 유가증권, K 코스닥
        for page in range(1, max_pages + 1):
            try:
                j = S.get(f"{DART}/list.json", params={"crtfc_key": key, "bgn_de": bgn.strftime("%Y%m%d"),
                                                       "end_de": end.strftime("%Y%m%d"), "corp_cls": cls,
                                                       "page_no": page, "page_count": 100}, timeout=20).json()
            except Exception as e:
                print(f"[DART] 실패 {cls} {page}: {e}")
                break
            if j.get("status") not in ("000",):
                if j.get("status") != "013":  # 013 = 조회된 데이터 없음
                    print(f"[DART] {j.get('status')} {j.get('message')}")
                break
            for d in j.get("list") or []:
                code = (d.get("stock_code") or "").strip()
                if not re.fullmatch(r"\d{6}", code):
                    continue
                title = re.sub(r"\s+", " ", d.get("report_nm", "")).strip()
                dd = d.get("rcept_dt", "")
                out.setdefault(code, []).append({
                    "date": f"{dd[:4]}-{dd[4:6]}-{dd[6:8]}" if len(dd) == 8 else None, "time": None,
                    "title": title, "source": "DART 공시", "summary": d.get("flr_nm", ""),
                    "url": f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={d.get('rcept_no')}",
                    "impact": dart_classify(title), "auto": True, "kind": "공시"})
                n += 1
            if page >= int(j.get("total_page") or 1):
                break
            time.sleep(0.15)
    print(f"[DART] 공시 {n}건, 종목 {len(out)}개")
    return out


# ---------------------------------------------------------------- 한국투자증권 공통
_TOKEN = None


def kis_ready():
    return bool(os.environ.get("KIS_APP_KEY") and os.environ.get("KIS_APP_SECRET"))


def kis_token():
    """한국투자증권 접근 토큰 (같은 실행 안에서는 파일로 공유 — 토큰 발급은 1분에 1번만 허용)"""
    global _TOKEN
    if _TOKEN:
        return _TOKEN
    cache = "/tmp/kis_token.json"
    try:
        import json
        c = json.load(open(cache))
        if c.get("exp", 0) > time.time() + 600:
            _TOKEN = c["token"]
            return _TOKEN
    except Exception:
        pass
    r = S.post(f"{KIS}/oauth2/tokenP", json={"grant_type": "client_credentials", "appkey": os.environ["KIS_APP_KEY"],
                                            "appsecret": os.environ["KIS_APP_SECRET"]}, timeout=20)
    j = r.json()
    if not j.get("access_token"):
        raise RuntimeError(f"KIS 토큰 실패: {str(j)[:200]}")
    _TOKEN = j["access_token"]
    try:
        import json
        json.dump({"token": _TOKEN, "exp": time.time() + int(j.get("expires_in") or 86400)}, open(cache, "w"))
    except Exception:
        pass
    return _TOKEN


def kis_call(path, tr_id, params, tr_cont=""):
    """(본문, 다음 페이지 있음?)"""
    h = {"authorization": f"Bearer {kis_token()}", "appkey": os.environ["KIS_APP_KEY"], "appsecret": os.environ["KIS_APP_SECRET"],
         "tr_id": tr_id, "custtype": "P", "tr_cont": tr_cont, "content-type": "application/json; charset=utf-8"}
    for i in range(4):
        r = S.get(f"{KIS}{path}", headers=h, params=params, timeout=20)
        j = r.json()
        if j.get("rt_cd") == "0":
            return j, r.headers.get("tr_cont") in ("M", "F")
        if "EGW00201" in str(j.get("msg_cd")):
            time.sleep(0.7 * (i + 1))
            continue
        raise RuntimeError(f"{tr_id} {j.get('msg_cd')} {j.get('msg1')}")
    raise RuntimeError(f"{tr_id} 호출 한도 초과")


# ---------------------------------------------------------------- 한국투자증권 뉴스
def _kis_news_item(o, classify):
    title = re.sub(r"\s+", " ", o.get("hts_pbnt_titl_cntt") or "").strip()
    d, t = o.get("data_dt") or "", o.get("data_tm") or ""
    return {"date": f"{d[:4]}-{d[4:6]}-{d[6:8]}" if len(d) == 8 else None, "time": f"{t[:2]}:{t[2:4]}" if len(t) >= 4 else None,
            "title": title, "source": (o.get("dorg") or "").strip() or "한국투자증권", "summary": "",
            "url": f"https://search.naver.com/search.naver?where=news&query={quote(title[:60])}",
            "impact": classify(title), "auto": True, "kind": "뉴스"}, [o.get(f"iscd{i}") for i in range(1, 11) if o.get(f"iscd{i}")]


def kis_news(classify, code="", pages=1):
    """code='' 이면 시장 전체 최신 뉴스. 결과 {종목코드: [뉴스]} (code 지정 시 그 종목만)"""
    if not kis_ready():
        return {}
    p = {"FID_NEWS_OFER_ENTP_CODE": "", "FID_COND_MRKT_CLS_CODE": "", "FID_INPUT_ISCD": code, "FID_TITL_CNTT": "",
         "FID_INPUT_DATE_1": "", "FID_INPUT_HOUR_1": "", "FID_RANK_SORT_CLS_CODE": "", "FID_INPUT_SRNO": ""}
    out: dict[str, list] = {}
    cont = ""
    for _ in range(pages):
        try:
            j, more = kis_call("/uapi/domestic-stock/v1/quotations/news-title", "FHKST01011800", p, cont)
        except Exception as e:
            print(f"[KIS 뉴스] 실패 {code or '전체'}: {e}")
            break
        for o in j.get("output") or []:
            it, codes = _kis_news_item(o, classify)
            if not it["title"]:
                continue
            for c in ([code] if code else codes):
                if re.fullmatch(r"\d{6}", c or ""):
                    out.setdefault(c, []).append(it)
        if not more:
            break
        cont = "N"
        time.sleep(0.12)
    return out


# ---------------------------------------------------------------- 시장경고 (투자주의·경고·위험 등)
WARN = {"01": "투자주의", "02": "투자경고", "03": "투자위험"}


def kis_warnings(codes, per_sec=8, budget=600):
    """종목별 현재가 조회로 경고 정보 모으기 → {종목코드: ["투자경고", "단기과열", ...]} (해당 있는 종목만)
    budget 초가 넘으면 멈춤 (호출 한도가 낮은 신규 계정에서 전체 갱신이 늦어지지 않게). 절반도 못 하면 None"""
    if not kis_ready():
        return None
    out, fails, t0, done = {}, 0, time.time(), 0
    for i, c in enumerate(codes):
        if time.time() - t0 > budget:
            print(f"[경고] 시간 초과로 {i}/{len(codes)} 에서 멈춤")
            break
        done = i + 1
        try:
            j, _ = kis_call("/uapi/domestic-stock/v1/quotations/inquire-price", "FHKST01010100",
                            {"FID_COND_MRKT_DIV_CODE": "J", "FID_INPUT_ISCD": c})
            o = j.get("output") or {}
            tags = []
            if WARN.get(o.get("mrkt_warn_cls_code")):
                tags.append(WARN[o["mrkt_warn_cls_code"]])
            if o.get("invt_caful_yn") == "Y":
                tags.append("투자유의")
            if o.get("temp_stop_yn") == "Y":
                tags.append("거래정지")
            if o.get("short_over_yn") == "Y":
                tags.append("단기과열")
            if o.get("mang_issu_cls_code") == "Y":
                tags.append("관리종목")
            if tags:
                out[c] = tags
            if i and i % 500 == 0:
                print(f"[경고] {i}/{len(codes)} … {time.time() - t0:.0f}초")
        except Exception as e:
            fails += 1
            if fails <= 5:
                print(f"[경고] 실패 {c}: {e}")
        time.sleep(1 / per_sec)
    print(f"[경고] {len(codes)}종목 확인, 해당 {len(out)}개, 실패 {fails}, {time.time() - t0:.0f}초")
    return out if done >= len(codes) * 0.5 and fails < done * 0.3 else None


# ---------------------------------------------------------------- 합치기
def merge_items(*lists, n=8):
    """여러 출처 기사·공시를 합쳐 같은 제목은 하나로, 최신순"""
    seen, out = set(), []
    for lst in lists:
        for it in lst or []:
            key = re.sub(r"[^가-힣A-Za-z0-9]", "", it.get("title", ""))[:18]
            if key and key not in seen:
                seen.add(key)
                out.append(it)
    out.sort(key=lambda x: (x.get("date") or "", x.get("time") or "99:99" if x.get("kind") == "공시" else x.get("time") or ""), reverse=True)
    return out[:n]
