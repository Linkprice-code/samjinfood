/* 어묵 경쟁사 모니터 대시보드 — 정적 JSON만 읽습니다. */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') || /^data\/manual\//.test(u || '') ? u : '#');
const fmt = (n) => (n == null ? '–' : Number(n).toLocaleString('ko-KR'));
const SRC = { naver_news: '뉴스', naver_blog: '블로그', naver_cafe: '카페', youtube: '유튜브' };
const SENT = { positive: ['긍정', 'pos'], negative: ['부정', 'neg'], neutral: ['중립', ''] };
const COLORS = ['#2463eb', '#e8710a', '#12805c', '#c4302b', '#7c3aed', '#0891b2', '#a16207', '#db2777'];

const D = {}; // 데이터
const S = { gran: 'day', ref: null, brands: new Set(), platform: '', mentionCache: {} };

/* ---------- 날짜 ---------- */
const toD = (s) => new Date(s + 'T00:00:00Z');
const toS = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = toD(s); d.setUTCDate(d.getUTCDate() + n); return toS(d); };
const kstToday = () => toS(new Date(Date.now() + 9 * 3600e3));
function range(gran, ref) {
  if (gran === 'day') return [ref, ref];
  if (gran === 'week') { const wd = (toD(ref).getUTCDay() + 6) % 7; const s = addDays(ref, -wd); return [s, addDays(s, 6)]; }
  const s = ref.slice(0, 8) + '01'; const d = toD(s); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return [s, toS(d)];
}
function prevRef(gran, ref) {
  if (gran === 'day') return addDays(ref, -1);
  if (gran === 'week') return addDays(ref, -7);
  const d = toD(ref.slice(0, 8) + '01'); d.setUTCMonth(d.getUTCMonth() - 1); return toS(d);
}
const inR = (d, [a, b]) => d && d >= a && d <= b;
const GLabel = { day: '전일', week: '전주', month: '전월' };
const rangeText = ([a, b]) => (a === b ? a : `${a} ~ ${b}`);

/* ---------- 로딩 ---------- */
async function j(path, fb) { try { const r = await fetch(path, { cache: 'no-store' }); if (!r.ok) throw 0; return await r.json(); } catch { return fb; } }
async function load() {
  [D.cfg, D.site, D.cov, D.cr, D.notes, D.ts, D.off, D.runs] = await Promise.all([
    j('data/config.json', { brands: [], media: {} }), j('data/site.json', {}), j('data/coverage.json', { items: [] }),
    j('data/creatives.json', { items: [] }), j('data/notes.json', { items: [] }), j('data/timeseries.json', { days: {} }),
    j('data/official.json', { items: {} }), j('data/logs/runs.json', []),
  ]);
  D.brandName = Object.fromEntries(D.cfg.brands.map((b) => [b.id, b.name]));
  D.brands = D.cfg.brands.map((b) => b.id);
  const dates = Object.keys(D.ts.days).sort();
  S.ref = dates.at(-1) || kstToday();
  try { const saved = JSON.parse(localStorage.getItem('fcm-ui') || '{}'); if (saved.gran) S.gran = saved.gran; } catch {}
  S.brands = new Set(D.brands);
  $('#lastUpdated').textContent = D.site.lastCollectedAt
    ? `마지막 자동 수집 ${D.site.lastCollectedAt.slice(0, 16).replace('T', ' ')} (KST) · 화면 갱신 ${String(D.site.builtAt || '').slice(0, 16).replace('T', ' ')}`
    : `아직 자동 수집 전 · 화면 갱신 ${String(D.site.builtAt || '').slice(0, 16).replace('T', ' ')}`;
}
async function mentions(rangeArr) {
  const months = new Set();
  for (let d = rangeArr[0].slice(0, 7); d <= rangeArr[1].slice(0, 7);) { months.add(d); const x = toD(d + '-01'); x.setUTCMonth(x.getUTCMonth() + 1); d = toS(x).slice(0, 7); }
  const out = [];
  for (const m of months) {
    if (!(D.site.months || []).includes(m)) continue;
    S.mentionCache[m] ||= await j(`data/mentions/${m}.json`, { items: [] });
    out.push(...S.mentionCache[m].items);
  }
  return out.filter((x) => inR(x.date, rangeArr) && S.brands.has(x.brand) && !(x.baseline && !x.published));
}

