/* K-Market Intelligence — 정적 사이트 (GitHub Pages)
 * data/*.json 을 읽어 화면을 그립니다. 데이터는 GitHub Actions 가 매일 갱신합니다. */
(() => {
  "use strict";

  // ------------------------------------------------------------ 데이터 로딩
  const INLINE = window.__KM_DATA__ || null; // 미리보기 파일용 (데이터 내장)
  const cache = {};
  async function getJSON(path) {
    if (path in cache) return cache[path];
    if (INLINE) return (cache[path] = INLINE[path] ?? null);
    try {
      const r = await fetch(`data/${path}?v=${Date.now() / 600000 | 0}`);
      cache[path] = r.ok ? await r.json() : null;
    } catch { cache[path] = null; }
    return cache[path];
  }

  let CFG, MK, LIST, NEWS, ALL = {}, GROUPS = null;
  const CODE2THEMES = {};
  let SB = null, USER = null, MYCACHE = null;
  const $app = document.getElementById("app");

  // ------------------------------------------------------------ 포맷
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const isNum = (v) => typeof v === "number" && isFinite(v);
  const won = (v) => (isNum(v) ? Math.round(v).toLocaleString("ko-KR") : "–");
  const pct = (v, d = 1, sign = true) => (isNum(v) ? `${sign && v > 0 ? "+" : ""}${(v * 100).toFixed(d)}%` : "–");
  const cls = (v) => (isNum(v) ? (v > 0 ? "up" : v < 0 ? "down" : "") : "");
  const times = (v, d = 2) => (isNum(v) ? `${v.toFixed(d)}배` : "–");
  const cap = (eok) => {
    if (!isNum(eok)) return "–";
    if (eok >= 10000) return `${(eok / 10000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}조`;
    return `${Math.round(eok).toLocaleString("ko-KR")}억`;
  };
  const eokFmt = (v) => (isNum(v) ? v.toLocaleString("ko-KR", { maximumFractionDigits: Math.abs(v) < 10 ? 2 : 0 }) : "–");
  const impactBadge = (t) => {
    // 뉴스 분류 표시: 긍정 · 보통 · 악재 (저장값은 긍정/중립/주의)
    const [l, k] = { 긍정: ["긍정", "pos"], 주의: ["악재", "neg"], 부정: ["악재", "neg"], 중립: ["보통", ""] }[t || "중립"] ?? [t, ""];
    return `<span class="badge ${k}">${esc(l)}</span>`;
  };
  const verdictBadge = (v) => {
    const k = { "높은 관심": "pos", 관심: "pos", 중립: "", 주의: "warn", 약세: "neg", 강세: "pos", 상승: "pos", 혼조: "", "확인 필요": "",
      "시장 압도": "pos", "시장보다 강함": "pos", "시장 수준": "", "시장보다 약함": "warn", "크게 약함": "neg" }[v] ?? "";
    return `<span class="badge ${k}">${esc(v)}</span>`;
  };
  const daysSince = (iso) => {
    if (!iso) return null;
    const d = new Date(iso.length <= 10 ? iso + "T15:30:00+09:00" : iso);
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  };
  const stockLinks = (code) => `
    <a class="btn" href="https://finance.naver.com/item/main.naver?code=${code}" target="_blank" rel="noopener">네이버 금융 ↗</a>
    <a class="btn" href="https://dart.fss.or.kr/dsab007/main.do?textCrpNm=${code}" target="_blank" rel="noopener">DART 공시 ↗</a>`;

  function themeOfCode(code) {
    return CFG.themes.filter((t) => t.stocks.some((s) => s.code === code)).map((t) => t.name);
  }
  function memoOf(code) {
    for (const t of CFG.themes) for (const s of t.stocks) if (s.code === code && s.memo) return s.memo;
    return "";
  }
  function trackedCodes() {
    const set = new Set();
    CFG.themes.forEach((t) => t.stocks.forEach((s) => set.add(s.code)));
    (CFG.extra_companies || []).forEach((c) => set.add(c));
    return [...set];
  }
  const LMAP = {};
  function nameOf(code) {
    return MK.stocks[code]?.name || LMAP[code]?.[0] || code;
  }
  function priceOf(code) {
    return { ...(ALL[code] || {}), ...Object.fromEntries(Object.entries(MK.stocks[code] || {}).filter(([, v]) => v !== null && v !== undefined)) };
  }
  const bigWon = (v) => {
    if (!isNum(v)) return "–";
    const a = Math.abs(v);
    if (a >= 1e12) return `${(v / 1e12).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}조`;
    if (a >= 1e8) return `${(v / 1e8).toLocaleString("ko-KR", { maximumFractionDigits: a >= 1e10 ? 0 : 1 })}억`;
    if (a >= 1e4) return `${(v / 1e4).toLocaleString("ko-KR", { maximumFractionDigits: 0 })}만`;
    return Math.round(v).toLocaleString("ko-KR");
  };
  const signWon = (v) => (isNum(v) ? `${v > 0 ? "+" : ""}${Math.round(v).toLocaleString("ko-KR")}원` : "–");

  // ------------------------------------------------------------ 상태 표시
  function renderStatus() {
    const el = document.getElementById("status");
    const age = daysSince(MK.as_of);
    const stale = age === null || age > 4;
    const upd = MK.updated_at ? MK.updated_at.slice(5, 16).replace("T", " ") : "자동 갱신 전";
    el.innerHTML = `<span class="dot ${stale ? "stale" : ""}"></span><span>기준 ${esc(MK.as_of || "–")}</span><span class="long">· 갱신 ${esc(upd)}</span>`;
  }
  function staleBanner() {
    const age = daysSince(MK.as_of);
    const fails = (MK.failures || []).length;
    let msg = "";
    if (!MK.updated_at) msg = `지금은 <b>엑셀에서 옮긴 초기 데이터</b>입니다. GitHub Actions 가 처음 실행되면 실시간 시세·재무·뉴스로 바뀝니다.`;
    else if (age !== null && age > 4) msg = `데이터가 <b>${age}일 전</b> 기준입니다. GitHub Actions 실행 기록을 확인해 주세요.`;
    if (fails) msg += `${msg ? " " : ""}마지막 갱신에서 <b>${fails}건</b> 수집에 실패해 직전 값을 유지했습니다.`;
    return msg ? `<div class="banner">${msg}</div>` : "";
  }

  // ------------------------------------------------------------ 공통 조각
  function rankingCard(limit) {
    const rows = MK.themes.slice(0, limit || MK.themes.length);
    const basis = MK.themes[0]?.basis || "";
    return `<div class="card">
      <div class="card-head"><div><h2>추천 테마 랭킹</h2><div class="muted" style="font-size:13px">${esc(basis)} 1·3개월 수익률로 계산 · 50 = 기준선</div></div>
      <a class="more" href="#/themes">전체 보기 →</a></div>
      ${rows.map((t) => `
        <div class="rank-row" data-go="#/themes/${encodeURIComponent(t.name)}" title="평균 1개월 ${pct(t.avg1m)} · 3개월 ${pct(t.avg3m)} · 상승 ${t.up}/${t.total}">
          <div class="rk num">${t.rank ?? "–"}</div>
          <div class="nm">${esc(t.name)}</div>
          <div class="track"><div class="fill" style="width:${t.score ?? 0}%"></div><div class="mid"></div></div>
          <div class="sc num">${t.score ?? "–"}</div>
          <div>${verdictBadge(t.verdict)}</div>
        </div>`).join("")}
    </div>`;
  }

  function newsItems(items, opts = {}) {
    if (!items || !items.length) return `<div class="empty">표시할 뉴스가 없습니다.</div>`;
    return `<div class="news-list">${items.map((n) => posLocked(n.impact) ? `
      <div class="news-item locked">${posLockHTML(n.impact)}${impactBadge(n.impact)}<div class="meta">${esc(n.date || "")}${n.theme ? " · " + esc(n.theme) : ""}</div></div>` : `
      <div class="news-item">
        ${n.url ? `<a class="t" href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a>` : `<div class="t">${esc(n.title)}</div>`}
        ${impactBadge(n.impact)}
        <div class="meta">${esc(n.date || "")}${n.source ? " · " + esc(n.source) : ""}${n.stock ? " · " + esc(n.stock) : ""}${opts.showTheme && n.theme ? " · " + esc(n.theme) : ""}${n.auto ? " · 자동 분류" : ""}</div>
        ${n.summary ? `<div class="s">${esc(n.summary)}</div>` : ""}
        ${n.checkpoint ? `<div class="cp"><b>체크포인트</b> ${esc(n.checkpoint)}</div>` : ""}
      </div>`).join("")}</div>`;
  }

  function pos52(v) {
    if (!isNum(v)) return `<span class="muted">–</span>`;
    const p = Math.max(0, Math.min(1, v));
    return `<div class="pos52" title="52주 최저 0% ~ 최고 100%"><div class="bar"><i style="left:${p * 100}%"></i></div><span class="num">${Math.round(p * 100)}%</span></div>`;
  }

  // ------------------------------------------------------------ 10초 브리핑 (홈 상단)
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  // 시장 분위기 0~100 = 상승 종목 비율 50% + 코스피 당일 등락 30% + 52주 신고가/신저가 균형 20%
  function moodScore() {
    const b = MK.breadth || {}, k = MK.kospi || {};
    const parts = [];
    if (isNum(b.up) && isNum(b.down) && b.up + b.down > 0) parts.push([b.up / (b.up + b.down), 0.5]);
    if (isNum(k.chg)) parts.push([clamp01((k.chg + 0.03) / 0.06), 0.3]);
    if (isNum(b.high52) && isNum(b.low52) && b.high52 + b.low52 > 0) parts.push([((b.high52 - b.low52) / (b.high52 + b.low52) + 1) / 2, 0.2]);
    if (!parts.length) return null;
    const w = parts.reduce((a, [, x]) => a + x, 0);
    return Math.round((parts.reduce((a, [v, x]) => a + v * x, 0) / w) * 100);
  }
  const moodLabel = (s) => (s >= 80 ? "매우 뜨거움" : s >= 60 ? "뜨거움" : s >= 40 ? "보통" : s >= 20 ? "차가움" : "얼어붙음");
  const moodTone = (s) => (s >= 60 ? "hot" : s >= 40 ? "mid" : "cold");

  function gaugeSvg(score) {
    const seg = [["#3b82f6", 0, 20], ["#93b8f5", 20, 40], ["#c9ccd4", 40, 60], ["#f5a3a3", 60, 80], ["#e5484d", 80, 100]];
    const P = (v, r) => { const a = Math.PI * (1 - v / 100); return [100 + r * Math.cos(a), 100 - r * Math.sin(a)]; };
    const arc = (a, b) => { const [x1, y1] = P(a + 0.8, 80), [x2, y2] = P(b - 0.8, 80); return `M${x1.toFixed(1)} ${y1.toFixed(1)}A80 80 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`; };
    const [nx, ny] = P(score ?? 50, 62);
    return `<svg class="gauge" viewBox="0 0 200 112" role="img" aria-label="시장 분위기 ${score ?? "–"}점">
      ${seg.map(([c, a, b]) => `<path d="${arc(a, b)}" stroke="${c}" stroke-width="14" fill="none" stroke-linecap="butt"/>`).join("")}
      ${score === null ? "" : `<line x1="100" y1="100" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" class="needle" stroke-width="3.5" stroke-linecap="round"/><circle cx="100" cy="100" r="6" class="needle-dot"/>`}
      <text x="22" y="111" class="gl">차가움</text><text x="178" y="111" class="gl" text-anchor="end">뜨거움</text></svg>`;
  }

  function hotTopics() {
    const gs = (GROUPS?.themes || []).filter((g) => (g.total || 0) >= 5 && isNum(g.chg));
    if (!gs.length) return [];
    const sorted = gs.slice().sort((a, b) => b.chg - a.chg);
    const picks = sorted.slice(0, 3).map((g) => ({ g, tag: g.chg >= 0.03 ? "급등" : "강세", tone: "up" }));
    const worst = sorted[sorted.length - 1];
    if (worst && worst.chg < 0) picks.push({ g: worst, tag: "약세", tone: "down" });
    return picks;
  }

  function briefCard() {
    const s = moodScore();
    const k = MK.kospi || {}, b = MK.breadth || {};
    const topics = hotTopics();
    const lead = topics.find((t) => t.tone === "up")?.g, lag = topics.find((t) => t.tone === "down")?.g;
    const line = lead
      ? `${esc(lead.name)}${lag ? ` 강세, ${esc(lag.name)} 약세` : " 테마가 시장을 이끄는 날"}`
      : "오늘의 시장 흐름을 정리하고 있어요";
    const total = (b.up || 0) + (b.down || 0);
    const auto = Object.values(NEWS?.auto || {}).flat().filter((n) => n.impact && n.impact !== "중립")
      .sort((a, c) => `${c.date}${c.time || ""}`.localeCompare(`${a.date}${a.time || ""}`));
    const seen = new Set(), heads = [];
    for (const n of auto) { if (seen.has(n.title)) continue; seen.add(n.title); heads.push(n); if (heads.length >= 3) break; }
    return `<section class="brief">
      <div class="brief-mood ${s === null ? "" : moodTone(s)}">
        <div class="eyebrow">10초 브리핑 · ${esc(MK.as_of || "")}</div>
        ${gaugeSvg(s)}
        <div class="mood-score num">${s ?? "–"}<span>${s === null ? "" : moodLabel(s)}</span></div>
        <p class="mood-line">${line}</p>
        <div class="mood-chips">
          ${isNum(k.chg) ? `<span class="mchip"><em>코스피</em><b class="num ${cls(k.chg)}">${pct(k.chg, 2)}</b></span>` : ""}
          ${total ? `<span class="mchip"><em>상승 종목</em><b class="num">${Math.round((b.up / total) * 100)}%</b></span>` : ""}
          ${isNum(b.high52) ? `<span class="mchip"><em>52주 신고가</em><b class="num">${b.high52}</b></span>` : ""}
        </div>
        ${total ? `<div class="breadth-bar" title="상승 ${b.up} · 하락 ${b.down}"><i class="u" style="flex:${b.up}"></i><i class="d" style="flex:${b.down}"></i></div>
        <div class="breadth-legend num"><span class="up">상승 ${b.up.toLocaleString("ko-KR")}</span><span class="down">하락 ${b.down.toLocaleString("ko-KR")}</span></div>` : ""}
      </div>
      <div class="brief-topics">
        <div class="eyebrow">지금 뜨는 토픽</div>
        ${topics.length ? topics.map(({ g, tag, tone }) => `
          <a class="topic" href="#/market/g/theme/${g.no}">
            <span class="ttag ${tone}">${tag}</span>
            <span class="tbody"><b>${esc(g.name)}</b>
              <span class="tlead">${(tone === "down" ? groupLaggards(g, 3) : groupLeaders(g, 3)).map((l) => `${esc(l.name)} <em class="${cls(l.chg)}">${pct(l.chg, 1)}</em>`).join(" · ")}</span></span>
            <span class="tchg num ${cls(g.chg)}">${pct(g.chg, 1)}</span>
          </a>`).join("") : `<div class="empty">다음 자동 갱신 후 표시됩니다.</div>`}
        ${heads.length ? `<div class="eyebrow" style="margin-top:18px">오늘의 헤드라인</div>
          ${heads.map((n) => posLocked(n.impact) ? `<div class="headline">${impactBadge(n.impact)}${posLockHTML(n.impact)}</div>` : `<a class="headline" href="${esc(n.url || "#/news")}" ${n.url ? 'target="_blank" rel="noopener"' : ""}>
            ${impactBadge(n.impact)}<span>${esc(n.title)}</span><em>${esc(n.source || "")}</em></a>`).join("")}` : ""}
      </div>
    </section>`;
  }

  function heatmapCard() {
    const gs = (GROUPS?.themes || []).filter((g) => (g.total || 0) >= 5 && isNum(g.chg));
    if (gs.length < 6) return "";
    const s = gs.slice().sort((a, b) => b.chg - a.chg);
    const pick = [...s.slice(0, 12), ...s.slice(-6)];
    const max = Math.max(0.01, ...pick.map((g) => Math.abs(g.chg)));
    const tile = (g, i) => {
      const t = Math.min(1, Math.abs(g.chg) / max);
      const lvl = g.chg === 0 ? 0 : Math.max(1, Math.ceil(t * 4));
      return `<a class="tile ${g.chg >= 0 ? "u" : "d"}${lvl} ${i < 2 ? "big" : ""}" href="#/market/g/theme/${g.no}" title="${esc(g.name)} · 상승 ${g.rise} / 하락 ${g.fall}">
        <span class="tn">${esc(g.name)}</span><b class="num">${pct(g.chg, 1)}</b></a>`;
    };
    return `<div class="card section">
      <div class="card-head"><div><h2>테마 지도</h2><div class="muted" style="font-size:12.5px">오늘 가장 강한 테마 12개와 약한 테마 6개 · 색이 진할수록 많이 움직였어요</div></div><a class="more" href="#/market/groups/theme">전체 →</a></div>
      <div class="heatmap">${pick.map(tile).join("")}</div>
    </div>`;
  }

  // ------------------------------------------------------------ 홈
  function pageHome() {
    const T = MK.themes;
    const top = T[0], low = [...T].filter((t) => isNum(t.score)).sort((a, b) => a.score - b.score)[0];
    const all = Object.values(MK.stocks);
    const ups = all.filter((s) => (s.r1m || 0) > 0).length;
    const k = MK.kospi;
    const curated = (NEWS?.curated || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const auto = Object.values(NEWS?.auto || {}).flat().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const latest = (auto.length ? auto : curated).slice(0, 5);
    return `${staleBanner()}${adminBanner()}
    ${briefCard()}
    ${heatmapCard()}
    ${leadersCard()}
    <div class="grid g-main section">
      ${rankingCard()}
      <div class="card">
        <div class="card-head"><h2>종목 빠른 검색</h2><a class="more" href="#/search">검색 화면 →</a></div>
        ${searchBox("home-q")}
        <div class="card-head" style="margin-top:22px"><h2>최근 테마 뉴스</h2><a class="more" href="#/news">전체 →</a></div>
        ${newsItems(latest)}
      </div>
    </div>
    ${Object.keys(ALL).length ? `<div class="section">${homeMarketCard()}</div>` : ""}
    ${installCard()}`;
  }

  // ------------------------------------------------------------ 테마
  function stockTable(codes) {
    return `<div class="table-wrap"><table>
      <thead><tr><th>종목</th><th class="r">종가</th><th class="r">1개월</th><th class="r">3개월</th><th>52주 위치</th><th>모멘텀</th><th>메모</th></tr></thead>
      <tbody>${codes.map((c) => {
        const s = MK.stocks[c] || {};
        return `<tr class="link" data-go="#/company/${c}">
          <td><span class="stock-name">${esc(s.name || nameOf(c))}</span><span class="code">${c}</span></td>
          <td class="r num">${won(s.close)}</td>
          <td class="r num ${cls(s.r1m)}">${pct(s.r1m)}</td>
          <td class="r num ${cls(s.r3m)}">${pct(s.r3m)}</td>
          <td>${pos52(s.pos52)}</td>
          <td>${verdictBadge(s.momentum || "확인 필요")}</td>
          <td class="memo">${esc(memoOf(c))}</td></tr>`;
      }).join("")}</tbody></table></div>`;
  }

  function pageThemes(focus) {
    const T = MK.themes;
    const sel = focus && T.find((t) => t.name === focus) ? focus : null;
    const list = sel ? T.filter((t) => t.name === sel) : T;
    return `${staleBanner()}
    <div class="page-head"><div><h1>섹터·테마 모니터</h1><p class="lede">매일 바뀌는 자동 섹터 순위, 내가 ☆로 등록한 관심 테마, 기본 추천 테마, 맨 아래 테마 순위 종합 순서예요.</p></div><a class="btn primary" href="#/sectors">🔍 섹터 검색기</a></div>
    ${sel ? "" : autoSectorCard()}
    ${sel ? "" : myThemesCard(false)}
    <h2 style="margin:18px 0 10px;font-size:17px">기본 추천 테마 <span class="muted" style="font-size:12.5px;font-weight:500">핵심 종목을 매일 자세히 분석하는 8개 테마</span></h2>
    <div class="chips"><a class="chip ${sel ? "" : "on"}" href="#/themes">전체</a>${T.map((t) => `<a class="chip ${sel === t.name ? "on" : ""}" href="#/themes/${encodeURIComponent(t.name)}">${esc(t.name)}</a>`).join("")}</div>
    ${sel ? "" : `<div style="margin-bottom:16px">${rankingCard()}</div>`}
    ${list.map((t) => `
      <div class="card theme-block">
        <div class="theme-head"><span class="badge acc num">${t.rank ?? "–"}위</span><h2>${esc(t.name)}</h2>${verdictBadge(t.verdict)}
          <div class="theme-kpis num"><span>관심도<b>${t.score ?? "–"}</b></span><span>평균 1개월<b class="${cls(t.avg1m)}">${pct(t.avg1m)}</b></span><span>평균 3개월<b class="${cls(t.avg3m)}">${pct(t.avg3m)}</b></span>${isNum(t.rel1m) ? `<span>코스피 대비 1개월<b class="${cls(t.rel1m)}">${pct(t.rel1m)}p</b></span>` : ""}<span>상승<b>${t.up}/${t.total}</b></span></div>
        </div>
        ${themeSent(t.name) ? `<div class="theme-sent"><span class="muted">최근 뉴스</span>${sentBar(themeSent(t.name))}<a class="more" href="#/news">뉴스 보기 →</a></div>` : ""}
        ${stockTable(t.stocks)}
      </div>`).join("")}
    ${sel ? "" : themeRankAll()}`;
  }

  // ------------------------------------------------------------ 검색
  function searchBox(id, value = "") {
    return `<div class="search-box">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input id="${id}" type="search" autocomplete="off" placeholder="종목명 또는 코드 (예: 삼성전자, 005930)" value="${esc(value)}">
      <div class="suggest" hidden></div></div>`;
  }

  function wireSearch(id) {
    const input = document.getElementById(id);
    if (!input) return;
    const box = input.parentElement.querySelector(".suggest");
    let hits = [], hi = -1;
    const draw = () => {
      if (!hits.length) { box.hidden = true; return; }
      box.hidden = false;
      box.innerHTML = hits.map((r, i) => {
        const th = themeOfCode(r[1]);
        return `<button data-code="${r[1]}" data-name="${esc(r[0])}" class="${i === hi ? "hi" : ""}"><b>${esc(r[0])}</b><span class="muted num">${r[1]}</span>${th.length ? `<span class="badge acc">${esc(th[0])}</span>` : ""}<span class="m">${esc(r[2] || "")}</span></button>`;
      }).join("");
    };
    input.addEventListener("input", () => {
      const q = input.value.trim().toLowerCase();
      hi = -1;
      if (!q) { hits = []; return draw(); }
      const starts = [], has = [];
      for (const r of LIST) {
        const n = r[0].toLowerCase();
        if (n.startsWith(q) || r[1].startsWith(q)) starts.push(r);
        else if (n.includes(q)) has.push(r);
        if (starts.length >= 12) break;
      }
      hits = [...starts, ...has].slice(0, 12);
      draw();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { hi = Math.min(hits.length - 1, hi + 1); draw(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { hi = Math.max(0, hi - 1); draw(); e.preventDefault(); }
      else if (e.key === "Enter") {
        const r = hits[hi >= 0 ? hi : 0];
        if (r && input.dataset.pick) { e.preventDefault(); input.value = r[0]; input.dataset.code = r[1]; hits = []; draw(); input.dispatchEvent(new CustomEvent("picked", { detail: r[1] })); return; }
        if (r) location.hash = `#/company/${r[1]}`;
      } else if (e.key === "Escape") { hits = []; draw(); }
    });
    box.addEventListener("mousedown", (e) => {
      const b = e.target.closest("button");
      if (b) { e.preventDefault(); if (input.dataset.pick) { input.value = b.dataset.name; input.dataset.code = b.dataset.code; hits = []; draw(); input.dispatchEvent(new CustomEvent("picked", { detail: b.dataset.code })); } else location.hash = `#/company/${b.dataset.code}`; }
    });
    input.addEventListener("blur", () => setTimeout(() => (box.hidden = true), 120));
  }

  function pageSearch(code) {
    const row = code ? LIST.find((r) => r[1] === code) : null;
    let detail = "";
    if (code && !row) detail = `<div class="empty">종목코드 ${esc(code)} 를 목록에서 찾지 못했습니다.</div>`;
    if (row) {
      const themes = themeOfCode(code);
      const tracked = trackedCodes().includes(code);
      const theme = themes[0] ? MK.themes.find((t) => t.name === themes[0]) : null;
      const related = theme ? theme.stocks.filter((c) => c !== code) : [];
      const s = MK.stocks[code];
      detail = `<div class="grid g2 section">
        <div class="card">
          <div class="company-title"><h2 style="font-size:22px">${esc(row[0])}</h2><span class="code num">${code}</span><span class="badge">${esc(row[2] || "")}</span></div>
          <dl class="kv" style="margin-top:16px">
            <dt>추천 테마</dt><dd>${themes.length ? themes.map((t) => `<a class="badge acc" href="#/themes/${encodeURIComponent(t)}">${esc(t)}</a>`).join(" ") : `<span class="muted">미등록</span>`}</dd>
            <dt>테마 점수</dt><dd>${theme ? `<span class="num">${theme.score ?? "–"}</span> ${verdictBadge(theme.verdict)} <span class="muted">(${theme.rank}위)</span>` : `<span class="muted">–</span>`}</dd>
            <dt>최근 종가</dt><dd class="num">${s ? won(s.close) : "–"}</dd>
            <dt>1개월 / 3개월</dt><dd class="num">${s ? `<span class="${cls(s.r1m)}">${pct(s.r1m)}</span> / <span class="${cls(s.r3m)}">${pct(s.r3m)}</span>` : "–"}</dd>
            <dt>같은 테마</dt><dd>${related.length ? related.map((c) => `<a href="#/search/${c}" style="text-decoration:underline;text-underline-offset:3px">${esc(nameOf(c))}</a>`).join(" · ") : `<span class="muted">–</span>`}</dd>
          </dl>
          <div class="btn-row">${tracked ? `<a class="btn primary" href="#/company/${code}">기업분석 보기 →</a>` : ""}${stockLinks(code)}</div>
        </div>
        <div class="card">
          <h2>${tracked ? "자동 분석 대상" : "자동 분석 대상이 아닙니다"}</h2>
          <p class="sub" style="font-size:14px;margin:8px 0 0">${tracked
            ? "이 종목은 매일 시세·재무·뉴스가 자동으로 수집됩니다."
            : `매일 자동 분석을 받으려면 GitHub 저장소의 <b>data/config.json</b> 에서 원하는 테마의 <b>stocks</b> 목록에 추가하거나, <b>extra_companies</b> 에 코드 <b class="num">"${code}"</b> 를 넣으세요. 다음 갱신부터 기업분석에 나타납니다.`}</p>
        </div></div>`;
    }
    const tracked = trackedCodes();
    return `<div class="page-head"><div><h1>종목 검색</h1><p class="lede">국내 상장 ${LIST.length.toLocaleString()}개 종목에서 검색하고, 관심 테마와 관련 종목을 연결해 봅니다.</p></div></div>
      ${searchBox("q", row ? row[0] : "")}
      ${detail}
      ${row ? "" : `<div class="card section"><div class="card-head"><h2>자동 분석 중인 종목</h2><span class="muted" style="font-size:13px">${tracked.length}개</span></div>
        <div class="chips" style="margin:0">${tracked.map((c) => `<a class="chip" href="#/company/${c}">${esc(nameOf(c))}</a>`).join("")}</div></div>`}`;
  }

  // ------------------------------------------------------------ 기업분석
  const tagPER = (v) => (!isNum(v) ? null : v <= 0 ? "부정" : v <= 15 ? "긍정" : v <= 25 ? "중립" : "부정");
  const tagPBR = (v) => (!isNum(v) ? null : v <= 1.5 ? "긍정" : v <= 2.5 ? "중립" : "부정");
  const tagROE = (v) => (!isNum(v) ? null : v >= 0.15 ? "긍정" : v >= 0.08 ? "중립" : "부정");
  const tagDebt = (v) => (!isNum(v) ? null : v <= 0.5 ? "긍정" : v <= 1 ? "중립" : "부정");
  const tagOPM = (v) => (!isNum(v) ? null : v >= 0.15 ? "긍정" : v >= 0.05 ? "중립" : "부정");
  const tagBadge = (t) => (t ? `<span class="badge ${t === "긍정" ? "pos" : t === "부정" ? "neg" : ""}">${t}</span>` : "");

  function companyScore(c, price) {
    const f = c.fundamentals || {};
    const q = c.quarters || [];
    const items = [];
    // 밸류에이션 (PER 10 + PBR 10)
    if (isNum(f.per) && isNum(f.pbr)) {
      const p = f.per <= 0 ? 2 : f.per <= 10 ? 10 : f.per <= 15 ? 8 : f.per <= 25 ? 5 : 2;
      const b = f.pbr <= 0.7 ? 10 : f.pbr <= 1.5 ? 8 : f.pbr <= 2.5 ? 5 : 2;
      items.push(["밸류에이션", p + b, `PER ${f.per.toFixed(1)}배 → ${p}점, PBR ${f.pbr.toFixed(2)}배 → ${b}점`]);
    } else items.push(["밸류에이션", null]);
    const r = f.roe;
    items.push(["수익성", isNum(r) ? (r >= 0.2 ? 20 : r >= 0.15 ? 17 : r >= 0.1 ? 14 : r >= 0.08 ? 11 : r >= 0.05 ? 7 : 3) : null, isNum(r) ? `ROE ${(r * 100).toFixed(1)}% (20% 이상 만점)` : ""]);
    const d = f.debt_ratio;
    items.push(["재무안정성", isNum(d) ? (d <= 0.5 ? 20 : d <= 1 ? 16 : d <= 1.5 ? 12 : d <= 2 ? 8 : d <= 3 ? 4 : 1) : null, isNum(d) ? `부채비율 ${Math.round(d * 100)}% (50% 이하 만점)` : ""]);
    if (q.length >= 2 && isNum(q[0].op_income) && isNum(q[1].op_income)) {
      const yoy = q[4] && isNum(q[4].op_income) ? q[0].op_income > q[4].op_income : null;
      const revYoy = q[4] && isNum(q[4].revenue) && isNum(q[0].revenue) ? q[0].revenue > q[4].revenue : null;
      let s = 10 + (q[0].op_income >= q[1].op_income ? 4 : -4);
      if (yoy !== null) s += yoy ? 4 : -4;
      if (revYoy !== null) s += revYoy ? 2 : -2;
      items.push(["실적 모멘텀", Math.max(0, Math.min(20, s)), `영업이익 전분기 대비 ${q[0].op_income >= q[1].op_income ? "증가" : "감소"}${yoy === null ? "" : `, 전년 대비 ${yoy ? "증가" : "감소"}`}${revYoy === null ? "" : `, 매출 전년 대비 ${revYoy ? "증가" : "감소"}`}`]);
    } else items.push(["실적 모멘텀", null]);
    if (price && isNum(price.r1m) && isNum(price.r3m)) {
      const n = c.news || [];
      const pos = n.filter((x) => x.impact === "긍정").length, neg = n.filter((x) => x.impact === "주의" || x.impact === "부정").length;
      items.push(["시장·뉴스", Math.max(0, Math.min(20, 10 + (price.r1m > 0 ? 3 : -3) + (price.r3m > 0 ? 2 : -2) + Math.min(5, pos) - Math.min(5, neg))), `1개월 ${pct(price.r1m)}, 3개월 ${pct(price.r3m)}, 긍정 뉴스 ${pos}건·악재 ${neg}건`]);
    } else items.push(["시장·뉴스", null]);
    const have = items.filter((i) => i[1] !== null);
    const total = have.length ? Math.round(have.reduce((a, i) => a + i[1], 0) * 100 / (20 * have.length)) : null;
    const grade = total === null ? "자료 부족" : total >= 80 ? "매우 긍정" : total >= 65 ? "긍정" : total >= 50 ? "중립" : total >= 35 ? "주의" : "위험";
    const weakest = have.length ? have.reduce((a, b) => (b[1] < a[1] ? b : a))[0] : "–";
    return { items, total, grade, weakest, partial: have.length < items.length };
  }

  function sliceHist(c, range) {
    if (c?.history?.length > 1) return c.history.slice(-({ "1M": 22, "3M": 66, "6M": 130, "1Y": 999 }[range] || 999));
    if (c?.history_w?.length > 1) return c.history_w.slice(-({ "1M": 5, "3M": 14, "6M": 27, "1Y": 999 }[range] || 999));
    return null;
  }
  function priceChart(data) {
    if (!data || data.length < 2) return `<div class="empty">주가 차트는 이 종목의 자료가 수집되면 표시됩니다.<br>관심 종목(☆)에 추가하면 다음 갱신부터 매일 수집해요.</div>`;
    const W = 720, H = 220, P = { l: 8, r: 56, t: 10, b: 24 };
    const vals = data.map((d) => d[1]);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = (hi - lo) * 0.08 || hi * 0.02; lo -= pad; hi += pad;
    const x = (i) => P.l + (i / (data.length - 1)) * (W - P.l - P.r);
    const y = (v) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
    const up = vals[vals.length - 1] >= vals[0];
    const color = up ? "var(--up)" : "var(--down)";
    const path = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d[1]).toFixed(1)}`).join("");
    const area = `${path}L${x(data.length - 1).toFixed(1)},${H - P.b}L${x(0).toFixed(1)},${H - P.b}Z`;
    const step0 = (hi - lo) / 4, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= step0) || step0;
    const ticks = [];
    for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t);
    const xt = [0, Math.floor((data.length - 1) / 2), data.length - 1];
    return `<div class="chart-box" data-chart='${JSON.stringify({ W, P, lo, hi, H })}'>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="주가 추이">
        <defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".16"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
        ${ticks.map((t) => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)" stroke-width="1"/><text x="${W - P.r + 8}" y="${y(t) + 4}" font-size="11" fill="var(--ink-3)">${won(t)}</text>`).join("")}
        ${xt.map((i) => `<text x="${x(i)}" y="${H - 6}" font-size="11" fill="var(--ink-3)" text-anchor="${i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}">${data[i][0].slice(2).replace(/-/g, ".")}</text>`).join("")}
        <path d="${area}" fill="url(#g)"/>
        <path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
        <line class="xh" x1="0" x2="0" y1="${P.t}" y2="${H - P.b}" stroke="var(--ink-3)" stroke-dasharray="3 3" opacity="0"/>
        <circle class="pt" r="4.5" fill="${color}" stroke="var(--surface)" stroke-width="2" opacity="0"/>
        <rect x="${P.l}" y="0" width="${W - P.l - P.r}" height="${H}" fill="transparent" class="hit"/>
      </svg><div class="chart-tip"></div></div>`;
  }

  function wireChart(data) {
    const box = document.querySelector(".chart-box");
    if (!box || !data) return;
    const { W, P, lo, hi, H } = JSON.parse(box.dataset.chart);
    const svg = box.querySelector("svg"), tip = box.querySelector(".chart-tip");
    const xh = svg.querySelector(".xh"), pt = svg.querySelector(".pt");
    const move = (ev) => {
      const rect = svg.getBoundingClientRect();
      const cx = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left) * (W / rect.width);
      const i = Math.max(0, Math.min(data.length - 1, Math.round(((cx - P.l) / (W - P.l - P.r)) * (data.length - 1))));
      const px = P.l + (i / (data.length - 1)) * (W - P.l - P.r);
      const py = P.t + (1 - (data[i][1] - lo) / (hi - lo)) * (H - P.t - P.b);
      xh.setAttribute("x1", px); xh.setAttribute("x2", px); xh.setAttribute("opacity", 1);
      pt.setAttribute("cx", px); pt.setAttribute("cy", py); pt.setAttribute("opacity", 1);
      const chg = data[i][1] / data[0][1] - 1;
      tip.innerHTML = `${data[i][0]} · <b>${won(data[i][1])}</b> (${pct(chg)})`;
      tip.style.left = `${(px / W) * rect.width}px`; tip.style.top = `${(py / H) * rect.height}px`; tip.style.opacity = 1;
    };
    const leave = () => { xh.setAttribute("opacity", 0); pt.setAttribute("opacity", 0); tip.style.opacity = 0; };
    svg.addEventListener("mousemove", move); svg.addEventListener("touchmove", move, { passive: true });
    svg.addEventListener("mouseleave", leave); svg.addEventListener("touchend", leave);
  }

  let chartRange = "1Y";
  async function pageCompany(code) {
    const codes = trackedCodes();
    code = code || codes[0];
    if (!LMAP[code] && !MK.stocks[code]) return `<div class="empty">종목코드 ${esc(code)} 를 찾지 못했습니다.</div>`;
    if (!codes.includes(code)) codes.unshift(code);
    const c = (await getJSON(`companies/${code}.json`)) || { code, name: nameOf(code), market: LMAP[code]?.[2] };
    const price = { ...(c.price || {}), ...priceOf(code) };
    const starred = MYCACHE?.watch?.some((w) => w.code === code);
    const f = c.fundamentals || {};
    const sc = companyScore(c, price);
    const notes = CFG.company_notes?.[code];
    const mcap = f.market_cap_eok ?? price.marcap;
    const capTier = !isNum(mcap) ? null : mcap >= 100000 ? "대형주" : mcap >= 10000 ? "중형주" : "소형주";
    const q = c.quarters || [];
    const opYoY = q[4] && isNum(q[0]?.op_income) && isNum(q[4].op_income) ? q[0].op_income - q[4].op_income : null;
    const vt = [tagPER(f.per), tagPBR(f.pbr)].filter(Boolean);
    const heavy = vt.includes("부정");
    const cheap = vt.length === 2 && vt.every((t) => t === "긍정");
    const signals = !CAN_SEE() ? (capTier ? `<span class="badge">${capTier}</span>` : "") + `<span class="badge">🔒 투자 신호는 회원 전용</span>` : [
      capTier && `<span class="badge">${capTier}</span>`,
      isNum(f.op_margin) && (f.op_margin >= 0.15 ? `<span class="badge pos">고수익성</span>` : `<span class="badge">수익성 점검</span>`),
      opYoY !== null && (opYoY > 0 ? `<span class="badge pos">이익 모멘텀 ↑</span>` : `<span class="badge neg">이익 모멘텀 ↓</span>`),
      vt.length && (heavy ? `<span class="badge warn" title="PER 또는 PBR이 '부정' 구간">밸류 부담</span>` : cheap ? `<span class="badge good" title="PER·PBR 모두 '긍정' 구간">밸류 매력</span>` : `<span class="badge" title="PER·PBR 보통 구간">밸류 보통</span>`),
    ].filter(Boolean).join("");
    const strategy = (isNum(f.op_margin) && opYoY !== null)
      ? (() => {
          const strong = f.op_margin >= 0.15 && opYoY > 0;
          const weak = f.op_margin < 0.05 || opYoY <= 0;
          const a = strong ? "실적과 수익성 모멘텀이 강합니다. " : weak ? "본업 수익성 또는 이익 모멘텀이 약합니다. " : "수익성은 보통이며 이익 추세 확인이 필요합니다. ";
          const b = heavy ? "PER 또는 PBR이 높은 구간이라 추격매수보다 조정 시 분할 접근이 유리합니다."
            : strong ? "밸류에이션 부담이 크지 않아 실적 추세를 확인하며 비중 확대를 검토할 수 있습니다."
            : cheap ? "지표상 저평가지만 이익 개선이 확인되기 전까지는 비중 확대에 신중한 편이 좋습니다."
            : "밸류에이션은 보통 수준이라 실적 방향이 주가를 좌우할 가능성이 큽니다.";
          return `<b>전략</b> ${a}${b}`;
        })()
      : `<b>전략</b> 재무·분기 실적 자료가 모이면 자동으로 코멘트가 만들어집니다.`;
    const age = daysSince(c.as_of);
    const metric = (label, value, tag, note, tip) => `<div class="metric" title="${esc(tip)}"><div class="label">${label}${tagBadge(tag)}</div><div class="value num">${value}</div>${note ? `<div class="note">${note}</div>` : ""}</div>`;

    return `<div class="page-head">
      <div><div class="company-title"><h1>${esc(c.name || nameOf(code))}</h1><span class="code num">${code}</span>${c.market ? `<span class="badge">${esc(c.market)}</span>` : ""}${themeOfCode(code).map((t) => `<a class="badge acc" href="#/themes/${encodeURIComponent(t)}">${esc(t)}</a>`).join("")}</div>
      ${(CODE2THEMES[code] || []).length ? `<div class="signal-line"><span class="muted" style="font-size:12.5px;align-self:center">소속 테마</span>${CODE2THEMES[code].slice(0, 5).map((g) => `<a class="badge" href="#/market/g/theme/${g.no}">${esc(g.name)} <span class="${cls(g.chg)}">${pct(g.chg, 1)}</span></a>`).join("")}</div>` : ""}
      <div class="signal-line">${signals || `<span class="muted" style="font-size:13px">재무 자료 수집 전</span>`}${LMAP[code]?.[3] ? `<span class="badge">${esc(LMAP[code][3])}</span>` : ""}</div></div>
      <div style="display:flex;gap:8px;align-items:center">${SB ? `<button class="btn" id="star" data-code="${code}" data-name="${esc(c.name || nameOf(code))}" title="관심 종목">${starred ? "★ 관심" : "☆ 관심 추가"}</button>` : ""}
      <div class="company-search">${searchBox("cq")}</div></div>
    </div>
    ${!c.fundamentals ? `<div class="banner">이 종목의 재무·분기 실적은 아직 수집 전이에요. 전 종목 재무는 평일마다 나눠서 받아 <b>1주일에 한 번</b> 갱신됩니다.</div>` : ""}
    ${c.source === "엑셀 수기 입력" || (age !== null && age > 30) ? `<div class="banner">이 종목의 재무·뉴스는 <b>${esc(c.as_of || "")}</b> 기준${age !== null ? ` (${age}일 전)` : ""}입니다.${c.source === "엑셀 수기 입력" ? " 엑셀에서 옮긴 값이며, 자동 갱신이 시작되면 최신 자료로 바뀝니다." : ""}</div>` : ""}
    <div class="grid g4">
      <div class="card stat"><div class="label">최근 종가</div><div class="value num">${won(price.close)}</div><div class="foot">${isNum(price.chg) ? `<span class="${cls(price.chg)}">${pct(price.chg, 2)}</span> · ` : ""}${esc(price.last_date || "")}</div></div>
      <div class="card stat"><div class="label">1개월 / 3개월</div><div class="value sm num"><span class="${cls(price.r1m)}">${pct(price.r1m)}</span> <span class="muted">/</span> <span class="${cls(price.r3m)}">${pct(price.r3m)}</span></div><div class="foot">모멘텀 ${verdictBadge(price.momentum || "확인 필요")}</div></div>
      <div class="card stat"><div class="label">52주 위치</div><div class="value num">${isNum(price.pos52) ? Math.round(price.pos52 * 100) + "%" : "–"}</div><div class="foot num">${isNum(price.lo52) ? `${won(price.lo52)} ~ ${won(price.hi52)}` : "최저 0% ~ 최고 100%"}</div></div>
      <div class="card stat"><div class="label">시가총액</div><div class="value num">${cap(f.market_cap_eok ?? price.marcap)}</div><div class="foot">${isNum(price.amount) ? `거래대금 ${bigWon(price.amount)}` : isNum(price.vol20) ? `20일 평균 거래량 ${won(price.vol20)}` : "&nbsp;"}</div></div>
    </div>
    ${CAN_SEE() ? consensusLine(f, price) : ""}
    <div class="grid g-main section">
      <div class="card">
        <div class="card-head"><h2>주가 추이${!c.history?.length && c.history_w?.length ? ` <span class="muted" style="font-size:12px;font-weight:600">주간</span>` : ""}</h2><div class="range-tabs">${["1M", "3M", "6M", "1Y"].map((r) => `<button data-range="${r}" class="${r === chartRange ? "on" : ""}">${r}</button>`).join("")}</div></div>
        ${priceChart(sliceHist(c, chartRange))}
      </div>
      ${!CAN_SEE() ? secretBox("종합 점수", 260) : `<div class="card">
        <div class="card-head"><h2>종합 점수</h2>${verdictBadge(sc.grade === "매우 긍정" ? "높은 관심" : sc.grade === "긍정" ? "관심" : sc.grade === "위험" ? "약세" : sc.grade === "자료 부족" ? "확인 필요" : sc.grade)}</div>
        <div class="score-ring"><div class="score-big num">${sc.total ?? "–"}</div><div class="sub" style="font-size:13px">100점 만점 · 5개 항목 × 20점${sc.partial ? "<br><span class='muted'>자료 있는 항목만 환산</span>" : ""}<br>가장 약한 항목: <b>${esc(sc.weakest)}</b></div></div>
        <div class="score-items">${sc.items.map(([k, v, why]) => `<div class="score-item" title="${esc(why || "자료 없음")}"><span class="sub">${k}</span><div class="track"><div class="fill" style="width:${isNum(v) ? v * 5 : 0}%"></div></div><b class="num">${v ?? "–"}</b>${why ? `<span class="why">${esc(why)}</span>` : ""}</div>`).join("")}</div>
      </div>`}
    </div>
    ${!CAN_SEE() ? `<div class="section">${secretBox("핵심 재무 지표", 200)}</div>` : `<div class="card section">
      <div class="card-head"><h2>핵심 재무 지표</h2><span class="muted" style="font-size:12.5px">${esc(c.source || "")} ${c.as_of ? "· " + esc(c.as_of) : ""}</span></div>
      <div class="metrics">
        ${metric("PER", times(f.per), tagPER(f.per), tagPER(f.per) === "긍정" ? "이익 대비 주가 부담 낮음" : tagPER(f.per) === "중립" ? "보통 수준" : tagPER(f.per) ? "이익 대비 주가 부담" : "", "주가 ÷ 주당순이익. 15배 이하 긍정, 25배 초과 부담. 업종마다 기준이 다릅니다.")}
        ${metric("PBR", times(f.pbr), tagPBR(f.pbr), tagPBR(f.pbr) === "긍정" ? "자산가치 대비 저평가" : tagPBR(f.pbr) === "중립" ? "적정 구간" : tagPBR(f.pbr) ? "자산가치 대비 고평가" : "", "주가 ÷ 주당순자산. 1.5배 이하 긍정. 수익성이 낮으면 저PBR이 오래 갈 수 있습니다.")}
        ${metric("ROE", pct(f.roe, 1, false), tagROE(f.roe), tagROE(f.roe) === "긍정" ? "자본 효율 우수" : tagROE(f.roe) === "중립" ? "보통 수준" : tagROE(f.roe) ? "수익성 개선 필요" : "", "순이익 ÷ 자기자본. 15% 이상 우수, 8% 미만 낮음.")}
        ${metric("영업이익률", pct(f.op_margin, 1, false), tagOPM(f.op_margin), "", "영업이익 ÷ 매출액 (최근 분기).")}
        ${metric("부채비율", pct(f.debt_ratio, 0, false), tagDebt(f.debt_ratio), tagDebt(f.debt_ratio) === "긍정" ? "재무 안정적" : tagDebt(f.debt_ratio) === "중립" ? "지속 점검" : tagDebt(f.debt_ratio) ? "부채 부담 높음" : "", "부채 ÷ 자본. 50% 이하 안정, 100% 초과 점검. 금융·조선 등은 업종 특성상 높을 수 있습니다.")}
      </div>
      <div class="strategy">${strategy}</div>
    </div>`}
    <div class="grid g2 section">
      <div class="card">
        <div class="card-head"><h2>분기 실적</h2><span class="muted" style="font-size:12.5px">단위 ${esc(c.unit || "억원")}</span></div>
        ${q.length ? `<div class="table-wrap"><table><thead><tr><th>분기</th><th class="r">매출액</th><th class="r">영업이익</th><th class="r">순이익</th><th class="r">영업이익률</th></tr></thead><tbody>
          ${q.map((r) => `<tr><td>${esc(r.period)}</td><td class="r num">${eokFmt(r.revenue)}</td><td class="r num ${isNum(r.op_income) && r.op_income < 0 ? "down" : ""}">${eokFmt(r.op_income)}</td><td class="r num ${isNum(r.net_income) && r.net_income < 0 ? "down" : ""}">${eokFmt(r.net_income)}</td><td class="r num">${pct(r.op_margin, 1, false)}</td></tr>`).join("")}
        </tbody></table></div>` : `<div class="empty">분기 실적은 첫 자동 갱신 후 표시됩니다.</div>`}
      </div>
      ${flowCard(c)}
    </div>
    <div class="grid g-main section">
      <div class="card">
        <div class="card-head"><h2>최근 뉴스</h2><a class="more" href="https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(c.name || "")}" target="_blank" rel="noopener">네이버 뉴스 ↗</a></div>
        ${newsItems(c.news)}
      </div>
      ${disclosureCard(c) || `<div class="card"><div class="card-head"><h2>최근 공시</h2></div><div class="empty">공시는 매일 자동 수집 종목에 표시돼요.</div></div>`}
    </div>
    ${notes ? `<div class="card section notes">
      <div class="card-head"><h2>내 분석 메모</h2><span class="muted" style="font-size:12.5px">${esc(notes.as_of || "")} 작성 · config.json</span></div>
      ${(notes.issues || []).map((i) => `<div class="issue"><div style="display:flex;gap:8px;align-items:center"><b>${esc(i.title)}</b>${impactBadge(i.impact)}</div><p>${esc(i.detail)}</p></div>`).join("")}
      ${(notes.conditions || []).map((i) => `<div class="issue"><div style="display:flex;gap:8px;align-items:center"><b>${esc(i.label)}</b><span class="badge">${esc(i.tag)}</span></div><p>${esc(i.detail)}</p></div>`).join("")}
      ${notes.verdict ? `<div class="strategy"><b>종합 판단 · ${esc(notes.verdict)}</b><br>${esc(notes.comment || "")}</div>` : ""}
    </div>` : ""}
    <div class="btn-row">${stockLinks(code)}</div>`;
  }

  // ------------------------------------------------------------ 뉴스
  let newsFilter = "전체", newsTone = "전체", newsTab = "auto", newsLimit = 20;
  const toneOf = (imp) => (imp === "긍정" ? "긍정" : imp === "주의" || imp === "부정" ? "악재" : "보통");
  const dayLabel = (d) => { const n = daysSince(d); return n === 0 ? "오늘" : n === 1 ? "어제" : d ? `${+d.slice(5, 7)}월 ${+d.slice(8, 10)}일` : "날짜 없음"; };
  function newsCards(items, opts = {}) {
    if (!items.length) return `<div class="empty">조건에 맞는 뉴스가 없어요.</div>`;
    let last = null;
    return `<div class="nlist">${items.map((n) => {
      const head = opts.group && n.date !== last ? `<div class="nday">${dayLabel(n.date)}</div>` : "";
      last = n.date;
      const tag = [n.stock, n.theme].filter(Boolean).map(esc).join(" · ");
      if (posLocked(n.impact)) return `${head}<div class="ncard t-${toneOf(n.impact)} locked"><div class="ntop">${sentBadge(n.impact)}${n.theme ? `<span class="ntag">${esc(n.theme)}</span>` : ""}<span class="ntime num">${opts.group ? esc(n.time || "") : esc(n.date || "")}</span></div>${posLockHTML(n.impact)}</div>`;
      return `${head}<a class="ncard t-${toneOf(n.impact)}" ${n.url ? `href="${esc(n.url)}" target="_blank" rel="noopener"` : ""}>
        <div class="ntop">${sentBadge(n.impact)}${tag ? `<span class="ntag">${tag}</span>` : ""}<span class="ntime num">${opts.group ? esc(n.time || "") : esc(n.date || "")}</span></div>
        <div class="ntitle">${esc(n.title)}</div>
        ${n.summary ? `<div class="nsum">${esc(n.summary)}</div>` : ""}
        ${n.checkpoint ? `<div class="ncp"><b>체크포인트</b> ${esc(n.checkpoint)}</div>` : ""}
        <div class="nsrc">${esc(n.source || "")}</div></a>`;
    }).join("")}</div>`;
  }
  function pageNews() {
    const themes = CFG.themes.map((t) => t.name);
    const inTheme = (n) => newsFilter === "전체" || n.theme === newsFilter;
    const curatedAll = (NEWS?.curated || []).filter(inTheme).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const seen = new Set();
    const autoAll = Object.entries(NEWS?.auto || {}).flatMap(([t, l]) => l.map((n) => ({ ...n, theme: t })))
      .filter(inTheme).filter((n) => (seen.has(n.title) ? false : seen.add(n.title)))
      .sort((a, b) => `${b.date}${b.time || ""}`.localeCompare(`${a.date}${a.time || ""}`));
    const both = [...autoAll, ...curatedAll];
    const cnt = { 긍정: 0, 보통: 0, 악재: 0 };
    both.forEach((n) => cnt[toneOf(n.impact)]++);
    const byTone = (l) => (newsTone === "전체" ? l : l.filter((n) => toneOf(n.impact) === newsTone));
    const auto = byTone(autoAll), curated = byTone(curatedAll);
    const tot = cnt.긍정 + cnt.보통 + cnt.악재;
    const mood = cnt.긍정 > cnt.악재 ? ["긍정 우세", "up"] : cnt.악재 > cnt.긍정 ? ["악재 우세", "down"] : ["팽팽", ""];
    return `<div class="page-head"><div><h1>뉴스</h1><p class="lede">추천 테마 종목 뉴스를 하루 두 번 모아 긍정·보통·악재로 자동 분류해요 (참고용).</p></div></div>
      <div class="hscroll chips">${["전체", ...themes].map((t) => `<button class="chip ${t === newsFilter ? "on" : ""}" data-nf="${esc(t)}">${esc(t)}</button>`).join("")}</div>
      <div class="card nmood">
        <div class="nmood-top"><div><div class="label">${newsFilter === "전체" ? "전체" : esc(newsFilter)} 뉴스 분위기</div><b class="${mood[1]}">${mood[0]}</b></div><span class="muted num" style="font-size:12.5px">${tot}건 · ${esc(NEWS?.auto_as_of || "")} 수집</span></div>
        ${tot ? `<div class="sent-bar" style="height:12px;border-radius:6px"><i class="p" style="flex:${cnt.긍정}"></i><i class="m" style="flex:${cnt.보통}"></i><i class="n" style="flex:${cnt.악재}"></i></div>` : ""}
        <div class="tone-btns">${[["전체", tot, ""], ["긍정", cnt.긍정, "up"], ["보통", cnt.보통, ""], ["악재", cnt.악재, "down"]].map(([k, v, c]) => `<button class="tone ${newsTone === k ? "on" : ""}" data-nt="${k}"><span>${k}</span><b class="num ${c}">${v}</b></button>`).join("")}</div>
      </div>
      <div class="seg"><button class="${newsTab === "auto" ? "on" : ""}" data-ntab="auto">자동 수집 <b class="num">${auto.length}</b></button><button class="${newsTab === "cur" ? "on" : ""}" data-ntab="cur">핵심 뉴스 <b class="num">${curated.length}</b></button></div>
      <div class="ncols show-${newsTab}">
        <div class="card ncol-auto"><div class="card-head"><h2>자동 수집 뉴스</h2><span class="muted" style="font-size:12.5px">최신순 · ${auto.length}건</span></div>
          ${autoAll.length ? newsCards(auto.slice(0, newsLimit), { group: true }) : `<div class="empty">다음 자동 수집 후 표시돼요.</div>`}
          ${auto.length > newsLimit ? `<button class="btn" style="width:100%;margin-top:12px" id="news-more">더 보기 (${newsLimit}/${auto.length})</button>` : ""}</div>
        <div class="card ncol-cur"><div class="card-head"><h2>핵심 뉴스</h2><span class="muted" style="font-size:12.5px">직접 정리 · ${esc(NEWS?.as_of || "")}</span></div>
          ${newsCards(curated)}</div>
      </div>`;
  }

  // ------------------------------------------------------------ 주도 테마·업종 (네이버 테마 전체)
  function groupLeaders(g, n = 3) {
    return (g.codes || []).map((c) => ({ code: c, name: nameOf(c), chg: ALL[c]?.chg, amount: ALL[c]?.amount }))
      .filter((x) => isNum(x.chg)).sort((a, b) => b.chg - a.chg).slice(0, n);
  }
  function groupLaggards(g, n = 3) {
    return (g.codes || []).map((c) => ({ code: c, name: nameOf(c), chg: ALL[c]?.chg }))
      .filter((x) => isNum(x.chg)).sort((a, b) => a.chg - b.chg).slice(0, n);
  }
  function groupList(kind, limit, compact) {
    const gs = (GROUPS?.[kind === "theme" ? "themes" : "industries"] || []).filter((g) => (g.total || 0) >= 3)
      .slice().sort((a, b) => b.chg - a.chg).slice(0, limit);
    if (!gs.length) return `<div class="empty">다음 자동 갱신(평일 16:20) 후 표시됩니다.</div>`;
    return `<div class="glist">${gs.map((g, i) => {
      const lead = groupLeaders(g, compact ? 2 : 3);
      const breadth = g.rise + g.fall ? g.rise / (g.rise + g.fall) : 0;
      return `<a class="grow" href="#/market/g/${kind}/${g.no}">
        <span class="rk num">${i + 1}</span>
        <span class="gname">${esc(g.name)}<span class="glead">${lead.map((l) => `${esc(l.name)} <b class="${cls(l.chg)}">${pct(l.chg, 1)}</b>`).join(" · ")}</span></span>
        <span class="gbreadth" title="상승 ${g.rise} · 하락 ${g.fall}"><i style="width:${breadth * 100}%"></i></span>
        <b class="num ${cls(g.chg)}">${pct(g.chg, 2)}</b></a>`;
    }).join("")}</div>`;
  }
  function leadersCard() {
    if (!GROUPS) return "";
    return `<div class="grid g2 section">
      <div class="card"><div class="card-head"><div><h2>오늘의 주도 테마</h2><div class="muted" style="font-size:12.5px">네이버 테마 ${GROUPS.themes.length}개 중 · 평균 등락률 순</div></div><a class="more" href="#/market/groups/theme">전체 →</a></div>${groupList("theme", 6, true)}</div>
      <div class="card"><div class="card-head"><div><h2>오늘의 주도 업종</h2><div class="muted" style="font-size:12.5px">업종 ${GROUPS.industries.length}개 중</div></div><a class="more" href="#/market/groups/industry">전체 →</a></div>${groupList("industry", 6, true)}</div>
    </div>`;
  }
  function findGroup(kind, no) {
    return (GROUPS?.[kind === "theme" ? "themes" : "industries"] || []).find((g) => String(g.no) === String(no));
  }

  // ------------------------------------------------------------ 섹터 검색기 · 섹터 뉴스 (긍정·보통·악재)
  let GNEWS = null; // data/group_news.json (섹터 화면에서만 불러옴)
  const SENT = { 긍정: ["긍정", "pos"], 중립: ["보통", ""], 주의: ["악재", "neg"], 부정: ["악재", "neg"] };
  const sentBadge = (t) => { const [l, k] = SENT[t] || SENT.중립; return `<span class="badge ${k}">${l}</span>`; };
  const gkey = (kind, no) => `${kind === "industry" ? "i" : "t"}${no}`;
  const gnewsOf = (kind, no) => { const v = GNEWS?.g?.[gkey(kind, no)]; return v ? { p: v[0], m: v[1], n: v[2], items: v[3] || [] } : null; };
  function sentBar(s, big) {
    if (!s) return `<span class="muted" style="font-size:12px">뉴스 수집 전</span>`;
    const tot = s.p + s.m + s.n;
    if (!tot) return `<span class="muted" style="font-size:12px">최근 7일 뉴스 없음</span>`;
    return `<div class="sent ${big ? "big" : ""}" title="긍정 ${s.p} · 보통 ${s.m} · 악재 ${s.n}">
      <div class="sent-bar"><i class="p" style="flex:${s.p}"></i><i class="m" style="flex:${s.m}"></i><i class="n" style="flex:${s.n}"></i></div>
      <div class="sent-num num"><span class="up">${s.p}</span><span class="muted">${s.m}</span><span class="down">${s.n}</span></div></div>`;
  }
  // 테마·업종 묶음의 1주·1개월 평균과 종합 강도(오늘 40% · 1주 30% · 1개월 30% 백분위)
  let GSTAT = null;
  function allGroups() {
    if (GSTAT) return GSTAT;
    const avg = (codes, k) => { const v = codes.map((c) => ALL[c]?.[k]).filter(isNum); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const gs = [...(GROUPS?.themes || []).map((g) => ({ ...g, kind: "theme" })), ...(GROUPS?.industries || []).map((g) => ({ ...g, kind: "industry" }))]
      .filter((g) => (g.total || 0) >= 3)
      .map((g) => ({ ...g, r1w: avg(g.codes || [], "r1w"), r1m: avg(g.codes || [], "r1m") }));
    const prc = (k) => { const v = gs.map((g) => g[k]).filter(isNum).sort((a, b) => a - b); return (x) => (isNum(x) && v.length > 1 ? v.filter((y) => y < x).length / (v.length - 1) : 0.5); };
    const pc = prc("chg"), pw = prc("r1w"), pm = prc("r1m");
    gs.forEach((g) => (g.score = Math.round(100 * (0.4 * pc(g.chg) + 0.3 * pw(g.r1w) + 0.3 * pm(g.r1m)))));
    return (GSTAT = gs);
  }
  const secState = { q: "", kind: "전체", sort: "score", limit: 40 };
  const SECSORT = { score: "종합 강도", chg: "오늘", r1w: "1주", r1m: "1개월", pos: "긍정 뉴스", neg: "악재 뉴스" };
  const norm = (s) => String(s || "").replace(/\s/g, "").toLowerCase();
  // 줄임말 → 네이버 섹터 이름에 들어가는 말
  const SEC_ALIAS = { 원전: ["원자력"], 배터리: ["2차전지", "전지"], 이차전지: ["2차전지"], 인공지능: ["ai", "인공지능"], 방산: ["방위산업", "국방"],
    우주: ["우주"], 바이오: ["바이오", "제약", "의료"], 헬스케어: ["의료", "제약", "헬스케어"], 전력망: ["전력", "스마트그리드"], 데이터센터: ["데이터센터", "전력설비"],
    조선: ["조선", "해운"], 엔터: ["엔터"], 반도체: ["반도체", "hbm"], 로봇: ["로봇"], 금융: ["은행", "증권", "보험"], 화장품: ["화장품"], 자율주행: ["자율주행"] };
  const secMatch = (name, q) => { const n = norm(name); return n.includes(q) || (SEC_ALIAS[q] || []).some((a) => n.includes(a)); };
  function sectorRows() {
    let gs = allGroups();
    if (secState.kind === "테마") gs = gs.filter((g) => g.kind === "theme");
    if (secState.kind === "업종") gs = gs.filter((g) => g.kind === "industry");
    const q = norm(secState.q);
    let byStock = null;
    if (q) {
      const hit = LIST.find((r) => norm(r[0]) === q || r[1] === q) || (q.length >= 2 ? LIST.find((r) => norm(r[0]).startsWith(q)) : null);
      const named = gs.filter((g) => secMatch(g.name, q));
      if (hit) byStock = { name: hit[0], code: hit[1], groups: gs.filter((g) => (g.codes || []).includes(hit[1]) && !named.includes(g)) };
      gs = named;
    }
    const sv = (g) => { const s = gnewsOf(g.kind, g.no); const k = secState.sort;
      if (k === "pos") return s ? s.p - s.n * 0.5 : -1e9;
      if (k === "neg") return s ? s.n - s.p * 0.5 : -1e9;
      return isNum(g[k]) ? g[k] : -1e9; };
    const sorter = (a, b) => sv(b) - sv(a);
    return { rows: gs.slice().sort(sorter), byStock: byStock && { ...byStock, groups: byStock.groups.sort(sorter) } };
  }
  function sectorTable(rows, start = 0) {
    if (!rows.length) return `<div class="empty">찾는 섹터가 없어요. 다른 이름이나 종목명으로 검색해 보세요.</div>`;
    return `<div class="table-wrap"><table class="sec-table">
      <thead><tr><th>#</th><th>섹터</th><th class="r">강도</th><th class="r">오늘</th><th class="r">1주</th><th class="r">1개월</th><th>상승 비율</th><th>최근 뉴스 <span class="muted" style="font-weight:500">긍정·보통·악재</span></th></tr></thead>
      <tbody>${rows.map((g, i) => {
        const br = g.rise + g.fall ? g.rise / (g.rise + g.fall) : 0;
        return `<tr class="link" data-go="#/sectors/${g.kind}/${g.no}">
          <td class="muted num">${start + i + 1}</td>
          <td><span class="stock-name">${esc(g.name)}</span> <span class="badge">${g.kind === "theme" ? "테마" : "업종"}</span>
            <div class="muted" style="font-size:11.5px">${groupLeaders(g, 2).map((l) => `${esc(l.name)} <span class="${cls(l.chg)}">${pct(l.chg, 1)}</span>`).join(" · ")}</div></td>
          <td class="r num"><b>${g.score}</b></td>
          <td class="r num ${cls(g.chg)}">${pct(g.chg, 2)}</td>
          <td class="r num ${cls(g.r1w)}">${pct(g.r1w)}</td>
          <td class="r num ${cls(g.r1m)}">${pct(g.r1m)}</td>
          <td><span class="gbreadth" style="display:block;width:70px" title="상승 ${g.rise} · 하락 ${g.fall}"><i style="width:${br * 100}%"></i></span></td>
          <td>${sentBar(gnewsOf(g.kind, g.no))}</td></tr>`;
      }).join("")}</tbody></table></div>`;
  }
  function sectorResults() {
    const { rows, byStock } = sectorRows();
    return `${byStock && byStock.groups.length ? `<div class="card section"><div class="card-head"><h2>‘${esc(byStock.name)}’이(가) 속한 섹터</h2><a class="more" href="#/company/${byStock.code}">기업분석 →</a></div>${sectorTable(byStock.groups)}</div>` : ""}
      ${byStock && byStock.groups.length && !rows.length ? "" : `<div class="card section"><div class="card-head"><h2>${secState.q ? `‘${esc(secState.q)}’ 관련 섹터` : "전체 섹터 순위"}</h2><span class="muted" style="font-size:13px">${rows.length}개</span></div>
        ${sectorTable(rows.slice(0, secState.limit))}
        ${rows.length > secState.limit ? `<div style="text-align:center;margin-top:14px"><button class="btn" id="sec-more">40개 더 보기</button></div>` : ""}</div>`}`;
  }
  function pageSectors(parts) {
    if (parts[1] && parts[2]) return pageSectorDetail(parts[1], parts[2]);
    if (!GROUPS) return `<div class="empty">섹터 목록은 다음 자동 갱신(평일 16:20) 후 표시됩니다.</div>`;
    return `<div class="page-head"><div><h1>섹터 검색기</h1><p class="lede">네이버 테마 ${GROUPS.themes.length}개 · 업종 ${GROUPS.industries.length}개를 매일 새로 받아옵니다. 섹터 이름이나 종목명으로 찾고, 최근 7일 뉴스를 긍정·보통·악재로 나눠 보여줘요. · ${esc(GROUPS.as_of || "")} 기준${GNEWS ? ` · 뉴스 ${esc((GNEWS.updated_at || "").replace("T", " ").slice(0, 16))}` : ""}</p></div></div>
      <div class="search-box"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="sec-q" type="search" autocomplete="off" placeholder="예: 반도체, 원전, 2차전지, 또는 종목명 ‘한화오션’" value="${esc(secState.q)}"></div>
      <div class="chips" style="margin-top:12px">${["전체", "테마", "업종"].map((k) => `<button class="chip ${secState.kind === k ? "on" : ""}" data-sk="${k}">${k}</button>`).join("")}
        <span class="muted" style="align-self:center;margin:0 4px 0 10px;font-size:12.5px">정렬</span>${Object.entries(SECSORT).map(([k, l]) => `<button class="chip ${secState.sort === k ? "on" : ""}" data-ss="${k}">${l}</button>`).join("")}</div>
      <div id="sec-results">${sectorResults()}</div>
      <p class="muted" style="font-size:12px;margin-top:10px">강도 = 오늘 등락 40% + 1주 30% + 1개월 30%를 전체 섹터 중 순위(0~100)로 바꾼 값. 뉴스는 섹터 시가총액 상위 3종목의 기사 제목 키워드로 자동 분류한 참고용입니다.</p>`;
  }
  function wireSectors() {
    const inp = document.getElementById("sec-q");
    const box = document.getElementById("sec-results");
    const draw = () => { box.innerHTML = sectorResults(); document.getElementById("sec-more")?.addEventListener("click", () => { secState.limit += 40; draw(); }); };
    inp?.addEventListener("input", () => { secState.q = inp.value.trim(); secState.limit = 40; draw(); });
    document.querySelectorAll("[data-sk]").forEach((b) => b.addEventListener("click", () => { secState.kind = b.dataset.sk; secState.limit = 40; rerender(); }));
    document.querySelectorAll("[data-ss]").forEach((b) => b.addEventListener("click", () => { secState.sort = b.dataset.ss; secState.limit = 40; rerender(); }));
    if (box) draw();
  }
  function sentDonut(s) {
    const tot = s.p + s.m + s.n, r = 42, C = 2 * Math.PI * r;
    let off = 0;
    const seg = (v, col) => { const len = (v / tot) * C; const el = v ? `<circle r="${r}" cx="55" cy="55" fill="none" stroke="${col}" stroke-width="16" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 55 55)"/>` : ""; off += len; return el; };
    const tone = s.p > s.n ? ["긍정 우세", "up"] : s.n > s.p ? ["악재 우세", "down"] : ["팽팽", ""];
    return `<svg viewBox="0 0 110 110" width="128" height="128" role="img" aria-label="긍정 ${s.p} 보통 ${s.m} 악재 ${s.n}">
      <circle r="${r}" cx="55" cy="55" fill="none" stroke="var(--line)" stroke-width="16"/>
      ${seg(s.p, "var(--up)")}${seg(s.m, "var(--ink-3)")}${seg(s.n, "var(--down)")}
      <text x="55" y="52" text-anchor="middle" font-size="18" font-weight="800" fill="var(--ink)">${tot}</text>
      <text x="55" y="69" text-anchor="middle" font-size="10" fill="var(--ink-3)">건</text></svg>
      <div class="sent-tone ${tone[1]}">${tone[0]}</div>`;
  }
  function pageSectorDetail(kind, no) {
    const g = allGroups().find((x) => x.kind === kind && String(x.no) === String(no)) || (findGroup(kind, no) && { ...findGroup(kind, no), kind });
    if (!g) return `<div class="empty">섹터를 찾지 못했어요. <a href="#/sectors" style="color:var(--accent)">섹터 검색기로</a></div>`;
    const s = gnewsOf(kind, no);
    const mem = (g.codes || []).map((c) => ({ code: c, name: nameOf(c), ...(ALL[c] || {}) })).sort((a, b) => (b.marcap || 0) - (a.marcap || 0));
    const tot = s ? s.p + s.m + s.n : 0;
    return `<div class="page-head"><div><a href="#/sectors" class="muted" style="font-size:13px">← 섹터 검색기</a>
      <h1>${esc(g.name)} <span class="badge">${kind === "theme" ? "테마" : "업종"}</span></h1>
      <p class="lede">${g.total}종목 · 오늘 <span class="${cls(g.chg)}">${pct(g.chg, 2)}</span> · 상승 ${g.rise} / 하락 ${g.fall}${isNum(g.score) ? ` · 강도 <b>${g.score}</b>` : ""}</p></div>
      ${SB ? (() => { const t = MYCACHE?.themes?.find((x) => x.kind === kind && String(x.no) === String(no)); const s = t && themeSince(t);
        return `<div style="text-align:right"><button class="btn ${t ? "" : "primary"}" id="tstar" data-kind="${kind}" data-no="${esc(no)}" data-name="${esc(g.name)}">${t ? "★ 관심 테마" : "☆ 관심 테마 추가"}</button>${s ? `<div class="num" style="font-size:12.5px;margin-top:6px">${esc(t.created_at.slice(0, 10))} 등록 후 <b class="${cls(s.ret)}">${pct(s.ret, 2)}</b></div>` : ""}</div>`; })() : ""}</div>
      <div class="grid g4 section">
        <div class="card stat"><div class="label">오늘</div><div class="value num ${cls(g.chg)}">${pct(g.chg, 2)}</div></div>
        <div class="card stat"><div class="label">1주 평균</div><div class="value num ${cls(g.r1w)}">${pct(g.r1w)}</div></div>
        <div class="card stat"><div class="label">1개월 평균</div><div class="value num ${cls(g.r1m)}">${pct(g.r1m)}</div></div>
        <div class="card stat"><div class="label">상승 종목</div><div class="value num">${g.rise}<span class="muted" style="font-size:15px"> / ${g.total}</span></div></div>
      </div>
      <div class="grid g-main section">
        <div class="card"><div class="card-head"><h2>최신 뉴스</h2><span class="muted" style="font-size:12.5px">최근 7일 · 시총 상위 종목 기사</span></div>
          ${s && s.items.length ? `<div class="news-list">${s.items.map(([d, t, title, src, url, imp, st]) => posLocked(imp) ? `<div class="news-item locked"><div style="display:flex;gap:8px;align-items:center">${sentBadge(imp)}${posLockHTML(imp)}</div><div class="meta num">${esc(d || "")} ${esc(t || "")}</div></div>` : `<div class="news-item">
            <div style="display:flex;gap:8px;align-items:flex-start">${sentBadge(imp)}<a class="t" style="font-weight:600" href="${esc(url || "#")}" target="_blank" rel="noopener">${esc(title)}</a></div>
            <div class="meta num">${esc(st)} · ${esc(src)} · ${esc(d || "")} ${esc(t || "")}</div></div>`).join("")}</div>`
            : `<div class="empty">${GNEWS ? "최근 7일 동안 모인 뉴스가 없어요." : "섹터 뉴스는 다음 자동 갱신 후 표시됩니다."}</div>`}
        </div>
        <div class="card"><div class="card-head"><h2>뉴스 분위기</h2></div>
          ${tot ? `<div class="sent-wrap">${sentDonut(s)}<div class="sent-legend">
            <div><i class="p"></i>긍정<b class="num up">${s.p}</b></div><div><i class="m"></i>보통<b class="num">${s.m}</b></div><div><i class="n"></i>악재<b class="num down">${s.n}</b></div></div></div>
            ${sentBar(s, true)}` : `<div class="empty">집계할 뉴스가 없어요.</div>`}
          <p class="muted" style="font-size:12px;margin-top:10px">기사 제목 키워드(수주·최대 실적·목표가 상향 ↔ 적자·유상증자·목표가 하향 등)로 자동 분류한 참고용이에요.</p>
        </div>
      </div>
      <div class="card section"><div class="card-head"><h2>소속 종목</h2><a class="more" href="#/market/g/${kind}/${no}">정렬 가능한 표 →</a></div>
        <div class="table-wrap"><table><thead><tr><th>종목</th><th class="r">현재가</th><th class="r">오늘</th><th class="r">1주</th><th class="r">1개월</th><th>52주 위치</th><th class="r">시총</th></tr></thead>
        <tbody>${mem.slice(0, 30).map((r) => `<tr class="link" data-go="#/company/${r.code}"><td><span class="stock-name">${esc(r.name)}</span><span class="code">${r.code}</span></td>
          <td class="r num">${won(r.close)}</td><td class="r num ${cls(r.chg)}">${pct(r.chg, 2)}</td><td class="r num ${cls(r.r1w)}">${pct(r.r1w)}</td><td class="r num ${cls(r.r1m)}">${pct(r.r1m)}</td><td>${pos52(r.pos52)}</td><td class="r num">${cap(r.marcap)}</td></tr>`).join("")}</tbody></table></div></div>`;
  }
  // 섹터·테마 화면 맨 위: 매일 바뀌는 자동 섹터 순위
  function autoSectorCard() {
    if (!GROUPS) return "";
    const top = allGroups().filter((g) => g.kind === "theme" && g.total >= 5).sort((a, b) => b.score - a.score).slice(0, 8);
    return `<div class="card section"><div class="card-head"><div><h2>오늘의 자동 섹터 TOP 8</h2><div class="muted" style="font-size:12.5px">네이버 테마 ${GROUPS.themes.length}개에서 매일 새로 뽑아요 · ${esc(GROUPS.as_of || "")} 기준</div></div><a class="more" href="#/sectors">섹터 검색기 →</a></div>
      <div class="auto-sec">${top.map((g, i) => `<a class="asec" href="#/sectors/theme/${g.no}">
        <span class="rk num">${i + 1}</span><b>${esc(g.name)}</b>
        <span class="num"><span class="${cls(g.chg)}">${pct(g.chg, 1)}</span> · 1주 <span class="${cls(g.r1w)}">${pct(g.r1w)}</span></span>
        ${sentBar(gnewsOf("theme", g.no))}</a>`).join("")}</div></div>`;
  }
  // 섹터·테마 화면 맨 아래: 테마 순위 종합 (오늘·1주·1개월 순위를 한 표로)
  let rankLimit = 30;
  function themeRankAll() {
    if (!GROUPS) return "";
    const gs = allGroups().filter((g) => g.kind === "theme" && g.total >= 5);
    const rk = (k) => { const o = gs.filter((g) => isNum(g[k])).slice().sort((a, b) => b[k] - a[k]); const m = new Map(o.map((g, i) => [g, i + 1])); return (g) => m.get(g); };
    const rc = rk("chg"), rw = rk("r1w"), rm = rk("r1m");
    const N = gs.length, top = (r) => r && r <= N * 0.2, bot = (r) => r && r > N * 0.6;
    const rows = gs.slice().sort((a, b) => b.score - a.score);
    const mine = new Set((MYCACHE?.themes || []).map((t) => `${t.kind}${t.no}`));
    const steady = rows.filter((g) => top(rc(g)) && top(rw(g)) && top(rm(g))).slice(0, 6);
    const rebound = rows.filter((g) => top(rc(g)) && bot(rm(g))).slice(0, 6);
    const fading = gs.filter((g) => bot(rc(g)) && bot(rw(g)) && top(rm(g))).slice(0, 6);
    const chipL = (l) => l.length ? l.map((g) => `<a class="chip" href="#/sectors/theme/${g.no}">${esc(g.name)} <b class="${cls(g.chg)}">${pct(g.chg, 1)}</b></a>`).join("") : `<span class="muted" style="font-size:12.5px">오늘은 없어요</span>`;
    const rankCell = (r, v, d = 1) => `<td class="r num"><span class="${cls(v)}">${pct(v, d)}</span><div class="muted" style="font-size:11px">${r ? r + "위" : "–"}</div></td>`;
    return `<div class="card section" id="rank-all"><div class="card-head"><div><h2>테마 순위 종합</h2><div class="muted" style="font-size:12.5px">네이버 테마 ${N}개(5종목 이상) · 오늘·1주·1개월 순위를 한 번에 · ${esc(GROUPS.as_of || "")} 기준</div></div><a class="more" href="#/sectors">섹터 검색기 →</a></div>
      <div class="rank-sum">
        <div><div class="mini-title">🔥 꾸준히 강한 테마 <span class="muted">오늘·1주·1개월 모두 상위 20%</span></div><div class="chips" style="margin:6px 0 0">${chipL(steady)}</div></div>
        <div><div class="mini-title">🌱 반등 시작 <span class="muted">1개월은 약했는데 오늘 상위 20%</span></div><div class="chips" style="margin:6px 0 0">${chipL(rebound)}</div></div>
        <div><div class="mini-title">🍂 힘 빠지는 테마 <span class="muted">1개월은 강했는데 오늘·1주 약세</span></div><div class="chips" style="margin:6px 0 0">${chipL(fading)}</div></div>
      </div>
      <div class="table-wrap" style="margin-top:14px"><table><thead><tr><th>종합</th><th>테마</th><th class="r">강도</th><th class="r">오늘</th><th class="r">1주</th><th class="r">1개월</th><th>상승 비율</th><th>최근 뉴스</th></tr></thead><tbody>
        ${rows.slice(0, rankLimit).map((g, i) => { const br = g.rise + g.fall ? g.rise / (g.rise + g.fall) : 0;
          return `<tr class="link" data-go="#/sectors/theme/${g.no}"><td class="num"><b>${i + 1}</b></td>
          <td><span class="stock-name">${mine.has(`theme${g.no}`) ? "★ " : ""}${esc(g.name)}</span><div class="muted" style="font-size:11.5px">${g.total}종목 · ${groupLeaders(g, 1).map((l) => `${esc(l.name)} <span class="${cls(l.chg)}">${pct(l.chg, 1)}</span>`).join("")}</div></td>
          <td class="r num"><b>${g.score}</b></td>${rankCell(rc(g), g.chg, 2)}${rankCell(rw(g), g.r1w)}${rankCell(rm(g), g.r1m)}
          <td><span class="gbreadth" style="display:block;width:64px"><i style="width:${br * 100}%"></i></span></td>
          <td>${sentBar(gnewsOf("theme", g.no))}</td></tr>`; }).join("")}
      </tbody></table></div>
      ${rows.length > rankLimit ? `<div style="text-align:center;margin-top:14px"><button class="btn" id="rank-more">30개 더 보기 (${rankLimit}/${rows.length})</button></div>` : ""}
      <p class="muted" style="font-size:12px;margin-top:10px">강도 = 오늘 40% + 1주 30% + 1개월 30%를 순위(0~100)로 환산. ★는 내 관심 테마.</p></div>`;
  }

  // 내 관심 테마(config) 블록용 뉴스 분위기 — theme_news.json 자동 수집분
  function themeSent(name) {
    const l = NEWS?.auto?.[name] || [];
    return l.length ? { p: l.filter((n) => n.impact === "긍정").length, m: l.filter((n) => n.impact === "중립").length, n: l.filter((n) => n.impact === "주의" || n.impact === "부정").length } : null;
  }

  // ------------------------------------------------------------ 수급·컨센서스·공시
  const shares = (v) => {
    if (!isNum(v)) return "–";
    const a = Math.abs(v), sgn = v > 0 ? "+" : v < 0 ? "−" : "";
    return a >= 1e4 ? `${sgn}${(a / 1e4).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}만주` : `${sgn}${Math.round(a).toLocaleString("ko-KR")}주`;
  };
  function flowCard(c) {
    const f = (c.flows || []).slice(-20);
    if (!f.length) return `<div class="card"><div class="card-head"><h2>외국인·기관 수급</h2></div><div class="empty">수급은 매일 자동 수집 종목(관심 테마·보유·관심 종목)에 표시돼요.</div></div>`;
    const sum = (k, n) => f.slice(-n).reduce((a, r) => a + (r[k] || 0), 0);
    const max = Math.max(1, ...f.flatMap((r) => [Math.abs(r[1] || 0), Math.abs(r[2] || 0)]));
    const bar = (v) => `<span class="fbar ${v >= 0 ? "buy" : "sell"}" style="width:${Math.abs(v || 0) / max * 50}%;${v >= 0 ? "left:50%" : `right:50%`}"></span>`;
    const hold = f[f.length - 1][5];
    const streak = (k) => { let n = 0; const s = Math.sign(f[f.length - 1][k] || 0); for (let i = f.length - 1; i >= 0 && Math.sign(f[i][k] || 0) === s && s; i--) n++; return s ? `${n}일 연속 ${s > 0 ? "순매수" : "순매도"}` : ""; };
    return `<div class="card"><div class="card-head"><h2>외국인·기관 수급</h2><span class="muted" style="font-size:12.5px">${isNum(hold) ? `외국인 보유 ${pct(hold, 2, false)}` : ""}</span></div>
      <div class="grid g2" style="gap:10px;margin-bottom:12px">
        <div class="flow-sum"><span class="sub">외국인</span><b class="num ${cls(sum(1, 5))}">5일 ${shares(sum(1, 5))}</b><span class="num ${cls(sum(1, 20))}">20일 ${shares(sum(1, 20))}</span><span class="muted">${streak(1)}</span></div>
        <div class="flow-sum"><span class="sub">기관</span><b class="num ${cls(sum(2, 5))}">5일 ${shares(sum(2, 5))}</b><span class="num ${cls(sum(2, 20))}">20일 ${shares(sum(2, 20))}</span><span class="muted">${streak(2)}</span></div>
      </div>
      <div class="flow-table"><div class="fh"><span>날짜</span><span>외국인</span><span>기관</span></div>
        ${f.slice(-10).reverse().map((r) => `<div class="fr"><span class="num muted">${r[0].slice(5)}</span>
          <span class="fcell" title="${shares(r[1])}">${bar(r[1])}<em class="num ${cls(r[1])}">${shares(r[1])}</em></span>
          <span class="fcell" title="${shares(r[2])}">${bar(r[2])}<em class="num ${cls(r[2])}">${shares(r[2])}</em></span></div>`).join("")}
      </div></div>`;
  }
  function consensusLine(f, price) {
    const parts = [];
    if (isNum(f.target) && f.target > 0) {
      const up = isNum(price.close) ? f.target / price.close - 1 : null;
      parts.push(`목표주가 <b class="num">${won(f.target)}원</b>${up !== null ? ` <span class="${cls(up)}">(현재가 대비 ${pct(up)})</span>` : ""}`);
    }
    if (isNum(f.recomm)) parts.push(`투자의견 <b>${f.recomm >= 4.5 ? "강력매수" : f.recomm >= 3.5 ? "매수" : f.recomm >= 2.5 ? "중립" : "매도"}</b> <span class="muted num">(${f.recomm.toFixed(2)}/5)</span>`);
    if (isNum(f.cns_per)) parts.push(`추정 PER <b class="num">${times(f.cns_per)}</b>`);
    return parts.length ? `<div class="consensus">${parts.join('<span class="sep">·</span>')}<span class="muted" style="font-size:12px"> 증권사 컨센서스</span></div>` : "";
  }
  function disclosureCard(c) {
    const d = c.disclosures || [];
    if (!d.length) return "";
    return `<div class="card"><div class="card-head"><h2>최근 공시</h2><a class="more" href="https://dart.fss.or.kr/dsab007/main.do?textCrpNm=${encodeURIComponent(c.name || "")}" target="_blank" rel="noopener">DART ↗</a></div>
      <div class="news-list">${d.map((x) => `<div class="news-item"><div class="t" style="font-weight:600">${esc(x.title)}</div><div class="meta num">${esc(x.date)}</div></div>`).join("")}</div></div>`;
  }

  // ------------------------------------------------------------ 하단 탭바 (모바일) · 앱 설치
  function renderTabbar() {
    if (document.getElementById("tabbar")) return;
    const t = document.createElement("nav");
    t.id = "tabbar";
    t.className = "tabbar";
    const ic = {
      home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
      market: '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>',
      themes: '<circle cx="7" cy="7" r="3"/><circle cx="17" cy="7" r="3"/><circle cx="7" cy="17" r="3"/><circle cx="17" cy="17" r="3"/>',
      company: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
      my: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
      news: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h10M7 17h6"/>',
    };
    t.innerHTML = [["home", "#/", "홈"], ["market", "#/market", "시장"], ["themes", "#/themes", "테마"], ["news", "#/news", "뉴스"], ["company", "#/company", "종목"], ["my", "#/my", "내 투자"]]
      .map(([k, h, l]) => `<a href="${h}" data-page="${k}"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ic[k]}</svg><span>${l}</span></a>`).join("");
    document.body.appendChild(t);
  }
  let deferredInstall = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredInstall = e; });
  function installCard() {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    if (standalone) return "";
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    return `<div class="card section install"><div><b>📱 앱처럼 쓰기</b><div class="sub" style="font-size:13px;margin-top:2px">${ios ? "사파리 아래쪽 <b>공유 버튼 → 홈 화면에 추가</b>를 누르면 앱 아이콘으로 열려요." : "홈 화면에 설치하면 앱처럼 바로 열려요."}</div></div>${ios ? "" : `<button class="btn primary sm" id="install">설치</button>`}</div>`;
  }
  function wireInstall() {
    document.getElementById("install")?.addEventListener("click", async () => {
      if (deferredInstall) { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; }
      else alertBox("브라우저 메뉴(⋮)에서 '앱 설치' 또는 '홈 화면에 추가'를 눌러주세요.");
    });
  }
  function alertBox(msg) {
    const d = document.createElement("div"); d.className = "toast"; d.textContent = msg; document.body.appendChild(d);
    setTimeout(() => d.remove(), 3500);
  }

  // ------------------------------------------------------------ 시장 전체
  const mkState = { mkt: "전체", sort: "amount", dir: -1, limit: 100, group: null };
  const SORTS = { amount: "거래대금", chg: "등락률", r1w: "1주", r1m: "1개월", r3m: "3개월", marcap: "시가총액", pos52: "52주 위치" };
  function marketRows() {
    let rows = LIST.map((r) => ({ code: r[1], name: r[0], market: r[2], sector: r[3] || "", ...(ALL[r[1]] || {}) }));
    if (mkState.group) { const set = new Set(mkState.group.codes || []); rows = rows.filter((r) => set.has(r.code)); }
    if (mkState.mkt === "KOSPI") rows = rows.filter((r) => r.market === "KOSPI");
    else if (mkState.mkt === "KOSDAQ") rows = rows.filter((r) => (r.market || "").startsWith("KOSDAQ"));
    else if (mkState.mkt === "신고가") rows = rows.filter((r) => (r.pos52 ?? 0) >= 0.98);
    else if (mkState.mkt === "신저가") rows = rows.filter((r) => r.pos52 !== undefined && r.pos52 !== null && r.pos52 <= 0.02);
    else if (mkState.mkt === "추천 테마") { const t = new Set(trackedCodes()); rows = rows.filter((r) => t.has(r.code)); }
    const k = mkState.sort;
    rows.sort((a, b) => ((isNum(b[k]) ? b[k] : -Infinity) - (isNum(a[k]) ? a[k] : -Infinity)) * (mkState.dir === -1 ? 1 : -1));
    return rows;
  }
  function pageMarket(parts = []) {
    if (parts[1] === "groups") {
      const kind = parts[2] === "industry" ? "industry" : "theme";
      return `<div class="page-head"><div><h1>${kind === "theme" ? "테마" : "업종"} 순위</h1><p class="lede">오늘 평균 등락률 순 · 막대는 상승 종목 비율 · ${esc(GROUPS?.as_of || "")} 기준</p></div></div>
        <div class="chips"><a class="chip ${kind === "theme" ? "on" : ""}" href="#/market/groups/theme">테마</a><a class="chip ${kind === "industry" ? "on" : ""}" href="#/market/groups/industry">업종</a></div>
        <div class="card">${groupList(kind, 400)}</div>`;
    }
    mkState.group = parts[1] === "g" ? findGroup(parts[2], parts[3]) || null : null;
    const rows = marketRows();
    const b = MK.breadth;
    const th = (k, label, r = true) => `<th class="${r ? "r" : ""} sortable" data-sort="${k}">${label}${mkState.sort === k ? (mkState.dir === -1 ? " ▼" : " ▲") : ""}</th>`;
    const G = mkState.group;
    return `<div class="page-head"><div><h1>${G ? esc(G.name) : "시장 전체"}</h1><p class="lede">${G ? `${parts[2] === "industry" ? "업종" : "테마"} · ${G.total}종목 · 평균 <span class="${cls(G.chg)}">${pct(G.chg, 2)}</span> · 상승 ${G.rise} / 하락 ${G.fall} · <a href="#/sectors/${parts[2] === "industry" ? "industry" : "theme"}/${G.no}" style="color:var(--accent)">섹터 뉴스·분위기</a> · <a href="#/market" style="color:var(--accent)">전체 시장 보기</a>` : `국내 상장 ${LIST.length.toLocaleString()}개 종목 · ${esc(ALLMETA.as_of || "자동 갱신 후 표시")} 기준`}</p></div></div>
      ${searchBox("q")}
      ${b && !G ? `<div class="grid g4 section">
        <div class="card stat"><div class="label">상승 / 하락</div><div class="value sm num"><span class="up">${b.up.toLocaleString()}</span> <span class="muted">/</span> <span class="down">${b.down.toLocaleString()}</span></div><div class="foot">전체 ${b.total.toLocaleString()}종목</div></div>
        <div class="card stat"><div class="label">52주 신고가</div><div class="value num up">${b.high52}</div><div class="foot">종가 기준 1년 최고</div></div>
        <div class="card stat"><div class="label">52주 신저가</div><div class="value num down">${b.low52}</div><div class="foot">종가 기준 1년 최저</div></div>
        <div class="card stat"><div class="label">코스피</div><div class="value sm num">${won(MK.kospi?.close)}</div><div class="foot"><span class="${cls(MK.kospi?.chg)}">${pct(MK.kospi?.chg, 2)}</span> · 1개월 <span class="${cls(MK.kospi?.r1m)}">${pct(MK.kospi?.r1m)}</span></div></div>
      </div>` : ""}
      ${!G && GROUPS ? leadersCard() : ""}
      <div class="card section">
        <div class="card-head" style="flex-wrap:wrap">
          <div class="chips" style="margin:0">${(G ? ["전체", "KOSPI", "KOSDAQ"] : ["전체", "KOSPI", "KOSDAQ", "신고가", "신저가", "추천 테마"]).map((m) => `<button class="chip ${m === mkState.mkt ? "on" : ""}" data-mkt="${m}">${m}</button>`).join("")}</div>
          <span class="muted" style="font-size:13px">${rows.length.toLocaleString()}종목 · 제목을 눌러 정렬</span>
        </div>
        ${Object.keys(ALL).length ? `<div class="table-wrap"><table class="mk-table">
          <thead><tr><th>#</th><th>종목</th>${th("close", "현재가")}${th("chg", "등락")}${th("r1w", "1주")}${th("r1m", "1개월")}${th("r3m", "3개월")}<th class="sortable" data-sort="pos52">52주 위치${mkState.sort === "pos52" ? (mkState.dir === -1 ? " ▼" : " ▲") : ""}</th>${th("amount", "거래대금")}${th("marcap", "시총")}</tr></thead>
          <tbody>${rows.slice(0, mkState.limit).map((r, i) => `<tr class="link" data-go="#/company/${r.code}">
            <td class="muted num">${i + 1}</td>
            <td><span class="stock-name">${esc(r.name)}</span><span class="code">${r.code}</span>${r.sector ? `<div class="muted" style="font-size:11.5px">${esc(r.sector)}</div>` : ""}</td>
            <td class="r num">${won(r.close)}</td>
            <td class="r num ${cls(r.chg)}">${pct(r.chg, 2)}</td>
            <td class="r num ${cls(r.r1w)}">${pct(r.r1w)}</td>
            <td class="r num ${cls(r.r1m)}">${pct(r.r1m)}</td>
            <td class="r num ${cls(r.r3m)}">${pct(r.r3m)}</td>
            <td>${pos52(r.pos52)}</td>
            <td class="r num">${bigWon(r.amount)}</td>
            <td class="r num">${cap(r.marcap)}</td></tr>`).join("")}</tbody></table></div>
          ${rows.length > mkState.limit ? `<div style="text-align:center;margin-top:14px"><button class="btn" id="more">100개 더 보기</button></div>` : ""}`
        : `<div class="empty">전 종목 시세는 다음 자동 갱신(평일 16:20) 후 표시됩니다.</div>`}
      </div>`;
  }
  function wireMarket() {
    document.querySelectorAll("[data-mkt]").forEach((b) => b.addEventListener("click", () => { mkState.mkt = b.dataset.mkt; mkState.limit = 100; rerender(); }));
    document.querySelectorAll("[data-sort]").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.sort;
      if (mkState.sort === k) mkState.dir *= -1; else { mkState.sort = k; mkState.dir = -1; }
      rerender();
    }));
    document.getElementById("more")?.addEventListener("click", () => { mkState.limit += 100; rerender(); });
  }
  function homeMarketCard() {
    if (!Object.keys(ALL).length) return "";
    const rows = LIST.map((r) => ({ code: r[1], name: r[0], ...(ALL[r[1]] || {}) })).filter((r) => isNum(r.chg));
    const topAmt = [...rows].sort((a, b) => (b.amount || 0) - (a.amount || 0)).slice(0, 5);
    const topUp = [...rows].filter((r) => (r.amount || 0) > 5e8).sort((a, b) => b.chg - a.chg).slice(0, 5);
    const li = (r, v) => `<div class="mini-row" data-go="#/company/${r.code}"><span>${esc(r.name)}</span><span class="num ${v === "amt" ? "" : cls(r.chg)}">${v === "amt" ? bigWon(r.amount) : pct(r.chg, 1)}</span></div>`;
    return `<div class="card"><div class="card-head"><h2>오늘의 시장</h2><a class="more" href="#/market">시장 전체 →</a></div>
      <div class="grid g2" style="gap:20px">
        <div><div class="mini-title">거래대금 상위</div>${topAmt.map((r) => li(r, "amt")).join("")}</div>
        <div><div class="mini-title">상승률 상위 <span class="muted">(거래대금 5억↑)</span></div>${topUp.map((r) => li(r, "chg")).join("")}</div>
      </div></div>`;
  }

  // ------------------------------------------------------------ 로그인
  function sbReady() {
    const c = window.KM_CONFIG?.supabase;
    return c && c.url && !c.url.startsWith("YOUR") && window.supabase?.createClient;
  }
  // ---------------------------------------------------------- 회원 승인제
  let PROFILE = null, PROFILE_OK = false, PENDING_N = 0;
  const APPROVAL = () => !!(window.KM_CONFIG?.approval && SB);
  const IS_ADMIN = () => !!PROFILE?.is_admin;
  // 승인된 회원인가? (승인제를 끄거나, 회원 정보 표가 아직 없으면 로그인만으로 통과)
  const CAN_SEE = () => !APPROVAL() || (USER && (!PROFILE_OK || PROFILE?.status === "approved"));
  const LOCKED_PAGES = new Set(["themes", "sectors", "news", "my", "admin"]);
  // 긍정 뉴스는 관리자가 열어준 회원만 (회원별 권한)
  // 관리자 '회원 화면 미리보기': 켜면 관리자도 일반 회원(긍정 뉴스 권한 없음)처럼 보여요
  const PREVIEW = () => { try { return IS_ADMIN() && localStorage.getItem("km_preview") === "1"; } catch { return false; } };
  const CAN_POS = () => PREVIEW() ? false : !APPROVAL() || IS_ADMIN() || (CAN_SEE() && (!PROFILE_OK || PROFILE?.can_positive === true || PROFILE?.can_positive === undefined));
  // 긍정·악재 뉴스는 관리자가 열어준 회원만 (보통 뉴스는 누구나)
  const posLocked = (imp) => (imp === "긍정" || imp === "주의" || imp === "부정") && !CAN_POS();
  const posLockHTML = (imp) => `<span class="pos-lock">🔒 ${imp === "긍정" ? "긍정" : "악재"} 뉴스 가림 · 관리자에게 문의하세요</span>`;
  // 카카오 가입 후 추가 정보가 비었는지
  const NEEDS_INFO = () => APPROVAL() && USER && PROFILE_OK && PROFILE && !PROFILE.is_admin && (!PROFILE.phone || !PROFILE.agreed_at);
  let NOTIF = [];
  const seenAt = () => { try { return localStorage.getItem("km_seen_" + USER?.id) || ""; } catch { return ""; } };
  const UNREAD = () => NOTIF.filter((n) => n.created_at > seenAt()).length;
  async function loadNotif() {
    NOTIF = [];
    if (!SB || !USER || !PROFILE_OK) return;
    const r = await SB.from("notifications").select("*").eq("user_id", USER.id).order("created_at", { ascending: false }).limit(100);
    if (!r.error) NOTIF = r.data;
  }
  async function loadProfile() {
    PROFILE = null; PROFILE_OK = false; PENDING_N = 0; NOTIF = [];
    if (!SB || !USER) return;
    const r = await SB.from("profiles").select("*").eq("id", USER.id).maybeSingle();
    if (r.error) return; // 표가 아직 없음 → 기존 방식(로그인만)
    PROFILE_OK = true; PROFILE = r.data;
    if (PROFILE?.is_admin) {
      const c = await SB.from("profiles").select("id", { count: "exact", head: true }).eq("status", "pending");
      PENDING_N = c.count || 0;
    }
    await loadNotif();
  }
  // ---------- 기기 제한: 휴대폰 1대 + PC 1대 (새로 로그인한 기기가 이김)
  const DEVICE_KIND = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? "mobile" : "pc";
  const DEVICE_ID = (() => { try { let d = localStorage.getItem("km_dev"); if (!d) { d = (crypto.randomUUID?.() || String(Math.random()).slice(2) + Date.now()); localStorage.setItem("km_dev", d); } return d; } catch { return "nostore"; } })();
  const markLogin = () => { try { sessionStorage.setItem("km_claim", "1"); } catch {} };
  async function claimDevice() {
    if (!SB || !USER) return;
    await SB.from("user_devices").upsert({ user_id: USER.id, kind: DEVICE_KIND, device_id: DEVICE_ID, label: navigator.userAgent.slice(0, 140), updated_at: new Date().toISOString() });
  }
  async function checkDevice() {
    if (!SB || !USER || !APPROVAL()) return true;
    let claim = false; try { claim = sessionStorage.getItem("km_claim") === "1"; sessionStorage.removeItem("km_claim"); } catch {}
    if (claim) { await claimDevice(); return true; }
    if (IS_ADMIN()) return true;
    const r = await SB.from("user_devices").select("device_id").eq("user_id", USER.id).eq("kind", DEVICE_KIND).maybeSingle();
    if (r.error) return true; // 표가 아직 없음
    if (!r.data) { await claimDevice(); return true; }
    if (r.data.device_id !== DEVICE_ID) {
      await SB.auth.signOut();
      alertBox(`다른 ${DEVICE_KIND === "mobile" ? "휴대폰" : "PC"}에서 로그인해서 이 기기는 로그아웃됐어요. (휴대폰 1대 + PC 1대까지)`);
      return false;
    }
    return true;
  }
  function gateCard(what) {
    if (!USER) return `<div class="lock"><div class="lock-card"><div class="lock-ic">🔒</div><h1>회원 전용${what ? ` · ${esc(what)}` : ""}</h1>
      <p>테마·섹터·뉴스와 종목 점수·재무 지표는<br>승인된 회원만 볼 수 있어요.</p>
      <button class="btn primary" data-auth="signup" style="width:100%;justify-content:center">회원가입</button>
      <button class="btn" data-auth="login" style="width:100%;justify-content:center">이미 회원이에요 · 로그인</button></div></div>`;
    const st = PROFILE?.status;
    return `<div class="lock"><div class="lock-card"><div class="lock-ic">${st === "rejected" ? "🚫" : "⏳"}</div>
      <h1>${st === "rejected" ? "승인되지 않았어요" : "승인 대기 중이에요"}</h1>
      <p>${st === "rejected" ? "관리자에게 문의해 주세요." : `관리자가 가입 정보를 확인한 뒤 승인하면<br>모든 화면이 열려요.`}</p>
      ${PROFILE ? `<div class="muted" style="font-size:13px">${esc(PROFILE.name || "")} · ${esc(PROFILE.email || USER.email)}</div>` : ""}
      ${NEEDS_INFO() ? `<button class="btn primary" id="gate-info" style="width:100%;justify-content:center">가입 정보 입력하기</button>` : ""}
      <button class="btn" id="gate-refresh" style="width:100%;justify-content:center">승인 확인하기</button></div></div>`;
  }
  // 종목 화면의 점수·재무 지표 가림막 (실제 숫자는 화면에 넣지 않음)
  function secretBox(title, h = 220) {
    return `<div class="card secret-card"><div class="card-head"><h2>${esc(title)}</h2><span class="badge">🔒 회원 전용</span></div>
      <div class="secret" style="height:${h}px"><div class="secret-fake">${Array.from({ length: 6 }, (_, i) => `<i style="width:${90 - i * 9}%"></i>`).join("")}</div>
      <div class="secret-msg"><b>${USER ? (PROFILE?.status === "rejected" ? "승인되지 않은 계정이에요" : "관리자 승인 후 보여요") : "회원만 볼 수 있어요"}</b>
      ${USER ? "" : `<button class="btn primary sm" data-auth="signup">회원가입</button><button class="btn sm" data-auth="login">로그인</button>`}</div></div></div>`;
  }
  function renderAuthButton() {
    const el = document.getElementById("auth");
    if (!el) return;
    if (!SB) { el.innerHTML = ""; return; }
    el.innerHTML = USER
      ? `<a class="btn sm admin-btn bell" href="#/alerts" title="알람">🔔${UNREAD() ? `<b class="dot num">${UNREAD()}</b>` : ""}</a>${IS_ADMIN() ? `<button class="btn sm admin-btn ${PREVIEW() ? "primary" : ""}" id="preview" title="회원 화면 미리보기">👁<span class="lbl"> ${PREVIEW() ? "회원 화면 보는 중" : "회원 화면"}</span></button>` : ""}${IS_ADMIN() ? `<a class="btn sm admin-btn ${PENDING_N ? "primary" : ""}" href="#/admin" title="회원 관리">👥<span class="lbl"> 회원 관리</span>${PENDING_N ? ` <b class="num">${PENDING_N}</b>` : ""}</a>` : ""}<a class="btn sm" href="#/my">내 투자</a><button class="btn sm ghost" id="logout" title="${esc(USER.email)}">로그아웃</button>`
      : `${APPROVAL() ? `<button class="btn sm" id="signup">회원가입</button>` : ""}<button class="btn sm primary" id="login">로그인</button>`;
    document.getElementById("signup")?.addEventListener("click", () => openAuth("signup"));
    document.getElementById("login")?.addEventListener("click", () => openAuth("login"));
    document.getElementById("logout")?.addEventListener("click", async () => { await SB.auth.signOut(); });
    document.getElementById("preview")?.addEventListener("click", () => {
      try { localStorage.setItem("km_preview", PREVIEW() ? "0" : "1"); } catch {}
      alertBox(PREVIEW() ? "회원 화면으로 보는 중이에요 (긍정·악재 뉴스 가림). 👁를 다시 누르면 관리자 화면으로 돌아와요." : "관리자 화면으로 돌아왔어요");
      renderAuthButton(); rerender();
    });
  }
  const KAKAO = () => !!window.KM_CONFIG?.kakao;
  async function kakaoLogin() {
    markLogin();
    const r = await SB.auth.signInWithOAuth({ provider: "kakao", options: { redirectTo: location.origin + location.pathname } });
    if (r.error) alertBox("카카오 로그인을 시작하지 못했어요: " + r.error.message);
  }
  // 카카오로 가입한 뒤 이름·생년월일·성별·전화번호·동의 받기
  function openProfileInfo() {
    closeModal();
    const p = PROFILE || {};
    const m = document.createElement("div");
    m.className = "modal-bg";
    m.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
      <h2>가입 정보 입력</h2><p class="sub" style="font-size:13.5px;margin:6px 0 14px">카카오 인증이 끝났어요. 관리자 승인을 위해 아래 정보를 적어 주세요.</p>
      <form id="pinfo" class="form">
        <label>이름<input name="name" required maxlength="30" value="${esc(p.name || "")}"></label>
        <label>생년월일<input name="birth" type="date" required min="1920-01-01" max="${new Date().toISOString().slice(0, 10)}" value="${esc(p.birth || "")}"></label>
        <div class="radio-row"><span>성별</span>${["남", "여"].map((g) => `<label class="radio"><input type="radio" name="gender" value="${g}" required ${p.gender === g ? "checked" : ""}> ${g}</label>`).join("")}</div>
        <label>전화번호<input name="phone" type="tel" required inputmode="numeric" placeholder="010-1234-5678" pattern="01[016789]-?\\d{3,4}-?\\d{4}" value="${esc(p.phone || "")}"></label>
        <label class="check"><input type="checkbox" name="agree" required> <span><b>[필수] 개인정보 수집·이용 동의</b><br><span class="hint">수집 항목: 이름, 생년월일, 성별, 전화번호, 카카오 계정 정보 · 목적: 회원 확인과 승인 · 보관: 탈퇴 시까지</span></span></label>
        <div class="form-msg"></div>
        <button class="btn primary" type="submit" style="width:100%;justify-content:center">가입 신청</button>
      </form>
      <div class="modal-foot"><a href="#" id="pinfo-out">나중에 할게요 (로그아웃)</a></div></div>`;
    document.body.appendChild(m);
    m.querySelector("#pinfo-out").addEventListener("click", async (e) => { e.preventDefault(); closeModal(); await SB.auth.signOut(); });
    m.querySelector("#pinfo").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target), out = m.querySelector(".form-msg");
      const phone = String(fd.get("phone")).replace(/\D/g, "").replace(/^(\d{3})(\d{3,4})(\d{4})$/, "$1-$2-$3");
      out.textContent = "저장 중…";
      const r = await SB.from("profiles").update({ name: fd.get("name").trim(), birth: fd.get("birth"), gender: fd.get("gender"), phone, agreed_at: new Date().toISOString() }).eq("id", USER.id);
      if (r.error) { out.textContent = /duplicate|unique/i.test(r.error.message) ? "이미 가입된 전화번호예요. 한 번호로 한 계정만 만들 수 있어요." : "저장하지 못했어요: " + r.error.message; return; }
      await loadProfile(); renderAuthButton();
      m.querySelector(".modal").innerHTML = `<h2>가입 신청 완료 🎉</h2><p style="font-size:14px;line-height:1.7">관리자가 확인하고 승인하면 테마·뉴스·종목 점수가 열려요.<br>승인되면 🔔 알람으로 알려드려요.</p>
        <button class="btn primary" style="width:100%;justify-content:center" onclick="this.closest('.modal-bg').remove()">확인</button>`;
      rerender();
    });
  }
  function openAuth(mode = "login", msg = "") {
    if (mode === "signup" && APPROVAL()) return openSignup();
    closeModal();
    const m = document.createElement("div");
    m.className = "modal-bg";
    m.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
      <button class="modal-x" aria-label="닫기">×</button>
      <h2>${mode === "login" ? "로그인" : mode === "signup" ? "회원가입" : "비밀번호 재설정"}</h2>
      <p class="sub" style="font-size:13.5px;margin:6px 0 16px">${mode === "reset" ? "가입한 이메일로 재설정 링크를 보내드려요." : "내 포트폴리오·매매 일지·자동 일지는 본인만 볼 수 있어요."}</p>
      ${mode === "login" && KAKAO() ? `<button class="btn kakao" id="kakao-btn" type="button">카카오로 로그인</button><div class="or"><span>또는 이메일</span></div>` : ""}
      <form id="authform" class="form">
        <label>이메일<input name="email" type="email" required autocomplete="email"></label>
        ${mode !== "reset" ? `<label>비밀번호<input name="pw" type="password" required minlength="6" autocomplete="${mode === "signup" ? "new-password" : "current-password"}"></label>` : ""}
        <div class="form-msg">${esc(msg)}</div>
        <button class="btn primary" style="width:100%;justify-content:center" type="submit">${mode === "login" ? "로그인" : mode === "signup" ? "가입하기" : "링크 보내기"}</button>
      </form>
      <div class="modal-foot">${mode === "login"
        ? `<a href="#" data-mode="signup">처음이신가요? 회원가입</a><a href="#" data-mode="reset">비밀번호를 잊었어요</a>`
        : `<a href="#" data-mode="login">이미 계정이 있어요. 로그인</a>`}</div></div>`;
    document.body.appendChild(m);
    m.addEventListener("click", (e) => { if (e.target === m || e.target.closest(".modal-x")) closeModal(); });
    m.querySelectorAll("[data-mode]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); openAuth(a.dataset.mode); }));
    m.querySelector("#kakao-btn")?.addEventListener("click", kakaoLogin);
    m.querySelector("input")?.focus();
    m.querySelector("#authform").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target), email = fd.get("email"), pw = fd.get("pw");
      const out = m.querySelector(".form-msg");
      out.textContent = "처리 중…";
      const redirect = location.origin + location.pathname;
      let r;
      if (mode === "login") { markLogin(); r = await SB.auth.signInWithPassword({ email, password: pw }); }
      else if (mode === "signup") r = await SB.auth.signUp({ email, password: pw, options: { emailRedirectTo: redirect } });
      else r = await SB.auth.resetPasswordForEmail(email, { redirectTo: redirect });
      if (r.error) { out.textContent = authError(r.error.message); return; }
      if (mode === "signup" && !r.data.session) { out.innerHTML = "<b>메일함을 확인해 주세요.</b> 인증 링크를 누르면 가입이 완료돼요."; return; }
      if (mode === "reset") { out.innerHTML = "<b>메일을 보냈어요.</b> 링크를 눌러 새 비밀번호를 정하세요."; return; }
      closeModal();
    });
  }
  // 회원가입: ① 이름·생년월일·성별·전화번호 + 동의 → ② 이메일·비밀번호 → 가입 완료(승인 대기)
  function openSignup() {
    closeModal();
    if (KAKAO()) {
      const k = document.createElement("div");
      k.className = "modal-bg";
      k.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><button class="modal-x" aria-label="닫기">×</button>
        <h2>회원가입</h2><p class="sub" style="font-size:13.5px;margin:6px 0 16px">휴대폰 인증이 된 <b>카카오 계정</b>으로만 가입할 수 있어요.<br>카카오 인증 → 가입 정보 입력 → 관리자 승인 순서예요.</p>
        <button class="btn kakao" id="kakao-signup" type="button">카카오로 가입하기</button>
        <div class="modal-foot"><a href="#" data-mode="login">이미 회원이에요. 로그인</a></div></div>`;
      document.body.appendChild(k);
      k.addEventListener("click", (e) => { if (e.target === k || e.target.closest(".modal-x")) closeModal(); });
      k.querySelector("#kakao-signup").addEventListener("click", kakaoLogin);
      k.querySelector("[data-mode]").addEventListener("click", (e) => { e.preventDefault(); openAuth("login"); });
      return;
    }
    const info = {}, opened = Date.now();
    const m = document.createElement("div");
    m.className = "modal-bg";
    document.body.appendChild(m);
    m.addEventListener("click", (e) => { if (e.target === m || e.target.closest(".modal-x")) closeModal(); });
    const steps = (n) => `<div class="steps"><span class="${n >= 1 ? "on" : ""}">1 회원 정보</span><span class="${n >= 2 ? "on" : ""}">2 계정 만들기</span><span class="${n >= 3 ? "on" : ""}">3 완료</span></div>`;
    const step1 = () => {
      m.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><button class="modal-x" aria-label="닫기">×</button>
        <h2>회원가입</h2>${steps(1)}
        <form id="s1" class="form">
          <label class="hp" aria-hidden="true">웹사이트<input name="website" tabindex="-1" autocomplete="off"></label>
          <label>이름<input name="name" required maxlength="30" autocomplete="name" value="${esc(info.name || "")}"></label>
          <label>생년월일<input name="birth" type="date" required min="1920-01-01" max="${new Date().toISOString().slice(0, 10)}" value="${esc(info.birth || "")}"></label>
          <div class="radio-row"><span>성별</span>${["남", "여"].map((g) => `<label class="radio"><input type="radio" name="gender" value="${g}" required ${info.gender === g ? "checked" : ""}> ${g}</label>`).join("")}</div>
          <label>전화번호<input name="phone" type="tel" required inputmode="numeric" placeholder="010-1234-5678" pattern="01[016789]-?\\d{3,4}-?\\d{4}" value="${esc(info.phone || "")}">
            <span class="hint">승인할 때 관리자가 이 번호로 본인 확인을 할 수 있어요.</span></label>
          <label class="check"><input type="checkbox" name="agree" required ${info.agreed ? "checked" : ""}> <span><b>[필수] 개인정보 수집·이용 동의</b><br><span class="hint">수집 항목: 이름, 생년월일, 성별, 전화번호, 이메일 · 목적: 회원 확인과 승인 · 보관: 탈퇴 시까지 (탈퇴하면 바로 삭제)</span></span></label>
          <div class="form-msg"></div>
          <button class="btn primary" type="submit" style="width:100%;justify-content:center">다음</button>
        </form>
        <div class="modal-foot"><a href="#" data-mode="login">이미 회원이에요. 로그인</a></div></div>`;
      m.querySelector("[data-mode]").addEventListener("click", (e) => { e.preventDefault(); openAuth("login"); });
      m.querySelector("#s1").addEventListener("submit", (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        if (fd.get("website")) { info.bot = true; } // 사람은 볼 수 없는 칸 — 채워져 있으면 로봇
        Object.assign(info, { name: fd.get("name").trim(), birth: fd.get("birth"), gender: fd.get("gender"), phone: String(fd.get("phone")).replace(/\D/g, "").replace(/^(\d{3})(\d{3,4})(\d{4})$/, "$1-$2-$3"), agreed: true });
        step2();
      });
    };
    const step2 = () => {
      m.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><button class="modal-x" aria-label="닫기">×</button>
        <h2>회원가입</h2>${steps(2)}
        <div class="muted" style="font-size:13px;margin-bottom:10px">${esc(info.name)} · ${esc(info.birth)} · ${esc(info.gender)} · ${esc(info.phone)} <a href="#" id="back" style="color:var(--accent)">수정</a></div>
        <form id="s2" class="form">
          <label>이메일<input name="email" type="email" required autocomplete="email"></label>
          <label>비밀번호<input name="pw" type="password" required minlength="8" autocomplete="new-password"><span class="hint">8자 이상</span></label>
          <label>비밀번호 확인<input name="pw2" type="password" required minlength="8" autocomplete="new-password"></label>
          <div class="form-msg"></div>
          <button class="btn primary" type="submit" style="width:100%;justify-content:center">가입하기</button>
        </form></div>`;
      m.querySelector("#back").addEventListener("click", (e) => { e.preventDefault(); step1(); });
      m.querySelector("#s2").addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target), out = m.querySelector(".form-msg");
        if (fd.get("pw") !== fd.get("pw2")) { out.textContent = "비밀번호가 서로 달라요."; return; }
        if (info.bot || Date.now() - opened < 6000) { out.textContent = "잠시 후 다시 시도해 주세요."; return; } // 로봇 자동가입 차단
        out.textContent = "처리 중…";
        const r = await SB.auth.signUp({ email: fd.get("email"), password: fd.get("pw"),
          options: { emailRedirectTo: location.origin + location.pathname, data: { name: info.name, birth: info.birth, gender: info.gender, phone: info.phone, agreed: true } } });
        if (r.error) { out.textContent = /Database error/i.test(r.error.message) ? "이미 가입된 전화번호예요. 한 번호로 한 계정만 만들 수 있어요." : authError(r.error.message); return; }
        m.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><button class="modal-x" aria-label="닫기">×</button>
          <h2>가입 신청 완료 🎉</h2>${steps(3)}
          <p style="font-size:14px;line-height:1.7">${r.data.session ? "" : `<b>① 메일함</b>에서 인증 링크를 눌러 주세요. (스팸함도 확인)<br>`}<b>${r.data.session ? "①" : "②"} 관리자 승인</b> 후 테마·뉴스·종목 점수가 열려요.<br>승인되면 같은 이메일·비밀번호로 로그인하면 돼요.</p>
          <button class="btn primary" style="width:100%;justify-content:center" onclick="this.closest('.modal-bg').remove()">확인</button></div>`;
      });
    };
    step1();
  }
  function openNewPassword(welcome) {
    closeModal();
    const m = document.createElement("div");
    m.className = "modal-bg";
    m.innerHTML = `<div class="modal"><h2>${welcome ? "환영해요! 비밀번호를 정해 주세요" : "새 비밀번호"}</h2>${welcome ? `<p class="sub" style="font-size:13.5px;margin-top:6px">다음부터 이 이메일과 비밀번호로 로그인해요.</p>` : ""}<form id="pwform" class="form" style="margin-top:14px">
      <label>새 비밀번호<input name="pw" type="password" minlength="6" required autocomplete="new-password"></label>
      <div class="form-msg"></div><button class="btn primary" type="submit">저장</button></form></div>`;
    document.body.appendChild(m);
    m.querySelector("#pwform").addEventListener("submit", async (e) => {
      e.preventDefault();
      const r = await SB.auth.updateUser({ password: new FormData(e.target).get("pw") });
      m.querySelector(".form-msg").textContent = r.error ? authError(r.error.message) : "저장했어요.";
      if (!r.error) setTimeout(closeModal, 800);
    });
  }
  const authError = (m) => /Invalid login/i.test(m) ? "이메일 또는 비밀번호가 맞지 않아요."
    : /not confirmed/i.test(m) ? "메일 인증이 아직 안 됐어요. 메일함의 링크를 눌러주세요."
    : /already registered/i.test(m) ? "이미 가입된 이메일이에요. 로그인해 주세요."
    : /Password should be/i.test(m) ? "비밀번호는 6자 이상이어야 해요."
    : /rate limit/i.test(m) ? "요청이 많아요. 잠시 뒤 다시 시도해 주세요." : m;
  function closeModal() { document.querySelectorAll(".modal-bg").forEach((x) => x.remove()); }

  // ------------------------------------------------------------ 내 투자 데이터
  async function loadMine(force) {
    if (!SB || !USER) return null;
    if (MYCACHE && !force) return MYCACHE;
    const [t, w, j] = await Promise.all([
      SB.from("trades").select("*").order("trade_date", { ascending: false }).order("created_at", { ascending: false }),
      SB.from("watchlist").select("*").order("created_at", { ascending: false }),
      SB.from("journal").select("*").order("date", { ascending: false }).limit(250),
    ]);
    const err = t.error || w.error || j.error;
    if (err) throw err;
    const th = await SB.from("my_themes").select("*").order("created_at", { ascending: false });
    MYCACHE = { trades: t.data, watch: w.data, journal: j.data, themes: th.error ? [] : th.data, themesReady: !th.error };
    backfillWatchPrice(MYCACHE.watch);
    return MYCACHE;
  }
  function portfolio(trades) {
    const pos = {};
    let realized = 0, bought = 0;
    [...trades].sort((a, b) => (a.trade_date + (a.created_at || "")).localeCompare(b.trade_date + (b.created_at || ""))).forEach((t) => {
      const p = (pos[t.code] ||= { code: t.code, name: t.name, qty: 0, avg: 0 });
      const q = +t.qty, price = +t.price, fee = +(t.fee || 0);
      if (t.side === "buy") { p.avg = (p.avg * p.qty + price * q + fee) / (p.qty + q); p.qty += q; bought += price * q + fee; }
      else { const qq = Math.min(q, p.qty); realized += (price - p.avg) * qq - fee; p.qty -= qq; }
    });
    const list = Object.values(pos).filter((p) => p.qty > 1e-9).map((p) => {
      const pr = priceOf(p.code);
      const close = isNum(pr.close) ? pr.close : p.avg;
      const value = close * p.qty, cost = p.avg * p.qty;
      const day = isNum(pr.chg) ? value - value / (1 + pr.chg) : 0;
      return { ...p, close, chg: pr.chg, value, cost, pnl: value - cost, pnlPct: p.avg ? close / p.avg - 1 : null, day, pos52: pr.pos52, stale: !isNum(pr.close) };
    }).sort((a, b) => b.value - a.value);
    const total = list.reduce((a, p) => a + p.value, 0), cost = list.reduce((a, p) => a + p.cost, 0), day = list.reduce((a, p) => a + p.day, 0);
    list.forEach((p) => (p.weight = total ? p.value / total : 0));
    return { list, total, cost, day, realized, bought, unreal: total - cost, dayRet: total - day > 0 ? day / (total - day) : null, totalRet: bought ? (total - cost + realized) / bought : null };
  }
  function themeOf(code) { return themeOfCode(code)[0] || null; }

  function myTabs(active) {
    return `<div class="tabs">${[["", "포트폴리오"], ["trades", "매매 일지"], ["journal", "자동 일지"]].map(([k, l]) => `<a href="#/my${k ? "/" + k : ""}" class="${active === k ? "on" : ""}">${l}</a>`).join("")}</div>`;
  }
  function needLogin() {
    if (!SB) return `<div class="page-head"><div><h1>내 투자</h1></div></div><div class="empty">로그인 기능을 준비 중이에요.</div>`;
    return `<div class="page-head"><div><h1>내 투자</h1><p class="lede">보유 종목, 매매 기록, 매일 자동으로 쌓이는 투자 일지를 한곳에서.</p></div></div>
      <div class="card hero-login">
        <div class="grid g3">
          <div><div class="hl-ico">📈</div><h3>포트폴리오</h3><p class="sub">평가금액·수익률·테마 비중을 실시간 시세로 계산해요.</p></div>
          <div><div class="hl-ico">📝</div><h3>매매 일지</h3><p class="sub">사고판 이유와 메모를 남기고 나중에 결과와 비교해요.</p></div>
          <div><div class="hl-ico">🗓️</div><h3>자동 일지</h3><p class="sub">장 마감 후 수익, 급등락, 뉴스가 매일 자동 기록돼요.</p></div>
        </div>
        <div class="btn-row" style="justify-content:center;margin-top:24px"><button class="btn primary" data-auth="signup">무료로 시작하기</button><button class="btn" data-auth="login">로그인</button></div>
      </div>`;
  }

  const adminBanner = () => (IS_ADMIN() && PENDING_N ? `<a class="banner section admin-banner" href="#/admin">👥 승인 대기 회원 <b>${PENDING_N}명</b> · 눌러서 승인하기 →</a>` : "");
  async function pageMy(tab) {
    if (!USER) return needLogin();
    let d;
    try { d = await loadMine(); } catch (e) { return `<div class="empty">내 데이터를 불러오지 못했어요: ${esc(e.message)}</div>`; }
    const head = `<div class="page-head"><div><h1>내 투자</h1><p class="lede">${esc(USER.email)}</p></div>
      <div style="display:flex;gap:8px">${IS_ADMIN() ? `<a class="btn" href="#/admin">👥 회원 관리${PENDING_N ? ` <b class="num">${PENDING_N}</b>` : ""}</a>` : ""}<button class="btn primary" data-newtrade>+ 매매 기록</button></div></div>${adminBanner()}${myTabs(tab || "")}`;
    if (tab === "trades") return head + pageTrades(d);
    if (tab === "journal") return head + pageJournal(d);
    return head + pagePortfolio(d);
  }

  function pagePortfolio(d) {
    const P = portfolio(d.trades);
    if (!d.trades.length) return `<div class="empty" style="padding:48px 16px"><b style="font-size:16px;color:var(--ink)">첫 매매를 기록해 보세요</b><br>보유 종목을 매수 기록으로 넣으면 포트폴리오와 자동 일지가 시작돼요.<br><br><button class="btn primary" data-newtrade>+ 매매 기록</button></div>${watchCard(d)}${myThemesCard(true)}`;
    // 테마·업종 비중
    const group = (keyFn) => {
      const g = {};
      P.list.forEach((p) => { const k = keyFn(p) || "기타"; g[k] = (g[k] || 0) + p.weight; });
      return Object.entries(g).sort((a, b) => b[1] - a[1]);
    };
    const byTheme = group((p) => themeOf(p.code));
    const bySector = group((p) => LMAP[p.code]?.[3]);
    const warn = [];
    const top = P.list[0];
    if (top && top.weight > 0.35) warn.push(`${esc(top.name)} 비중이 ${pct(top.weight, 0, false)}로 높아요. 한 종목 쏠림을 점검하세요.`);
    if (byTheme[0] && byTheme[0][0] !== "기타" && byTheme[0][1] > 0.6) warn.push(`${esc(byTheme[0][0])} 테마 비중이 ${pct(byTheme[0][1], 0, false)}예요.`);
    P.list.filter((p) => isNum(p.pnlPct) && p.pnlPct <= -0.15).forEach((p) => warn.push(`${esc(p.name)} 손실률 ${pct(p.pnlPct)} — 손절 기준을 확인하세요.`));
    const series = [...d.journal].reverse();
    const bars = (rows) => rows.map(([k, w]) => `<div class="score-item"><span class="sub" title="${esc(k)}">${esc(k)}</span><div class="track"><div class="fill" style="width:${w * 100}%"></div></div><b class="num">${pct(w, 0, false)}</b></div>`).join("");
    return `<div class="grid g4">
        <div class="card stat"><div class="label">평가금액</div><div class="value num">${won(P.total)}<span class="unit">원</span></div><div class="foot">매입 ${bigWon(P.cost)}</div></div>
        <div class="card stat"><div class="label">평가손익</div><div class="value num ${cls(P.unreal)}">${signWon(P.unreal)}</div><div class="foot"><span class="${cls(P.unreal)}">${pct(P.cost ? P.unreal / P.cost : null)}</span> · 실현 <span class="${cls(P.realized)}">${signWon(P.realized)}</span></div></div>
        <div class="card stat"><div class="label">오늘 변동</div><div class="value num ${cls(P.day)}">${signWon(P.day)}</div><div class="foot"><span class="${cls(P.dayRet)}">${pct(P.dayRet, 2)}</span> · 코스피 <span class="${cls(MK.kospi?.chg)}">${pct(MK.kospi?.chg, 2)}</span></div></div>
        <div class="card stat"><div class="label">총 수익률</div><div class="value num ${cls(P.totalRet)}">${pct(P.totalRet, 2)}</div><div class="foot">(평가+실현) ÷ 총 매수금액</div></div>
      </div>
      ${warn.length ? `<div class="banner section">${warn.map((w) => `⚠️ ${w}`).join("<br>")}</div>` : ""}
      <div class="card section"><div class="card-head"><h2>보유 종목</h2><span class="muted" style="font-size:12.5px">시세 기준 ${esc(ALLMETA.as_of || MK.as_of || "")}</span></div>
        <div class="table-wrap"><table><thead><tr><th>종목</th><th class="r">수량</th><th class="r">평단</th><th class="r">현재가</th><th class="r">평가손익</th><th class="r">오늘</th><th>비중</th></tr></thead><tbody>
        ${P.list.map((p) => `<tr class="link" data-go="#/company/${p.code}"><td><span class="stock-name">${esc(p.name)}</span><span class="code">${p.code}</span>${themeOf(p.code) ? `<div class="muted" style="font-size:11.5px">${esc(themeOf(p.code))}</div>` : ""}</td>
          <td class="r num">${p.qty.toLocaleString("ko-KR")}</td><td class="r num">${won(p.avg)}</td><td class="r num">${won(p.close)}${p.stale ? " *" : ""}</td>
          <td class="r num ${cls(p.pnl)}">${signWon(p.pnl)}<div style="font-size:12px">${pct(p.pnlPct)}</div></td>
          <td class="r num ${cls(p.chg)}">${pct(p.chg, 2)}</td>
          <td><div class="pos52"><div class="bar"><i style="left:${p.weight * 100}%;background:var(--accent)"></i></div><span class="num">${pct(p.weight, 0, false)}</span></div></td></tr>`).join("")}
        </tbody></table></div></div>
      <div class="grid g-main section">
        <div class="card"><div class="card-head"><h2>내 수익률 vs 코스피</h2><span class="muted" style="font-size:12.5px">자동 일지 기준</span></div>${perfChart(series)}</div>
        <div class="card"><div class="card-head"><h2>비중 분석</h2></div>
          <div class="mini-title">테마</div><div class="score-items" style="margin-top:6px">${bars(byTheme)}</div>
          ${bySector.some(([k]) => k !== "기타") ? `<div class="mini-title" style="margin-top:18px">업종</div><div class="score-items" style="margin-top:6px">${bars(bySector.slice(0, 6))}</div>` : ""}</div>
      </div>
      ${watchCard(d)}${myThemesCard(true)}`;
  }
  function watchCard(d) {
    const rows = d.watch.map((w) => { const p = priceOf(w.code); const b = +w.price; return { w, p, ret: b > 0 && isNum(p.close) ? p.close / b - 1 : null }; });
    const rs = rows.map((r) => r.ret).filter(isNum);
    const best = rows.filter((r) => isNum(r.ret)).sort((a, b) => b.ret - a.ret);
    return `<div class="card section"><div class="card-head"><div><h2>관심 종목</h2><div class="muted" style="font-size:12.5px">기업분석에서 ☆를 누르면 그때 현재가가 등록가로 저장돼요</div></div>
        ${rs.length ? `<span class="num" style="font-size:13px">평균 <b class="${cls(rs.reduce((a, b) => a + b, 0) / rs.length)}">${pct(rs.reduce((a, b) => a + b, 0) / rs.length, 2)}</b> · 상승 ${rs.filter((x) => x > 0).length}/${rs.length}</span>` : ""}</div>
      ${best.length > 1 ? `<div class="chips" style="margin:0 0 10px"><span class="chip">🏆 ${esc(best[0].w.name)} <b class="${cls(best[0].ret)}">${pct(best[0].ret, 1)}</b></span><span class="chip">🔻 ${esc(best[best.length - 1].w.name)} <b class="${cls(best[best.length - 1].ret)}">${pct(best[best.length - 1].ret, 1)}</b></span></div>` : ""}
      ${d.watch.length ? `<div class="table-wrap"><table><thead><tr><th>종목</th><th>등록일</th><th class="r">등록가</th><th class="r">현재가</th><th class="r">등록 후 수익률</th><th class="r">오늘</th><th>52주 위치</th></tr></thead><tbody>
        ${rows.map(({ w, p, ret }) => `<tr class="link" data-go="#/company/${w.code}"><td><span class="stock-name">${esc(w.name)}</span><span class="code">${w.code}</span></td>
          <td class="num muted">${esc((w.created_at || "").slice(0, 10))}</td>
          <td class="r num">${+w.price > 0 ? won(+w.price) : "–"}</td><td class="r num">${won(p.close)}</td>
          <td class="r num ${cls(ret)}"><b>${pct(ret, 2)}</b>${isNum(ret) && isNum(p.close) ? `<div style="font-size:11.5px">${ret >= 0 ? "+" : ""}${won(p.close - +w.price)}원</div>` : ""}</td>
          <td class="r num ${cls(p.chg)}">${pct(p.chg, 2)}</td><td>${pos52(p.pos52)}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty">아직 관심 종목이 없어요.</div>`}</div>`;
  }
  function perfChart(series) {
    if (series.length < 2) return `<div class="empty">자동 일지가 2일 이상 쌓이면 그래프가 그려져요.<br>일지는 평일 장 마감 후(16:20) 자동으로 기록됩니다.</div>`;
    let k = 1;
    const pts = series.map((j, i) => {
      if (i > 0 && isNum(j.kospi_ret)) k *= 1 + j.kospi_ret;
      return { d: j.date, me: isNum(j.cum_ret) ? j.cum_ret : 0, ks: k - 1 };
    });
    const W = 640, H = 200, P = { l: 8, r: 52, t: 10, b: 24 };
    const vals = pts.flatMap((p) => [p.me, p.ks]);
    let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
    const pad = (hi - lo) * 0.1 || 0.01; lo -= pad; hi += pad;
    const x = (i) => P.l + (i / (pts.length - 1)) * (W - P.l - P.r);
    const y = (v) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
    const line = (key) => pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join("");
    const last = pts[pts.length - 1];
    return `<div class="legend"><span><i style="background:var(--accent)"></i>내 수익률 <b class="num">${pct(last.me)}</b></span><span><i style="background:var(--ink-3)"></i>코스피 <b class="num">${pct(last.ks)}</b></span></div>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">
        <line x1="${P.l}" x2="${W - P.r}" y1="${y(0)}" y2="${y(0)}" stroke="var(--line)"/>
        <text x="${W - P.r + 8}" y="${y(0) + 4}" font-size="11" fill="var(--ink-3)">0%</text>
        <path d="${line("ks")}" fill="none" stroke="var(--ink-3)" stroke-width="2" stroke-dasharray="4 3"/>
        <path d="${line("me")}" fill="none" stroke="var(--accent)" stroke-width="2"/>
        <text x="${P.l}" y="${H - 6}" font-size="11" fill="var(--ink-3)">${pts[0].d.slice(5)}</text>
        <text x="${W - P.r}" y="${H - 6}" font-size="11" fill="var(--ink-3)" text-anchor="end">${last.d.slice(5)}</text>
      </svg>`;
  }

  const REASONS = ["실적", "테마·모멘텀", "차트", "뉴스·이슈", "가치(저평가)", "분할매수", "손절", "익절", "기타"];
  function pageTrades(d) {
    const byDate = {};
    d.trades.forEach((t) => (byDate[t.trade_date] ||= []).push(t));
    return `${Object.keys(byDate).length ? Object.entries(byDate).map(([date, ts]) => `<div class="card section">
        <div class="card-head"><h2 class="num">${date}</h2><span class="muted" style="font-size:13px">${ts.length}건</span></div>
        ${ts.map((t) => { const now = priceOf(t.code).close; const after = isNum(now) && +t.price ? now / +t.price - 1 : null; return `<div class="trade-row">
          <span class="badge ${t.side === "buy" ? "pos" : "neg"}">${t.side === "buy" ? "매수" : "매도"}</span>
          <div class="tr-main"><a href="#/company/${t.code}" class="stock-name">${esc(t.name)}</a> <span class="num">${(+t.qty).toLocaleString("ko-KR")}주 × ${won(+t.price)}원</span> <span class="muted num">= ${bigWon(+t.qty * +t.price)}</span>
            ${t.reason ? `<span class="badge">${esc(t.reason)}</span>` : ""}
            ${t.memo ? `<div class="sub tr-memo">${esc(t.memo)}</div>` : ""}</div>
          <div class="tr-side num" title="기록 이후 현재가 변화">${after !== null ? `이후 <span class="${cls(after)}">${pct(after)}</span>` : ""}</div>
          <div class="tr-act"><button class="link-btn" data-edit="${t.id}">수정</button><button class="link-btn danger" data-del="${t.id}">삭제</button></div>
        </div>`; }).join("")}</div>`).join("")
      : `<div class="empty section">아직 매매 기록이 없어요. 오른쪽 위 <b>+ 매매 기록</b>으로 시작하세요.</div>`}`;
  }

  function pageJournal(d) {
    if (!d.journal.length) return `<div class="empty section" style="padding:40px 16px"><b style="color:var(--ink)">자동 일지는 장 마감 후 매일 쌓여요</b><br>매매 기록이 있으면 평일 16:20에 그날의 평가금액, 수익, 급등락, 뉴스를 자동으로 정리합니다.</div>`;
    return d.journal.map((j) => {
      const movers = [...(j.positions || [])].sort((a, b) => Math.abs(b.chg || 0) - Math.abs(a.chg || 0)).slice(0, 3);
      const ev = j.events || [];
      const icon = { move: "⚡", high: "🔺", low: "🔻", news: "📰", trade: "✍️" };
      return `<div class="card section journal-day">
        <div class="card-head"><div><h2 class="num">${j.date} <span class="muted" style="font-size:13px;font-weight:600">${["일", "월", "화", "수", "목", "금", "토"][new Date(j.date + "T00:00:00+09:00").getDay()]}요일</span></h2></div>
          <div class="num" style="text-align:right"><b class="${cls(j.day_pnl)}">${signWon(+j.day_pnl)}</b> <span class="${cls(j.day_ret)}">(${pct(j.day_ret, 2)})</span><div class="muted" style="font-size:12px">코스피 ${pct(j.kospi_ret, 2)} · 평가 ${bigWon(+j.total_value)} · 누적 ${pct(j.cum_ret)}</div></div></div>
        ${movers.length ? `<div class="chips" style="margin-bottom:10px">${movers.map((p) => `<a class="chip" href="#/company/${p.code}">${esc(p.name)} <span class="${cls(p.chg)}">${pct(p.chg, 1)}</span></a>`).join("")}</div>` : ""}
        ${ev.length ? `<ul class="events">${ev.map((e) => posLocked(e.impact) ? `<li><span>${icon[e.type] || "•"}</span>${posLockHTML(e.impact)} ${impactBadge(e.impact)}</li>` : `<li><span>${icon[e.type] || "•"}</span>${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.text)}</a>` : esc(e.text)}${e.impact ? " " + impactBadge(e.impact) : ""}</li>`).join("")}</ul>` : `<div class="muted" style="font-size:13px">특별한 이벤트 없음</div>`}
        <div class="note-box"><textarea data-note="${j.date}" placeholder="오늘의 한 줄 회고 (예: 반도체 비중 줄일지 고민)">${esc(j.note || "")}</textarea><button class="btn sm" data-savenote="${j.date}">메모 저장</button></div>
      </div>`;
    }).join("");
  }

  function openTradeForm(t) {
    closeModal();
    const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    const m = document.createElement("div");
    m.className = "modal-bg";
    m.innerHTML = `<div class="modal"><button class="modal-x" aria-label="닫기">×</button>
      <h2>${t ? "매매 기록 수정" : "매매 기록"}</h2>
      <form id="tform" class="form" style="margin-top:14px">
        <div class="seg">${["buy", "sell"].map((s) => `<label class="${(t?.side || "buy") === s ? "on" : ""}"><input type="radio" name="side" value="${s}" ${(t?.side || "buy") === s ? "checked" : ""}>${s === "buy" ? "매수" : "매도"}</label>`).join("")}</div>
        <label>종목${searchBox("tq", t?.name || "").replace('type="search"', 'type="search" data-pick="1"' + (t ? ` data-code="${t.code}"` : ""))}</label>
        <div class="grid g2" style="gap:10px"><label>날짜<input name="date" type="date" value="${t?.trade_date || today}" required></label><label>수량(주)<input name="qty" type="number" min="0" step="any" value="${t?.qty ?? ""}" required></label></div>
        <div class="grid g2" style="gap:10px"><label>단가(원)<input name="price" type="number" min="0" step="any" value="${t?.price ?? ""}" required></label><label>수수료·세금(원)<input name="fee" type="number" min="0" step="any" value="${t?.fee ?? 0}"></label></div>
        <label>이유<select name="reason"><option value="">선택 안 함</option>${REASONS.map((r) => `<option ${t?.reason === r ? "selected" : ""}>${r}</option>`).join("")}</select></label>
        <label>메모<textarea name="memo" rows="3" placeholder="왜 샀는지/팔았는지, 목표가·손절가 등">${esc(t?.memo || "")}</textarea></label>
        <div class="form-msg"></div>
        <button class="btn primary" type="submit" style="width:100%;justify-content:center">저장</button>
      </form></div>`;
    document.body.appendChild(m);
    m.addEventListener("click", (e) => { if (e.target === m || e.target.closest(".modal-x")) closeModal(); });
    m.querySelectorAll(".seg input").forEach((r) => r.addEventListener("change", () => m.querySelectorAll(".seg label").forEach((l) => l.classList.toggle("on", l.querySelector("input").checked))));
    wireSearch("tq");
    const q = m.querySelector("#tq");
    q.addEventListener("picked", (e) => { const p = priceOf(e.detail); const pf = m.querySelector("[name=price]"); if (!pf.value && isNum(p.close)) pf.value = p.close; });
    m.querySelector("#tform").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target), out = m.querySelector(".form-msg");
      const code = q.dataset.code;
      if (!code || !LMAP[code]) { out.textContent = "종목을 목록에서 선택해 주세요."; return; }
      const row = { code, name: LMAP[code][0], side: fd.get("side"), trade_date: fd.get("date"), qty: +fd.get("qty"), price: +fd.get("price"), fee: +(fd.get("fee") || 0), reason: fd.get("reason") || null, memo: fd.get("memo") || null };
      if (!(row.qty > 0)) { out.textContent = "수량을 확인해 주세요."; return; }
      if (row.side === "sell") {
        const held = portfolio((MYCACHE?.trades || []).filter((x) => x.id !== t?.id)).list.find((p) => p.code === code)?.qty || 0;
        if (row.qty > held + 1e-9) { out.textContent = `보유 수량(${held}주)보다 많이 팔 수 없어요.`; return; }
      }
      out.textContent = "저장 중…";
      const r = t ? await SB.from("trades").update(row).eq("id", t.id) : await SB.from("trades").insert(row);
      if (r.error) { out.textContent = r.error.message; return; }
      closeModal();
      await loadMine(true);
      if (!location.hash.startsWith("#/my")) location.hash = "#/my/trades"; else rerender();
    });
  }

  function wireMy() {
    document.querySelectorAll("[data-auth]").forEach((b) => b.addEventListener("click", () => openAuth(b.dataset.auth)));
    document.querySelectorAll("[data-newtrade]").forEach((b) => b.addEventListener("click", () => openTradeForm()));
    document.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openTradeForm(MYCACHE.trades.find((t) => t.id === b.dataset.edit))));
    document.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
      if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "정말 삭제?"; setTimeout(() => { b.dataset.confirm = ""; b.textContent = "삭제"; }, 3000); return; }
      const r = await SB.from("trades").delete().eq("id", b.dataset.del);
      if (!r.error) { await loadMine(true); rerender(); }
    }));
    document.querySelectorAll("[data-savenote]").forEach((b) => b.addEventListener("click", async () => {
      const d = b.dataset.savenote, note = document.querySelector(`[data-note="${d}"]`).value;
      b.textContent = "저장 중…";
      const r = await SB.from("journal").update({ note }).eq("date", d).eq("user_id", USER.id);
      b.textContent = r.error ? "실패" : "저장됨 ✓";
      if (!r.error) { const j = MYCACHE.journal.find((x) => x.date === d); if (j) j.note = note; }
      setTimeout(() => (b.textContent = "메모 저장"), 1500);
    }));
  }
  async function toggleStar(btn) {
    if (!USER) { openAuth("login"); return; }
    const code = btn.dataset.code, name = btn.dataset.name;
    await loadMine();
    const on = MYCACHE.watch.some((w) => w.code === code);
    let r;
    if (on) r = await SB.from("watchlist").delete().eq("code", code).eq("user_id", USER.id);
    else {
      const price = priceOf(code).close;
      r = await SB.from("watchlist").insert({ code, name, price: isNum(price) ? price : null });
      if (r.error && /price/.test(r.error.message || "")) r = await SB.from("watchlist").insert({ code, name }); // DB 업데이트 전
    }
    if (!r.error) {
      await loadMine(true); btn.textContent = on ? "☆ 관심 추가" : "★ 관심";
      if (!on) alertBox(`관심 종목에 추가했어요 · 등록가 ${won(priceOf(code).close)}원`);
    }
  }
  // 예전에 등록해 등록가가 비어 있는 관심 종목: 등록일 종가로 한 번 채워 넣기
  async function backfillWatchPrice(list) {
    for (const w of (list || []).filter((x) => !("price" in x) ? false : x.price === null)) {
      const c = await getJSON(`companies/${w.code}.json`);
      const day = (w.created_at || "").slice(0, 10);
      const h = (c?.history || c?.history_w || []).filter((r) => r[0] <= day);
      const px = h.length ? h[h.length - 1][1] : null;
      if (!isNum(px)) continue;
      const r = await SB.from("watchlist").update({ price: px }).eq("code", w.code).eq("user_id", USER.id);
      if (!r.error) w.price = px;
    }
  }
  // 관심 테마(섹터) 등록 · 해제 — 등록 시점 소속 종목 종가를 함께 저장해 등록 후 수익률 계산
  async function toggleTheme(btn) {
    if (!USER) { openAuth("login"); return; }
    await loadMine();
    if (!MYCACHE.themesReady) { alertBox("관심 테마 저장소가 아직 준비되지 않았어요 (Supabase 업데이트 필요)."); return; }
    const { kind, no, name } = btn.dataset;
    const on = MYCACHE.themes.some((t) => t.kind === kind && String(t.no) === String(no));
    let r;
    if (on) r = await SB.from("my_themes").delete().eq("kind", kind).eq("no", String(no)).eq("user_id", USER.id);
    else {
      const g = findGroup(kind, no);
      const base = {};
      (g?.codes || []).forEach((c) => { if (isNum(ALL[c]?.close)) base[c] = ALL[c].close; });
      r = await SB.from("my_themes").insert({ kind, no: String(no), name, base });
    }
    if (r.error) { alertBox("저장하지 못했어요: " + r.error.message); return; }
    await loadMine(true);
    btn.textContent = on ? "☆ 관심 테마 추가" : "★ 관심 테마";
    if (!on) alertBox(`관심 테마에 추가했어요 · 오늘부터 수익률을 계산해요`);
  }
  // 관심 테마 등록 후 수익률 = 소속 종목 (현재가 ÷ 등록 시 종가 − 1) 평균
  function themeSince(t) {
    const rs = Object.entries(t.base || {}).map(([c, b]) => (isNum(ALL[c]?.close) && b > 0 ? ALL[c].close / b - 1 : null)).filter(isNum);
    return rs.length ? { ret: rs.reduce((a, b) => a + b, 0) / rs.length, up: rs.filter((x) => x > 0).length, n: rs.length } : null;
  }
  function myThemesCard(compact) {
    if (!SB) return "";
    if (!USER) return `<div class="card section"><div class="card-head"><h2>내 관심 테마</h2></div><div class="empty">로그인하면 섹터를 ☆로 등록하고 등록 후 수익률을 볼 수 있어요. <button class="btn sm primary" data-login>로그인</button></div></div>`;
    const ts = MYCACHE?.themes || [];
    const rows = ts.map((t) => ({ t, g: allGroups().find((x) => x.kind === t.kind && String(x.no) === String(t.no)) || findGroup(t.kind, t.no) || {}, s: themeSince(t) }));
    return `<div class="card section"><div class="card-head"><div><h2>내 관심 테마</h2><div class="muted" style="font-size:12.5px">섹터 화면에서 ☆를 눌러 추가 · 등록 후 수익률 = 소속 종목 평균</div></div><a class="more" href="#/sectors">섹터 찾기 →</a></div>
      ${MYCACHE && !MYCACHE.themesReady ? `<div class="empty">관심 테마 저장소 준비 중이에요 (Supabase 업데이트 후 사용 가능).</div>` : rows.length ? `<div class="table-wrap"><table><thead><tr><th>테마</th><th>등록일</th><th class="r">등록 후</th><th class="r">오늘</th><th class="r">1주</th>${compact ? "" : `<th class="r">1개월</th><th>최근 뉴스</th>`}</tr></thead><tbody>
        ${rows.map(({ t, g, s }) => `<tr class="link" data-go="#/sectors/${t.kind}/${t.no}"><td><span class="stock-name">${esc(t.name)}</span> <span class="badge">${t.kind === "theme" ? "테마" : "업종"}</span>${s ? `<div class="muted" style="font-size:11.5px">${s.up}/${s.n}종목 상승</div>` : ""}</td>
          <td class="num muted">${esc((t.created_at || "").slice(0, 10))}</td>
          <td class="r num ${cls(s?.ret)}"><b>${pct(s?.ret, 2)}</b></td>
          <td class="r num ${cls(g.chg)}">${pct(g.chg, 2)}</td><td class="r num ${cls(g.r1w)}">${pct(g.r1w)}</td>
          ${compact ? "" : `<td class="r num ${cls(g.r1m)}">${pct(g.r1m)}</td><td>${sentBar(gnewsOf(t.kind, t.no))}</td>`}</tr>`).join("")}
      </tbody></table></div>` : `<div class="empty">아직 관심 테마가 없어요. <a href="#/sectors" style="color:var(--accent)">섹터 검색기</a>에서 ☆를 눌러 추가하세요.</div>`}</div>`;
  }

  // ------------------------------------------------------------ 알람 (회원은 읽고 지우기만)
  const NICON = { notice: "📢", approval: "✅", move: "⚡", high: "🚀", news: "📰", perm: "🔓" };
  function pageAlerts() {
    const html = `<div class="page-head"><div><h1>알람</h1><p class="lede">관리자 공지와 관심종목 알람이 여기 쌓여요. 다 본 알람은 지울 수 있어요.</p></div>
      ${NOTIF.length ? `<button class="btn" id="al-clear">모두 지우기</button>` : ""}</div>
      ${!PROFILE_OK ? `<div class="empty">알람 저장소 준비 중이에요.</div>` : NOTIF.length ? `<div class="alist">${NOTIF.map((n) => `<div class="card aitem ${n.created_at > seenAt() ? "new" : ""}">
        <span class="aic">${NICON[n.kind] || "🔔"}</span>
        <div class="abody">${n.link ? `<a href="${esc(n.link)}" ${/^https?:/.test(n.link) ? 'target="_blank" rel="noopener"' : ""}><b>${esc(n.title)}</b></a>` : `<b>${esc(n.title)}</b>`}
          ${n.body ? `<p>${esc(n.body)}</p>` : ""}<span class="muted num">${esc(new Date(n.created_at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }))}</span></div>
        <button class="ax" data-del="${n.id}" aria-label="지우기">✕</button></div>`).join("")}</div>` : `<div class="empty">새 알람이 없어요.</div>`}`;
    try { if (NOTIF[0]) localStorage.setItem("km_seen_" + USER.id, NOTIF[0].created_at); } catch {}
    setTimeout(renderAuthButton, 0);
    return html;
  }
  function wireAlerts() {
    document.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true;
      const r = await SB.from("notifications").delete().eq("id", b.dataset.del);
      if (r.error) { alertBox("지우지 못했어요"); b.disabled = false; return; }
      NOTIF = NOTIF.filter((n) => String(n.id) !== b.dataset.del); rerender();
    }));
    document.getElementById("al-clear")?.addEventListener("click", async () => {
      if (!confirm("알람을 모두 지울까요?")) return;
      const r = await SB.from("notifications").delete().eq("user_id", USER.id);
      if (!r.error) { NOTIF = []; rerender(); }
    });
  }
  async function sendNotif(userIds, kind, title, body, link) {
    if (!userIds.length) return { error: null };
    return SB.from("notifications").insert(userIds.map((u) => ({ user_id: u, kind, title, body: body || null, link: link || null })));
  }

  // ------------------------------------------------------------ 관리자: 회원 관리
  let adminTab = "pending";
  async function pageAdmin() {
    const r = await SB.from("profiles").select("*").order("created_at", { ascending: false });
    if (r.error) return `<div class="empty">회원 정보를 불러오지 못했어요: ${esc(r.error.message)}</div>`;
    const all = r.data, by = (s) => all.filter((p) => p.status === s);
    PENDING_N = by("pending").length; renderAuthButton();
    const age = (b) => { if (!b) return ""; const d = new Date(b), n = new Date(); let a = n.getFullYear() - d.getFullYear(); if (n < new Date(n.getFullYear(), d.getMonth(), d.getDate())) a--; return `만 ${a}세`; };
    const list = by(adminTab);
    ADMIN_MEMBERS = all;
    const notice = `<details class="card section notice-box"><summary><b>📢 알람 보내기</b> <span class="muted" style="font-size:12.5px">승인된 회원 ${by("approved").filter((p) => !p.is_admin).length}명</span></summary>
      <form id="nform" class="form" style="margin-top:12px">
        <label>받는 사람<select name="to"><option value="all">승인된 회원 전체</option>${by("approved").filter((p) => !p.is_admin).map((p) => `<option value="${p.id}">${esc(p.name || p.email)}</option>`).join("")}</select></label>
        <label>제목<input name="title" required maxlength="80" placeholder="예: 오늘 반도체 테마 주목"></label>
        <label>내용<textarea name="body" rows="3" maxlength="500"></textarea></label>
        <label>링크 (선택)<input name="link" placeholder="#/themes 또는 https://..."></label>
        <div class="form-msg"></div><button class="btn primary" type="submit">보내기</button></form></details>`;
    return `<div class="page-head"><div><h1>회원 관리</h1><p class="lede">가입 신청을 확인하고 승인하면 테마·뉴스·종목 점수가 열려요. 전화번호를 눌러 바로 전화·문자로 본인 확인할 수 있어요.</p></div></div>
      ${notice}
      <div class="seg" style="display:grid;grid-template-columns:repeat(3,1fr)">${[["pending", "승인 대기"], ["approved", "승인됨"], ["rejected", "거절"]].map(([k, l]) => `<button class="${adminTab === k ? "on" : ""}" data-atab="${k}">${l} <b class="num">${by(k).length}</b></button>`).join("")}</div>
      ${list.length ? `<div class="members">${list.map((p) => `<div class="card member">
        <div class="mhead"><b>${esc(p.name || "(이름 없음)")}</b>${p.is_admin ? `<span class="badge acc">관리자</span>` : ""}${p.provider === "kakao" ? `<span class="badge kakao-badge">카카오 인증</span>` : `<span class="badge">이메일</span>`}${!p.is_admin && (!p.phone || !p.agreed_at) ? `<span class="badge warn">정보 미입력</span>` : ""}<span class="muted num" style="margin-left:auto;font-size:12px">${esc((p.created_at || "").slice(0, 10))} 가입</span></div>
        <div class="minfo num">
          <span>${p.birth ? `${esc(p.birth)} (${age(p.birth)})` : "생년월일 없음"}</span><span>${esc(p.gender || "성별 없음")}</span>
          ${p.phone ? `<a href="tel:${esc(p.phone)}">📞 ${esc(p.phone)}</a><a href="sms:${esc(p.phone)}">💬 문자</a>` : `<span class="muted">전화번호 없음</span>`}
          <span class="muted">${esc(p.email || "")}</span></div>
        ${p.is_admin ? "" : `<div class="mact">
          ${p.status !== "approved" ? `<button class="btn primary sm" data-set="approved" data-id="${p.id}">✅ 승인</button>` : `<button class="btn sm" data-set="pending" data-id="${p.id}">승인 취소</button>`}
          ${p.status !== "rejected" ? `<button class="btn sm" data-set="rejected" data-id="${p.id}">거절</button>` : `<button class="btn sm" data-set="pending" data-id="${p.id}">대기로 되돌리기</button>`}</div>
          ${p.status === "approved" ? `<label class="pos-toggle"><input type="checkbox" data-pos="${p.id}" ${p.can_positive ? "checked" : ""}> 긍정·악재 뉴스 보기 허용</label>` : ""}`}
      </div>`).join("")}</div>` : `<div class="empty">${adminTab === "pending" ? "승인 대기 중인 회원이 없어요." : "없어요."}</div>`}
      <p class="muted" style="font-size:12px;margin-top:12px">회원을 완전히 삭제하려면 Supabase → Authentication → Users 에서 삭제하세요 (회원 정보도 함께 지워져요).</p>`;
  }
  let ADMIN_MEMBERS = [];
  function wireAdmin() {
    document.querySelectorAll("[data-pos]").forEach((c) => c.addEventListener("change", async () => {
      c.disabled = true;
      const r = await SB.from("profiles").update({ can_positive: c.checked }).eq("id", c.dataset.pos);
      if (r.error) { alertBox("변경하지 못했어요: " + r.error.message); c.checked = !c.checked; c.disabled = false; return; }
      if (c.checked) await sendNotif([c.dataset.pos], "perm", "긍정·악재 뉴스가 열렸어요", "이제 뉴스 화면에서 긍정·악재 뉴스도 볼 수 있어요.", "#/news");
      alertBox(c.checked ? "긍정·악재 뉴스를 열어줬어요" : "긍정·악재 뉴스를 닫았어요"); c.disabled = false;
    }));
    document.getElementById("nform")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target), out = e.target.querySelector(".form-msg");
      const to = fd.get("to"), ids = to === "all" ? ADMIN_MEMBERS.filter((p) => p.status === "approved" && !p.is_admin).map((p) => p.id) : [to];
      if (!ids.length) { out.textContent = "보낼 승인 회원이 없어요."; return; }
      out.textContent = "보내는 중…";
      const r = await sendNotif(ids, "notice", fd.get("title").trim(), fd.get("body").trim(), fd.get("link").trim());
      out.textContent = r.error ? "보내지 못했어요: " + r.error.message : `${ids.length}명에게 보냈어요 ✅`;
      if (!r.error) e.target.reset();
    });
    document.querySelectorAll("[data-atab]").forEach((b) => b.addEventListener("click", () => { adminTab = b.dataset.atab; rerender(); }));
    document.querySelectorAll("[data-set]").forEach((b) => b.addEventListener("click", async () => {
      const st = b.dataset.set;
      if (st === "rejected" && !confirm("이 회원의 가입을 거절할까요?")) return;
      b.disabled = true;
      const r = await SB.from("profiles").update({ status: st, approved_at: st === "approved" ? new Date().toISOString() : null }).eq("id", b.dataset.id);
      if (r.error) { alertBox("변경하지 못했어요: " + r.error.message); b.disabled = false; return; }
      if (st === "approved") await sendNotif([b.dataset.id], "approval", "가입이 승인됐어요 🎉", "이제 테마·섹터·뉴스·종목 점수를 모두 볼 수 있어요.", "#/themes");
      alertBox(st === "approved" ? "승인했어요" : st === "rejected" ? "거절했어요" : "대기로 바꿨어요");
      rerender();
    }));
  }

  // ------------------------------------------------------------ 라우터
  let ALLMETA = {};
  async function rerender() { window.__kmKeepScroll = true; await route(); window.__kmKeepScroll = false; }
  async function route() {
    const parts = (location.hash || "#/").slice(2).split("/").map(decodeURIComponent);
    let page = parts[0] || "home";
    if (page === "search") { if (parts[1]) { location.replace(`#/company/${parts[1]}`); return; } page = "market"; }
    document.querySelectorAll(".nav a, .tabbar a").forEach((a) => a.classList.toggle("active", a.dataset.page === page || (page === "sectors" && a.dataset.page === "themes" && !a.closest(".nav"))));
    let html = "";
    const wireGate = () => {
      document.querySelectorAll("[data-auth]").forEach((b) => b.addEventListener("click", () => openAuth(b.dataset.auth)));
      document.getElementById("gate-refresh")?.addEventListener("click", async () => { await loadProfile(); renderAuthButton(); rerender(); });
      document.getElementById("gate-info")?.addEventListener("click", openProfileInfo);
    };
    if (LOCKED_PAGES.has(page) && !CAN_SEE()) {
      $app.innerHTML = gateCard({ themes: "테마", sectors: "섹터", news: "뉴스", my: "내 투자", admin: "회원 관리" }[page]);
      wireGate(); if (!window.__kmKeepScroll) window.scrollTo(0, 0);
      return;
    }
    if (page === "admin" && !IS_ADMIN()) { location.replace("#/"); return; }
    if ((page === "sectors" || page === "themes") && !GNEWS) GNEWS = (await getJSON("group_news.json")) || { g: {} };
    if ((page === "themes" || page === "sectors") && USER && !MYCACHE) await loadMine().catch(() => {});
    if (page === "themes") html = pageThemes(parts[1]);
    else if (page === "sectors") html = pageSectors(parts);
    else if (page === "market") html = pageMarket(parts);
    else if (page === "company") html = await pageCompany(parts[1]);
    else if (page === "news") html = pageNews();
    else if (page === "admin") html = await pageAdmin();
    else if (page === "alerts") html = USER ? pageAlerts() : gateCard("알람");
    else if (page === "my") html = await pageMy(parts[1]);
    else html = pageHome();
    $app.innerHTML = html;
    wireSearch("home-q"); wireSearch("q"); wireSearch("cq"); wireInstall(); wireGate();
    if (page === "admin") wireAdmin();
    if (page === "alerts" && USER) wireAlerts();
    if (page === "market") wireMarket();
    if (page === "sectors" && !parts[1]) wireSectors();
    document.getElementById("tstar")?.addEventListener("click", (e) => toggleTheme(e.currentTarget).then(rerender));
    document.querySelectorAll("[data-login]").forEach((b) => b.addEventListener("click", () => openAuth("login")));
    document.getElementById("rank-more")?.addEventListener("click", () => { rankLimit += 30; rerender(); });
    if (page === "my") wireMy();
    if (page === "company") {
      const code = parts[1] || trackedCodes()[0];
      const c = await getJSON(`companies/${code}.json`);
      wireChart(sliceHist(c, chartRange));
      document.getElementById("star")?.addEventListener("click", (e) => toggleStar(e.currentTarget));
      document.querySelectorAll("[data-range]").forEach((b) => b.addEventListener("click", () => { chartRange = b.dataset.range; rerender(); }));
    }
    if (page === "news") {
      document.querySelectorAll("[data-nf]").forEach((b) => b.addEventListener("click", () => { newsFilter = b.dataset.nf; newsLimit = 20; rerender(); }));
      document.querySelectorAll("[data-nt]").forEach((b) => b.addEventListener("click", () => { newsTone = b.dataset.nt; newsLimit = 20; rerender(); }));
      document.querySelectorAll("[data-ntab]").forEach((b) => b.addEventListener("click", () => { newsTab = b.dataset.ntab; rerender(); }));
      document.getElementById("news-more")?.addEventListener("click", () => { newsLimit += 20; rerender(); });
      document.querySelector(".chip.on[data-nf]")?.scrollIntoView({ block: "nearest", inline: "center" });
    }
    if (!window.__kmKeepScroll) window.scrollTo(0, 0);
  }
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-go]");
    if (el && !e.target.closest("a, button")) location.hash = el.dataset.go;
  });

  async function init() {
    let all;
    [CFG, MK, LIST, NEWS, all, GROUPS] = await Promise.all([getJSON("config.json"), getJSON("market.json"), getJSON("stocks.json"), getJSON("theme_news.json"), getJSON("market_all.json"), getJSON("groups.json")]);
    (GROUPS?.themes || []).forEach((g) => (g.codes || []).forEach((c) => (CODE2THEMES[c] ||= []).push(g)));
    Object.values(CODE2THEMES).forEach((l) => l.sort((a, b) => b.chg - a.chg));
    if (!CFG || !MK) {
      $app.innerHTML = `<div class="empty">데이터를 불러오지 못했습니다. data 폴더가 함께 배포됐는지 확인해 주세요.</div>`;
      return;
    }
    LIST = LIST || [];
    LIST.forEach((r) => (LMAP[r[1]] = r));
    if (all?.rows) {
      ALLMETA = { as_of: all.as_of };
      for (const [c, v] of Object.entries(all.rows)) { const o = {}; all.fields.forEach((f, i) => (o[f] = v[i])); ALL[c] = o; }
    }
    document.title = CFG.site_title || document.title;
    renderStatus();
    const invited = /type=invite/.test(location.hash);
    if (sbReady()) {
      const c = window.KM_CONFIG.supabase;
      SB = window.supabase.createClient(c.url, c.anonKey);
      const { data } = await SB.auth.getSession();
      USER = data.session?.user || null;
      await loadProfile();
      if (USER && !(await checkDevice())) { USER = null; PROFILE = null; }
      // 주의: 이 콜백 안에서 Supabase 요청을 바로 await 하면 멈출 수 있어(라이브러리 잠금) setTimeout 으로 한 박자 늦춰 실행
      SB.auth.onAuthStateChange((ev, session) => {
        setTimeout(async () => {
          const was = USER?.id;
          USER = session?.user || null;
          if (was !== USER?.id) { MYCACHE = null; await loadProfile(); if (USER) await checkDevice(); }
          renderAuthButton();
          if (USER && NEEDS_INFO() && was !== USER.id) openProfileInfo();
          if (ev === "PASSWORD_RECOVERY") openNewPassword();
          if (was !== USER?.id) { if (USER) loadMine().catch(() => {}); rerender(); }
        }, 0);
      });
      if (USER) loadMine().catch(() => {});
      if (USER && invited) { history.replaceState(null, "", location.pathname + "#/"); openNewPassword(true); }
      if (USER && NEEDS_INFO()) openProfileInfo();
      // 다른 기기 로그인 확인 + 새 알람: 화면에 돌아올 때와 3분마다
      const recheck = async () => { if (!USER) return; if (await checkDevice()) { await loadNotif(); renderAuthButton(); } };
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") recheck(); });
      setInterval(recheck, 180000);
    }
    renderAuthButton();
    renderTabbar();
    if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
    window.addEventListener("hashchange", route);
    route();
  }
  init();
})();
