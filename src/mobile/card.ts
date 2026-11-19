// 모바일 배치 카드 한 장의 내용: 묶음(진행·대기·보관·창고), 상태 문구, 진행률, 다음 공정 (옛 js/mobile_core.js)
import type { Batch } from '../batch/core.ts';
import { formatRemaining } from '../main/summary.ts';

type Times = Partial<Record<string, { start?: Date | null; end?: Date | null }>> | null;
export type Normalize = (s: Batch['schedule'], o: { baseYear: number }) => Times;
export interface ZoneLike { zoneId?: string; processName?: string; badgeText?: string; statusDesc?: string; step?: string }
export interface CardModel { lot: string; group: 'progress' | 'waiting' | 'storage' | 'logistics'; zoneId: string; zoneLabel: string; statusText: string; progressPct: number; nextText: string; qtyText: string; sortKey: number }

const MACHINE = ['stage1-1', 'stage1-2', 'stage2', 'stage3-1', 'stage3-2', 'stage4-1', 'stage4-2', 'stage5', 'packaging'];
const NAMES: Record<string, string> = { A: '공정1', B: '공정2', C: '공정3', D: '공정4', E: '공정5' };
const ZONE_STEP: [string, string][] = [['stage1', 'A'], ['stage2', 'B'], ['stage3', 'C'], ['stage4', 'D'], ['stage5', 'E'], ['packaging', 'packaging']];
const DAY = 86400000;

export const formatHHMM = (d: Date | null) => (!d || isNaN(+d) ? '--:--' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);

/** 연도 넘김 보정한 공정 시작·종료 (보정 함수가 없으면 저장값 그대로) */
function stepWindow(b: Batch, step: string, now: Date, normalize?: Normalize) {
  const toDate = (v: unknown) => { const d = v ? new Date(v as string) : null; return d && !isNaN(+d) ? d : null; };
  const w = normalize ? normalize(b.schedule || {}, { baseYear: now.getFullYear() })?.[step] : (b.schedule as Times)?.[step];
  return { start: toDate(w?.start), end: toDate(w?.end) };
}

export function buildBatchCardModel(b: Batch & Record<string, unknown>, z: ZoneLike | null, now: Date, normalize?: Normalize): CardModel {
  const zoneId = z?.zoneId || b.manualZone || b.assignedZone || '';
  const step = ZONE_STEP.find(([k]) => zoneId.includes(k))?.[1] || z?.step || String(b.currentProcess || 'A');
  const pName = z?.processName || '공정';
  const isWh = zoneId === 'logistics' || b.assignedZone === 'logistics' || b.manualZone === 'logistics' || Boolean(b.completed_at || b.enteredLogisticsAt);
  const group = isWh ? 'logistics' : MACHINE.includes(zoneId) ? 'progress' : zoneId.endsWith('-wait') ? 'waiting' : 'storage';
  const { start, end } = stepWindow(b, step, now, normalize);
  let statusText = `${z?.statusDesc || z?.badgeText || '보관 중'}`, progressPct = 0, sortKey = +now + 2 * DAY;
  if (group === 'progress') {
    statusText = `${pName} 진행 중 · ${end ? `${formatHHMM(end)} 종료 (${formatRemaining(+end - +now)} 남음)` : '진행 중'}`;
    if (start && end && end > start) progressPct = Math.min(100, Math.max(0, Math.round((+now - +start) / (+end - +start) * 100)));
    sortKey = end ? +end : +now + DAY;
  } else if (group === 'waiting') {
    statusText = `${pName} · ${start ? `${formatHHMM(start)} 시작` : '대기 중'}`;
    sortKey = start ? +start : +now + DAY;
  }
  const next = Object.keys(NAMES).map(k => [k, stepWindow(b, k, now, normalize).start] as const).find(([, s]) => s && s > now);
  const qty = b.finalQty ?? b.quantity ?? b.qtyB ?? '-';
  return {
    lot: b.lotNumber || String(b.lot || '-'), group, zoneId, zoneLabel: z?.badgeText || z?.processName || zoneId, statusText, progressPct, sortKey,
    nextText: next ? `다음: ${NAMES[next[0]]} (${formatHHMM(next[1])})` : '다음 공정 일정 없음',
    qtyText: typeof qty === 'number' ? `${qty.toLocaleString()}개` : String(qty)
  };
}
