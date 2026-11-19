// PC 배치 등록 화면의 계산: 시각 코드(MMDDHHMM)·소요(HHMM) 칸 연동, 일정 만들기, 저장할 기록, 템플릿.
// 옛 js/batches_app.js의 계산을 동작 그대로 옮긴 것. 화면 없음 (node 테스트 대상)
import { calcQuantities, sanitizeInput } from './core';
import type { Batch, LossKey, RemarkKey, ScheduleStep, StepKey } from './core';

export type TimeStep = StepKey; // A~E, packaging
export interface TimeFields { start: string; dur: string; end: string }
export type FormTimes = Record<TimeStep, TimeFields>;
export type Machines = { A: string; C: string; D: string };
export type FormLosses = Record<LossKey, string>;
export type FormRemarks = Record<RemarkKey, string>;

export const PROCS: { id: TimeStep; name: string; room: string; hasMachine: boolean }[] = [
  { id: 'A', name: '공정1', room: '공정1실', hasMachine: true },
  { id: 'B', name: '공정2', room: '공정2실', hasMachine: false },
  { id: 'C', name: '공정3', room: '공정3실', hasMachine: true },
  { id: 'D', name: '공정4', room: '공정4실', hasMachine: true },
  { id: 'E', name: '공정5', room: '공정5실', hasMachine: false },
  { id: 'packaging', name: '포장공정', room: '포장실', hasMachine: false }
];
export const DEFAULT_DURS: Record<TimeStep, string> = { A: '0200', B: '0300', C: '2400', D: '0200', E: '0130', packaging: '0400' };
export const DEFAULT_MACHINES: Machines = { A: '기계 1', C: '기계 1', D: '기계 1' };
export const LOSS_KEYS: LossKey[] = ['B', 'C', 'D', 'E', 'inspection', 'packaging'];
export const REMARK_KEYS: RemarkKey[] = ['A', 'B', 'C', 'D', 'E', 'inspection', 'packaging'];

const pad2 = (n: number) => String(n).padStart(2, '0');

export function parseMMDDHHMM(str: string | null | undefined, overrideYear?: number): Date | null {
  if (!str) return null;
  const c = str.replace(/\D/g, '');
  if (c.length !== 8) return null;
  const m = +c.slice(0, 2), d = +c.slice(2, 4), h = +c.slice(4, 6), mn = +c.slice(6, 8);
  if (m < 1 || m > 12 || d < 1 || d > 31 || h > 23 || mn > 59) return null;
  const dt = new Date(overrideYear ?? new Date().getFullYear(), m - 1, d, h, mn, 0, 0);
  return dt.getMonth() === m - 1 ? dt : null;
}

export const fmtMMDDHHMM = (dt: Date | null) => (dt && !isNaN(dt.getTime()) ? `${pad2(dt.getMonth() + 1)}${pad2(dt.getDate())}${pad2(dt.getHours())}${pad2(dt.getMinutes())}` : '');

