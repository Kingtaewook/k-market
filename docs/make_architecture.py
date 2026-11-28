"""K-Market 서버 구조도 (SVG) 만들기 — 구조가 바뀌면 이 파일의 상자·화살표만 고치고 다시 실행.
python3 docs/make_architecture.py  →  docs/architecture.svg
"""
from pathlib import Path

W, H = 1100, 1110
BLUE, INK, GRAY, LINE = "#2f6fec", "#111", "#8a8f98", "#c9ccd1"
out = []
A = out.append


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;")


def region(x, y, w, h, label, dashed=False, fill="#fff"):
    da = ' stroke-dasharray="6 5"' if dashed else ""
    A(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="{fill}" stroke="{GRAY}" stroke-width="1.3"{da}/>')
    A(f'<text x="{x+16}" y="{y+24}" class="rl">{esc(label)}</text>')


def box(x, y, w, h, title, lines=(), color=INK, dashed=False, bold=1.4):
    da = ' stroke-dasharray="6 5"' if dashed else ""
    A(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="9" fill="#fff" stroke="{color}" stroke-width="{bold}"{da}/>')
    n = len(lines)
    ty = y + h / 2 - (n * 17) / 2 + 4
    tc = GRAY if dashed else "#111"
    A(f'<text x="{x+w/2}" y="{ty}" class="bt" fill="{tc}">{esc(title)}</text>')
    for i, l in enumerate(lines):
        A(f'<text x="{x+w/2}" y="{ty+19+i*17}" class="bs">{esc(l)}</text>')


def path(d, color=INK, dashed=False, both=False, w=1.5):
    da = ' stroke-dasharray="6 5"' if dashed else ""
    mk = "ab" if color == BLUE else ("ag" if color == GRAY else "ak")
    st = f' marker-start="url(#{mk}s)"' if both else ""
    A(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{w}"{da} marker-end="url(#{mk})"{st}/>')


def badge(x, y, n, color=INK):
    A(f'<circle cx="{x}" cy="{y}" r="11" fill="{color}"/><text x="{x}" y="{y+4.5}" class="bn">{n}</text>')


def label(x, y, s, anchor="start", color="#444", cls="al"):
    A(f'<text x="{x}" y="{y}" class="{cls}" text-anchor="{anchor}" fill="{color}">{esc(s)}</text>')


# ---------- 영역
region(20, 150, 700, 450, "Supabase (클라우드 · 무료 플랜)")
region(40, 318, 660, 262, "PostgreSQL · 표마다 RLS 잠금", fill="#fafafa")
region(20, 620, 700, 232, "GitHub (공개 저장소 Kingtaewook/k-market)")
label(1060, 172, "외부", anchor="end", cls="rl")

# ---------- 상자
box(60, 40, 300, 80, "회원 화면", ["브라우저 · 휴대폰 (PWA)", "카카오 로그인 · 승인제"])
box(40, 182, 190, 70, "예약 작업 pg_cron", ["매 1분 · 비밀 열쇠 첨부"])
box(270, 178, 250, 82, "kis-market 함수", ["지수·환율 매분 · 전 종목 5분", "정해진 시각 GitHub 작업 호출"])
box(550, 178, 150, 82, "kis-quote 함수", ["보이는 30종목", "10초 · 승인 회원만"])
box(60, 358, 190, 70, "profiles", ["회원 · 승인 · 관리자"])
box(270, 358, 190, 70, "비밀 표", ["kis_token · app_secret", "서버만 읽기"])
box(480, 358, 200, 70, "Auth", ["카카오 로그인 · 토큰(JWT)"])
box(60, 488, 190, 72, "live_cache", ["1번 전 종목 · 2번 지수·환율", "누구나 읽기"])
box(270, 488, 190, 72, "member_data", ["정리: 하루 기록·돌아보기", "승인 회원만"], color=BLUE, bold=2)
box(480, 488, 200, 72, "big_trades_day", ["큰 체결 하루 집계", "승인 회원만 · 30일 보관"], color=BLUE, bold=2)
box(40, 652, 210, 82, "warnings", ["경고 종목 · 06:40", "전 종목 확인 (최대 55분)"])
box(270, 652, 190, 82, "update-data", ["뉴스 · 시세 · 분석", "평일 08:20~20:12"])
box(480, 652, 220, 82, "big-trades", ["큰 체결 08:58~15:35", "거래대금 상위 40종목"])
box(90, 770, 250, 66, "data/ 공개 파일", ["종목·지표·테마·경고 · 커밋"])
box(420, 770, 240, 66, "GitHub Pages", ["사이트 배포 (화면 코드)"])
box(780, 190, 280, 90, "한국투자증권 API", ["REST: 시세·지수·뉴스·체결", "웹소켓: 실시간 체결 (3종목)"])
box(780, 353, 280, 80, "카카오", ["로그인"])
box(780, 618, 280, 70, "OpenDART", ["공시 목록"])
box(780, 720, 280, 70, "네이버 금융", ["코스닥·환율·테마 (예비)"], dashed=True)

# ---------- 화살표 + 번호
path("M230,217 H270")                                   # 1 예약 → kis-market
badge(250, 200, 1)
path("M400,178 V162 H840 V190")                           # 2 kis-market → KIS
badge(770, 162, 2)
label(788, 155, "시세 조회")
path("M700,222 H780")                                   # 9 kis-quote → KIS
path("M300,260 V276 H30 V524 H60")                        # 3 kis-market → live_cache
badge(30, 400, 3)
label(40, 290, "저장 (1분 · 5분)")
path("M500,260 V292 H738 V680 H700")                     # 4 작업 호출
badge(738, 470, 4)
label(608, 307, "정해진 시각 작업 호출")
path("M720,705 H758 V300 H900 V280")                     # 5 작업 → KIS
path("M720,650 H780", both=False)                        # 5 → DART
path("M720,755 H780", color=GRAY, dashed=True)          # 5 → 네이버(예비)
badge(758, 560, 5)
path("M145,734 V770")                                   # 6 → data/
path("M330,734 V752 H300 V770")
path("M340,803 H420")                                   # data → Pages
badge(380, 789, 6)
label(380, 822, "재배포", anchor="middle")
path("M365,652 V560", color=BLUE)                        # 7 → member_data
path("M590,652 V560", color=BLUE)                        # 7 → big_trades_day
badge(365, 606, 7, BLUE)
badge(590, 606, 7, BLUE)
path("M680,393 H780", both=True)                         # Auth ↔ 카카오
path("M150,120 V150", color=BLUE)                         # 8 화면 → Supabase 읽기
badge(150, 135, 8, BLUE)
label(168, 140, "로그인 후 표 읽기 (승인 회원만 잠금 표)", color=BLUE)
path("M360,70 H625 V178", color=BLUE)                     # 9 화면 → kis-quote
badge(500, 70, 9, BLUE)
label(518, 62, "10초 실시간", color=BLUE)
path("M540,836 V866 H8 V80 H60", color=GRAY)             # Pages → 화면
label(16, 880, "사이트 열기", color=GRAY)

# ---------- 처리 순서
steps = [
    ("1", INK, "예약 작업이 매 1분 kis-market을 비밀 열쇠와 함께 부른다."),
    ("2", INK, "kis-market이 한국투자증권에서 지수·환율(매분)과 전 종목 시세(5분)를 받는다."),
    ("3", INK, "받은 값을 live_cache에 저장한다. 회원 수와 상관없이 증권사 호출은 그대로."),
    ("4", INK, "정해진 시각(06:40~20:12, 평일)에 GitHub 작업을 부른다. 주말·휴장일은 스스로 건너뜀."),
    ("5", INK, "GitHub 작업이 한국투자증권·DART·네이버(예비)에서 모으고 분석한다."),
    ("6", INK, "공개 데이터는 data/에 커밋하고 사이트를 다시 배포한다."),
    ("7", BLUE, "「정리」 분석과 큰 체결은 회원 전용 표에 저장한다."),
    ("8", BLUE, "회원이 카카오로 로그인하면, 승인 상태에 따라 표를 읽는다."),
    ("9", BLUE, "화면에 보이는 30종목은 10초마다 kis-quote로 실시간 시세를 받는다."),
]
A('<text x="30" y="912" class="h2">한 번의 흐름 (평일 기준)</text>')
for i, (n, c, s) in enumerate(steps):
    col, row = (0, i) if i < 5 else (1, i - 5)
    x, y = 42 + col * 540, 942 + row * 26
    badge(x, y - 4, n, c)
    label(x + 20, y + 1, s, color="#222", cls="st")

# ---------- 표시
A('<text x="30" y="1080" class="h2">표시</text>')
lx = 90
for d, c, dash, s in [("검은 선", INK, False, "자동 · 동작 확인됨"), ("파란 선", BLUE, False, "회원 전용(잠금) 경로"),
                       ("점선", GRAY, True, "예비 경로")]:
    path(f"M{lx},1075 H{lx+44}", color=c, dashed=dash)
    label(lx + 54, 1080, s, color="#222", cls="st")
    lx += 250
A(f'<text x="30" y="{H-6}" class="ft">기준: 2026-11-28. 시세 원천은 한국투자증권 하나 · 회원 화면은 저장된 표만 읽음 · 참고용 정보이며 투자 권유가 아님.</text>')

defs = "".join(
    f'<marker id="{k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="{c}"/></marker>'
    f'<marker id="{k}s" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="{c}"/></marker>'
    for k, c in (("ak", INK), ("ab", BLUE), ("ag", GRAY)))
style = """<style>
text{font-family:'Pretendard','Apple SD Gothic Neo','Noto Sans CJK KR','Noto Sans KR',sans-serif}
.rl{font-size:13px;font-weight:700;fill:#333}
.bt{font-size:15px;font-weight:800;text-anchor:middle}
.bs{font-size:11.5px;fill:#555;text-anchor:middle}
.bn{font-size:12px;font-weight:800;fill:#fff;text-anchor:middle}
.al{font-size:11.5px}
.st{font-size:12.5px}
.h2{font-size:15px;font-weight:800;fill:#111}
.ft{font-size:11.5px;fill:#777}
</style>"""
svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}"><defs>{defs}</defs>{style}<rect width="100%" height="100%" fill="#fff"/>' + "".join(out) + "</svg>"
p = Path(__file__).with_name("architecture.svg")
p.write_text(svg, encoding="utf-8")
print(p)
