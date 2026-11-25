# K-Market Intelligence

엑셀 「주식 매크로」를 옮긴 자동 갱신 주식 대시보드입니다.
GitHub Pages로 무료 호스팅되고, GitHub Actions가 평일 16:20(KST)에 전 종목 시세·재무·뉴스·일지를, 08:20에 뉴스를 새로 받아옵니다.

## 처음 설정 (10분)

1. GitHub에서 새 저장소를 만듭니다 (예: `k-market`). 공개(Public)여야 무료 Pages를 쓸 수 있습니다.
2. 이 폴더의 파일을 **전부** 올립니다. 숨김 폴더 `.github`도 꼭 포함해야 합니다.
   - 웹에서 올릴 때: 저장소 → **Add file → Upload files** → 폴더 내용을 끌어다 놓기
3. **Settings → Pages** → Source: `Deploy from a branch`, Branch: `main` / `(root)` → Save
4. **Settings → Actions → General** → Workflow permissions: **Read and write permissions** → Save
5. **Actions** 탭 → `주가 데이터 자동 갱신` → **Run workflow** 를 눌러 첫 갱신을 실행합니다 (3~5분).
6. 1~2분 뒤 `https://<내아이디>.github.io/k-market/` 에서 확인합니다.

## 로그인·내 투자 (Supabase)

- 회원가입/로그인, 매매 일지, 포트폴리오, 관심 종목은 Supabase(무료)에 저장되며 RLS 정책으로 **본인 데이터만** 읽고 쓸 수 있습니다.
- 테이블 구조: `supabase/schema.sql` (SQL Editor 에서 한 번 실행)
- 사이트 연결: `assets/config.js` 의 URL·publishable 키
- **자동 일지**: GitHub 저장소 Settings → Secrets and variables → Actions 에 `SUPABASE_SERVICE_KEY`(Supabase 의 secret 키)를 넣으면,
  평일 16:20 갱신 때 모든 사용자의 평가금액·손익·급등락·뉴스를 일지로 기록합니다.

## 데이터 범위

- 전 종목(약 2,700개): 매일 시세·등락·1주/1개월/3개월 수익률·52주 위치·거래대금 → `data/market_all.json`
- 전 종목 재무·분기 실적: 평일마다 1/5씩 나눠 수집 → 1주일에 한 바퀴 (`data/companies/`)
- 테마 종목 + 사용자 보유·관심 종목: 매일 1년 차트·재무·뉴스

## 섹터 검색기 (`#/sectors`)

- 네이버 테마(약 265개)·업종(약 79개)과 소속 종목을 평일 16:20에 새로 받아옵니다 → `data/groups.json`
- 섹터 이름·줄임말(원전, 방산, 배터리…)이나 종목명으로 검색. 종목명을 넣으면 그 종목이 속한 섹터가 나옵니다.
- **강도** = 오늘 등락 40% + 1주 30% + 1개월 30%를 전체 섹터 중 순위(0~100)로 환산.
- **섹터 뉴스**: 섹터마다 시가총액 상위 3종목의 최근 7일 기사를 모아 긍정·보통·악재로 자동 분류 → `data/group_news.json` (08:20, 16:20 갱신)
- 섹터·테마 화면 맨 위의 「오늘의 자동 섹터 TOP 8」은 이 순위로 매일 바뀝니다. 그 아래 8개 관심 테마는 `config.json` 그대로입니다.

## 관심 종목·관심 테마 (로그인)

- 기업분석에서 ☆ → 그 순간 현재가가 **등록가**로 저장되고, 내 투자 화면에서 등록 후 수익률을 봅니다.
- 섹터 화면에서 ☆ → **관심 테마**. 등록 시점 소속 종목 종가를 저장해 등록 후 평균 수익률을 계산합니다.
- 처음 한 번 `supabase/2026-11-25_관심종목_등록가_관심테마.sql` 을 Supabase SQL Editor 에서 실행해야 합니다.

## 종목·테마 바꾸기 (기본 추천 테마)

`data/config.json` 만 고치면 됩니다 (GitHub 웹에서 연필 아이콘으로 편집 가능).

- `themes[].stocks` : 테마별 종목 (`code` 6자리, `name`, `memo`)
- `extra_companies` : 테마와 상관없이 기업분석에 넣을 종목 코드
- `company_notes` : 기업분석 화면 하단 '내 분석 메모'

저장 후 다음 자동 갱신(또는 Run workflow)부터 반영됩니다.

## 구조

| 파일 | 역할 |
|---|---|
| `index.html`, `assets/` | 사이트 화면 |
| `data/config.json` | 직접 편집하는 설정 |
| `data/market.json` | 시세·테마 랭킹 (자동 생성) |
| `data/companies/*.json` | 종목별 재무·분기 실적·뉴스·주가 (자동 생성) |
| `data/groups.json`, `data/group_news.json` | 네이버 테마·업종과 섹터 뉴스 (자동 생성) |
| `data/theme_news.json` | 테마 뉴스 (자동 + 직접 정리한 `curated`) |
| `data/stocks.json` | 전체 상장 종목 목록 |
| `scripts/update_data.py` | 수집 스크립트 |

## 계산 방식

- **테마 관심도** = 50 + (테마 평균 1개월 − 코스피 1개월)×100 + (테마 평균 3개월 − 코스피 3개월)×50, 0~100.
  코스피 대비로 바꿔 하락장에서도 상대적으로 강한 테마가 드러나게 했습니다.
- **기업 종합점수**: 밸류에이션·수익성·재무안정성·실적 모멘텀·시장/뉴스 5개 항목 × 20점 (엑셀 기준 그대로).
- **뉴스 분류**: 제목 키워드 기반 자동 분류이며 참고용입니다.

## 문제가 생기면

- Actions 실행이 빨간색(실패)이면 로그를 열어 확인하세요. 종목 하나가 실패해도 나머지는 갱신되고, 사이트 상단에 실패 건수가 표시됩니다.
- 네이버 금융 페이지 구조가 바뀌면 재무/뉴스 수집이 멈출 수 있습니다. 이때는 `scripts/update_data.py` 의 해당 함수를 고치면 됩니다.

시세·재무·뉴스는 네이버 금융에서 수집하며, 투자 판단의 참고 자료일 뿐 매매 권유가 아닙니다.
