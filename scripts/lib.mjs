import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = path.join(ROOT, 'data');

/** 한국 시간 기준 YYYY-MM-DD */
export function kstDate(d = new Date(), offsetDays = 0) {
  const t = new Date(d.getTime() + 9 * 3600e3 + offsetDays * 86400e3);
  return t.toISOString().slice(0, 10);
}
export function kstIso(d = new Date()) {
  return new Date(d.getTime() + 9 * 3600e3).toISOString().replace('Z', '+09:00');
}

export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
export function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 1) + '\n');
}

export function sha1(s) { return crypto.createHash('sha1').update(s).digest('hex'); }

export function stripTags(s = '') {
  return String(s).replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, ' ').trim();
}

const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

/** 브랜드 관련 + 어묵 카테고리 글만 통과 */
export function matchesBrand(brand, text, category = '어묵') {
  const t = norm(text);
  if (!brand.mustInclude.some((k) => t.includes(norm(k)))) return false;
  if (brand.exclude.some((k) => t.includes(norm(k)))) return false;
  // 브랜드명에 '어묵'이 없는 검색어(대림선·사조오양 등)는 카테고리 단어가 함께 나와야 함
  const brandHasCategory = brand.mustInclude.some((k) => norm(k).includes(norm(category)));
  if (!brandHasCategory && !/어묵|오뎅|어묵탕|핫바|피시케이크|fishcake/i.test(t)) return false;
  return true;
}

/* ---------- 키워드 기반 분류 (정확한 감성분석이 아니라 키워드 매칭 추정치) ---------- */
const POS = ['맛있', '맛나', '존맛', '쫄깃', '탱글', '추천', '만족', '최고', '좋아', '좋았', '재구매', '감동', '인기', '든든', '고소', '부드럽', '푸짐', '강추', '대박', '선물하기 좋'];
const NEG = ['비리', '비린', '짜다', '짜요', '너무 짜', '실망', '별로', '냄새', '이물질', '리콜', '회수', '불만', '비싸', '최악', '환불', '식중독', '위반', '적발', '눅눅', '퍽퍽', '맛없', '불친절', '배송 지연', '곰팡이'];
const ISSUE = ['리콜', '회수', '적발', '이물질', '식약처', '위반', '소송', '식중독', '행정처분', '갑질', '논란', '해썹 취소', 'haccp 취소'];
const MARKETING = ['신제품', '출시', '협업', '콜라보', '팝업', '모델', '광고', '캠페인', '수출', '입점', '박람회', '라이브', '기획전', '한정판', '리뉴얼', '이벤트'];
const PROMO = ['할인', '특가', '쿠폰', '1+1', '2+1', '무료배송', '증정', '이벤트', '타임세일', '최저가', '적립', '선착순', '세일', '%', '원 할인', '사은품'];
const PRODUCTS = ['어묵탕', '사각어묵', '어묵바', '핫바', '수제어묵', '어묵꼬치', '어묵 선물세트', '선물세트', '모둠어묵', '떡볶이', '어묵볶음', '어묵스프', '오뎅', '어묵고로케', '치즈어묵', '부산어묵'];

const hits = (text, list) => list.filter((k) => String(text).toLowerCase().includes(k.toLowerCase()));

export function sentiment(text) {
  const p = hits(text, POS).length, n = hits(text, NEG).length;
  return p > n ? 'positive' : n > p ? 'negative' : 'neutral';
}
export const issueHits = (t) => hits(t, ISSUE);
export const marketingHits = (t) => hits(t, MARKETING);
export const promoHits = (t) => hits(t, PROMO).filter((k) => k !== '%' || /\d+\s*%/.test(t));
export const productHits = (t) => hits(t, PRODUCTS);

/** 후킹 문구: 카피 중 첫 문장 또는 느낌표/물음표가 있는 짧은 문장 */
export function hookOf(copy = '') {
  const parts = String(copy).split(/(?<=[!?！？])|\n|\|/).map((s) => s.trim()).filter(Boolean);
  return parts.find((s) => /[!?！？]/.test(s) && s.length <= 60) || parts[0] || '';
}

export async function fetchJson(url, opts = {}, retries = 2) {
  let last;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(20000) });
      const text = await r.text();
      if (!r.ok) { const e = new Error(`HTTP ${r.status}: ${text.slice(0, 300)}`); e.status = r.status; throw e; }
      return JSON.parse(text);
    } catch (e) {
      last = e;
      if (e.status && e.status < 500 && e.status !== 429) break;
      await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
    }
  }
  throw last;
}