/* ---------- 공통 필터 ---------- */
const platOf = (media) => D.cfg.media[media]?.platform;
const crFiltered = () => D.cr.items.filter((c) => S.brands.has(c.brand) && (!S.platform || platOf(c.media) === S.platform));
const seenIn = (c, r) => c.seenDates.some((d) => inR(d, r));
const activeAt = (c, d) => c.seenDates.some((x) => x <= d && x >= addDays(d, -6)); // 최근 7일 내 확인
function tsSum(r, brand, keys) {
  let n = 0;
  for (const [d, v] of Object.entries(D.ts.days)) if (inR(d, r) && v[brand]) for (const k of keys) n += v[brand][k] || 0;
  return n;
}
const MKEYS = Object.keys(SRC);
const delta = (a, b) => { const d = a - b; return d === 0 ? '<span class="note">변화 없음</span>' : `<span class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'}${Math.abs(d)}</span>`; };
const mediaTag = (m) => `<span class="tag p-${esc(platOf(m))}">${esc(platOf(m))} · ${esc(D.cfg.media[m]?.label || m)}</span>`;
const sentTag = (s) => `<span class="tag ${SENT[s]?.[1] || ''}">${SENT[s]?.[0] || '미분류'}</span>`;
function topN(arr, n = 3) { const m = {}; arr.filter(Boolean).forEach((x) => (m[x] = (m[x] || 0) + 1)); return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n); }

/* ---------- 개요 ---------- */
async function renderOverview() {
  const r = range(S.gran, S.ref), pr = range(S.gran, prevRef(S.gran, S.ref));
  const cr = crFiltered();
  const newNow = cr.filter((c) => inR(c.firstSeen, r)).length, newPrev = cr.filter((c) => inR(c.firstSeen, pr)).length;
  const seenNow = cr.filter((c) => seenIn(c, r)).length;
  let mNow = 0, mPrev = 0, neg = 0, pos = 0;
  for (const b of S.brands) { mNow += tsSum(r, b, MKEYS); mPrev += tsSum(pr, b, MKEYS); neg += tsSum(r, b, ['sent_negative']); pos += tsSum(r, b, ['sent_positive']); }
  const mediaIds = Object.keys(D.cfg.media).filter((m) => !S.platform || platOf(m) === S.platform);

  const kpis = `<div class="kpis">
    <div class="card kpi"><div class="l">기간 내 확인된 광고 소재</div><div class="v">${seenNow}</div><div class="d">누적 ${cr.length}건</div></div>
    <div class="card kpi"><div class="l">신규 소재</div><div class="v">${newNow}</div><div class="d">${GLabel[S.gran]} 대비 ${delta(newNow, newPrev)}</div></div>
    <div class="card kpi"><div class="l">SNS·웹 언급량</div><div class="v">${fmt(mNow)}</div><div class="d">${GLabel[S.gran]} 대비 ${delta(mNow, mPrev)}</div></div>
    <div class="card kpi"><div class="l">긍정 / 부정 언급</div><div class="v"><span class="up">${pos}</span> / <span class="down">${neg}</span></div><div class="d">키워드 기반 추정</div></div>
  </div>`;

  const matrix = `<h2>경쟁사별 확인된 광고 매체 <small>${r[1]}까지 누적 · 진한 칸은 선택 기간(${rangeText(r)})에 확인</small></h2>
  <div class="scroll card" style="padding:0"><table class="matrix"><thead><tr><th>경쟁사</th>${mediaIds.map((m) => `<th>${pfBadge(D.cfg.media[m].platform)}${esc(D.cfg.media[m].label)}</th>`).join('')}</tr></thead><tbody>
  ${[...S.brands].map((b) => `<tr><td>${esc(D.brandName[b])}</td>${mediaIds.map((m) => {
    const list = D.cr.items.filter((c) => c.brand === b && c.media === m && c.firstSeen <= r[1]);
    if (!list.length) return '<td><span class="no">미확인</span></td>';
    const last = list.map((c) => c.lastSeen).sort().at(-1);
    const hot = list.some((c) => seenIn(c, r));
    return `<td><span class="ok" style="${hot ? 'font-weight:700' : 'opacity:.75'}">확인 ${list.length}</span><div class="note">최근 ${last.slice(5)}</div></td>`;
  }).join('')}</tr>`).join('')}</tbody></table></div>`;

  const cards = [...S.brands].map((b) => {
    const list = cr.filter((c) => c.brand === b);
    const ref = S.ref;
    const actT = list.filter((c) => activeAt(c, ref)).length, actY = list.filter((c) => activeAt(c, addDays(ref, -1))).length, actW = list.filter((c) => activeAt(c, addDays(ref, -7))).length;
    const mD = tsSum([ref, ref], b, MKEYS), mY = tsSum([addDays(ref, -1), addDays(ref, -1)], b, MKEYS);
    const mW = tsSum([addDays(ref, -6), ref], b, MKEYS), mPW = tsSum([addDays(ref, -13), addDays(ref, -7)], b, MKEYS);
    const medias = [...new Set(list.map((c) => c.media))];
    const main = topN(list.map((c) => c.media), 1)[0];
    const fmtMain = topN(list.map((c) => c.format), 1)[0];
    const products = topN(list.flatMap((c) => String(c.product || '').split(/,\s*/)), 3).map((x) => x[0]);
    const promos = topN(list.flatMap((c) => String(c.promo || '').split(/,\s*/)), 3).map((x) => x[0]);
    const note = D.notes.items.find((n) => n.brand === b);
    const first = list.map((c) => c.firstSeen).sort()[0], last = list.map((c) => c.lastSeen).sort().at(-1);
    return `<div class="card brandcard" style="--bc:${COLORS[D.brands.indexOf(b) % 8]}"><h3><span><span class="dot"></span>${esc(D.brandName[b])}</span><span class="tag">${list.length ? `소재 ${list.length}` : '광고 미확인'}</span></h3><dl>
      <dt>확인 매체</dt><dd>${medias.length ? medias.map(mediaTag).join('') : '<span class="no">미확인</span>'}</dd>
      <dt>주력 광고 유형</dt><dd>${main ? `${esc(D.cfg.media[main[0]]?.label)} (${main[1]}건) · ${esc({ image: '이미지', video: '동영상', text: '텍스트' }[fmtMain[0]] || fmtMain[0])}` : '<span class="no">미확인</span>'}<div class="note">확인된 소재 기준</div></dd>
      <dt>최초 / 최근</dt><dd>${first ? `${first} / ${last}` : '<span class="no">미확인</span>'}</dd>
      <dt>광고 운영 변화</dt><dd>최근 7일 내 확인 ${actT}건 · 전일 ${delta(actT, actY)} · 전주 ${delta(actT, actW)}</dd>
      <dt>언급량</dt><dd>${ref.slice(5)} ${mD}건 (전일 ${delta(mD, mY)}) · 최근 7일 ${mW}건 (전주 ${delta(mW, mPW)})</dd>
      <dt>주요 상품</dt><dd>${products.length ? products.map((p) => `<span class="tag">${esc(p)}</span>`).join('') : '<span class="no">미확인</span>'}</dd>
      <dt>프로모션</dt><dd>${promos.length ? promos.map((p) => `<span class="tag warn">${esc(p)}</span>`).join('') : '<span class="no">미확인</span>'}</dd>
      <dt>특이사항</dt><dd>${note ? `${esc(note.text)} <a href="${esc(safeUrl(note.sourceUrl))}" target="_blank" rel="noopener">출처</a> <span class="note">${note.confirmedDate}</span>` : '<span class="no">등록된 특이사항 없음</span>'}</dd>
    </dl></div>`;
  }).join('');

  $('#tab-overview').innerHTML = `${kpis}${matrix}<h2>경쟁사별 요약 <small>기준일 ${S.ref} · 전일/전주 비교</small></h2><div class="grid">${cards}</div>`;
}

