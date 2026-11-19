// 작업 알림(웹 푸시) 켜기·끄기·테스트 창과, 앱을 열 때 브라우저 구독을 서버와 맞추기 (옛 js/push_client.js).
// 창 마크업은 index.html #push-settings-modal
import type { SupabaseLike } from '../supabase.ts';
import { SUPABASE_KEY, SUPABASE_URL } from '../supabase.ts';
import { VAPID_PUBLIC_KEY } from '../config.ts';
import { showToast } from '../main/toast.ts';

declare global { interface Window { PushClient?: { openModal(): void } } }

const KEY_SUBSCRIBED = 'APP_PUSH_SUBSCRIBED';
const KEY_LAST_REG = 'APP_PUSH_LAST_REGISTERED';
// 구독을 등록한 작업자는 이름으로 기억한다 (다른 작업자가 로그인하면 바로 다시 등록)
const KEY_REG_WORKER = 'APP_PUSH_REGISTERED_WORKER';
const PUSH_FUNCTION_URL = SUPABASE_URL + '/functions/v1/todo-push';
type State = 'unauth' | 'unsupported' | 'ios_browser' | 'denied' | 'off' | 'on';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

/** 창이 열려 있으면 창 안 문구로, 닫혀 있으면 토스트로 */
function pushNotice(msg: string) {
  const el = $('push-action-msg');
  if (el) el.textContent = msg;
  if (!$<HTMLDialogElement>('push-settings-modal')?.open) showToast(msg);
}

function storedWorker(): { id?: number; name?: string } | null {
  try { return JSON.parse(localStorage.getItem('APP_VERIFIED_OPERATOR') || 'null'); } catch { return null; }
}

function platform(): 'android' | 'ios' | 'other' {
  const ua = navigator.userAgent || '';
  return /android/i.test(ua) ? 'android' : /iphone|ipad|ipod/i.test(ua) ? 'ios' : 'other';
}

function isIosBrowserNotStandalone() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone);
  return platform() === 'ios' && !standalone;
}

