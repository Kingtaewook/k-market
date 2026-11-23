"""네이버 응답 구조 확인용 (수동 실행). 결과: probe/out.json"""
import json, requests, pathlib
H = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
     "Referer": "https://finance.naver.com/"}
U = {
 "trend": "https://m.stock.naver.com/api/stock/005930/trend?pageSize=3",
 "integration": "https://m.stock.naver.com/api/stock/005930/integration",
 "news": "https://m.stock.naver.com/api/news/stock/005930?pageSize=3&page=1",
 "disclosure": "https://m.stock.naver.com/api/stock/005930/disclosure?page=1&pageSize=3",
 "theme_m": "https://m.stock.naver.com/api/stocks/theme?page=1&pageSize=5",
 "industry_m": "https://m.stock.naver.com/api/stocks/industry?page=1&pageSize=5",
 "theme_detail_m": "https://m.stock.naver.com/api/stocks/theme/1?page=1&pageSize=3",
 "frgn_html": "https://finance.naver.com/item/frgn.naver?code=005930",
 "theme_html": "https://finance.naver.com/sise/theme.naver?page=1",
 "upjong_html": "https://finance.naver.com/sise/sise_group.naver?type=upjong",
}
out = {}
for k, u in U.items():
    try:
        r = requests.get(u, headers=H, timeout=15)
        if "html" in k:
            r.encoding = "euc-kr"
        t = r.text
        out[k] = {"status": r.status_code, "len": len(t), "head": t[:2500] if "html" not in k else t[t.find("<table"):t.find("<table") + 3000]}
    except Exception as e:
        out[k] = {"error": str(e)}
try:
    import FinanceDataReader as fdr
    d = fdr.StockListing("KRX-DESC")
    out["krx_desc"] = {"cols": list(d.columns), "rows": d.head(3).astype(str).values.tolist(), "n": len(d)}
except Exception as e:
    out["krx_desc"] = {"error": str(e)[:300]}
pathlib.Path("probe").mkdir(exist_ok=True)
pathlib.Path("probe/out.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
print("ok")