/* ---------- 광고 소재 ---------- */
function crCard(c, r) {
  const isNew = inR(c.firstSeen, r);
  const img = c.image || c.thumbnail;
  const thumb = img ? `<img src="${esc(safeUrl(img))}" alt="${esc(c.copy)}" loading="lazy" data-zoom="${esc(safeUrl(img))}" data-cap="${esc(D.brandName[c.brand] + ' · ' + c.copy)}">`
    : c.videoUrl ? `<a href="${esc(safeUrl(c.videoUrl))}" target="_blank" rel="noopener">▶ 광고 영상 보기</a>`
    : `소재 이미지 미저장<br><a href="${esc(safeUrl(c.sourceUrls[0]))}" target="_blank" rel="noopener">원본에서 보기</a>`;
  return `<div class="card cr">
    <div class="thumb">${thumb}</div>
    <div><span class="tag ${isNew ? 'new' : ''}">${isNew ? '신규' : '기존'}</span>${mediaTag(c.media)}<span class="tag">${esc({ image: '이미지', video: '동영상', text: '텍스트' }[c.format] || c.format)}</span>${c.status === 'active' ? '<span class="tag pos">활성 확인</span>' : ''}</div>
    <div class="note"><b>${esc(D.brandName[c.brand])}</b></div>
    <div class="copy">${esc(c.copy || '(카피 없음)')}</div>
    ${c.hook && c.hook !== c.copy ? `<div class="note">후킹: “${esc(c.hook)}”</div>` : ''}
    ${c.subCopy ? `<div class="note">${esc(c.subCopy)}</div>` : ''}
    <div class="meta">상품: ${esc(c.product || '미확인')} · 프로모션: ${esc(c.promo || '미확인')}</div>
    <div class="meta">최초 확인 ${c.firstSeen} · 최근 확인 ${c.lastSeen}${c.deliveryStart ? ` · 게재 시작 ${c.deliveryStart}` : ''}${c.duplicates ? ` · 중복 ${c.duplicates}건 병합` : ''}</div>
    <div class="meta">확인 방법: ${esc(c.verifiedBy.join(', '))}</div>
    ${c.note ? `<div class="meta">${esc(c.note)}</div>` : ''}
    <div class="meta">출처: ${c.sourceUrls.map((u, i) => `<a href="${esc(safeUrl(u))}" target="_blank" rel="noopener">링크${c.sourceUrls.length > 1 ? i + 1 : ''}</a>`).join(' ')}${c.landingUrl ? ` · <a href="${esc(safeUrl(c.landingUrl))}" target="_blank" rel="noopener">랜딩</a>` : ''}</div>
  </div>`;
}
function renderCreatives() {
  const r = range(S.gran, S.ref);
  const all = $('#crAll')?.checked ?? false;
  const list = crFiltered().filter((c) => all || seenIn(c, r));
  $('#tab-creatives').innerHTML = `<h2>광고 소재 <small>${all ? '전체 누적' : rangeText(r) + ' 확인분'} · ${list.length}건 · 신규 = 선택 기간에 처음 확인</small></h2>
    <label class="note crAll"><input type="checkbox" id="crAll" ${all ? 'checked' : ''}> 기간과 관계없이 전체 누적 보기</label>
    <div class="grid" style="margin-top:10px">${list.map((c) => crCard(c, r)).join('') || `<div class="empty">선택한 조건에 확인된 광고 소재가 없습니다(미확인). 수동 등록 탭에서 추가하거나 '전체 누적 보기'를 켜 보세요.</div>`}</div>`;
  $('#crAll').onchange = renderCreatives;
}

