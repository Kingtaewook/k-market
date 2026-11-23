"""테마 관심도·모멘텀 계산 (사이트와 자동 갱신 스크립트가 함께 사용)."""


def momentum(r1, r3):
    if r1 is None or r3 is None:
        return "확인 필요"
    if r1 > 0.05 and r3 > 0.10:
        return "강세"
    if r1 > 0 and r3 > 0:
        return "상승"
    if r1 < 0 and r3 < 0:
        return "약세"
    return "혼조"


def verdict(score):
    """관심도는 코스피 대비 상대 점수이므로 '시장보다 강한지'로 표현합니다."""
    if score >= 70:
        return "시장 압도"
    if score >= 58:
        return "시장보다 강함"
    if score >= 45:
        return "시장 수준"
    if score >= 33:
        return "시장보다 약함"
    return "크게 약함"


def _avg(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def compute_themes(config, stocks, kospi=None):
    """관심도 = 50 + (테마 1개월 - 코스피 1개월)×100 + (테마 3개월 - 코스피 3개월)×50.
    코스피 자료가 없으면 절대 수익률로 계산합니다 (엑셀 원래 방식)."""
    k1 = (kospi or {}).get("r1m")
    k3 = (kospi or {}).get("r3m")
    out = []
    for t in config["themes"]:
        codes = [s["code"] for s in t["stocks"]]
        rows = [stocks.get(c, {}) for c in codes]
        a1 = _avg([r.get("r1m") for r in rows])
        a3 = _avg([r.get("r3m") for r in rows])
        rel1 = a1 - k1 if (a1 is not None and k1 is not None) else None
        rel3 = a3 - k3 if (a3 is not None and k3 is not None) else None
        b1 = rel1 if rel1 is not None else a1
        b3 = rel3 if rel3 is not None else a3
        score = None
        if b1 is not None and b3 is not None:
            score = max(0, min(100, round(50 + b1 * 100 + b3 * 50)))
        up = sum(1 for r in rows if (r.get("r1m") or 0) > 0)
        out.append({
            "name": t["name"], "score": score, "avg1m": a1, "avg3m": a3,
            "rel1m": rel1, "rel3m": rel3, "up": up, "total": len(codes),
            "verdict": verdict(score) if score is not None else "확인 필요",
            "basis": "코스피 대비" if rel1 is not None else "절대 수익률",
            "stocks": codes,
        })
    ranked = sorted([t for t in out if t["score"] is not None], key=lambda t: -t["score"])
    for t in out:
        t["rank"] = 1 + sum(1 for o in ranked if o["score"] > t["score"]) if t["score"] is not None else None
    out.sort(key=lambda t: (t["rank"] is None, t["rank"] or 0))
    return out
