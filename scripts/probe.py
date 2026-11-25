"""외부 응답 구조 확인용 (수동 실행). 결과를 로그에 출력하고 probe/out.json 에 저장"""
import json, requests, pathlib
H = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
     "Referer": "https://finance.naver.com/"}
U = {}
for s in [".INX", ".IXIC", ".DJI", ".SOX", ".VIX"]:
    U["naver_" + s] = f"https://api.stock.naver.com/index/{s}/basic"
U["naver_fx"] = "https://m.stock.naver.com/front-api/marketIndex/productDetail?category=exchange&reutersCode=FX_USDKRW"
U["naver_tnx"] = "https://api.stock.naver.com/index/.TNX/basic"
out = {}
for k, u in U.items():
    try:
        r = requests.get(u, headers=H, timeout=15)
        j = r.json()
        if isinstance(j, dict) and "result" in j: j = j["result"]
        if isinstance(j, dict):
            j = {a: b for a, b in j.items() if a not in ("stockExchangeType", "stockItemTotalInfos", "industryCodeType")}
        out[k] = {"status": r.status_code, "body": j}
    except Exception as e:
        out[k] = {"error": str(e)}
    print("PROBE", k, json.dumps(out[k], ensure_ascii=False)[:1600])
pathlib.Path("probe").mkdir(exist_ok=True)
pathlib.Path("probe/out.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
