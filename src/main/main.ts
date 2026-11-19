// 메인 화면(index.html) 진입점: 창·평면도·모바일 화면을 붙이고 로그인 확인부터 시작한다.
// window에 내놓는 이름은 E2E 테스트와 js/ 스크립트가 부르는 것이다. 이름을 바꾸면 그쪽이 깨진다
import * as core from '../batch/core';
import * as zone from '../batch/zone';
import * as quantity from '../batch/quantity';
import { ZONES } from '../batch/zone';
import { sb } from '../sb';
import { SUPABASE_KEY, SUPABASE_URL } from '../supabase';
import { setupWorkerAdmin } from '../admin/WorkerAdmin';
import { setupEquipmentModal } from '../equipment/EqModal';
import { startJobs } from '../equipment/jobs';
import { setupBatchDialog } from '../batches/BatchDialog';
import { openBatchEditSheet } from '../mobile/BatchEditSheet';
import { setupMobileApp } from '../mobile/MobileApp';
import { handleApplySchedule, openScheduleConfirmSheet } from '../mobile/TodoTab';
import { setupPmModal } from '../pm/PmModal';
import { setupPushClient } from '../push/client';
import { setupRoomDialogs } from '../rooms/RoomDialogs';
import { setupRulesModal } from '../todo/RulesModal';
import { setupTodoModal } from '../todo/TodoModal';
import { setupArchiveModal } from '../warehouse/ArchiveModal';
import { pushAudit } from './audit';
import { setupAuth } from './auth';
import { batchSync, zoneInfo } from './batches';
import { setupBoard } from './Board';
import { runAppStart } from './appStart';
import { moveToWarehouse } from './moves';
import { setupShell } from './shell';
import { showToast } from './toast';

declare global {
  interface Window {
    /** E2E가 연다 */
    openEquipmentModal(tab?: 'new' | 'list' | 'tpl'): void;
  }
}

// 모바일 화면이 PC 쪽 상태를 읽는 창구
const mobileBridge = {
  getSupabase: () => sb,
  // 저장된 값이 아니라 지금 인증된 작업자 (모바일은 열 때마다 다시 인증하므로 저장값은 이전 사람일 수 있다)
  getWorker: () => window.currentWorker,
  getBatches: () => {
    try { return JSON.parse(localStorage.getItem('APP_BATCH_RECORDS') || localStorage.getItem('BATCH_STORAGE_KEY') || '[]'); } catch { return []; }
  },
  getBatchZoneInfo: zoneInfo,
  calcBatchQuantities: quantity.batchQuantities,
  getBatchQtyForZone: quantity.qtyForZone,
  getZones: () => ZONES,
  openOperatorModal: (forceNew?: boolean) => window.openOperatorModal(forceNew),
  openPushSettingsModal: () => window.PushClient?.openModal(),
  recheck: () => location.reload()
};
window.MobileBridge = mobileBridge;

Object.assign(window, {
  SUPABASE_URL, SUPABASE_KEY, showToast, ALLOWED_ZONES: ZONES,
  BatchCore: { ...core, ...zone, ...quantity },
  escapeHtml: (s: unknown) => (s ? String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;') : ''),
  saveBatchesToServer: batchSync.save, fetchServerBatches: batchSync.fetchLatest, applyServerBatches: batchSync.apply, readBatchMirror: batchSync.read,
  pushToCentralAuditQueue: pushAudit,
  openBatchEditSheet, moveBatchToFinishedWarehouse: moveToWarehouse, startEquipmentJobs: startJobs,
  openEquipmentModal: (tab?: 'new' | 'list' | 'tpl') => window.EquipmentModal?.open(tab),
  // 모바일 '일정 반영' 확인 시트를 같이 쓴다
  MobileTodo: { openScheduleConfirmSheet, handleApplySchedule }
});

setupAuth();
setupShell();
setupBoard();
setupBatchDialog();
setupRoomDialogs();
setupWorkerAdmin();
setupEquipmentModal();
setupPmModal();
setupRulesModal();
setupTodoModal();
setupArchiveModal();
setupMobileApp();
setupPushClient(sb);
setTimeout(runAppStart, 0);
