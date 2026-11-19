// 평면도에서 배치를 다른 구역·완제품 창고로 옮긴다
import { applyZoneChange } from '../batch/core';
import { ZONES, inWarehouse } from '../batch/zone';
import { batchSync, readBatches, zoneInfo } from './batches';
import { pushAudit } from './audit';
import { showToast as toast } from './toast';

const zoneName = (z: string, fallback = z) => ZONES[z]?.name || fallback;

function commit(lot: string, to: string, from: string, action: string, detail: string) {
  const nowIso = new Date().toISOString();
  batchSync.commit(lot, b => { applyZoneChange(b!, to, nowIso, from); return b; }).then(res => {
    if (!res.success) return toast(`⚠️ ${res.message}`, 5000);
    pushAudit({ zone: '배치 공정', action, item: lot, from: zoneName(from, '공정 구역'), to: zoneName(to), detail });
  });
}

export function moveBatch(lot: string, to: string): void {
  if (to === 'logistics') return moveToWarehouse(lot);
  const b = readBatches().find(x => x.lotNumber === lot);
  const from = b && zoneInfo(b).zoneId;
  // 제자리에 놓으면 아무것도 쓰지 않는다. 이동 시각을 찍으면 공정 자동 진행이 멈춘다
  if (!b || from === to) return;
  commit(lot, to, from!, '배치 이동', `[${lot}] 공정 구역 이동: ${zoneName(from!, '공정 구역')} ➔ ${zoneName(to)}`);
  toast(`[${lot}] 배치가 ${zoneName(to)}(으)로 이동되었습니다.`);
}

export function moveToWarehouse(lot: string): void {
  if (!lot) return;
  const b = readBatches().find(x => x.lotNumber === lot);
  if (!b) return toast(`⚠️ 로트 [${lot}] 배치를 찾을 수 없습니다.`, 4000);
  const from = zoneInfo(b).zoneId;
  // 다시 입고하면 꺼낼 때 돌아갈 원래 위치가 지워진다
  if (inWarehouse(b, from)) return toast(`ℹ️ [${lot}] 배치는 이미 완제품 창고에 있습니다.`, 4000);
  commit(lot, 'logistics', from, '완제품 창고 입고', `[${lot}] 완제품 창고 입고: ${zoneName(from, '공정 구역')} ➔ 완제품 창고`);
  window.FinishedWarehouse?.refresh();
  toast(`✅ [${lot}] 배치가 완제품 창고로 입고되었습니다.`, 4000);
}

/** 완제품 창고에서 꺼내 들어오기 전 구역(없으면 포장실)으로 되돌린다. 이동 시각은 찍지 않는다(공정 자동 진행이 이어지게) */
export function restoreFromWarehouse(lot: string): void {
  const b = readBatches().find(x => x.lotNumber === lot);
  if (!b) return toast(`⚠️ [${lot}] 배치를 찾을 수 없습니다.`);
  const prev = b.prevZoneBeforeLogistics;
  const to = prev && prev !== 'logistics' && ZONES[prev] ? prev : 'packaging';
  const name = zoneName(to, '포장실');
  batchSync.commit(lot, x => {
    x!.manualZone = to;
    x!.assignedZone = to;
    delete x!.completed_at;
    delete x!.moved_to_storage_at;
    delete x!.enteredLogisticsAt;
    delete x!.prevZoneBeforeLogistics;
    return x;
  }).then(res => {
    if (!res.success) return toast(`⚠️ ${res.message}`, 5000);
    pushAudit({ zone: '완제품 창고', action: '배치 복원 (꺼내오기)', item: lot, from: '완제품 창고', to: name, detail: `[${lot}] 배치 완제품 창고에서 평면도(${name})로 복원됨` });
  });
  window.FinishedWarehouse?.refresh();
  toast(`↩️ 로트 [${lot}]가 [${name}]으로 복원되어 평면도에 다시 표시됩니다.`, 4000);
}