export function fmtFriendly(dt: Date | null): string {
  if (!dt || isNaN(dt.getTime())) return '-';
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const yrPrefix = dt.getFullYear() !== new Date().getFullYear() ? `${dt.getFullYear()}년 ` : '';
  return `${yrPrefix}${dt.getMonth() + 1}월 ${dt.getDate()}일(${days[dt.getDay()]}) ${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
}

/** 'HHMM'·'H'·'HMM' → 분. 분이 60 이상이면 시간으로 넘긴다 */
export function parseDurMins(s: string | null | undefined): number {
  const c = (s || '').replace(/\D/g, '');
  if (!c.length) return 0;
  let h = 0, m = 0;
  if (c.length <= 2) h = +c;
  else if (c.length === 3) { h = +c[0]; m = +c.slice(1); }
  else { h = +c.slice(0, c.length - 2); m = +c.slice(-2); }
  if (m >= 60) { h += Math.floor(m / 60); m %= 60; }
  return h * 60 + m;
}

export const fmtDur = (mins: number) => `${Math.floor(mins / 60)}시간 ${pad2(mins % 60)}분`;
export const durCode = (mins: number) => pad2(Math.floor(mins / 60)) + pad2(mins % 60);
export const addMins = (dt: Date, mins: number) => new Date(dt.getTime() + mins * 60000);

/** 시작·소요·종료 중 하나를 고치면 나머지를 맞춘다 (공정마다 따로, 다른 공정은 건드리지 않는다) */
export function syncTimeFields(f: TimeFields, trigger: 'start' | 'dur' | 'end'): TimeFields {
  const startDt = parseMMDDHHMM(f.start.trim()), durMins = parseDurMins(f.dur.trim()), endDt = parseMMDDHHMM(f.end.trim());
  const out = { ...f };
  if (trigger === 'start' && startDt) {
    if (durMins > 0) out.end = fmtMMDDHHMM(addMins(startDt, durMins));
    else if (endDt && endDt >= startDt) out.dur = durCode(Math.round((endDt.getTime() - startDt.getTime()) / 60000));
  } else if (trigger === 'dur') {
    if (startDt) out.end = fmtMMDDHHMM(addMins(startDt, durMins));
    else if (endDt) out.start = fmtMMDDHHMM(addMins(endDt, -durMins));
  } else if (trigger === 'end' && endDt) {
    if (startDt) out.dur = durCode(Math.max(0, Math.round((endDt.getTime() - startDt.getTime()) / 60000)));
    else if (durMins > 0) out.start = fmtMMDDHHMM(addMins(endDt, -durMins));
  }
  return out;
}

/** 시각 칸 아래 읽기 쉬운 표시 */
export function readableLabel(code: string): { text: string; invalid: boolean } {
  const dt = parseMMDDHHMM(code.trim());
  if (dt) return { text: fmtFriendly(dt), invalid: false };
  return code.trim() ? { text: '❌ 잘못된 형식 (8자리)', invalid: true } : { text: '-', invalid: false };
}

// 앞 공정보다 이른 달이 나오면 해를 넘긴 것으로 본다 (12월 → 1월)
function rollYear(code: string, state: { year: number; lastMonth: number | null }) {
  const c = code.replace(/\D/g, '');
  if (c.length !== 8) return;
  const m = +c.slice(0, 2);
  if (m < 1 || m > 12) return;
  if (state.lastMonth !== null && m < state.lastMonth) state.year++;
  state.lastMonth = m;
}

export interface FormSchedule {
  schedule: Partial<Record<TimeStep, ScheduleStep & { startDate: Date | null; endDate: Date | null }>>;
  totalMins: number;
  minStart: Date | null;
  maxEnd: Date | null;
}

/** 폼 칸 → 저장할 공정 일정. 소요가 비면 2시간, 종료가 비면 시작+소요 */
export function scheduleFromForm(times: FormTimes, machines: Machines, remarks: FormRemarks): FormSchedule {
  const schedule: FormSchedule['schedule'] = {};
  let totalMins = 0, minStart: Date | null = null, maxEnd: Date | null = null;
  const yr = { year: new Date().getFullYear(), lastMonth: null as number | null };
  for (const proc of PROCS) {
    const t = times[proc.id];
    const startStr = t.start.trim(), durStr = t.dur.trim() || '0200', endStr = t.end.trim();
    rollYear(startStr, yr);
    const startDt = parseMMDDHHMM(startStr, yr.year);
    const durMins = parseDurMins(durStr);
    rollYear(endStr, yr);
    const endDt = parseMMDDHHMM(endStr, yr.year) || (startDt ? addMins(startDt, durMins) : null);
    if (endDt && endStr.replace(/\D/g, '').length !== 8) { yr.lastMonth = endDt.getMonth() + 1; yr.year = endDt.getFullYear(); }
    if (durMins > 0) totalMins += durMins;
    if (startDt && (!minStart || startDt < minStart)) minStart = startDt;
    if (endDt && (!maxEnd || endDt > maxEnd)) maxEnd = endDt;
    schedule[proc.id] = {
      stepId: proc.id, stepName: proc.name, room: proc.room,
      machine: proc.hasMachine ? (machines[proc.id as keyof Machines] || '기계 1') : null,
      startDate: startDt, endDate: endDt,
      startCode: startDt ? fmtMMDDHHMM(startDt) : startStr,
      endCode: endDt ? fmtMMDDHHMM(endDt) : endStr,
      startFriendly: fmtFriendly(startDt), endFriendly: fmtFriendly(endDt),
      durationMinutes: durMins, durationText: fmtDur(durMins),
      remarks: sanitizeInput(remarks[proc.id].trim())
    };
  }
  return { schedule, totalMins, minStart, maxEnd };
}

/** 차감 칸: 비면 null(저장)·0(계산) */
export function formQuantities(qtyB: string, losses: FormLosses) {
  const b = qtyB.trim();
  const toNum = (v: string) => { const n = Number(v); return isNaN(n) ? 0 : n; };
  const q = calcQuantities(b === '' ? null : Number(b), Object.fromEntries(LOSS_KEYS.map(k => [k, losses[k].trim() === '' ? 0 : toNum(losses[k])])));
  const saved = Object.fromEntries(LOSS_KEYS.map(k => [k, losses[k].trim() === '' ? null : toNum(losses[k])])) as Record<LossKey, number | null>;
  return { ...q.quantities, losses: saved };
}

/** 저장 버튼: 메인 화면에 보낼 배치 기록. 위치·완료 정보는 메인이 서버의 최신 값을 지킨다 */
export function buildRecord(a: {
  lot: string; startA: string; isEdit: boolean; originalCreatedAt: string | null; now: Date;
  form: FormSchedule; machines: Machines; qtyB: string; losses: FormLosses; remarks: FormRemarks;
}) {
  const sch = a.form.schedule, q = formQuantities(a.qtyB, a.losses);
  return {
    lotNumber: a.lot,
    createdAt: a.isEdit ? (a.originalCreatedAt || a.now.toISOString()) : a.now.toISOString(),
    updatedAt: a.isEdit ? a.now.toISOString() : undefined,
    totalDurationMinutes: Object.values(sch).reduce((s, x) => s + (x?.durationMinutes || 0), 0),
    totalDurationText: fmtDur(a.form.totalMins),
    overallStartCode: sch.A?.startCode || a.startA,
    overallEndCode: sch.packaging?.endCode || sch.E?.endCode || '',
    overallStartFriendly: sch.A?.startFriendly || '',
    overallEndFriendly: sch.packaging?.endFriendly || sch.E?.endFriendly || '',
    stage1Machine: a.machines.A || '기계 1',
    stage3Machine: a.machines.C || '기계 1',
    stage4Machine: a.machines.D || '기계 1',
    packagingStartDate: sch.packaging?.startDate || undefined,
    packagingEndDate: sch.packaging?.endDate || undefined,
    packagingStartCode: sch.packaging?.startCode || undefined,
    packagingEndCode: sch.packaging?.endCode || undefined,
    schedule: sch,
    quantities: { B: q.B, BNet: q.BNet, C: q.C, D: q.D, E: q.E, inspection: q.inspection, packaging: q.packaging, losses: q.losses },
    // 옛 이름도 같이 저장한다
    qtyB: q.B, lossB: q.losses.B, qtyC: q.C, qtyD: q.D, qtyE: q.E, qtyInspection: q.inspection, qtyPackaging: q.packaging,
    lossQuantities: q.losses,
    remarks: Object.fromEntries(REMARK_KEYS.map(k => [k, sanitizeInput(a.remarks[k].trim())]))
  };
}

const emptyTimes = (): FormTimes => Object.fromEntries(PROCS.map(p => [p.id, { start: '', dur: DEFAULT_DURS[p.id], end: '' }])) as FormTimes;

/** 새 배치: 공정1을 지금 시작으로, 뒤 공정은 앞 공정 종료에 이어 기본 소요로 채운다 */
export function defaultTimes(now: Date): FormTimes {
  const t = emptyTimes();
  t.A = syncTimeFields({ ...t.A, start: fmtMMDDHHMM(now) }, 'start');
  let cur = parseMMDDHHMM(t.A.end);
  for (const k of ['B', 'C', 'D', 'E'] as TimeStep[]) {
    if (!cur) break;
    t[k] = syncTimeFields({ ...t[k], start: fmtMMDDHHMM(cur) }, 'start');
    cur = parseMMDDHHMM(t[k].end);
  }
  return t;
}

/** 수정: 저장된 일정을 칸에 넣는다 (시작+소요로 종료를 다시 맞춘다) */
export function timesFromBatch(b: Batch): FormTimes {
  const t = emptyTimes();
  for (const p of PROCS) {
    const s = b.schedule?.[p.id];
    if (s) {
      if (s.startCode) t[p.id].start = s.startCode;
      if (s.durationMinutes != null) t[p.id].dur = durCode(s.durationMinutes);
      if (s.endCode) t[p.id].end = s.endCode;
    } else if (p.id === 'A' && typeof b.overallStartCode === 'string' && b.overallStartCode) {
      t.A.start = b.overallStartCode;
    }
    t[p.id] = syncTimeFields(t[p.id], 'start');
  }
  return t;
}

/** 수정: 저장된 차감. 없으면 앞뒤 수량 차이로 */
export function lossesFromBatch(b: Batch): FormLosses {
  const q = (b.quantities || {}) as Record<string, number | null | undefined>;
  const l = (q.losses || b.lossQuantities || {}) as Record<string, number | null | undefined>;
  const diff = (a?: number | null, c?: number | null) => (a != null && c != null ? String(a - c) : '');
  const pick = (k: LossKey, fallback: string) => (l[k] != null ? String(l[k]) : fallback);
  return {
    B: pick('B', b.lossB != null ? String(b.lossB) : ''),
    C: pick('C', diff(q.B, q.C)), D: pick('D', diff(q.C, q.D)), E: pick('E', diff(q.D, q.E)),
    inspection: pick('inspection', diff(q.E, q.inspection)), packaging: pick('packaging', diff(q.inspection, q.packaging))
  };
}

export function machinesFromBatch(b: Batch): Machines {
  const s = b.schedule || {};
  return {
    A: String(b.stage1Machine || b.stage1MachineOld || s.A?.machine || '기계 1'),
    C: String(b.stage3Machine || s.C?.machine || '기계 1'),
    D: String(b.stage4Machine || s.D?.machine || '기계 1')
  };
}

// ── 템플릿: 공정1 시작(T0) 기준 상대 시각(분)으로 저장한다 ──
type Offset = { dur?: number; startOffset?: number | null; endOffset?: number | null };
export interface Template {
  id: string; name: string; author?: string; createdAt?: string;
  offsets: Partial<Record<'A' | 'B' | 'C' | 'D' | 'E', Offset>>;
  machines?: Partial<Machines>;
  losses?: Partial<Record<LossKey, number | string | null>>;
  remarks?: Partial<Record<RemarkKey, string>>;
}

export function defaultTemplates(): Template[] {
  return [{
    id: 'tpl_default_standard',
    name: '표준 제품 A 생산 템플릿 (24h 건조/1호기)',
    author: '시스템 기본',
    createdAt: new Date().toISOString(),
    offsets: {
      A: { dur: 120, endOffset: 120 },
      B: { startOffset: 180, endOffset: 360, dur: 180 },
      C: { startOffset: 390, endOffset: 1830, dur: 1440 },
      D: { startOffset: 1860, endOffset: 1980, dur: 120 },
      E: { startOffset: 2010, endOffset: 2100, dur: 90 }
    },
    machines: { A: '기계 1', C: '기계 1', D: '기계 1' },
    losses: { C: 0, D: 0, E: 0, inspection: 0, packaging: 0 },
    remarks: { A: '표준 공정1 공정', B: '표준 공정2 공정', C: '24시간 공정3', D: '장비 처리', E: '표준 공정5' }
  }];
}

export function templateFromForm(a: { name: string; author: string; t0: Date; times: FormTimes; form: FormSchedule; machines: Machines; losses: FormLosses; remarks: FormRemarks; now: Date }): Template {
  const sch = a.form.schedule, t0 = a.t0.getTime();
  const off = (dt: Date | null) => (dt ? Math.round((dt.getTime() - t0) / 60000) : null);
  const at = (k: TimeStep, which: 'start' | 'end') => sch[k]?.[which === 'start' ? 'startDate' : 'endDate'] || parseMMDDHHMM(a.times[k][which]);
  const dur = (k: TimeStep) => sch[k]?.durationMinutes ?? parseDurMins(a.times[k].dur);
  const lossNum = (v: string) => { const n = Number(v); return v.trim() === '' || isNaN(n) ? 0 : n; };
  return {
    id: 'tpl_' + a.now.getTime(),
    name: sanitizeInput(a.name),
    author: a.author,
    createdAt: a.now.toISOString(),
    offsets: {
      A: { dur: dur('A'), endOffset: off(at('A', 'end')) },
      ...Object.fromEntries((['B', 'C', 'D', 'E'] as const).map(k => [k, { startOffset: off(at(k, 'start')), endOffset: off(at(k, 'end')), dur: dur(k) }]))
    },
    machines: { A: a.machines.A || '기계 1', C: a.machines.C || '기계 1', D: a.machines.D || '기계 1' },
    losses: Object.fromEntries(LOSS_KEYS.map(k => [k, lossNum(a.losses[k])])),
    remarks: Object.fromEntries(REMARK_KEYS.map(k => [k, sanitizeInput(a.remarks[k].trim())]))
  };
}

/** 템플릿을 고른 뒤 공정1 시작을 넣으면: 공정1 종료, 공정2~공정5 시작·종료를 T0+오프셋으로 채운다 */
export function timesFromTemplate(tpl: Template, times: FormTimes, startA: string): FormTimes | null {
  const t0 = parseMMDDHHMM(startA.trim());
  if (!t0 || !tpl.offsets) return null;
  const at = (m: number | null | undefined) => (m != null ? fmtMMDDHHMM(addMins(t0, m)) : null);
  const t: FormTimes = { ...times, A: { ...times.A, start: startA } };
  const o = tpl.offsets;
  t.A.end = at(o.A?.endOffset) ?? t.A.end;
  for (const k of ['B', 'C', 'D', 'E'] as const) t[k] = { ...t[k], start: at(o[k]?.startOffset) ?? t[k].start, end: at(o[k]?.endOffset) ?? t[k].end };
  for (const k of ['A', 'B', 'C', 'D', 'E'] as const) t[k] = syncTimeFields(t[k], 'start');
  return t;
}