/* ---------- SNS·고객 반응 ---------- */
function trendSvg(gran, ref) {
  const buckets = [];
  let cur = ref;
  for (let i = 0; i < 14; i++) { buckets.unshift(range(gran, cur)); cur = prevRef(gran, cur); }
  const brands = [...S.brands];
  const series = brands.map((b) => buckets.map((r) => tsSum(r, b, MKEYS)));
  const max = Math.max(1, ...series.flat());
  const W = 760, H = 160, pl = 30, pb = 20, pt = 8;
  const x = (i) => pl + (i * (W - pl - 10)) / (buckets.length - 1), y = (v) => pt + (H - pt - pb) * (1 - v / max);
  const lines = series.map((s, k) => `<polyline fill="none" stroke="${COLORS[D.brands.indexOf(brands[k]) % 8]}" stroke-width="2" points="${s.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"><title>${esc(D.brandName[brands[k]])}</title></polyline>`).join('');
  const labels = buckets.map((r, i) => (i % 2 === 0 || i === buckets.length - 1 ? `<text x="${x(i)}" y="${H - 4}" font-size="10" text-anchor="middle" fill="currentColor" opacity=".6">${gran === 'month' ? r[0].slice(2, 7) : r[0].slice(5)}</text>` : '')).join('');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="언급량 추이">
    <line x1="${pl}" x2="${W - 10}" y1="${y(0)}" y2="${y(0)}" stroke="currentColor" opacity=".15"/><text x="2" y="${pt + 8}" font-size="10" fill="currentColor" opacity=".6">${max}</text>${lines}${labels}</svg>
    <div class="legend">${brands.map((b) => `<span><i style="background:${COLORS[D.brands.indexOf(b) % 8]}"></i>${esc(D.brandName[b])}</span>`).join('')}</div>`;
}
async function renderSocial() {
  const r = range(S.gran, S.ref), pr = range(S.gran, prevRef(S.gran, S.ref));
  const rows = [...S.brands].map((b) => {
    const by = MKEYS.map((k) => tsSum(r, b, [k]));
    const tot = by.reduce((a, c) => a + c, 0), prev = tsSum(pr, b, MKEYS);
    const p = tsSum(r, b, ['sent_positive']), n = tsSum(r, b, ['sent_negative']), u = tsSum(r, b, ['sent_neutral']);
    return { b, by, tot, prev, p, n, u };
  });
  const maxTot = Math.max(1, ...rows.map((x) => x.tot));
  const bars = rows.map((x) => `<div class="bar"><span>${esc(D.brandName[x.b])}</span><div class="track" title="긍정 ${x.p} · 부정 ${x.n} · 중립 ${x.u}">
    <span class="s-pos" style="width:${(x.p / maxTot) * 100}%"></span><span class="s-neg" style="width:${(x.n / maxTot) * 100}%"></span><span class="s-neu" style="width:${(x.u / maxTot) * 100}%"></span></div><span class="num">${x.tot}</span></div>`).join('');
  const table = `<div class="scroll"><table><thead><tr><th>경쟁사</th>${MKEYS.map((k) => `<th>${SRC[k]}</th>`).join('')}<th>합계</th><th>${GLabel[S.gran]} 합계</th><th>변화</th><th>긍정</th><th>부정</th></tr></thead><tbody>
    ${rows.map((x) => `<tr><td>${esc(D.brandName[x.b])}</td>${x.by.map((v) => `<td class="num">${v}</td>`).join('')}<td class="num"><b>${x.tot}</b></td><td class="num">${x.prev}</td><td class="num">${delta(x.tot, x.prev)}</td><td class="num up">${x.p}</td><td class="num down">${x.n}</td></tr>`).join('')}</tbody></table></div>`;

  const off = Object.values(D.off.items).filter((o) => S.brands.has(o.brand) && (!S.platform || (S.platform === '구글' ? o.platform === 'youtube' : S.platform === '메타' ? o.platform === 'instagram' : false)))
    .sort((a, b) => (b.published || '').localeCompare(a.published || '')).slice(0, 40);
  const offTable = off.length ? `<div class="scroll"><table><thead><tr><th>게시일</th><th>경쟁사</th><th>채널</th><th>콘텐츠</th><th>조회</th><th>좋아요</th><th>댓글</th><th>댓글 반응(최근 50개)</th></tr></thead><tbody>
    ${off.map((o) => { const cs = o.commentSentiment; return `<tr><td>${o.published}${inR(o.firstSeen, r) ? ' <span class="tag new">신규</span>' : ''}</td><td>${esc(D.brandName[o.brand])}</td><td>${o.platform === 'youtube' ? '유튜브' : '인스타그램'}</td>
      <td><a href="${esc(safeUrl(o.url))}" target="_blank" rel="noopener">${esc(o.title || '(제목 없음)')}</a></td><td class="num">${fmt(o.metrics?.views)}</td><td class="num">${fmt(o.metrics?.likes)}</td><td class="num">${fmt(o.metrics?.comments)}</td>
      <td>${cs ? `<span class="tag pos">긍정 ${cs.positive}</span><span class="tag neg">부정 ${cs.negative}</span><span class="tag">중립 ${cs.neutral}</span>` : '<span class="no">–</span>'}</td></tr>`; }).join('')}</tbody></table></div>`
    : `<div class="empty">공식 유튜브·인스타그램 계정이 아직 설정되지 않았거나 수집된 콘텐츠가 없습니다(미확인). 수집 현황 탭에서 설정 상태를 확인하세요.</div>`;

  const ms = (await mentions(r)).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const recent = ms.slice(0, 150);
  const mlist = recent.length ? `<div class="scroll"><table><thead><tr><th>날짜</th><th>경쟁사</th><th>출처</th><th>반응</th><th>내용</th></tr></thead><tbody>
    ${recent.map((m) => `<tr><td>${m.date}${m.published ? '' : '<div class="note">수집일</div>'}</td><td>${esc(D.brandName[m.brand])}</td><td>${SRC[m.source] || m.source}</td><td>${sentTag(m.sentiment)}</td>
      <td><a href="${esc(safeUrl(m.url))}" target="_blank" rel="noopener">${esc(m.title)}</a><div class="note">${esc(m.desc)}</div></td></tr>`).join('')}</tbody></table></div>${ms.length > 150 ? `<p class="note">최근 150건만 표시 (전체 ${ms.length}건)</p>` : ''}`
    : '<div class="empty">선택 기간에 수집된 언급이 없습니다.</div>';

  $('#tab-social').innerHTML = `<h2>언급량 <small>${rangeText(r)} · 네이버 뉴스·블로그·카페 + 유튜브 영상</small></h2>
    <div class="card"><div class="legend"><span><i class="s-pos"></i>긍정</span><span><i class="s-neg"></i>부정</span><span><i class="s-neu"></i>중립</span></div><div class="bars">${bars}</div></div>
    <div style="margin-top:10px">${table}</div>
    <h2>언급량 추이 <small>${S.gran === 'day' ? '최근 14일' : S.gran === 'week' ? '최근 14주' : '최근 14개월'}</small></h2><div class="card">${trendSvg(S.gran, S.ref)}</div>
    <h2>공식 채널 콘텐츠·반응</h2>${offTable}
    <h2>주요 언급 <small>긍정/부정은 키워드 기반 추정</small></h2>${mlist}`;
}

/* ---------- 이슈·특이사항 ---------- */
async function renderIssues() {
  const r = range(S.gran, S.ref);
  const ms = await mentions(r);
  const risk = ms.filter((m) => m.issue?.length), mk = ms.filter((m) => m.marketing?.length || m.promo?.length);
  const notes = D.notes.items.filter((n) => S.brands.has(n.brand));
  const row = (m, tags) => `<tr><td>${m.date}</td><td>${esc(D.brandName[m.brand])}</td><td>${SRC[m.source] || m.source}</td><td>${tags.map((t) => `<span class="tag ${t[1]}">${esc(t[0])}</span>`).join('')}</td><td><a href="${esc(safeUrl(m.url))}" target="_blank" rel="noopener">${esc(m.title)}</a></td></tr>`;
  const tbl = (arr, fn) => (arr.length ? `<div class="scroll"><table><thead><tr><th>날짜</th><th>경쟁사</th><th>출처</th><th>키워드</th><th>제목</th></tr></thead><tbody>${arr.map(fn).join('')}</tbody></table></div>` : '<div class="empty">해당 기간에 감지된 항목이 없습니다.</div>');
  $('#tab-issues').innerHTML = `<h2>경쟁사별 주요 마케팅 특이사항 <small>직접 확인 후 등록한 내용</small></h2>
    ${notes.length ? `<div class="scroll"><table><thead><tr><th>확인일</th><th>경쟁사</th><th>내용</th><th>출처</th></tr></thead><tbody>${notes.map((n) => `<tr><td>${n.confirmedDate}</td><td>${esc(D.brandName[n.brand])}</td><td>${esc(n.text)}</td><td><a href="${esc(safeUrl(n.sourceUrl))}" target="_blank" rel="noopener">출처</a></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">등록된 특이사항이 없습니다. 수동 등록 탭에서 ‘특이사항’으로 추가할 수 있습니다.</div>'}
    <h2>브랜드 이슈 감지 <small>${rangeText(r)} · 리콜·이물질·적발 등 위험 키워드</small></h2>${tbl(risk, (m) => row(m, m.issue.map((t) => [t, 'neg'])))}
    <h2>마케팅·프로모션 언급 <small>신제품·출시·협업·할인 등 키워드</small></h2>${tbl(mk, (m) => row(m, [...(m.marketing || []).map((t) => [t, '']), ...(m.promo || []).map((t) => [t, 'warn'])]))}`;
}

/* ---------- 수집 현황 ---------- */
function renderStatus() {
  const last = D.runs[0];
  const cols = [...new Set((last?.results || []).map((x) => x.collector))];
  const cell = (rr) => (!rr ? '<span class="no">–</span>' : `<span class="tag ${rr.status === 'ok' ? 'pos' : rr.status === 'error' ? 'neg' : ''}" title="${esc(rr.message)}">${rr.status === 'ok' ? `정상 ${rr.count}` : rr.status === 'error' ? '오류' : '미설정'}</span>`);
  const errs = D.runs.flatMap((run) => run.results.filter((x) => x.status === 'error').map((x) => ({ ...x, runAt: run.runAt }))).slice(0, 60);
  $('#tab-status').innerHTML = `<h2>매체별 자동 수집 가능 범위 <small>검증일 ${esc(D.cov.verifiedAt)}</small></h2>
    <p class="note">${esc(D.cov.summary)}</p>
    <div class="scroll"><table class="wide"><thead><tr><th>매체</th><th>대상</th><th>방식</th><th>필요 설정</th><th>근거</th></tr></thead><tbody>
    ${D.cov.items.map((c) => `<tr><td>${pfBadge(c.platform)}</td><td>${esc(c.target)}</td><td>${c.mode === 'auto' ? '<span class="tag pos">자동</span>' : c.mode === 'auto-optional' ? '<span class="tag warn">자동(설정 시)</span>' : '<span class="tag">수동 등록</span>'}<div class="note">${esc(c.method)}</div></td><td class="note">${esc(c.needs)}</td><td class="note">${esc(c.evidence)}</td></tr>`).join('')}</tbody></table></div>
    <h2>최근 실행 결과 <small>${last ? `${esc(last.runAt.slice(0, 16).replace('T', ' '))} · ${esc(last.trigger)} · 정상 ${last.summary.ok} / 미설정 ${last.summary.skipped} / 오류 ${last.summary.error}` : '실행 기록 없음'}</small></h2>
    ${last ? `<div class="scroll"><table><thead><tr><th>경쟁사</th>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${D.brands.map((b) => `<tr><td>${esc(D.brandName[b])}</td>${cols.map((c) => `<td class="c">${cell(last.results.find((x) => x.brand === b && x.collector === c))}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="note">칸에 마우스를 올리면 상세 메시지가 보입니다.</p>` : '<div class="empty">아직 자동 수집이 실행되지 않았습니다.</div>'}
    <h2>오류 기록 <small>최근 ${errs.length}건</small></h2>
    ${errs.length ? `<div class="scroll"><table><thead><tr><th>실행 시각</th><th>수집기</th><th>경쟁사</th><th>메시지</th></tr></thead><tbody>${errs.map((e) => `<tr><td>${esc(e.runAt.slice(0, 16).replace('T', ' '))}</td><td>${esc(e.collector)}</td><td>${esc(D.brandName[e.brand] || e.brand)}</td><td class="note">${esc(e.message)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">기록된 오류가 없습니다.</div>'}
    <h2>수동 등록 파일 검사</h2>
    ${(D.site.buildErrors || []).length ? `<div class="scroll"><table><thead><tr><th>파일</th><th>문제</th></tr></thead><tbody>${D.site.buildErrors.map((e) => `<tr><td>${esc(e.file)}</td><td class="down">${esc(e.message)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">문제 없음</div>'}
    <h2>실행 이력</h2><div class="scroll"><table><thead><tr><th>시각</th><th>방식</th><th>소요</th><th>정상</th><th>미설정</th><th>오류</th></tr></thead><tbody>
    ${D.runs.slice(0, 30).map((x) => `<tr><td>${esc(x.runAt.slice(0, 16).replace('T', ' '))}</td><td>${esc(x.trigger)}</td><td class="num">${Math.round(x.durationMs / 1000)}초</td><td class="num">${x.summary.ok}</td><td class="num">${x.summary.skipped}</td><td class="num">${x.summary.error}</td></tr>`).join('')}</tbody></table></div>`;
}

/* ---------- 수동 등록 ---------- */
function repoInfo() {
  if (D.site.repo) return { repo: D.site.repo, branch: D.site.branch || 'main' };
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  const seg = location.pathname.split('/').filter(Boolean)[0];
  return m && seg ? { repo: `${m[1]}/${seg}`, branch: 'main' } : null;
}
function renderManual() {
  const media = Object.entries(D.cfg.media).map(([k, v]) => `<option value="${k}">${esc(v.platform)} · ${esc(v.label)}</option>`).join('');
  const brands = D.cfg.brands.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
  const ri = repoInfo();
  $('#tab-manual').innerHTML = `<h2>수동 등록 <small>자동 수집이 제한된 광고 소재·특이사항을 직접 확인한 뒤 등록</small></h2>
  <div class="card"><p class="note">직접 확인한 광고만 등록하세요. 출처 URL(광고 라이브러리·투명성 센터 링크 또는 확인한 화면 주소)은 필수입니다. 이미지는 저작권·재게시 권한을 확인한 경우에만 올리고, 권한이 불확실하면 이미지 없이 출처 링크만 남기세요. GitHub Pages 주소는 누구나 볼 수 있습니다.</p>
  <form class="form" id="mf">
    <label>종류<select name="type"><option value="creative">광고 소재</option><option value="note">마케팅 특이사항</option></select></label>
    <label>경쟁사 *<select name="brand" required>${brands}</select></label>
    <label class="cr-only">매체 *<select name="media">${media}</select></label>
    <label class="cr-only">소재 형식<select name="format"><option value="image">이미지</option><option value="video">동영상</option><option value="text">텍스트</option></select></label>
    <label>확인일 *<input type="date" name="confirmedDate" required value="${kstToday()}"></label>
    <label class="cr-only">게재 시작일(확인 가능 시)<input type="date" name="deliveryStart"></label>
    <label class="cr-only">상태<select name="status"><option value="active">활성 확인</option><option value="unknown">미확인</option><option value="ended">종료 확인</option></select></label>
    <label class="full">출처 URL *<input type="url" name="sourceUrl" required placeholder="https://www.facebook.com/ads/library/?id=…"></label>
    <label class="full cr-only">메인 카피 *<input name="copy" placeholder="광고 제목/메인 문구 그대로"></label>
    <label class="full cr-only">서브 카피<input name="subCopy"></label>
    <label class="cr-only">후킹 문구(비우면 자동 추출)<input name="hook"></label>
    <label class="cr-only">홍보 상품(비우면 자동 추출)<input name="product" placeholder="어묵탕, 선물세트"></label>
    <label class="cr-only">할인·프로모션(비우면 자동 추출)<input name="promo" placeholder="30% 할인, 무료배송"></label>
    <label class="cr-only">랜딩 URL<input type="url" name="landingUrl"></label>
    <label class="cr-only">이미지 파일명(업로드한 경우)<input name="image" placeholder="images/2026-11-25_goraesa_gfa.jpg"></label>
    <label class="cr-only">이미지 URL(공식 출처)<input type="url" name="imageUrl"></label>
    <label class="cr-only">영상 URL<input type="url" name="videoUrl"></label>
    <label class="full"><span class="note-only">특이사항 내용 / 메모</span><textarea name="text" rows="2"></textarea></label>
    <div class="full" style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn" type="submit">${ri ? 'GitHub에 등록하기' : 'JSON 만들기'}</button>
      ${ri ? `<a class="btn ghost" href="https://github.com/${esc(ri.repo)}/upload/${esc(ri.branch)}/data/manual/images" target="_blank" rel="noopener">이미지 먼저 올리기</a>` : ''}
      <button class="btn ghost" type="button" id="copyJson">JSON 복사</button>
    </div>
  </form>
  <p class="note">‘GitHub에 등록하기’를 누르면 GitHub 새 파일 화면이 내용이 채워진 채로 열립니다. <b>Commit changes</b>를 누르면 1~2분 뒤 이 화면에 반영됩니다. 같은 브랜드·매체·카피·이미지는 자동으로 하나로 합쳐지고 확인일이 누적됩니다.</p>
  <pre id="jsonOut"></pre></div>`;
  const f = $('#mf');
  const sync = () => { const note = f.type.value === 'note'; f.querySelectorAll('.cr-only').forEach((el) => (el.style.display = note ? 'none' : '')); };
  f.type.onchange = sync; sync();
  const build = () => {
    const fd = Object.fromEntries(new FormData(f).entries());
    const o = {};
    if (fd.type === 'note') Object.assign(o, { type: 'note', brand: fd.brand, confirmedDate: fd.confirmedDate, sourceUrl: fd.sourceUrl, text: fd.text });
    else for (const k of ['brand', 'media', 'format', 'copy', 'subCopy', 'hook', 'product', 'promo', 'status', 'deliveryStart', 'confirmedDate', 'sourceUrl', 'landingUrl', 'image', 'imageUrl', 'videoUrl']) if (fd[k]) o[k] = fd[k];
    if (fd.type !== 'note') { o.verifiedBy = '수동 등록'; if (fd.text) o.note = fd.text; }
    const name = `data/manual/${fd.confirmedDate}_${fd.brand}_${fd.type === 'note' ? 'note' : fd.media}_${Math.random().toString(36).slice(2, 7)}.json`;
    const json = JSON.stringify(o, null, 1);
    $('#jsonOut').textContent = `// ${name}\n${json}`;
    return { name, json };
  };
  f.onsubmit = (e) => {
    e.preventDefault();
    if (f.type.value !== 'note' && !f.copy.value.trim()) { alert('메인 카피를 입력하세요.'); return; }
    const { name, json } = build();
    if (ri) window.open(`https://github.com/${ri.repo}/new/${ri.branch}?filename=${encodeURIComponent(name)}&value=${encodeURIComponent(json)}`, '_blank', 'noopener');
  };
  $('#copyJson').onclick = async () => { const { json } = build(); try { await navigator.clipboard.writeText(json); } catch {} };
}

/* ---------- 필터·탭 ---------- */
let current = 'overview';
const renderers = { overview: renderOverview, creatives: renderCreatives, social: renderSocial, issues: renderIssues, status: renderStatus, manual: renderManual };
async function render() {
  $('#rangeLabel').textContent = rangeText(range(S.gran, S.ref));
  $('#filters').style.display = ['status', 'manual'].includes(current) ? 'none' : '';
  await renderers[current]();
  alignHeads($(`#tab-${current}`));
}
// 모든 표: 칸 제목 정렬을 그 칸 내용 정렬(숫자=오른쪽, 배지=가운데, 글자=왼쪽)과 똑같이 맞춤
function alignHeads(root) {
  root.querySelectorAll('table').forEach((t) => {
    const row = t.tBodies[0]?.rows[0];
    if (!row || !t.tHead) return;
    [...t.tHead.rows[0].cells].forEach((th, i) => {
      const td = row.cells[i];
      if (td?.classList.contains('num')) th.classList.add('num');
      else if (td?.classList.contains('c')) th.classList.add('c');
    });
  });
}
const pfBadge = (p) => `<span class="pf pf-${esc(p)}">${esc(p)}</span>`;
function initUI() {
  $('#refDate').value = S.ref;
  document.querySelectorAll('#gran button').forEach((b) => b.classList.toggle('on', b.dataset.g === S.gran));
  $('#gran').onclick = (e) => { const g = e.target.dataset.g; if (!g) return; S.gran = g; document.querySelectorAll('#gran button').forEach((b) => b.classList.toggle('on', b === e.target)); try { localStorage.setItem('fcm-ui', JSON.stringify({ gran: g })); } catch {} render(); };
  $('#refDate').onchange = (e) => { if (e.target.value) { S.ref = e.target.value; render(); } };
  $('#platformSel').onchange = (e) => { S.platform = e.target.value; render(); };
  $('#brandChips').innerHTML = `<button class="chip on" data-b="*">전체</button>` + D.cfg.brands.map((b) => `<button class="chip on" data-b="${b.id}">${esc(b.name)}</button>`).join('');
  $('#brandChips').onclick = (e) => {
    const id = e.target.dataset.b; if (!id) return;
    if (id === '*') S.brands = new Set(S.brands.size === D.brands.length ? [] : D.brands);
    else S.brands.has(id) ? S.brands.delete(id) : S.brands.add(id);
    document.querySelectorAll('#brandChips .chip').forEach((c) => c.classList.toggle('on', c.dataset.b === '*' ? S.brands.size === D.brands.length : S.brands.has(c.dataset.b)));
    render();
  };
  $('#tabs').onclick = (e) => {
    const t = e.target.dataset.tab; if (!t) return; current = t;
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b === e.target));
    document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('on', s.id === `tab-${t}`));
    render();
  };
  const lb = $('#lightbox');
  document.addEventListener('click', (e) => {
    const z = e.target.dataset?.zoom;
    if (z) { lb.querySelector('img').src = z; lb.querySelector('p').textContent = e.target.dataset.cap || ''; lb.hidden = false; }
    else if (e.target === lb || e.target.matches('.lightbox button')) lb.hidden = true;
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') lb.hidden = true; });
}

load().then(() => { initUI(); render(); });
