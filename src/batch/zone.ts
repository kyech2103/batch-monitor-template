// 배치가 지금 어느 구역에 있는지: 스케줄 시각대로 자동 진행 + 사람이 옮긴 위치. PC 평면도와 모바일이 모두 이 함수 하나로 위치를 정한다.
// 옛 js/app/08_floorplan_batches.js getBatchZoneInfo를 동작 그대로 옮긴 것
import type { Batch, ScheduleStep, StepKey } from './core';

export interface ZoneDef { name: string; badge: string }
export interface ZoneInfo { zoneId: string; processName: string; badgeText: string; statusDesc: string; isManual: boolean }
type StepTimes = { start?: Date | null; end?: Date | null };
/** 연도 넘김 보정(src/todo/core.ts normalizeScheduleYears). 테스트가 바꿔 넣을 수 있게 밖에서 받는다 */
export type NormalizeYears = (sch: Batch['schedule'], opts: { baseYear: number }) => Partial<Record<StepKey, StepTimes>> | null;

/** E(공정5) 뒤 구역. 사람이 여기로 옮기면 자동 진행보다 그 위치가 먼저다 (포장 시간만 예외) */
export const POST_E_ZONES = ['semi-storage-pre', 'semi-storage-post', 'semi-discharge', 'inspection', 'packaging-wait', 'packaging', 'logistics'];

function parseScheduleTime(s: ScheduleStep | undefined, isStart: boolean, year: number): Date | null {
  if (!s) return null;
  const raw = isStart ? (s.startDate || s.start) : (s.endDate || s.end);
  if (raw) {
    const d = raw instanceof Date ? raw : new Date(raw);
    if (!isNaN(d.getTime())) return d;
  }
  const code = isStart ? (s.startCode || s.start) : (s.endCode || s.end);
  const clean = typeof code === 'string' ? code.replace(/\D/g, '') : '';
  if (clean.length !== 8) return null;
  const n = (i: number) => parseInt(clean.substring(i, i + 2), 10);
  return new Date(year, n(0) - 1, n(2), n(4), n(6), 0, 0);
}

const unit = (zoneId: string) => (zoneId.endsWith('2') ? '2호기' : '1호기');
const manualInfo = (zoneId: string, zones: Record<string, ZoneDef>): ZoneInfo =>
  ({ zoneId, processName: zones[zoneId].badge, badgeText: zones[zoneId].badge, statusDesc: `${zones[zoneId].name} (수동/배정 위치)`, isManual: true });
const STAGE5_DONE: ZoneInfo = { zoneId: 'semi-storage-pre', processName: '공정5 완료', badgeText: '공정 완료', statusDesc: '공정5 완료 (반제품 보관실)', isManual: false };

