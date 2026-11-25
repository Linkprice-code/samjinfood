// 매일 자동 수집: 네이버 검색 API(뉴스·블로그·카페), YouTube Data API, Instagram Graph API(설정 시)
// 공식 API만 사용합니다. 검색 결과 화면·광고 라이브러리 화면을 긁어오지 않습니다.
import path from 'node:path';
import {
  DATA, ROOT, kstDate, kstIso, readJson, writeJson, sha1, stripTags, matchesBrand,
  sentiment, issueHits, marketingHits, promoHits, productHits, fetchJson,
} from './lib.mjs';

const cfg = readJson(path.join(ROOT, 'config/brands.json'));
const TODAY = process.env.RUN_DATE || kstDate();
const started = Date.now();
const results = [];
const log = (collector, brand, status, count = 0, message = '') => {
  results.push({ collector, brand, status, count, message: String(message).slice(0, 400) });
  console.log(`[${status}] ${collector} ${brand} ${count} ${message}`);
};

const seenFile = path.join(DATA, 'state/seen.json');
const seen = readJson(seenFile, {});
const tsFile = path.join(DATA, 'timeseries.json');
const ts = readJson(tsFile, { days: {} });
const officialFile = path.join(DATA, 'official.json');
const official = readJson(officialFile, { items: {} });
const firstRunForSource = (src, brand) => !Object.values(seen).some((v) => v.s === src && v.b === brand);

const monthFiles = {};
const monthOf = (d) => d.slice(0, 7);
function addMention(item) {
  const m = monthOf(item.date);
  const f = path.join(DATA, 'mentions', `${m}.json`);
  monthFiles[m] ||= readJson(f, { items: [] });
  monthFiles[m].items.push(item);
}
function bump(date, brand, key, n = 1) {
  const day = (ts.days[date] ||= {});
  const b = (day[brand] ||= {});
  b[key] = (b[key] || 0) + n;
}
function setVal(date, brand, key, v) {
  const day = (ts.days[date] ||= {});
  (day[brand] ||= {})[key] = v;
}

function recordItem(brand, src, raw) {
  const id = sha1(`${brand.id}|${raw.url}`); // 같은 글이 여러 브랜드를 언급하면 브랜드별로 각각 집계
  if (seen[id]) return false;
  const text = `${raw.title} ${raw.desc}`;
  const baseline = raw.baseline;
  const date = raw.published || TODAY;
  seen[id] = { d: TODAY, s: src, b: brand.id };
  const sent = sentiment(text);
  addMention({
    id, brand: brand.id, source: src, title: raw.title, desc: raw.desc.slice(0, 200), url: raw.url,
    published: raw.published || null, firstSeen: TODAY, date, baseline: !!baseline, sentiment: sent,
    issue: issueHits(text), marketing: marketingHits(text), promo: promoHits(text), products: productHits(text),
    extra: raw.extra || undefined,
  });
  // 최초 수집(기준선) 시 과거 글은 '일별 신규 언급'에 넣지 않고, 게시일이 있는 글만 해당 날짜로 반영
  if (!baseline || raw.published) {
    bump(date, brand.id, src);
    bump(date, brand.id, `sent_${sent}`);
  }
  return true;
}

