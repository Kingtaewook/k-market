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

  let CFG, MK, LIST, NEWS;
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
    const k = { 긍정: "pos", 주의: "warn", 부정: "neg", 중립: "" }[t] ?? "";
    return `<span class="badge ${k}">${esc(t || "중립")}</span>`;
  };
  const verdictBadge = (v) => {
    const k = { "높은 관심": "pos", 관심: "pos", 중립: "", 주의: "warn", 약세: "neg", 강세: "pos", 상승: "pos", 혼조: "", "확인 필요": "" }[v] ?? "";
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
  function nameOf(code) {
    return MK.stocks[code]?.name || (LIST.find((r) => r[1] === code) || [])[0] || code;
  }

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
      <div class="card-head"><div><h2>테마 관심도 랭킹</h2><div class="muted" style="font-size:13px">${esc(basis)} 1·3개월 수익률로 계산 · 50 = 기준선</div></div>
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
    return `<div class="news-list">${items.map((n) => `
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
    return `${staleBanner()}
    <div class="page-head"><div><h1>${esc(CFG.site_title || "K-Market Intelligence")}</h1>
      <p class="lede">관심 테마 ${T.length}개 · 핵심 종목 ${all.length}개의 모멘텀과 기업 지표를 매일 자동으로 정리합니다.</p></div></div>
    <div class="grid g4">
      <a class="card stat" href="#/themes/${encodeURIComponent(top?.name || "")}"><div class="label">최고 관심 테마</div><div class="value sm">${esc(top?.name || "–")}</div><div class="foot">관심도 <b>${top?.score ?? "–"}</b> · 1개월 <span class="${cls(top?.avg1m)}">${pct(top?.avg1m)}</span></div></a>
      <a class="card stat" href="#/themes/${encodeURIComponent(low?.name || "")}"><div class="label">주의 테마</div><div class="value sm">${esc(low?.name || "–")}</div><div class="foot">관심도 <b>${low?.score ?? "–"}</b> · 1개월 <span class="${cls(low?.avg1m)}">${pct(low?.avg1m)}</span></div></a>
      <div class="card stat"><div class="label">코스피 1개월</div><div class="value num ${cls(k?.r1m)}">${k ? pct(k.r1m) : "–"}</div><div class="foot">${k ? `지수 ${won(k.close)} · 3개월 <span class="${cls(k.r3m)}">${pct(k.r3m)}</span>` : "자동 갱신 후 표시"}</div></div>
      <div class="card stat"><div class="label">1개월 상승 종목</div><div class="value num">${ups}<span class="muted" style="font-size:18px"> / ${all.length}</span></div><div class="foot">핵심 종목 기준</div></div>
    </div>
    <div class="grid g-main section">
      ${rankingCard()}
      <div class="card">
        <div class="card-head"><h2>종목 빠른 검색</h2><a class="more" href="#/search">검색 화면 →</a></div>
        ${searchBox("home-q")}
        <div class="card-head" style="margin-top:22px"><h2>최근 테마 뉴스</h2><a class="more" href="#/news">전체 →</a></div>
        ${newsItems(latest)}
      </div>
    </div>`;
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
    <div class="page-head"><div><h1>섹터·테마 모니터</h1><p class="lede">테마별 핵심 종목의 1·3개월 모멘텀과 52주 위치입니다. 종목을 누르면 기업분석으로 이동합니다.</p></div></div>
    <div class="chips"><a class="chip ${sel ? "" : "on"}" href="#/themes">전체</a>${T.map((t) => `<a class="chip ${sel === t.name ? "on" : ""}" href="#/themes/${encodeURIComponent(t.name)}">${esc(t.name)}</a>`).join("")}</div>
    ${sel ? "" : `<div style="margin-bottom:16px">${rankingCard()}</div>`}
    ${list.map((t) => `
      <div class="card theme-block">
        <div class="theme-head"><span class="badge acc num">${t.rank ?? "–"}위</span><h2>${esc(t.name)}</h2>${verdictBadge(t.verdict)}
          <div class="theme-kpis num"><span>관심도<b>${t.score ?? "–"}</b></span><span>평균 1개월<b class="${cls(t.avg1m)}">${pct(t.avg1m)}</b></span><span>평균 3개월<b class="${cls(t.avg3m)}">${pct(t.avg3m)}</b></span>${isNum(t.rel1m) ? `<span>코스피 대비 1개월<b class="${cls(t.rel1m)}">${pct(t.rel1m)}p</b></span>` : ""}<span>상승<b>${t.up}/${t.total}</b></span></div>
        </div>
        ${stockTable(t.stocks)}
      </div>`).join("")}`;
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
        return `<button data-code="${r[1]}" class="${i === hi ? "hi" : ""}"><b>${esc(r[0])}</b><span class="muted num">${r[1]}</span>${th.length ? `<span class="badge acc">${esc(th[0])}</span>` : ""}<span class="m">${esc(r[2] || "")}</span></button>`;
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
        if (r) location.hash = `#/search/${r[1]}`;
      } else if (e.key === "Escape") { hits = []; draw(); }
    });
    box.addEventListener("mousedown", (e) => {
      const b = e.target.closest("button");
      if (b) { e.preventDefault(); location.hash = `#/search/${b.dataset.code}`; }
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
            <dt>관심 테마</dt><dd>${themes.length ? themes.map((t) => `<a class="badge acc" href="#/themes/${encodeURIComponent(t)}">${esc(t)}</a>`).join(" ") : `<span class="muted">미등록</span>`}</dd>
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
      items.push(["밸류에이션", p + b]);
    } else items.push(["밸류에이션", null]);
    const r = f.roe;
    items.push(["수익성", isNum(r) ? (r >= 0.2 ? 20 : r >= 0.15 ? 17 : r >= 0.1 ? 14 : r >= 0.08 ? 11 : r >= 0.05 ? 7 : 3) : null]);
    const d = f.debt_ratio;
    items.push(["재무안정성", isNum(d) ? (d <= 0.5 ? 20 : d <= 1 ? 16 : d <= 1.5 ? 12 : d <= 2 ? 8 : d <= 3 ? 4 : 1) : null]);
    if (q.length >= 2 && isNum(q[0].op_income) && isNum(q[1].op_income)) {
      const yoy = q[4] && isNum(q[4].op_income) ? q[0].op_income > q[4].op_income : null;
      const revYoy = q[4] && isNum(q[4].revenue) && isNum(q[0].revenue) ? q[0].revenue > q[4].revenue : null;
      let s = 10 + (q[0].op_income >= q[1].op_income ? 4 : -4);
      if (yoy !== null) s += yoy ? 4 : -4;
      if (revYoy !== null) s += revYoy ? 2 : -2;
      items.push(["실적 모멘텀", Math.max(0, Math.min(20, s))]);
    } else items.push(["실적 모멘텀", null]);
    if (price && isNum(price.r1m) && isNum(price.r3m)) {
      const n = c.news || [];
      const pos = n.filter((x) => x.impact === "긍정").length, neg = n.filter((x) => x.impact === "주의" || x.impact === "부정").length;
      items.push(["시장·뉴스", Math.max(0, Math.min(20, 10 + (price.r1m > 0 ? 3 : -3) + (price.r3m > 0 ? 2 : -2) + Math.min(5, pos) - Math.min(5, neg)))]);
    } else items.push(["시장·뉴스", null]);
    const have = items.filter((i) => i[1] !== null);
    const total = have.length ? Math.round(have.reduce((a, i) => a + i[1], 0) * 100 / (20 * have.length)) : null;
    const grade = total === null ? "자료 부족" : total >= 80 ? "매우 긍정" : total >= 65 ? "긍정" : total >= 50 ? "중립" : total >= 35 ? "주의" : "위험";
    const weakest = have.length ? have.reduce((a, b) => (b[1] < a[1] ? b : a))[0] : "–";
    return { items, total, grade, weakest, partial: have.length < items.length };
  }

  function priceChart(hist, range) {
    if (!hist || hist.length < 2) return `<div class="empty">주가 차트는 첫 자동 갱신 후 표시됩니다.</div>`;
    const n = { "1M": 22, "3M": 66, "6M": 130, "1Y": 999 }[range] || 999;
    const data = hist.slice(-n);
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

  function wireChart(hist, range) {
    const box = document.querySelector(".chart-box");
    if (!box || !hist) return;
    const n = { "1M": 22, "3M": 66, "6M": 130, "1Y": 999 }[range] || 999;
    const data = hist.slice(-n);
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
    const c = (await getJSON(`companies/${code}.json`)) || { code, name: nameOf(code) };
    const s = MK.stocks[code] || {};
    const price = { ...(c.price || {}), ...Object.fromEntries(Object.entries(s).filter(([, v]) => v !== null && v !== undefined)) };
    const f = c.fundamentals || {};
    const sc = companyScore(c, price);
    const notes = CFG.company_notes?.[code];
    const capTier = !isNum(f.market_cap_eok) ? null : f.market_cap_eok >= 100000 ? "대형주" : f.market_cap_eok >= 10000 ? "중형주" : "소형주";
    const q = c.quarters || [];
    const opYoY = q[4] && isNum(q[0]?.op_income) && isNum(q[4].op_income) ? q[0].op_income - q[4].op_income : null;
    const heavy = (isNum(f.per) && f.per > 25) || (isNum(f.pbr) && f.pbr > 3);
    const signals = [
      capTier && `<span class="badge">${capTier}</span>`,
      isNum(f.op_margin) && (f.op_margin >= 0.15 ? `<span class="badge pos">고수익성</span>` : `<span class="badge">수익성 점검</span>`),
      opYoY !== null && (opYoY > 0 ? `<span class="badge pos">이익 모멘텀 ↑</span>` : `<span class="badge neg">이익 모멘텀 ↓</span>`),
      (isNum(f.per) || isNum(f.pbr)) && (heavy ? `<span class="badge warn">밸류 부담</span>` : `<span class="badge good">밸류 양호</span>`),
    ].filter(Boolean).join("");
    const strategy = (isNum(f.op_margin) && opYoY !== null)
      ? (() => {
          const strong = f.op_margin >= 0.15 && opYoY > 0;
          const weak = f.op_margin < 0.05 || opYoY <= 0;
          const a = strong ? "실적과 수익성 모멘텀이 강합니다. " : weak ? "본업 수익성 또는 이익 모멘텀이 약합니다. " : "수익성은 보통이며 이익 추세 확인이 필요합니다. ";
          const b = heavy ? "PER·PBR 부담이 높아 추격매수보다 조정 시 분할 접근이 유리합니다."
            : strong ? "밸류에이션 부담이 크지 않아 실적 추세를 확인하며 비중 확대를 검토할 수 있습니다."
            : "지표상 저평가여도 이익 개선이 확인되기 전까지는 비중 확대에 신중한 편이 좋습니다.";
          return `<b>전략</b> ${a}${b}`;
        })()
      : `<b>전략</b> 재무·분기 실적 자료가 모이면 자동으로 코멘트가 만들어집니다.`;
    const age = daysSince(c.as_of);
    const metric = (label, value, tag, note, tip) => `<div class="metric" title="${esc(tip)}"><div class="label">${label}${tagBadge(tag)}</div><div class="value num">${value}</div>${note ? `<div class="note">${note}</div>` : ""}</div>`;

    return `<div class="page-head">
      <div><div class="company-title"><h1>${esc(c.name || nameOf(code))}</h1><span class="code num">${code}</span>${c.market ? `<span class="badge">${esc(c.market)}</span>` : ""}${themeOfCode(code).map((t) => `<a class="badge acc" href="#/themes/${encodeURIComponent(t)}">${esc(t)}</a>`).join("")}</div>
      <div class="signal-line">${signals || `<span class="muted" style="font-size:13px">재무 자료 수집 전</span>`}</div></div>
      <select class="picker" id="picker">${codes.map((k) => `<option value="${k}" ${k === code ? "selected" : ""}>${esc(nameOf(k))}</option>`).join("")}</select>
    </div>
    ${c.source === "엑셀 수기 입력" || (age !== null && age > 30) ? `<div class="banner">이 종목의 재무·뉴스는 <b>${esc(c.as_of || "")}</b> 기준${age !== null ? ` (${age}일 전)` : ""}입니다.${c.source === "엑셀 수기 입력" ? " 엑셀에서 옮긴 값이며, 자동 갱신이 시작되면 최신 자료로 바뀝니다." : ""}</div>` : ""}
    <div class="grid g4">
      <div class="card stat"><div class="label">최근 종가</div><div class="value num">${won(price.close)}</div><div class="foot">${esc(price.last_date || "")}</div></div>
      <div class="card stat"><div class="label">1개월 / 3개월</div><div class="value sm num"><span class="${cls(price.r1m)}">${pct(price.r1m)}</span> <span class="muted">/</span> <span class="${cls(price.r3m)}">${pct(price.r3m)}</span></div><div class="foot">모멘텀 ${verdictBadge(price.momentum || "확인 필요")}</div></div>
      <div class="card stat"><div class="label">52주 위치</div><div class="value num">${isNum(price.pos52) ? Math.round(price.pos52 * 100) + "%" : "–"}</div><div class="foot num">${isNum(price.lo52) ? `${won(price.lo52)} ~ ${won(price.hi52)}` : "최저 0% ~ 최고 100%"}</div></div>
      <div class="card stat"><div class="label">시가총액</div><div class="value num">${cap(f.market_cap_eok)}</div><div class="foot">${isNum(price.vol20) ? `20일 평균 거래량 ${won(price.vol20)}` : "&nbsp;"}</div></div>
    </div>
    <div class="grid g-main section">
      <div class="card">
        <div class="card-head"><h2>주가 추이</h2><div class="range-tabs">${["1M", "3M", "6M", "1Y"].map((r) => `<button data-range="${r}" class="${r === chartRange ? "on" : ""}">${r}</button>`).join("")}</div></div>
        ${priceChart(c.history, chartRange)}
      </div>
      <div class="card">
        <div class="card-head"><h2>종합 점수</h2>${verdictBadge(sc.grade === "매우 긍정" ? "높은 관심" : sc.grade === "긍정" ? "관심" : sc.grade === "위험" ? "약세" : sc.grade === "자료 부족" ? "확인 필요" : sc.grade)}</div>
        <div class="score-ring"><div class="score-big num">${sc.total ?? "–"}</div><div class="sub" style="font-size:13px">100점 만점 · 5개 항목 × 20점${sc.partial ? "<br><span class='muted'>자료 있는 항목만 환산</span>" : ""}<br>가장 약한 항목: <b>${esc(sc.weakest)}</b></div></div>
        <div class="score-items">${sc.items.map(([k, v]) => `<div class="score-item"><span class="sub">${k}</span><div class="track"><div class="fill" style="width:${isNum(v) ? v * 5 : 0}%"></div></div><b class="num">${v ?? "–"}</b></div>`).join("")}</div>
      </div>
    </div>
    <div class="card section">
      <div class="card-head"><h2>핵심 재무 지표</h2><span class="muted" style="font-size:12.5px">${esc(c.source || "")} ${c.as_of ? "· " + esc(c.as_of) : ""}</span></div>
      <div class="metrics">
        ${metric("PER", times(f.per), tagPER(f.per), tagPER(f.per) === "긍정" ? "이익 대비 주가 부담 낮음" : tagPER(f.per) === "중립" ? "보통 수준" : tagPER(f.per) ? "이익 대비 주가 부담" : "", "주가 ÷ 주당순이익. 15배 이하 긍정, 25배 초과 부담. 업종마다 기준이 다릅니다.")}
        ${metric("PBR", times(f.pbr), tagPBR(f.pbr), tagPBR(f.pbr) === "긍정" ? "자산가치 대비 저평가" : tagPBR(f.pbr) === "중립" ? "적정 구간" : tagPBR(f.pbr) ? "자산가치 대비 고평가" : "", "주가 ÷ 주당순자산. 1.5배 이하 긍정. 수익성이 낮으면 저PBR이 오래 갈 수 있습니다.")}
        ${metric("ROE", pct(f.roe, 1, false), tagROE(f.roe), tagROE(f.roe) === "긍정" ? "자본 효율 우수" : tagROE(f.roe) === "중립" ? "보통 수준" : tagROE(f.roe) ? "수익성 개선 필요" : "", "순이익 ÷ 자기자본. 15% 이상 우수, 8% 미만 낮음.")}
        ${metric("영업이익률", pct(f.op_margin, 1, false), tagOPM(f.op_margin), "", "영업이익 ÷ 매출액 (최근 분기).")}
        ${metric("부채비율", pct(f.debt_ratio, 0, false), tagDebt(f.debt_ratio), tagDebt(f.debt_ratio) === "긍정" ? "재무 안정적" : tagDebt(f.debt_ratio) === "중립" ? "지속 점검" : tagDebt(f.debt_ratio) ? "부채 부담 높음" : "", "부채 ÷ 자본. 50% 이하 안정, 100% 초과 점검. 금융·조선 등은 업종 특성상 높을 수 있습니다.")}
      </div>
      <div class="strategy">${strategy}</div>
    </div>
    <div class="grid g2 section">
      <div class="card">
        <div class="card-head"><h2>분기 실적</h2><span class="muted" style="font-size:12.5px">단위 ${esc(c.unit || "억원")}</span></div>
        ${q.length ? `<div class="table-wrap"><table><thead><tr><th>분기</th><th class="r">매출액</th><th class="r">영업이익</th><th class="r">순이익</th><th class="r">영업이익률</th></tr></thead><tbody>
          ${q.map((r) => `<tr><td>${esc(r.period)}</td><td class="r num">${eokFmt(r.revenue)}</td><td class="r num ${isNum(r.op_income) && r.op_income < 0 ? "down" : ""}">${eokFmt(r.op_income)}</td><td class="r num ${isNum(r.net_income) && r.net_income < 0 ? "down" : ""}">${eokFmt(r.net_income)}</td><td class="r num">${pct(r.op_margin, 1, false)}</td></tr>`).join("")}
        </tbody></table></div>` : `<div class="empty">분기 실적은 첫 자동 갱신 후 표시됩니다.</div>`}
      </div>
      <div class="card">
        <div class="card-head"><h2>최근 뉴스</h2><a class="more" href="https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(c.name || "")}" target="_blank" rel="noopener">네이버 뉴스 ↗</a></div>
        ${newsItems(c.news)}
      </div>
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
  let newsFilter = "전체";
  function pageNews() {
    const themes = CFG.themes.map((t) => t.name);
    const curated = (NEWS?.curated || []).filter((n) => newsFilter === "전체" || n.theme === newsFilter);
    const autoMap = NEWS?.auto || {};
    const auto = (newsFilter === "전체" ? Object.entries(autoMap).flatMap(([t, l]) => l.map((n) => ({ ...n, theme: t }))) : (autoMap[newsFilter] || []).map((n) => ({ ...n, theme: newsFilter })))
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const count = (k) => curated.filter((n) => n.impact === k).length + auto.filter((n) => n.impact === k).length;
    return `<div class="page-head"><div><h1>테마 뉴스</h1><p class="lede">테마별 종목 뉴스를 매일 모으고 제목 키워드로 긍정·중립·주의를 자동 분류합니다. 분류는 참고용입니다.</p></div></div>
      <div class="chips">${["전체", ...themes].map((t) => `<button class="chip ${t === newsFilter ? "on" : ""}" data-nf="${esc(t)}">${esc(t)}</button>`).join("")}</div>
      <div class="grid g4" style="margin-bottom:16px">
        <div class="card stat"><div class="label">긍정</div><div class="value num up">${count("긍정")}</div></div>
        <div class="card stat"><div class="label">중립</div><div class="value num">${count("중립")}</div></div>
        <div class="card stat"><div class="label">주의</div><div class="value num" style="color:var(--warn)">${count("주의")}</div></div>
        <div class="card stat"><div class="label">자동 수집 기준일</div><div class="value sm num">${esc(NEWS?.auto_as_of || "갱신 전")}</div></div>
      </div>
      <div class="grid g2">
        <div class="card"><div class="card-head"><h2>자동 수집 뉴스</h2><span class="muted" style="font-size:13px">${auto.length}건</span></div>${auto.length ? newsItems(auto.slice(0, 30), { showTheme: true }) : `<div class="empty">GitHub Actions 가 처음 실행되면 테마별 최신 뉴스가 여기에 쌓입니다.</div>`}</div>
        <div class="card"><div class="card-head"><h2>핵심 뉴스 (직접 정리)</h2><span class="muted" style="font-size:13px">${esc(NEWS?.as_of || "")} 기준</span></div>${newsItems(curated, { showTheme: true })}</div>
      </div>`;
  }

  // ------------------------------------------------------------ 라우터
  async function route() {
    const parts = (location.hash || "#/").slice(2).split("/").map(decodeURIComponent);
    const page = parts[0] || "home";
    document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.page === (page === "home" ? "home" : page)));
    let html = "";
    if (page === "themes") html = pageThemes(parts[1]);
    else if (page === "search") html = pageSearch(parts[1]);
    else if (page === "company") html = await pageCompany(parts[1]);
    else if (page === "news") html = pageNews();
    else html = pageHome();
    $app.innerHTML = html;
    wireSearch("home-q"); wireSearch("q");
    if (page === "company") {
      const code = parts[1] || trackedCodes()[0];
      const c = await getJSON(`companies/${code}.json`);
      wireChart(c?.history, chartRange);
      document.getElementById("picker")?.addEventListener("change", (e) => (location.hash = `#/company/${e.target.value}`));
      document.querySelectorAll("[data-range]").forEach((b) => b.addEventListener("click", async () => { chartRange = b.dataset.range; window.__kmKeepScroll = true; await route(); window.__kmKeepScroll = false; }));
    }
    if (page === "news") document.querySelectorAll("[data-nf]").forEach((b) => b.addEventListener("click", async () => { newsFilter = b.dataset.nf; window.__kmKeepScroll = true; await route(); window.__kmKeepScroll = false; }));
    if (!window.__kmKeepScroll) window.scrollTo(0, 0);
  }
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-go]");
    if (el && !e.target.closest("a")) location.hash = el.dataset.go;
  });

  async function init() {
    [CFG, MK, LIST, NEWS] = await Promise.all([getJSON("config.json"), getJSON("market.json"), getJSON("stocks.json"), getJSON("theme_news.json")]);
    if (!CFG || !MK) {
      $app.innerHTML = `<div class="empty">데이터를 불러오지 못했습니다. data 폴더가 함께 배포됐는지 확인해 주세요.</div>`;
      return;
    }
    LIST = LIST || [];
    document.title = CFG.site_title || document.title;
    renderStatus();
    window.addEventListener("hashchange", route);
    route();
  }
  init();
})();
