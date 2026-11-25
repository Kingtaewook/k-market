"""외부 응답 구조 확인용 (수동 실행). 결과를 로그에 출력하고 probe/out.json 에 저장"""
import json, requests, pathlib
H = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
     "Referer": "https://finance.naver.com/"}
U = {}
for s in ["%5EGSPC", "%5EIXIC", "%5EDJI", "%5ESOX", "%5EVIX", "KRW%3DX", "%5ETNX"]:
    U["yahoo_" + s] = f"https://query1.finance.yahoo.com/v8/finance/chart/{s}?range=5d&interval=1d"
for s in [".INX", ".IXIC", ".DJI", ".SOX", ".VIX"]:
    U["naver_" + s] = f"https://api.stock.naver.com/index/{s}/basic"
U["naver_fx"] = "https://m.stock.naver.com/front-api/marketIndex/productDetail?category=exchange&reutersCode=FX_USDKRW"
U["stooq_spx"] = "https://stooq.com/q/l/?s=%5Espx&f=sd2t2ohlcv&h&e=csv"
out = {}
for k, u in U.items():
    try:
        r = requests.get(u, headers=H, timeout=15)
        out[k] = {"status": r.status_code, "head": r.text[:700]}
    except Exception as e:
        out[k] = {"error": str(e)}
    print("PROBE", k, json.dumps(out[k], ensure_ascii=False)[:800])
pathlib.Path("probe").mkdir(exist_ok=True)
pathlib.Path("probe/out.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
