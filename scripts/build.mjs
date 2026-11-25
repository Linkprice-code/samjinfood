// 수동 등록 소재 병합·중복 제거 → _site 폴더(GitHub Pages)로 출력
import fs from 'node:fs';
import path from 'node:path';
import { DATA, ROOT, readJson, writeJson, sha1, hookOf, promoHits, productHits, kstIso } from './lib.mjs';

const OUT = path.join(ROOT, '_site');
const cfg = readJson(path.join(ROOT, 'config/brands.json'));
const brandIds = new Set(cfg.brands.map((b) => b.id));
const mediaIds = new Set(Object.keys(cfg.media));
const buildErrors = [];

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'site'), OUT, { recursive: true });
fs.cpSync(DATA, path.join(OUT, 'data'), { recursive: true, filter: (src) => !src.includes(`${path.sep}state`) });
fs.copyFileSync(path.join(ROOT, 'config/brands.json'), path.join(OUT, 'data/config.json'));

/* ---------- 수동 등록 파일 읽기 ---------- */
const manualDir = path.join(DATA, 'manual');
const files = [];
(function walk(d) {
  if (!fs.existsSync(d)) return;
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p); else if (f.name.endsWith('.json')) files.push(p);
  }
})(manualDir);

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
const creatives = new Map();
const notes = [];

for (const file of files) {
  const rel = path.relative(DATA, file).replaceAll(path.sep, '/');
  let arr;
  try { arr = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { buildErrors.push({ file: rel, message: `JSON 형식 오류: ${e.message}` }); continue; }
  for (const e of Array.isArray(arr) ? arr : [arr]) {
    const problems = [];
    if (!brandIds.has(e.brand)) problems.push(`brand '${e.brand}' 없음`);
    if (!isDate(e.confirmedDate)) problems.push('confirmedDate(YYYY-MM-DD) 필요');
    if (!/^https?:\/\//.test(e.sourceUrl || '')) problems.push('sourceUrl(출처 URL) 필요');
    if (e.type === 'note') {
      if (!e.text) problems.push('text 필요');
      if (problems.length) { buildErrors.push({ file: rel, message: problems.join(', ') }); continue; }
      notes.push({ ...e, file: rel });
      continue;
    }
    if (!mediaIds.has(e.media)) problems.push(`media '${e.media}' 없음`);
    if (problems.length) { buildErrors.push({ file: rel, message: problems.join(', ') }); continue; }

    let imageKey = e.imageUrl || '';
    let image = e.imageUrl || null;
    if (e.image) {
      const p = path.join(manualDir, e.image);
      if (fs.existsSync(p)) { imageKey = sha1(fs.readFileSync(p)); image = `data/manual/${e.image.replaceAll('\\', '/')}`; }
      else buildErrors.push({ file: rel, message: `이미지 파일 없음: ${e.image}` });
    }
    const copy = e.copy || '';
    // 중복 기준: 광고 ID가 있으면(메타 광고 라이브러리) 브랜드+광고 ID, 없으면 브랜드 + 매체 + 카피(공백 무시) + 이미지(파일 해시 또는 URL) + 영상 URL
    const key = e.adId ? sha1(['ad', e.brand, String(e.adId)].join('|')) : sha1([e.brand, e.media, norm(copy), imageKey, e.videoUrl || ''].join('|'));
    const text = `${copy} ${e.subCopy || ''} ${e.product || ''}`;
    const prev = creatives.get(key);
    const dates = new Set([...(prev?.seenDates || []), e.confirmedDate, ...(e.lastConfirmedDate ? [e.lastConfirmedDate] : [])]);
    const sorted = [...dates].sort();
    creatives.set(key, {
      id: key.slice(0, 12), brand: e.brand, media: e.media, adId: e.adId || prev?.adId || null, pageName: e.pageName || prev?.pageName || null,
      format: e.format || (e.videoUrl ? 'video' : image ? 'image' : 'text'),
      copy, subCopy: e.subCopy || prev?.subCopy || '', hook: e.hook || prev?.hook || hookOf(copy),
      product: e.product || prev?.product || productHits(text).join(', '),
      promo: e.promo || prev?.promo || promoHits(text).join(', '),
      image: image || prev?.image || null, videoUrl: e.videoUrl || prev?.videoUrl || null, thumbnail: e.thumbnail || prev?.thumbnail || null,
      landingUrl: e.landingUrl || prev?.landingUrl || null,
      sourceUrls: [...new Set([...(prev?.sourceUrls || []), e.sourceUrl])],
      deliveryStart: e.deliveryStart || prev?.deliveryStart || null,
      status: e.status || prev?.status || 'unknown',
      firstSeen: sorted[0], lastSeen: sorted.at(-1), seenDates: sorted,
      verifiedBy: [...new Set([...(prev?.verifiedBy || []), e.verifiedBy || '수동 등록'])],
      note: [prev?.note, e.note].filter(Boolean).join(' / '),
      files: [...new Set([...(prev?.files || []), rel])],
      duplicates: (prev?.duplicates ?? -1) + 1,
    });
  }
}

const creativeList = [...creatives.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
writeJson(path.join(OUT, 'data/creatives.json'), { items: creativeList });
writeJson(path.join(OUT, 'data/notes.json'), { items: notes.sort((a, b) => b.confirmedDate.localeCompare(a.confirmedDate)) });

const months = fs.existsSync(path.join(DATA, 'mentions'))
  ? fs.readdirSync(path.join(DATA, 'mentions')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, 7)).sort() : [];
const runs = readJson(path.join(DATA, 'logs/runs.json'), []);
writeJson(path.join(OUT, 'data/site.json'), {
  builtAt: kstIso(), lastCollectedAt: runs[0]?.runAt || null, months, buildErrors,
  repo: process.env.GITHUB_REPOSITORY || null, branch: process.env.GITHUB_REF_NAME || 'main',
});
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
console.log(`build: creatives ${creativeList.length}, notes ${notes.length}, errors ${buildErrors.length}`);
buildErrors.forEach((e) => console.log('  !', e.file, e.message));
