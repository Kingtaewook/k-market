"""투자주의·경고·위험·단기과열·거래정지·관리종목 (한국투자증권, 전 종목 하나씩 확인)

지정은 전날 장 마감 뒤 공시돼 그날 적용 → 평일 아침(06:40) 한 번, 따로 실행.
호출 한도가 낮은 계정이라 전 종목에 40분 넘게 걸려서 전체 갱신(update_data)과 나눔.
결과: data/warnings.json = {"as_of": 날짜, "updated_at": ..., "w": {종목코드: ["투자경고", ...]}}
"""
from __future__ import annotations

import datetime as dt
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import sources  # noqa: E402
from review import is_trading  # noqa: E402
from update_data import DATA, KST, load, save  # noqa: E402


def main():
    now = dt.datetime.now(KST)
    manual = os.environ.get("RUN_MODE") == "full"
    if not manual and not is_trading(now.date()):
        print("주말·휴장일 → 건너뜀")
        return
    codes = [r[1] for r in load(DATA / "stocks.json", [])]
    budget = int(os.environ.get("WARN_BUDGET", "3300"))  # 최대 55분
    w = sources.kis_warnings(codes, budget=budget)
    if w is None:
        sys.exit("경고 정보를 절반도 확인하지 못해 저장하지 않음")
    save(DATA / "warnings.json", {"as_of": now.date().isoformat(), "updated_at": now.isoformat(timespec="minutes"), "w": w}, compact=True)
    print(f"warnings.json 저장: {len(w)}종목")


if __name__ == "__main__":
    main()
