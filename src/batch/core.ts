// 배치 한 건의 계산·검사·수정 규칙. PC(평면도·배치 등록·저장)와 모바일 수정이 모두 이 파일 하나만 쓴다.
// 옛 js/mobile_edit_core.js를 옮긴 것. 화면·네트워크 없음 (node 테스트 대상)

export type StepKey = 'A' | 'B' | 'C' | 'D' | 'E' | 'packaging';
export type LossKey = 'B' | 'C' | 'D' | 'E' | 'inspection' | 'packaging';
export type RemarkKey = 'A' | 'B' | 'C' | 'D' | 'E' | 'inspection' | 'packaging';

export type Losses = Record<LossKey, number | null>;
export interface Quantities {
  B: number | null; BNet: number | null; C: number | null; D: number | null; E: number | null;
  inspection: number | null; packaging: number | null; losses: Losses;
}

export interface ScheduleStep {
  stepId?: string; stepName?: string; room?: string; machine?: string | null;
  start?: string; end?: string; startDate?: string | Date | null; endDate?: string | Date | null;
  startCode?: string; endCode?: string; startFriendly?: string; endFriendly?: string;
  durationMinutes?: number; durationText?: string; remarks?: string;
}

/** DB batches.current_batches 배열의 한 칸. 옛 이름(qtyB, lossQuantities 등)도 같이 저장한다 */
export interface Batch {
  lotNumber: string;
  manualZone?: string; assignedZone?: string; manualMovedAt?: string;
  prevZoneBeforeLogistics?: string; completed_at?: string; moved_to_storage_at?: string; enteredLogisticsAt?: string;
  schedule?: Partial<Record<StepKey, ScheduleStep>>;
  quantities?: Partial<Quantities>;
  remarks?: Partial<Record<RemarkKey, string>>;
  qtyB?: number | null; lossQuantities?: Partial<Losses>;
  updatedAt?: string;
  [key: string]: unknown;
}

type RawNum = number | string | null | undefined;
export interface BatchEdit {
  lotNumber?: string;
  zoneId?: string;
  /** 사용자가 화면에서 본 현재 위치(스케줄 자동 진행 반영). zoneId가 이것과 같으면 옮기지 않는다. 없으면 저장된 위치 */
  fromZoneId?: string;
  qtyB?: RawNum;
  losses?: Partial<Record<LossKey, RawNum>>;
  times?: Partial<Record<StepKey, { start?: string | Date | null; end?: string | Date | null }>>;
  /** 입력칸 원래 글자. 저장할 때 sanitizeInput 한 번 */
  remarks?: Partial<Record<RemarkKey, string>>;
}

interface Zone { name?: string; maxCapacity?: number }

