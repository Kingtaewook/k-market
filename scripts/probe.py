"""네이버 응답 구조 확인용 (수동 실행). 결과: probe/out.json"""
import json, requests, pathlib
H = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
     "Referer": "https://finance.naver.com/"}
U = {
 "theme_505": "https://m.stock.naver.com/api/stocks/theme/505?page=1&pageSize=3",
 "industry_282": "https://m.stock.naver.com/api/stocks/industry/282?page=1&pageSize=3",
 "integration_tail": "https://m.stock.naver.com/api/stock/005930/integration",
 "trend20": "https://m.stock.naver.com/api/stock/000660/trend?pageSize=20",
}
out = {}
for k, u in U.items():
    try:
        r = requests.get(u, headers=H, timeout=15)
        if "html" in k:
            r.encoding = "euc-kr"
        t = r.text
        out[k] = {"status": r.status_code, "len": len(t), "head": (t[t.find("consensus")-50:t.find("consensus")+900] + " ||| " + t[t.find("industryCode")-100:t.find("industryCode")+300]) if k=="integration_tail" else t[:2500]}
    except Exception as e:
        out[k] = {"error": str(e)}
pathlib.Path("probe").mkdir(exist_ok=True)
pathlib.Path("probe/out.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
print("ok")