export function getBatchZoneInfo(batch: Batch, zones: Record<string, ZoneDef>, now: Date = new Date(), normalize?: NormalizeYears): ZoneInfo {
  let manual = batch.manualZone && zones[batch.manualZone] ? batch.manualZone
    : (batch.assignedZone && zones[batch.assignedZone] ? batch.assignedZone : null);
  if (manual === 'semi-discharge') manual = 'semi-storage-pre';

  const machineOf = (field: string, step: StepKey, alt?: string) =>
    String(batch[field] || (alt && batch[alt]) || batch.schedule?.[step]?.machine || '기계 1');
  const isUnit2 = (m: string) => m.includes('2');
  const stage1Zone = () => (isUnit2(machineOf('stage1Machine', 'A', 'stage1MachineOld')) ? 'stage1-2' : 'stage1-1');
  const stage3Zone = () => `stage3-${isUnit2(machineOf('stage3Machine', 'C')) ? '2' : '1'}`;
  const stage4Zone = () => `stage4-${isUnit2(machineOf('stage4Machine', 'D')) ? '2' : '1'}`;

  if (batch.schedule) {
    const sch = batch.schedule;
    const norm = normalize ? normalize(sch, { baseYear: now.getFullYear() }) : null;
    const t = (k: StepKey, isStart: boolean, step = sch[k]) =>
      (isStart ? norm?.[k]?.start : norm?.[k]?.end) || parseScheduleTime(step, isStart, now.getFullYear());
    const [startA, endA, startB, endB, startC, endC, startD, endD, startE, endE] =
      (['A', 'B', 'C', 'D', 'E'] as StepKey[]).flatMap(k => [t(k, true), t(k, false)]);

    // 완제품 창고에 넣은 배치는 스케줄과 상관없이 창고
    if (manual === 'logistics') return manualInfo(manual, zones);

    // 공정5이 끝났으면 포장 24시간 전부터 포장 대기, 포장 시간 동안 포장실 (사람이 옮긴 위치보다 먼저)
    const pkgStep = sch.packaging || (sch as Record<string, ScheduleStep | undefined>).pkg;
    const pkgDate = (v: unknown) => (v ? new Date(v as string) : null);
    const startPkg = t('packaging', true, pkgStep) || pkgDate(batch.packagingStartDate);
    const endPkg = t('packaging', false, pkgStep) || pkgDate(batch.packagingEndDate);
    const stage5Done = !endE || now >= endE;
    if (stage5Done && startPkg && !isNaN(startPkg.getTime())) {
      if (now >= new Date(startPkg.getTime() - 24 * 60 * 60 * 1000) && now < startPkg) {
        return { zoneId: 'packaging-wait', processName: '포장 대기', badgeText: '포장 대기', statusDesc: '포장 시행 1일 전 자동 이관 (포장 대기구역)', isManual: false };
      }
      if (now >= startPkg && (!endPkg || now < endPkg)) {
        return { zoneId: 'packaging', processName: '포장실', badgeText: '포장실', statusDesc: '포장 공정 진행 중 (포장실)', isManual: false };
      }
    }

    // 1. 공정5 뒤 구역에 사람이 옮겼으면 그대로
    if (manual && POST_E_ZONES.includes(manual)) return manualInfo(manual, zones);

    // 2. 공정 구역에 사람이 옮겼으면: 옮긴 뒤에 시작·종료된 공정만 자동으로 따라간다
    if (manual) {
      const moved = batch.manualMovedAt ? new Date(batch.manualMovedAt).getTime() : NaN;
      const moveTime = isNaN(moved) ? 0 : moved;
      const after = (d: Date) => moveTime <= 0 || d.getTime() > moveTime;
      const steps = [
        { key: 'A', start: startA, end: endA, zoneId: stage1Zone(), waitZoneId: 'stage1-wait', name: '공정1' },
        { key: 'B', start: startB, end: endB, zoneId: 'stage2', waitZoneId: 'stage2-wait', name: '공정2' },
        { key: 'C', start: startC, end: endC, zoneId: stage3Zone(), waitZoneId: 'stage3-wait', name: '공정3' },
        { key: 'D', start: startD, end: endD, zoneId: stage4Zone(), waitZoneId: 'stage4-wait', name: '공정4' },
        { key: 'E', start: startE, end: endE, zoneId: 'stage5', waitZoneId: 'stage5-wait', name: '공정5' }
      ];
      if (endE && now >= endE && after(endE)) return STAGE5_DONE;

      for (let i = steps.length - 1; i >= 0; i--) {
        const step = steps[i], next = steps[i + 1];
        let hit: { zoneId: string; name: string; desc: string; machine: boolean } | null = null;
        if (step.start && now >= step.start && (!step.end || now < step.end) && after(step.start)) {
          hit = { zoneId: step.zoneId, name: step.name, desc: '진행 중', machine: 'ACD'.includes(step.key) };
        } else if (step.end && now >= step.end && next && (!next.start || now < next.start) && after(step.end)) {
          hit = { zoneId: next.waitZoneId, name: `${next.name} (대기)`, desc: '시작 대기', machine: false };
        }
        if (hit) {
          return {
            zoneId: hit.zoneId,
            processName: hit.name,
            badgeText: hit.machine ? `${hit.name} (${unit(hit.zoneId)})` : hit.name,
            statusDesc: `${hit.name} ${hit.desc} (${zones[hit.zoneId] ? zones[hit.zoneId].name : hit.zoneId})`,
            isManual: false
          };
        }
      }
      if (moveTime > 0) return manualInfo(manual, zones);
    }

    // 3. 스케줄대로 자동 진행
    const run = (zoneId: string, name: string, room: string, machine: boolean): ZoneInfo =>
      ({ zoneId, processName: name, badgeText: machine ? `${name} (${unit(zoneId)})` : name, statusDesc: `${name} 진행 중 (${machine ? `${room} ${unit(zoneId)}` : room})`, isManual: false });
    const wait = (zoneId: string, name: string, room: string): ZoneInfo =>
      ({ zoneId, processName: `${name} 대기`, badgeText: `${name} (대기)`, statusDesc: `${name} 시작 대기 (${room})`, isManual: false });
    const reached = (d: Date | null) => d && now >= d;
    if (reached(endE)) return STAGE5_DONE;
    if (reached(startE)) return run('stage5', '공정5', '공정5실', false);
    if (reached(endD)) return wait('stage5-wait', '공정5', '공정5실 대기');
    if (reached(startD)) return run(stage4Zone(), '공정4', '공정4 설비', true);
    if (reached(endC)) return wait('stage4-wait', '공정4', '공정4실 대기');
    if (reached(startC)) return run(stage3Zone(), '공정3', '공정3 설비', true);
    if (reached(endB)) return wait('stage3-wait', '공정3', '공정3 대기');
    if (reached(startB)) return run('stage2', '공정2', '공정2실', false);
    if (reached(endA)) return wait('stage2-wait', '공정2', '공정2실 대기');
    if (reached(startA)) return run(stage1Zone(), '공정1', '공정1 설비', true);
    return wait('stage1-wait', '공정1', '공정1실 대기');
  }

  // 스케줄이 없으면 사람이 둔 위치, 그것도 없으면 옛 currentProcess 값
  if (manual) return manualInfo(manual, zones);
  const fixed = (zoneId: string, name: string, desc: string, badge = name): ZoneInfo => ({ zoneId, processName: name, badgeText: badge, statusDesc: desc, isManual: false });
  const p = batch.currentProcess;
  if (p === 'A') { const z = stage1Zone(); return fixed(z, '공정1', '공정1실', `공정1 (${unit(z)})`); }
  if (p === 'B') return fixed('stage2', '공정2', '공정2실');
  if (p === 'C') { const z = stage3Zone(); return fixed(z, '공정3', '공정3실', `공정3 (${unit(z)})`); }
  if (p === 'D') { const z = stage4Zone(); return fixed(z, '공정4', '공정4실', `공정4 (${unit(z)})`); }
  if (p === 'E') return fixed('stage5', '공정5', '공정5실');
  if (p === 'inspection') return fixed('inspection', '검사', '검사실');
  if (p === 'packaging') return fixed('packaging', '포장실', '포장실');
  if (typeof p === 'string' && ['completed', 'E완료', '공정 E 완료', '공정5 완료', '보관실(이전)'].includes(p)) return STAGE5_DONE;
  return { zoneId: 'stage1-wait', processName: '공정1 대기', badgeText: '공정1 (대기)', statusDesc: '공정1실 대기', isManual: false };
}

