// 모바일 화면 껍데기: 화면 폭에 따라 모바일 모드 전환, 주소(#m=탭&lot=)로 탭 이동, 헤더·탭 바·더보기, 연결 끊김 안내 화면.
// 탭 내용은 각 탭 파일(BatchViews·TodoTab·EqTab)이 #m-content-root에 그린다. PC 쪽 코드는 window.MobileApp으로 알려 온다
import { formatDateTime } from '../equipment/core';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { renderBatchDetail, renderBatchList } from './BatchViews';
import { renderTodoTab } from './TodoTab';
import { renderEqTab } from './EqTab';
import { mount } from './mount';

type Tab = 'batch' | 'todo' | 'equipment' | 'more';
type Bridge = MobileBridgeLike & {
  openOperatorModal?(forceNew?: boolean): void;
  openPushSettingsModal?(): void;
};
interface InstallEvent extends Event { prompt(): void; userChoice: Promise<unknown> }
declare global {
  interface Window {
    MobileApp?: typeof api;
  }
  interface Navigator { standalone?: boolean }
}

const TABS: { id: Tab; icon: string; label: string; title: string }[] = [
  { id: 'batch', icon: '📦', label: '배치', title: '배치 모니터링' },
  { id: 'todo', icon: '📋', label: '할 일', title: '할 일 목록' },
  { id: 'equipment', icon: '🛠️', label: '장비', title: '장비' },
  { id: 'more', icon: '⚙️', label: '더보기', title: '더보기' }
];

let tab: Tab = 'batch';
let lot: string | null = null;
let offline = false;
let lastUpdate = new Date();
let lastBatchesJson: string | null = null;
let pendingUpdate = false;
let installEvent: InstallEvent | null = null; // 크롬이 설치 가능하다고 알려 준 이벤트. 눌렀을 때 설치 창을 띄우려고 보관
let appRoot: Root | null = null;

const bridge = () => window.MobileBridge as Bridge;
const mql = window.matchMedia?.('(max-width: 680px), (pointer: coarse) and (max-width: 920px)');
const isMobileMode = () => Boolean(mql?.matches);
const workerName = () => { const w = bridge()?.getWorker?.(); return w?.name || w?.display || '미인증'; };
const updatedText = () => { const m = Math.max(0, Math.floor((Date.now() - lastUpdate.getTime()) / 60000)); return m === 0 ? '방금 갱신' : `갱신 ${m}분 전`; };

function parseHash(): { tab: Tab; lot: string | null } {
  const h = location.hash || '';
  const t = h.match(/#m=([^&]+)/)?.[1] as Tab | undefined;
  const l = h.match(/&lot=([^&]+)/)?.[1];
  return { tab: t && TABS.some(x => x.id === t) ? t : 'batch', lot: l ? decodeURIComponent(l) : null };
}

function setRoute(t: Tab, l: string | null): void {
  tab = t;
  lot = l || null;
  const hash = `#m=${t}` + (t === 'batch' && l ? `&lot=${encodeURIComponent(l)}` : '');
  if (location.hash !== hash) location.hash = hash;
  renderApp();
}

// 이미 설치된 앱으로 열었으면 null, 아니면 [설치 버튼을 보일지, 안내 문구]
function installState(): [boolean, string] | null {
  if (window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone) return null;
  if (installEvent) return [true, '누르면 휴대폰 홈 화면에 앱으로 설치됩니다'];
  if (/iPhone|iPad|iPod/.test(navigator.userAgent)) return [false, '사파리 주소창 옆 ⋯ → 공유 → 홈 화면에 추가 → 추가. 홈 화면에 생긴 아이콘으로 열어야 알림을 받을 수 있습니다'];
  return [false, '크롬 오른쪽 위 ⋮ → 앱 설치(또는 홈 화면에 추가)'];
}

const rowStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 52 } as const;