const STEP_KEYS: StepKey[] = ['A', 'B', 'C', 'D', 'E', 'packaging'];
const REMARK_KEYS: RemarkKey[] = ['A', 'B', 'C', 'D', 'E', 'inspection', 'packaging'];
const STEP_NAMES: Record<StepKey, string> = { A: '공정1', B: '공정2', C: '공정3', D: '공정4', E: '공정5', packaging: '포장' };
const STEP_ROOMS: Record<StepKey, string> = { A: '공정1실', B: '공정2실', C: '공정3실', D: '공정4실', E: '공정5실', packaging: '포장실' };
export const LOT_REGEX = /^[a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ_\-\.\s\(\)\/\#]{1,50}$/;

const pad2 = (n: number) => String(n).padStart(2, '0');

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function fmtMMDDHHMM(dt: Date | null): string {
  return dt ? `${pad2(dt.getMonth() + 1)}${pad2(dt.getDate())}${pad2(dt.getHours())}${pad2(dt.getMinutes())}` : '';
}

function fmtFriendly(dt: Date | null, refYear: number): string {
  if (!dt) return '-';
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const yrPrefix = dt.getFullYear() !== refYear ? `${dt.getFullYear()}년 ` : '';
  return `${yrPrefix}${dt.getMonth() + 1}월 ${dt.getDate()}일(${days[dt.getDay()]}) ${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
}

function fmtDur(mins: number | null | undefined): string {
  if (mins == null || isNaN(mins)) return '0시간 00분';
  return `${Math.floor(mins / 60)}시간 ${pad2(mins % 60)}분`;
}

export function sanitizeInput(str: unknown): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#x27;').replace(/\//g, '&#x2F;');
}

const UNESCAPE: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#x2F;': '/' };

/** 저장된 비고(sanitizeInput 한 번)를 입력칸에 넣을 원래 글자로 되돌린다. 그대로 넣으면 저장할 때마다 또 변환된다 */
export function unsanitizeInput(str: unknown): string {
  return String(str ?? '').replace(/&(amp|lt|gt|quot|#x27|#x2F);/g, m => UNESCAPE[m]);
}

function toNum(v: unknown): number | null {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

/** 공정2 수량(B)에서 공정별 차감을 차례로 뺀다. B가 없으면 전부 null */
export function calcQuantities(rawQtyB: unknown, rawLosses?: Partial<Record<LossKey, unknown>> | null) {
  const l = rawLosses || {};
  const losses: Losses = {
    B: toNum(l.B), C: toNum(l.C), D: toNum(l.D), E: toNum(l.E), inspection: toNum(l.inspection), packaging: toNum(l.packaging)
  };
  const B = toNum(rawQtyB);
  let quantities: Quantities;
  if (B == null) {
    quantities = { B: null, BNet: null, C: null, D: null, E: null, inspection: null, packaging: null, losses };
  } else {
    const BNet = B - (losses.B || 0);
    const C = BNet - (losses.C || 0);
    const D = C - (losses.D || 0);
    const E = D - (losses.E || 0);
    const inspection = E - (losses.inspection || 0);
    quantities = { B, BNet, C, D, E, inspection, packaging: inspection - (losses.packaging || 0), losses };
  }
  const q = quantities;
  const compat = { qtyB: q.B, lossB: losses.B, qtyC: q.C, qtyD: q.D, qtyE: q.E, qtyInspection: q.inspection, qtyPackaging: q.packaging, lossQuantities: losses };
  return { quantities, compat };
}

function buildStep(step: StepKey, prev: ScheduleStep, time: { start?: string | Date | null; end?: string | Date | null } | undefined, remark: string | undefined, nowYear: number): ScheduleStep {
  const startDt = toDate(time ? time.start : (prev.startDate || prev.start));
  const endDt = toDate(time ? time.end : (prev.endDate || prev.end));
  const dur = startDt && endDt ? Math.round((endDt.getTime() - startDt.getTime()) / 60000) : (prev.durationMinutes ?? 0);
  return {
    stepId: prev.stepId || step,
    stepName: prev.stepName || STEP_NAMES[step],
    room: prev.room || STEP_ROOMS[step],
    machine: prev.machine ?? null,
    durationMinutes: dur,
    durationText: fmtDur(dur),
    remarks: remark != null ? remark : (prev.remarks || ''),
    startDate: startDt ? startDt.toISOString() : null,
    endDate: endDt ? endDt.toISOString() : null,
    startCode: fmtMMDDHHMM(startDt),
    endCode: fmtMMDDHHMM(endDt),
    startFriendly: fmtFriendly(startDt, nowYear),
    endFriendly: fmtFriendly(endDt, nowYear)
  };
}

function buildSchedule(orig: Batch['schedule'], times: BatchEdit['times'], remarks: Batch['remarks'], nowYear: number) {
  const schedule: Partial<Record<StepKey, ScheduleStep>> = {};
  let totalMins = 0;
  for (const k of STEP_KEYS) {
    const s = buildStep(k, orig?.[k] || {}, times?.[k], remarks?.[k], nowYear);
    schedule[k] = s;
    totalMins += s.durationMinutes || 0;
  }
  const a = schedule.A || {}, end = schedule.packaging || schedule.E || {}, p = schedule.packaging || {};
  const summary = {
    totalDurationMinutes: totalMins,
    totalDurationText: fmtDur(totalMins),
    overallStartCode: a.startCode || '',
    overallStartFriendly: a.startFriendly || '',
    overallEndCode: end.endCode || '',
    overallEndFriendly: end.endFriendly || '',
    packagingStartDate: p.startDate || null,
    packagingEndDate: p.endDate || null,
    packagingStartCode: p.startCode || '',
    packagingEndCode: p.endCode || ''
  };
  return { schedule, summary };
}

/**
 * 사람이 위치를 옮긴다(batch를 직접 고침). fromZoneId는 사용자가 본 현재 위치(getBatchZoneInfo)다.
 * 저장된 위치와 다를 수 있다(스케줄대로 자동 진행). 완제품 창고(logistics)를 드나들 때 완료·원래 위치 기록을 같이 다룬다
 */
export function applyZoneChange(batch: Batch, newZoneId: string | undefined, nowIso: string, fromZoneId?: string): void {
  const stored = batch.manualZone || batch.assignedZone || 'packaging';
  // 위치 칸은 늘 현재 값으로 채워져 오므로, 그대로면 이동 시각을 찍지 않는다 (찍으면 공정 자동 진행이 멈춤)
  if (!newZoneId || newZoneId === (fromZoneId || stored)) return;
  if (newZoneId === 'logistics') {
    if (stored !== 'logistics') batch.prevZoneBeforeLogistics = fromZoneId || stored;
    if (!batch.completed_at) batch.completed_at = nowIso;
    batch.moved_to_storage_at = batch.completed_at;
    batch.enteredLogisticsAt = nowIso;
  } else if (stored === 'logistics') {
    delete batch.completed_at;
    delete batch.moved_to_storage_at;
    delete batch.enteredLogisticsAt;
    delete batch.prevZoneBeforeLogistics;
  }
  batch.manualZone = newZoneId;
  batch.assignedZone = newZoneId;
  batch.manualMovedAt = nowIso;
}

/** 수정 내용을 적용한 새 배치를 돌려준다 (받은 배치는 고치지 않는다) */
export function applyBatchEdit(batch: Batch, edit: BatchEdit, now: Date = new Date()): Batch {
  const nowIso = now.toISOString();
  const copy: Batch = JSON.parse(JSON.stringify(batch));
  if (edit.lotNumber !== undefined) copy.lotNumber = edit.lotNumber;
  if (edit.remarks) {
    const remarks = { ...(copy.remarks || {}) };
    for (const k of REMARK_KEYS) if (edit.remarks[k] !== undefined) remarks[k] = sanitizeInput(edit.remarks[k]);
    copy.remarks = remarks;
  }
  if (edit.qtyB !== undefined || edit.losses !== undefined) {
    const rawB = edit.qtyB !== undefined ? edit.qtyB : (copy.quantities?.B ?? copy.qtyB);
    const rawLosses = edit.losses !== undefined ? edit.losses : (copy.quantities?.losses || copy.lossQuantities || {});
    const q = calcQuantities(rawB, rawLosses);
    copy.quantities = q.quantities;
    Object.assign(copy, q.compat);
  }
  const s = buildSchedule(copy.schedule, edit.times, copy.remarks, now.getFullYear());
  copy.schedule = s.schedule;
  Object.assign(copy, s.summary);
  if (edit.zoneId !== undefined) applyZoneChange(copy, edit.zoneId, nowIso, edit.fromZoneId);
  copy.updatedAt = nowIso;
  return copy;
}

const isIntegerOrEmpty = (v: unknown) => v === '' || v === null || v === undefined || Number.isInteger(Number(v));

/** 화면에 보일 오류 문장 목록. 비어 있으면 저장해도 된다 */
export function validateEdit(edit: BatchEdit, batch: Batch | null | undefined, allBatches?: Batch[] | null): string[] {
  const errors: string[] = [];
  const lot = String(edit.lotNumber ?? batch?.lotNumber ?? '').trim();
  if (!lot || !LOT_REGEX.test(lot)) {
    errors.push('로트넘버 형식이 올바르지 않아요');
  } else if (Array.isArray(allBatches) && allBatches.some(b => b.lotNumber !== batch?.lotNumber && b.lotNumber === lot)) {
    errors.push('이미 있는 로트넘버예요');
  }
  for (const k of STEP_KEYS) {
    const t = edit.times?.[k];
    const s = toDate(t?.start), e = toDate(t?.end);
    if (s && e && e < s) errors.push(`${STEP_NAMES[k]} 종료가 시작보다 빨라요`);
  }
  if (edit.qtyB !== undefined && !isIntegerOrEmpty(edit.qtyB)) errors.push('수량은 정수여야 해요');
  if (edit.losses && Object.values(edit.losses).some(v => !isIntegerOrEmpty(v))) errors.push('손실은 정수여야 해요');
  if (edit.remarks && Object.values(edit.remarks).some(r => typeof r === 'string' && r.length > 200)) errors.push('비고는 200자까지예요');
  const zones: Record<string, Zone> = (typeof window !== 'undefined' && (window as { ALLOWED_ZONES?: Record<string, Zone> }).ALLOWED_ZONES) || {};
  const zone = edit.zoneId ? zones[edit.zoneId] : undefined;
  if (zone && typeof zone.maxCapacity === 'number' && Array.isArray(allBatches)) {
    const count = allBatches.filter(b => b.lotNumber !== batch?.lotNumber && (b.manualZone || b.assignedZone) === edit.zoneId).length;
    if (count >= zone.maxCapacity) errors.push(`[${zone.name || edit.zoneId}] 구역이 가득 찼어요`);
  }
  return errors;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((x, i) => deepEqual(x, (b as unknown[])[i]));
  const ka = Object.keys(a), ob = b as Record<string, unknown>;
  return ka.length === Object.keys(ob).length && ka.every(k => Object.prototype.hasOwnProperty.call(ob, k) && deepEqual((a as Record<string, unknown>)[k], ob[k]));
}

/** 시트를 연 뒤 서버의 그 배치가 바뀌었으면(또는 사라졌으면) true */
export function hasConflict(snapshot: unknown, latest: unknown): boolean {
  if (!latest || !snapshot) return true;
  return !deepEqual(snapshot, latest);
}
