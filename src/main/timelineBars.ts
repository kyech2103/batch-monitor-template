// 타임라인 탭 계산: 기간(2주·1주), 날짜 칸, 로트별 공정 막대, 지금 선 위치 (옛 js/timeline_core.js)
import type { Batch } from '../batch/core';

const STEPS = ['A', 'B', 'C', 'D', 'E'];
const NAMES: Record<string, string> = { A: '공정1', B: '공정2', C: '공정3', D: '공정4', E: '공정5' };
export const STEP_COLORS: Record<string, string> = { A: '#0D9488', B: '#DC2626', C: '#7C3AED', D: '#F59E0B', E: '#2563EB' };
/** 흰 바탕 글자용으로 조금 진하게 */
export const STEP_TEXT_COLORS: Record<string, string> = { A: '#0F766E', B: '#DC2626', C: '#7C3AED', D: '#B45309', E: '#2563EB' };
const DAY = 86400000;
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

const toDate = (v: unknown) => { if (!v) return null; const d = v instanceof Date ? v : new Date(v as string); return isNaN(+d) ? null : d; };
const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (d: Date | null) => (d ? `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}` : '-');

/** 2주: 3일 전 0시부터 14일, 1주: 어제 0시부터 7일 */
export function computeRange(range: string, now: Date) {
  const w1 = range === '1w';
  return { start: new Date(now.getFullYear(), now.getMonth(), now.getDate() - (w1 ? 1 : 3)), days: w1 ? 7 : 14 };
}

export function buildDayColumns(start: Date, days: number, now: Date) {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(+start + i * DAY);
    return { label: `${d.getMonth() + 1}/${d.getDate()} ${DAYS[d.getDay()]}`, isWeekend: d.getDay() % 6 === 0, isToday: d.toDateString() === now.toDateString() };
  });
}

/** 기간 밖이면 null */
export function nowLinePct(start: Date, days: number, now: Date): number | null {
  const diff = +now - +start;
  return diff < 0 || diff > days * DAY ? null : diff / (days * DAY) * 100;
}

type Times = Partial<Record<string, { start?: unknown; end?: unknown }>> | null;
export interface TimelineRow { batch: Batch; lotNumber: string; segments: { step: string; color: string; leftPct: number; widthPct: number; past: boolean; title: string }[] }

/** 기간에 걸친 공정 막대가 하나라도 있는 로트만, 첫 공정 시작 순. 완제품 창고·공정5 뒤 배치는 뺀다 */
export function buildTimelineRows(o: {
  batches: Batch[]; now: Date; start: Date; days: number; zoneOf(b: Batch): string;
  normalize?(s: Batch['schedule'], opts: { baseYear: number }): Times; isPostE?(b: Batch, norm: Times, now: Date): boolean;
}): TimelineRow[] {
  const from = +o.start, to = from + o.days * DAY, total = to - from;
  const rows: (TimelineRow & { first: number })[] = [];
  for (const b of o.batches) {
    const norm: Times = o.normalize ? o.normalize(b.schedule || {}, { baseYear: o.now.getFullYear() }) : (b.schedule as Times) || {};
    const z = o.zoneOf(b);
    if (z === 'logistics' || b.assignedZone === 'logistics' || b.manualZone === 'logistics' || o.isPostE?.(b, norm, o.now)) continue;
    const segments: TimelineRow['segments'] = [];
    let first = Number.MAX_SAFE_INTEGER;
    for (const k of STEPS) {
      const s = norm?.[k];
      if (!s) continue;
      const st = toDate(s.start);
      // 종료가 없으면 시작부터 2시간으로 그린다
      const en = toDate(s.end) || (st && new Date(+st + 2 * 3600000));
      if (!st && !en) continue;
      if (st && first === Number.MAX_SAFE_INTEGER) first = +st;
      const a = Math.max(+(st || en!), from), z2 = Math.min(+(en || st!), to);
      if (z2 <= a) continue;
      const left = (a - from) / total * 100;
      segments.push({ step: k, color: STEP_COLORS[k], leftPct: left, widthPct: Math.max(0.5, (z2 - from) / total * 100 - left), past: +(en || st!) < +o.now, title: `${NAMES[k]}: ${fmt(st)} ~ ${fmt(en)}` });
    }
    if (segments.length) rows.push({ batch: b, lotNumber: b.lotNumber || '', segments, first });
  }
  return rows.sort((a, b) => a.first - b.first || a.lotNumber.localeCompare(b.lotNumber));
}