function MoreTab() {
  const install = installState();
  const doInstall = () => {
    const ev = installEvent!;
    installEvent = null; // 설치 창은 이벤트당 한 번만 띄울 수 있다
    ev.prompt();
    ev.userChoice.finally(() => renderApp());
  };
  return (
    <>
      <div className="m-card" id="m-btn-open-push" role="button" style={{ ...rowStyle, cursor: 'pointer' }} onClick={() => bridge().openPushSettingsModal?.()}>
        <span style={{ fontWeight: 600, color: 'var(--pt-text)' }}>🔔 작업 알림 설정</span>
        <span style={{ color: 'var(--pt-muted)' }}>›</span>
      </div>
      <div className="m-card" id="m-btn-open-auth" role="button" style={{ ...rowStyle, cursor: 'pointer' }} onClick={() => bridge().openOperatorModal?.(false)}>
        <div>
          <div style={{ fontWeight: 600, color: 'var(--pt-text)' }}>작업자 인증·변경</div>
          <div style={{ fontSize: 13, color: 'var(--pt-accent)', marginTop: 2 }}>현재: {workerName()}</div>
        </div>
        <span style={{ color: 'var(--pt-muted)' }}>›</span>
      </div>
      {install && (
        <div className="m-card" id="m-btn-install" role={install[0] ? 'button' : undefined} style={{ ...rowStyle, cursor: install[0] ? 'pointer' : undefined }}
          onClick={install[0] ? doInstall : undefined}>
          <div>
            <div style={{ fontWeight: 600, color: 'var(--pt-text)' }}>📲 홈 화면에 앱 설치</div>
            <div style={{ fontSize: 13, color: 'var(--pt-muted)', marginTop: 2 }}>{install[1]}</div>
          </div>
          {install[0] && <span style={{ color: 'var(--pt-muted)' }}>›</span>}
        </div>
      )}
      <div className="m-card" style={{ minHeight: 52 }}>
        <div className="m-sub-line" style={{ marginBottom: 4 }}><span>앱 버전</span><span>v1.0.0 (모바일 1단계)</span></div>
        <div className="m-sub-line"><span>마지막 갱신 시각</span><span>{formatDateTime(new Date())}</span></div>
      </div>
    </>
  );
}

// 시작 전·작업자 미인증이면 localStorage 캐시 배치가 보이지 않게 막는다
function lockMessage(): string | null {
  if (document.body.classList.contains('auth-pending')) return '시작하는 중…';
  if (!window.currentUserEmail) return '작업자 인증 후 볼 수 있습니다';
  return null;
}

function renderTabContent(el: HTMLElement): void {
  const msg = lockMessage();
  if (msg) {
    const needAuth = !document.body.classList.contains('auth-pending');
    mount(el, 'lock', (
      <div className="m-card" style={{ textAlign: 'center', color: 'var(--pt-muted)', padding: '32px 16px' }}>
        {msg}
        {needAuth && <><br /><br /><button className="m-btn m-btn-primary" id="m-lock-auth-btn" style={{ minHeight: 44 }} onClick={() => bridge().openOperatorModal?.(true)}>작업자 인증</button></>}
      </div>
    ));
    return;
  }
  if (tab === 'batch') {
    if (lot) renderBatchDetail(el, lot, bridge(), () => setRoute('batch', null));
    else renderBatchList(el, bridge(), l => setRoute('batch', l));
  } else if (tab === 'todo') renderTodoTab(el, bridge());
  else if (tab === 'equipment') renderEqTab(el, bridge());
  else mount(el, 'more', <MoreTab />);
}

function Offline() {
  return (
    <div className="m-content">
      <div className="m-offline-screen">
        <div className="m-offline-icon">📶</div>
        <div className="m-offline-title">인터넷에 연결해 주세요</div>
        <div className="m-offline-desc">연결이 끊겨 최신 정보를 볼 수 없습니다.</div>
        <button className="m-btn m-btn-primary" id="m-offline-retry-btn" style={{ minWidth: 140 }}
          onClick={e => { e.currentTarget.disabled = true; e.currentTarget.textContent = '확인 중…'; offline = false; location.reload(); }}>다시 확인</button>
      </div>
    </div>
  );
}