export interface Zone extends ZoneDef { color: string }
const z = (name: string, badge: string, color: string): Zone => ({ name, badge, color });
/** 평면도 구역 (옛 ALLOWED_ZONES). 위치 계산·툴팁·이동 기록이 이 이름을 쓴다 */
export const ZONES: Record<string, Zone> = {
  'stage1-wait': z('공정1실 (대기)', '공정1 대기', '#0D9488'),
  'stage1-1': z('공정1 설비 1호기', '공정1 (1호기)', '#0D9488'),
  'stage1-2': z('공정1 설비 2호기', '공정1 (2호기)', '#0D9488'),
  stage1: z('공정1실', '공정1', '#0D9488'),
  'stage2-wait': z('공정2실 (대기)', '공정2 대기', '#DC2626'),
  stage2: z('공정2실', '공정2', '#DC2626'),
  'stage3-wait': z('공정3실 (대기)', '공정3 대기', '#7C3AED'),
  'stage3-1': z('공정3 설비 1호기', '공정3 (1호기)', '#7C3AED'),
  'stage3-2': z('공정3 설비 2호기', '공정3 (2호기)', '#7C3AED'),
  'stage3': z('공정3실', '공정3', '#7C3AED'),
  'stage4-wait': z('공정4실 (대기)', '공정4 대기', '#F59E0B'),
  'stage4-1': z('공정4 설비 1호기', '공정4 (1호기)', '#F59E0B'),
  'stage4-2': z('공정4 설비 2호기', '공정4 (2호기)', '#F59E0B'),
  stage4: z('공정4실', '공정4', '#F59E0B'),
  'stage5-wait': z('공정5실 (대기)', '공정5 대기', '#2563EB'),
  stage5: z('공정5실', '공정5', '#2563EB'),
  'semi-discharge': z('반제품 반출실', '반출실', '#0284c7'),
  'semi-storage-pre': z('반제품 보관실 (이전)', '보관실 (이전)', '#64748b'),
  'semi-storage-post': z('반제품 보관실 (이후)', '보관실 (이후)', '#64748b'),
  inspection: z('검사실', '검사실', '#10b981'),
  'packaging-wait': z('포장실 (대기)', '포장 대기', '#059669'),
  packaging: z('포장실', '포장실', '#059669'),
  logistics: z('완제품 창고', '완제품 창고', '#10b981')
};

/** 게이지가 있는 진행 구역과 그 구역의 공정 */
export const MACHINE_ZONES: Record<string, { step: string; name: string }> = {
  'stage1-1': { step: 'A', name: '공정1 설비 1호기' },
  'stage1-2': { step: 'A', name: '공정1 설비 2호기' },
  stage2: { step: 'B', name: '공정2실' },
  'stage3-1': { step: 'C', name: '공정3 설비 1호기' },
  'stage3-2': { step: 'C', name: '공정3 설비 2호기' },
  'stage4-1': { step: 'D', name: '공정4 설비 1호기' },
  'stage4-2': { step: 'D', name: '공정4 설비 2호기' },
  stage5: { step: 'E', name: '공정5실' },
  inspection: { step: 'inspection', name: '검사' },
  packaging: { step: 'packaging', name: '포장' }
};

/** 스케줄 한 공정의 시작·종료 시각 (8자리 코드는 올해로 읽는다) */
export const stepTime = (s: ScheduleStep | undefined, isStart: boolean, now = new Date()) => parseScheduleTime(s, isStart, now.getFullYear());

/** 완제품 창고에 든 배치 (평면도에 칩을 그리지 않는다) */
export const inWarehouse = (b: Batch, zoneId: string) =>
  zoneId === 'logistics' || b.assignedZone === 'logistics' || b.manualZone === 'logistics' || Boolean(b.completed_at);