/* ---------------- 네이버 검색 API ---------------- */
function naverDate(it, type) {
  if (type === 'blog' && it.postdate) return `${it.postdate.slice(0, 4)}-${it.postdate.slice(4, 6)}-${it.postdate.slice(6, 8)}`;
  if (type === 'news' && it.pubDate) return kstDate(new Date(it.pubDate));
  return null; // 카페 글은 API가 게시일을 주지 않음 → 최초 수집일 기준
}
async function collectNaver() {
  const id = process.env.NAVER_CLIENT_ID, secret = process.env.NAVER_CLIENT_SECRET;
  const types = { news: 'naver_news', blog: 'naver_blog', cafearticle: 'naver_cafe' };
  for (const brand of cfg.brands) {
    for (const [type, src] of Object.entries(types)) {
      if (!id || !secret) { log(src, brand.id, 'skipped', 0, 'NAVER_CLIENT_ID/SECRET 미설정'); continue; }
      try {
        // 네이버 클라우드 NAVER API HUB(2026년 신규 발급 방식). 응답 형식은 기존 검색 API와 같음
        const url = `https://naverapihub.apigw.ntruss.com/search/v1/${type}?query=${encodeURIComponent(brand.query)}&display=100&sort=date&format=json`;
        const j = await fetchJson(url, { headers: { 'X-NCP-APIGW-API-KEY-ID': id, 'X-NCP-APIGW-API-KEY': secret } });
        const baseline = firstRunForSource(src, brand.id);
        let added = 0, matched = 0;
        for (const it of j.items || []) {
          const title = stripTags(it.title), desc = stripTags(it.description);
          if (!matchesBrand(brand, `${title} ${desc}`, cfg.category)) continue;
          matched++;
          const ok = recordItem(brand, src, {
            title, desc, url: it.originallink || it.link, published: naverDate(it, type), baseline,
            extra: type === 'cafearticle' ? { cafe: it.cafename } : type === 'blog' ? { blog: it.bloggername } : undefined,
          });
          if (ok) added++;
        }
        setVal(TODAY, brand.id, `${src}_total`, j.total ?? null);
        log(src, brand.id, 'ok', added, `최근 ${j.items?.length || 0}건 중 카테고리 일치 ${matched}건${baseline ? ' (최초 기준선)' : ''}`);
      } catch (e) { log(src, brand.id, 'error', 0, e.message); }
    }
  }
}

/* ---------------- YouTube Data API ---------------- */
async function collectYouTube() {
  const key = process.env.YOUTUBE_API_KEY;
  const api = (p, q) => fetchJson(`https://www.googleapis.com/youtube/v3/${p}?${new URLSearchParams({ ...q, key })}`);
  const after = new Date(Date.now() - 3 * 86400e3).toISOString();
  for (const brand of cfg.brands) {
    if (!key) { log('youtube', brand.id, 'skipped', 0, 'YOUTUBE_API_KEY 미설정'); continue; }
    // 1) 브랜드 언급 영상(최근 3일)
    try {
      const j = await api('search', { part: 'snippet', q: brand.query, type: 'video', order: 'date', maxResults: '25', regionCode: 'KR', relevanceLanguage: 'ko', publishedAfter: after });
      const baseline = firstRunForSource('youtube', brand.id);
      let added = 0;
      for (const it of j.items || []) {
        const title = stripTags(it.snippet.title), desc = stripTags(it.snippet.description);
        if (!matchesBrand(brand, `${title} ${desc}`, cfg.category)) continue;
        if (recordItem(brand, 'youtube', {
          title, desc, url: `https://www.youtube.com/watch?v=${it.id.videoId}`,
          published: kstDate(new Date(it.snippet.publishedAt)), baseline,
          extra: { channel: it.snippet.channelTitle, thumb: it.snippet.thumbnails?.medium?.url },
        })) added++;
      }
      log('youtube', brand.id, 'ok', added, `검색 ${j.items?.length || 0}건`);
    } catch (e) { log('youtube', brand.id, 'error', 0, e.message); }

    // 2) 공식 채널(설정된 경우만)
    if (!brand.youtubeChannelId) { log('youtube_official', brand.id, 'skipped', 0, '공식 채널 ID 미설정'); continue; }
    try {
      const ch = await api('channels', { part: 'statistics,contentDetails,snippet', id: brand.youtubeChannelId });
      const c = ch.items?.[0];
      if (!c) throw new Error('채널을 찾을 수 없음');
      setVal(TODAY, brand.id, 'yt_subs', Number(c.statistics.subscriberCount || 0));
      setVal(TODAY, brand.id, 'yt_views', Number(c.statistics.viewCount || 0));
      const pl = await api('playlistItems', { part: 'contentDetails', playlistId: c.contentDetails.relatedPlaylists.uploads, maxResults: '10' });
      const ids = (pl.items || []).map((x) => x.contentDetails.videoId);
      if (ids.length) {
        const v = await api('videos', { part: 'snippet,statistics', id: ids.join(',') });
        let i = 0;
        for (const it of v.items || []) {
          const key2 = `yt_${it.id}`;
          const o = (official.items[key2] ||= { id: key2, brand: brand.id, platform: 'youtube', history: {} });
          Object.assign(o, {
            title: it.snippet.title, url: `https://www.youtube.com/watch?v=${it.id}`,
            thumb: it.snippet.thumbnails?.medium?.url, published: kstDate(new Date(it.snippet.publishedAt)),
            caption: (it.snippet.description || '').slice(0, 300),
            metrics: { views: +it.statistics.viewCount || 0, likes: +it.statistics.likeCount || 0, comments: +it.statistics.commentCount || 0 },
            firstSeen: o.firstSeen || TODAY, lastSeen: TODAY,
          });
          o.history[TODAY] = o.metrics;
          // 최근 영상 3개만 댓글 감성(키워드 기준) 집계 — 댓글 원문·작성자는 저장하지 않음
          if (i++ < 3 && o.metrics.comments > 0) {
            try {
              const cm = await api('commentThreads', { part: 'snippet', videoId: it.id, maxResults: '50', order: 'time', textFormat: 'plainText' });
              const s = { positive: 0, negative: 0, neutral: 0 };
              for (const t of cm.items || []) s[sentiment(t.snippet.topLevelComment.snippet.textDisplay)]++;
              o.commentSentiment = s;
            } catch (e) { /* 댓글 비활성 영상 */ }
          }
        }
      }
      log('youtube_official', brand.id, 'ok', ids.length, c.snippet.title);
    } catch (e) { log('youtube_official', brand.id, 'error', 0, e.message); }
  }
}