function Shell() {
  return (
    <>
      <header className="m-header">
        <span className="m-header-title">{lot ? '배치 상세' : TABS.find(t => t.id === tab)!.title}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="m-header-user">{workerName()}</span>
          <span className="m-header-time">{updatedText()}</span>
        </div>
      </header>
      <main className="m-content" id="m-content-root" />
      <nav className="m-tab-bar" role="tablist">
        {TABS.map(t => (
          <button key={t.id} className={`m-tab-btn ${tab === t.id ? 'is-active' : ''}`} role="tab" data-tab={t.id} aria-selected={tab === t.id} onClick={() => setRoute(t.id, null)}>
            <span className="m-tab-icon">{t.icon}</span>
            <span className="m-tab-label">{t.label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}

function renderApp(): void {
  const appEl = document.getElementById('m-app');
  if (!appEl) return;
  appRoot ??= createRoot(appEl);
  const root = appRoot;
  if (offline) { flushSync(() => root.render(<Offline />)); return; }
  lastBatchesJson = JSON.stringify(bridge()?.getBatches?.() || []);
  flushSync(() => root.render(<Shell />));
  const content = document.getElementById('m-content-root');
  if (content) renderTabContent(content);
}

/** 헤더만 다시 그린다. React는 #m-content-root 안(탭 화면)은 건드리지 않는다 */
function updateHeaderTime(): void {
  const root = appRoot;
  if (root && !offline && document.getElementById('m-content-root')) flushSync(() => root.render(<Shell />));
}

function isEditingOrSheetOpen(): boolean {
  if (document.querySelector('.m-sheet-backdrop, .pt-dialog[open]')) return true;
  const a = document.activeElement;
  return Boolean(a && document.getElementById('m-content-root')?.contains(a) && a.matches('input, textarea, select'));
}

/** 탭 내용만 다시 그린다. 탭 화면들은 제자리로 다시 그리므로 스크롤만 지킨다 */
function renderContentOnly(): void {
  const el = document.getElementById('m-content-root');
  if (!el) return;
  const top = el.scrollTop;
  renderTabContent(el);
  el.scrollTop = top;
}

function flushPendingUpdate(): void {
  if (pendingUpdate && !isEditingOrSheetOpen()) {
    pendingUpdate = false;
    renderContentOnly();
  }
}

function notifyBatchUpdate(): void {
  if (!isMobileMode()) return;
  const json = JSON.stringify(bridge()?.getBatches?.() || []);
  if (lastBatchesJson !== null && lastBatchesJson === json) return;
  lastBatchesJson = json;
  lastUpdate = new Date();
  updateHeaderTime();
  if (tab !== 'batch') return;
  // 입력 중이거나 시트가 열려 있으면 닫힌 뒤에 다시 그린다
  if (isEditingOrSheetOpen()) { pendingUpdate = true; return; }
  renderContentOnly();
}

function showOffline(): void {
  if (!isMobileMode()) return;
  offline = true;
  renderApp();
}

function evaluateMode(): void {
  const appEl = document.getElementById('m-app');
  if (isMobileMode()) {
    document.body.classList.add('m-mode');
    appEl?.removeAttribute('hidden');
    ({ tab, lot } = parseHash());
    renderApp();
  } else {
    document.body.classList.remove('m-mode');
    appEl?.setAttribute('hidden', '');
  }
}

const api = {
  isMobileMode, notifyBatchUpdate, showOffline, setRoute, renderApp,
  /** 평면도를 그릴 때 PC 쪽이 부른다. 모바일 모드면 true(평면도 대신 모바일 갱신) */
  onRenderBatch: () => { if (!document.body.classList.contains('m-mode')) return false; notifyBatchUpdate(); return true; }
};

export function setupMobileApp(): void {
  window.MobileApp = api;
  mql?.addEventListener('change', evaluateMode);
  addEventListener('resize', evaluateMode);
  addEventListener('hashchange', () => { if (isMobileMode()) { ({ tab, lot } = parseHash()); renderApp(); } });
  const isField = (t: EventTarget | null) => t instanceof Element && t.matches('input, textarea, select');
  document.addEventListener('focusin', e => { if (isField(e.target)) document.body.classList.add('keyboard-open'); });
  document.addEventListener('focusout', e => { if (isField(e.target)) document.body.classList.remove('keyboard-open'); });
  // 열어 둔 채 연결이 끊기면 화면의 배치를 지우고 연결 안내 화면으로 (복귀는 '다시 확인'으로 새로 고침)
  addEventListener('offline', () => {
    if (!isMobileMode()) return;
    document.body.classList.add('auth-pending');
    showOffline();
  });
  addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); // 크롬 기본 안내 대신 [더보기]의 설치 버튼으로
    installEvent = e as InstallEvent;
    if (isMobileMode() && tab === 'more') renderApp();
  });
  addEventListener('appinstalled', () => {
    installEvent = null;
    if (isMobileMode() && tab === 'more') renderApp();
  });
  setInterval(updateHeaderTime, 60000);
  document.addEventListener('focusout', () => setTimeout(flushPendingUpdate, 60));
  new MutationObserver(flushPendingUpdate).observe(document.body, { childList: true, subtree: true });
  evaluateMode();
}
