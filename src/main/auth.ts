// 작업자 로그인(Supabase Auth 이메일·비밀번호)과 머리띠 작업자 표시. 입력창 마크업은 index.html #operator-auth-modal
// 로그인한 계정이 직원 표(workers)에 등록돼 있어야 작업자로 인정한다. 실제 권한은 DB(행 단위 권한)가 검사한다
import { sb } from '../sb';
import { applyUserWatermark } from '../watermark';

export interface Worker { id?: number; name?: string; display?: string; dept?: string; department?: string; email?: string; is_admin?: boolean; color?: string }
declare global {
  interface Window {
    currentWorker: Worker | null;
    updateCurrentUserUI(w: Worker | null): void;
    openOperatorModal(forceNew?: boolean): void;
    closeOperatorModal(): void;
  }
}

export const OPERATOR_KEY = 'APP_VERIFIED_OPERATOR';
let worker: Worker | null = null;
let busy = false;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

function displayOf(w: Worker): string {
  const name = w.name || '작업자', dept = w.dept || w.department || '';
  return dept ? `${name} (${dept})` : w.email ? `${name} (${w.email})` : name;
}

export function updateCurrentUserUI(w: Worker | null): void {
  const badge = $('user-info-badge'), label = $('current-user-display');
  if (w && (w.name || w.display)) {
    worker = w;
    w.display = displayOf(w);
    window.currentUserEmail = w.display;
    if (label) label.textContent = w.name || '작업자';
    badge?.classList.remove('is-unverified');
    if (badge) badge.title = `인증된 작업자: ${w.display} (클릭하여 작업자 변경)`;
  } else {
    worker = null;
    window.currentUserEmail = '';
    if (label) label.textContent = '미인증 (클릭하여 로그인)';
    badge?.classList.add('is-unverified');
    if (badge) badge.title = '작업자 미인증 상태입니다. 클릭하여 로그인하세요.';
  }
  const admin = $('btn-worker-admin-trigger');
  if (admin) admin.style.display = worker?.is_admin ? '' : 'none';
  applyUserWatermark(worker?.name);
  if (window.MobileApp?.isMobileMode?.()) window.MobileApp.renderApp();
  window.refreshTodoOnAuthChange?.();
}

const inputs = () => ({ email: $<HTMLInputElement>('operator-email-input'), password: $<HTMLInputElement>('operator-password-input') });

function setBusyUI(on: boolean) {
  const loading = $('auth-loading-indicator'), btn = $<HTMLButtonElement>('btn-verify-code'), { password } = inputs();
  if (loading) loading.style.display = on ? 'flex' : 'none';
  if (btn) btn.disabled = on;
  if (password) password.disabled = on;
}

function showError(msg: string) {
  const box = $('auth-error-msg'), text = $('auth-error-text'), { password } = inputs();
  if (text) text.textContent = msg || '로그인하지 못했습니다.';
  if (box) {
    box.style.display = 'flex';
    box.classList.remove('auth-shake');
    void box.offsetWidth; // 흔들기 애니메이션을 다시 걸려면 한 번 그려야 한다
    box.classList.add('auth-shake');
  }
  setBusyUI(false);
  password?.focus();
  password?.select();
}

export function openOperatorModal(forceNew = false): void {
  const modal = $<HTMLDialogElement>('operator-auth-modal');
  if (!modal) return;
  const err = $('auth-error-msg');
  if (err) err.style.display = 'none';
  setBusyUI(false);
  const { email, password } = inputs();
  if (password) password.value = '';
  if (email && worker?.email) email.value = worker.email;
  // 이미 인증된 작업자가 바꾸려고 열었으면 취소·닫기, 인증돼 있으면 로그아웃도 보인다
  const canCancel = !forceNew && !!worker;
  for (const id of ['btn-cancel-auth', 'btn-close-auth-modal']) { const b = $(id); if (b) b.style.display = canCancel ? 'inline-block' : 'none'; }
  const logout = $('btn-logout-auth');
  if (logout) logout.style.display = worker ? 'inline-block' : 'none';
  if (!modal.open) modal.showModal();
  setTimeout(() => (email && !email.value ? email : password)?.focus(), 150);
}

export function closeOperatorModal(): void {
  $<HTMLDialogElement>('operator-auth-modal')?.close();
}

async function login() {
  if (busy) return;
  const { email: emailEl, password: passwordEl } = inputs();
  const email = (emailEl?.value || '').trim(), password = passwordEl?.value || '';
  if (!email || !password) return showError('이메일과 비밀번호를 입력해 주세요.');
  const err = $('auth-error-msg');
  if (err) err.style.display = 'none';
  busy = true;
  setBusyUI(true);
  try {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) return showError('이메일 또는 비밀번호가 맞지 않습니다.');
    const { data: workerId } = await sb.rpc('current_worker_id');
    const { data: row } = workerId
      ? await sb.from('workers').select('id, name, department, is_admin').eq('id', workerId).single()
      : { data: null };
    if (!row) {
      await sb.auth.signOut();
      return showError('직원으로 등록되지 않은 계정입니다. 관리자에게 등록을 요청해 주세요.');
    }
    const info: Worker = { id: row.id, name: row.name || '작업자', email, dept: row.department || '', is_admin: Boolean(row.is_admin) };
    info.display = displayOf(info);
    localStorage.setItem(OPERATOR_KEY, JSON.stringify(info));
    // 로그인 전에 연 화면은 DB를 못 읽은 상태다: 한 번 새로 고쳐 다시 읽는다
    location.reload();
  } catch (e) {
    console.error('로그인 실패:', e);
    showError('서버와 통신하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  } finally {
    busy = false;
  }
}

function readStoredWorker(): Worker | null {
  try {
    const w = JSON.parse(localStorage.getItem(OPERATOR_KEY) || 'null') as Worker | null;
    if (w?.name) w.display = displayOf(w);
    return w;
  } catch {
    return null;
  }
}

export function setupAuth(): void {
  worker = readStoredWorker();
  window.currentUserEmail = worker?.display || worker?.name || '';
  // 다른 화면 코드(모바일·QA)가 읽는다. 바꾸려면 updateCurrentUserUI
  Object.defineProperty(window, 'currentWorker', { get: () => worker, configurable: true });
  Object.assign(window, { updateCurrentUserUI, openOperatorModal, closeOperatorModal });

  $('btn-worker-admin-trigger')?.addEventListener('click', () => window.WorkerAdmin?.open());
  const badge = $('user-info-badge');
  badge?.addEventListener('click', () => window.openOperatorModal(false));
  badge?.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.openOperatorModal(false); }
  });
  $('btn-verify-code')?.addEventListener('click', login);
  $('btn-cancel-auth')?.addEventListener('click', () => { if (worker) closeOperatorModal(); });
  $('btn-close-auth-modal')?.addEventListener('click', () => { if (worker) closeOperatorModal(); });
  $('btn-logout-auth')?.addEventListener('click', () => {
    localStorage.removeItem(OPERATOR_KEY);
    // 로그아웃한 화면에 배치가 남지 않게 새로 연다 (새로 열면 시작할 때 배치 사본을 지우고 로그인 창을 띄운다)
    sb.auth.signOut().catch(() => {}).finally(() => location.reload());
  });
  inputs().password?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); login(); }
  });
}