/* ---------------- Instagram Graph API (business_discovery) ---------------- */
async function collectInstagram() {
  const token = process.env.META_ACCESS_TOKEN, igUser = process.env.IG_USER_ID;
  for (const brand of cfg.brands) {
    if (!token || !igUser) { log('instagram_official', brand.id, 'skipped', 0, 'META_ACCESS_TOKEN/IG_USER_ID 미설정'); continue; }
    if (!brand.instagramUsername) { log('instagram_official', brand.id, 'skipped', 0, '공식 인스타그램 계정 미설정'); continue; }
    try {
      const fields = `business_discovery.username(${brand.instagramUsername}){followers_count,media_count,media.limit(12){id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count}}`;
      const j = await fetchJson(`https://graph.facebook.com/v21.0/${igUser}?fields=${encodeURIComponent(fields)}&access_token=${token}`);
      const bd = j.business_discovery;
      setVal(TODAY, brand.id, 'ig_followers', bd.followers_count);
      let n = 0;
      for (const m of bd.media?.data || []) {
        const k = `ig_${m.id}`;
        const o = (official.items[k] ||= { id: k, brand: brand.id, platform: 'instagram', history: {} });
        Object.assign(o, {
          title: (m.caption || '').split('\n')[0].slice(0, 80), caption: (m.caption || '').slice(0, 500), url: m.permalink,
          thumb: m.thumbnail_url || (m.media_type !== 'VIDEO' ? m.media_url : null), mediaType: m.media_type,
          published: kstDate(new Date(m.timestamp)),
          metrics: { likes: m.like_count ?? null, comments: m.comments_count ?? null },
          promo: promoHits(m.caption || ''), products: productHits(m.caption || ''),
          firstSeen: o.firstSeen || TODAY, lastSeen: TODAY,
        });
        o.history[TODAY] = o.metrics; n++;
      }
      log('instagram_official', brand.id, 'ok', n, `@${brand.instagramUsername}`);
    } catch (e) { log('instagram_official', brand.id, 'error', 0, e.message); }
  }
}

await collectNaver();
await collectYouTube();
await collectInstagram();

for (const [m, obj] of Object.entries(monthFiles)) writeJson(path.join(DATA, 'mentions', `${m}.json`), obj);
writeJson(seenFile, seen);
writeJson(tsFile, ts);
writeJson(officialFile, official);

const runsFile = path.join(DATA, 'logs/runs.json');
const runs = readJson(runsFile, []);
const summary = { ok: 0, skipped: 0, error: 0 };
results.forEach((r) => summary[r.status]++);
runs.unshift({ runAt: kstIso(), date: TODAY, trigger: process.env.GITHUB_EVENT_NAME || 'local', durationMs: Date.now() - started, summary, results });
writeJson(runsFile, runs.slice(0, 120));
console.log('summary', summary);
