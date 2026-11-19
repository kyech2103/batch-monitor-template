// 메인 화면 시작: 시작 가림막을 걷고 배치·담당자·장비 예약 동기화를 건 뒤, 로그인 상태에 따라 로그인 창을 띄운다.
// 가림막 마크업은 index.html #start-gate. 가림막은 화면만 가린다: 실제 권한은 DB(행 단위 권한)가 검사한다
import { sb } from '../sb';
import { startJobs } from '../equipment/jobs';
import { startManagers } from '../pm/managers';
import { drainOldPendingTransfers } from '../rooms/RoomDialogs';
import { batchSync } from './batches';
import { updateCurrentUserUI } from './auth';

declare global { interface Window { QA_MODE?: boolean } }

let started = false;

function clearStartGate() {
  const gate = document.getElementById('start-gate');
  const reveal = () => {
    document.body.classList.remove('auth-pending');
    if (window.MobileApp?.isMobileMode?.()) window.MobileApp.renderApp();
  };
  if (!gate) return reveal();
  gate.classList.add('is-cleared');
  setTimeout(() => { gate.style.display = 'none'; reveal(); }, 320);
}

function startAppData() {
  // 모바일 '다시 확인'으로 여러 번 불려도 데이터 구독·주기 갱신은 한 번만 건다
  if (started) return;
  started = true;
  batchSync.start();
  window.renderBatchIcons?.();
  startManagers();
  startJobs();
  drainOldPendingTransfers();
  window.fetchMyTodayTodoCount?.();
  setInterval(() => window.fetchMyTodayTodoCount?.(), 5 * 60 * 1000);
  setInterval(() => window.renderBatchIcons?.(), 1000);
}

export async function runAppStart(): Promise<void> {
  let session = null;
  if (!window.QA_MODE) {
    session = (await sb.auth.getSession().catch(() => null))?.data.session ?? null;
    // 로그인하지 않은 화면에는 이 브라우저에 남은 배치 사본(직전 사용자 것)도 그리지 않는다
    if (!session) localStorage.removeItem('APP_BATCH_RECORDS');
  }
  clearStartGate();
  startAppData();

  const w = window.currentWorker;
  // 로컬 화면 점검용: ?qa=true면 가짜 작업자로 바로 연다 (localhost 계열에서만, index.html QA_MODE)
  if (window.QA_MODE) {
    updateCurrentUserUI(w || { id: 0, name: 'QA 테스터', display: 'QA 검증관', color: '#10b981' });
    return window.closeOperatorModal();
  }
  if (session && w && (w.name || w.display)) {
    updateCurrentUserUI(w);
  } else {
    updateCurrentUserUI(null);
    setTimeout(() => window.openOperatorModal(true), 380);
  }
}