function vapidKey(): Uint8Array<ArrayBuffer> {
  const b64 = (VAPID_PUBLIC_KEY + '='.repeat((4 - (VAPID_PUBLIC_KEY.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

function b64url(buffer: ArrayBuffer | null): string {
  if (!buffer) return '';
  return btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function register(sb: SupabaseLike, sub: PushSubscription) {
  return sb.rpc('register_push_subscription', {
    p_endpoint: sub.endpoint,
    p_p256dh: b64url(sub.getKey('p256dh')),
    p_auth: b64url(sub.getKey('auth')),
    p_platform: platform()
  });
}

function currentState(): State {
  if (!storedWorker()?.id) return 'unauth';
  // 아이폰 Safari는 홈 화면에 설치하기 전에는 알림 기능 자체가 없다: '미지원' 대신 설치 안내를 보여야 한다
  if (isIosBrowserNotStandalone()) return 'ios_browser';
  if (!('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return localStorage.getItem(KEY_SUBSCRIBED) === 'true' ? 'on' : 'off';
}

function setBtn(id: string, visible: boolean, enabled: boolean) {
  const b = $<HTMLButtonElement>(id);
  if (!b) return;
  b.style.display = visible ? '' : 'none';
  b.disabled = !enabled;
  b.style.opacity = enabled ? '' : '0.45';
  b.style.cursor = enabled ? '' : 'not-allowed';
}

function applyButtons(state: State) {
  // [보이기, 켜짐] 켜기·끄기·테스트
  const [en, dis, test]: [boolean, boolean][] =
    state === 'ios_browser' ? [[false, false], [false, false], [false, false]]
    : state === 'on' ? [[false, false], [true, true], [true, true]]
    : state === 'off' ? [[true, true], [true, false], [true, false]]
    : [[true, false], [true, false], [true, false]];
  setBtn('btn-push-enable', ...en);
  setBtn('btn-push-disable', ...dis);
  setBtn('btn-push-test', ...test);
}

function formatLastRegistered(ts: string | null) {
  const d = new Date(Number(ts) || Date.now());
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function updateUI(state: State) {
  const show = (id: string, on: boolean) => { const el = $(id); if (el) el.style.display = on ? 'block' : 'none'; };
  show('push-ios-guide', state === 'ios_browser');
  show('push-android-note', platform() === 'android');
  show('push-ios-note', platform() === 'ios' && state !== 'ios_browser');
  applyButtons(state);
  const info = {
    unauth: ['미인증', '작업자 인증 후 사용할 수 있습니다'],
    unsupported: ['미지원', '이 브라우저는 알림을 지원하지 않습니다'],
    ios_browser: ['설치 필요', '아이폰은 홈 화면에 추가한 뒤 그 아이콘으로 열어야 알림을 켤 수 있습니다'],
    denied: ['차단됨', '알림 권한이 차단됨 (브라우저 설정에서 허용 필요)'],
    off: ['꺼짐', '알림 꺼짐'],
    on: ['켜짐', `알림 켜짐 · 마지막 등록 ${formatLastRegistered(localStorage.getItem(KEY_LAST_REG))}`]
  }[state];
  const badge = $('push-status-badge'), text = $('push-status-text');
  if (badge) badge.textContent = info[0];
  if (text) text.textContent = info[1];
}

async function enable(sb: SupabaseLike) {
  const worker = storedWorker();
  if (!worker?.id) return pushNotice('작업자 인증 후 이용해 주세요.');
  if (await Notification.requestPermission() !== 'granted') return updateUI(currentState());
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKey() });
    const { error } = await register(sb, sub);
    if (error) throw error;
    localStorage.setItem(KEY_SUBSCRIBED, 'true');
    localStorage.setItem(KEY_LAST_REG, String(Date.now()));
    localStorage.setItem(KEY_REG_WORKER, String(worker.name || ''));
    updateUI('on');
    pushNotice('✅ 알림이 켜졌습니다.');
  } catch {
    pushNotice('등록 실패: 잠시 후 다시 시도해 주세요');
    updateUI('off');
  }
}

async function disable(sb: SupabaseLike) {
  try {
    const sub = await (await navigator.serviceWorker?.getRegistration())?.pushManager.getSubscription();
    if (sub) {
      await sub.unsubscribe();
      await sb.rpc('unregister_push_subscription', { p_endpoint: sub.endpoint });
    }
  } catch { /* 서버 기록이 남아도 다음 발송 때 만료로 지워진다 */ }
  localStorage.removeItem(KEY_SUBSCRIBED);
  updateUI('off');
  pushNotice('알림이 해제되었습니다.');
}

function testMessage(data: { ok?: boolean; reason?: string } | null) {
  if (data?.ok) return '✅ 테스트 알림을 보냈습니다. 몇 초 안에 도착합니다.';
  return { not_registered: '등록 정보가 없습니다. 알림 끄기 후 다시 켜 주세요.', rate_limited: '1분 뒤에 다시 눌러 주세요.', gone: '알림 등록이 만료되었습니다. 알림을 다시 켜 주세요.' }[data?.reason || '']
    || '테스트 알림 전송에 실패했습니다.';
}

async function sendTest() {
  const btn = $<HTMLButtonElement>('btn-push-test');
  if (btn) btn.disabled = true;
  pushNotice('보내는 중…');
  try {
    const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
    if (!sub) return pushNotice('구독 정보를 찾을 수 없습니다.');
    let data = null;
    try {
      const res = await fetch(PUSH_FUNCTION_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY }, body: JSON.stringify({ action: 'test', endpoint: sub.endpoint }) });
      data = await res.json();
    } catch { /* 아래에서 실패 문구 */ }
    if (data?.reason === 'gone') {
      await sub.unsubscribe().catch(() => {}); // 죽은 구독을 남기면 다음 실행 때 그대로 재등록된다
      localStorage.removeItem(KEY_SUBSCRIBED);
      updateUI('off');
    }
    pushNotice(testMessage(data));
  } catch {
    pushNotice('테스트 알림 전송에 실패했습니다.');
  } finally {
    applyButtons(currentState());
  }
}

/**
 * 앱을 열 때마다 브라우저의 실제 구독과 맞춘다. 크롬은 구독이 만료돼도 pushsubscriptionchange를 안 보내므로
 * 켜 둔 상태(표시 또는 살아 있는 구독)인데 구독이 없으면 조용히 다시 만들고 서버에 등록한다
 */
export async function checkSilentResubscribe(sb: SupabaseLike): Promise<void> {
  const worker = storedWorker();
  if (!worker?.id || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    let sub = reg && (await reg.pushManager.getSubscription());
    const wasOn = localStorage.getItem(KEY_SUBSCRIBED) === 'true';
    // 직접 끄면 마지막 등록 기록은 남는다. 구독·켜짐 표시·등록 기록이 모두 없는데 권한은 허용이면
    // 크롬 '쿠키 및 사이트 데이터' 삭제로 지워진 것이라 다시 켠다
    if (!sub && !wasOn && localStorage.getItem(KEY_LAST_REG) !== null) return;
    const lastReg = Number(localStorage.getItem(KEY_LAST_REG) || 0);
    // 기록이 없는 기존 설치는 같은 작업자로 본다(다음 갱신 때 기록됨)
    const regWorker = localStorage.getItem(KEY_REG_WORKER);
    const sameWorker = regWorker === null || regWorker === String(worker.name || '');
    // 정상 상태면 하루 한 번만 서버 갱신. 다른 작업자가 이 폰으로 인증했으면 알림이 이전 사람에게 가므로 바로 다시 등록
    if (sub && wasOn && sameWorker && Date.now() - lastReg < 24 * 60 * 60 * 1000) return;
    if (!sub) sub = await (reg || (await navigator.serviceWorker.register('/sw.js'))).pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKey() });
    localStorage.setItem(KEY_SUBSCRIBED, 'true');
    const { error } = await register(sb, sub);
    if (!error) {
      localStorage.setItem(KEY_LAST_REG, String(Date.now()));
      localStorage.setItem(KEY_REG_WORKER, String(worker.name || ''));
    }
  } catch { /* 다음에 앱을 열 때 다시 맞춘다 */ }
}

export function setupPushClient(sb: SupabaseLike): void {
  const modal = $<HTMLDialogElement>('push-settings-modal');
  const openModal = () => {
    if (!modal) return;
    const msg = $('push-action-msg');
    if (msg) msg.textContent = '';
    updateUI(currentState());
    if (!modal.open) modal.showModal();
  };
  window.PushClient = { openModal };
  $('btn-push-settings')?.addEventListener('click', openModal);
  $('btn-push-modal-close')?.addEventListener('click', () => modal?.close());
  $('btn-push-modal-cancel')?.addEventListener('click', () => modal?.close());
  $('btn-push-enable')?.addEventListener('click', () => enable(sb));
  $('btn-push-disable')?.addEventListener('click', () => disable(sb));
  $('btn-push-test')?.addEventListener('click', sendTest);
  checkSilentResubscribe(sb);
}
