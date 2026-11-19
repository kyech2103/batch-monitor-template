// 요약 띠 숫자, 다가오는 72시간 일정, 남은 시간 문구 (옛 js/dashboard_summary.js)
import type { Batch } from '../batch/core';
import { MACHINE_ZONES } from '../batch/zone.ts';

export const STEP_NAMES: Record<string, string> = { A: '공정1', B: '공정2', C: '공정3', D: '공정4', E: '공정5' };
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const STORAGE_ZONES = ['semi-storage-pre', 'semi-storage-post', 'inspection'];
const HOUR = 3600 * 1000;

type B = Batch & { enteredLogisticsAt?: string };
const isWarehouse = (b: B, z = '') => Boolean(z === 'logistics' || b.assignedZone === 'logistics' || b.manualZone === 'logistics' || b.completed_at || b.enteredLogisticsAt);

/** 1일 2시간 / 1시간 15분 / 25분 (지났으면 '… 지남') */
export function formatRemaining(ms: number | null): string {
  if (typeof ms !== 'number' || isNaN(ms)) return '-';
  const t = Math.floor(Math.abs(ms) / 60000), d = Math.floor(t / 1440), h = Math.floor((t % 1440) / 60), m = t % 60;
  const text = d ? (h ? `${d}일 ${h}시간` : `${d}일`) : h ? (m ? `${h}시간 ${m}분` : `${h}시간`) : `${m}분`;
  return ms < 0 ? `${text} 지남` : text;
}

/** 진행 중(검사 제외 설비)·48시간 안 종료·대기·보관 중. 완제품 창고 배치는 세지 않는다 */
export function computeSummary(batches: B[], now: Date, zoneOf: (b: B) => string, endOf: (b: B, zone: string) => Date | null) {
  const c = { inProgress: 0, endingSoon48h: 0, waiting: 0, storage: 0 };
  for (const b of batches) {
    const z = zoneOf(b);
    if (isWarehouse(b, z)) continue;
    if (MACHINE_ZONES[z] && z !== 'inspection') {
      c.inProgress++;
      const end = endOf(b, z)?.getTime();
      if (end != null && !isNaN(end) && end >= +now && end <= +now + 48 * HOUR) c.endingSoon48h++;
    }
    if (z.endsWith('-wait')) c.waiting++;
    if (STORAGE_ZONES.includes(z)) c.storage++;
  }
  return c;
}

const pad = (n: number) => String(n).padStart(2, '0');
type Times = Partial<Record<string, { start?: Date | string | null; end?: Date | string | null }>> | null;

/** 지금부터 72시간 안 공정 시작·종료, 시각순 8개. 공정5 뒤 배치·창고 배치는 뺀다 */
export function upcomingEvents(batches: B[], now: Date, normalize: (s: Batch['schedule'], o: { baseYear: number }) => Times = s => s as Times, isPostE: (b: B, norm: Times, now: Date) => boolean = () => false) {
  const out: { lot: string; step: string; type: 'start' | 'end'; ms: number; timeText: string; stepName: string; typeLabel: string; text: string }[] = [];
  for (const b of batches) {
    if (isWarehouse(b)) continue;
    const norm = normalize(b.schedule || {}, { baseYear: now.getFullYear() });
    if (isPostE(b, norm, now)) continue;
    for (const step of Object.keys(STEP_NAMES)) {
      for (const type of ['start', 'end'] as const) {
        const v = norm?.[step]?.[type];
        const d = v ? new Date(v) : null;
        if (!d || isNaN(+d) || +d < +now || +d > +now + 72 * HOUR) continue;
        const timeText = `${pad(d.getMonth() + 1)}/${pad(d.getDate())}(${DAYS[d.getDay()]}) ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        const typeLabel = type === 'start' ? '시작' : '종료';
        out.push({ lot: b.lotNumber, step, type, ms: +d, timeText, stepName: STEP_NAMES[step], typeLabel, text: `${timeText} · ${b.lotNumber} ${STEP_NAMES[step]} ${typeLabel}` });
      }
    }
  }
  return out.sort((a, b) => a.ms - b.ms || a.lot.localeCompare(b.lot)).slice(0, 8);
}
