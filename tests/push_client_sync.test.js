const test = require('node:test');
const assert = require('node:assert/strict');
const { checkSilentResubscribe } = require('../src/push/client.ts');

// 앱을 열 때 checkSilentResubscribe가 브라우저 실제 구독과 맞추는지 본다
async function run({ flag, sub, permission = 'granted', store = new Map(), worker = { id: 1 } }) {
  store.set('APP_VERIFIED_OPERATOR', JSON.stringify(worker));
  if (flag) store.set('APP_PUSH_SUBSCRIBED', 'true');
  const calls = { subscribe: 0, rpc: [] };
  const newSub = { endpoint: 'https://fcm.googleapis.com/new', getKey: () => new Uint8Array([1]) };
  const pushManager = {
    getSubscription: async () => sub,
    subscribe: async () => { calls.subscribe++; return newSub; }
  };
  const globals = {
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    navigator: { userAgent: 'Android', serviceWorker: { getRegistration: async () => ({ pushManager }), register: async () => ({ pushManager }) } },
    window: { PushManager: function () {}, Notification: {}, matchMedia: () => ({ matches: false }) },
    Notification: { permission },
    atob: () => '' // src/config.ts의 VAPID 공개 키는 자리표시라 실제 디코딩은 건너뛴다
  };
  for (const [k, value] of Object.entries(globals)) Object.defineProperty(globalThis, k, { value, configurable: true, writable: true });
  const sb = { rpc: async (name, args) => { calls.rpc.push(args.p_endpoint); return { error: null }; } };
  await checkSilentResubscribe(sb);
  return { calls, flag: store.get('APP_PUSH_SUBSCRIBED') };
}

const oldSub = { endpoint: 'https://fcm.googleapis.com/old', getKey: () => new Uint8Array([1]) };

test('켜 둔 상태인데 구독이 사라졌으면 다시 구독하고 서버에 등록', async () => {
  const r = await run({ flag: true, sub: null });
  assert.equal(r.calls.subscribe, 1);
  assert.deepEqual(r.calls.rpc, ['https://fcm.googleapis.com/new']);
  assert.equal(r.flag, 'true');
});

test('구독은 살아 있는데 저장 표시가 지워졌으면 켜짐으로 복구', async () => {
  const r = await run({ flag: false, sub: oldSub });
  assert.equal(r.calls.subscribe, 0);
  assert.deepEqual(r.calls.rpc, ['https://fcm.googleapis.com/old']);
  assert.equal(r.flag, 'true');
});

test('사용자가 끈 상태(표시·구독 없음, 등록 기록은 남음)는 그대로 둔다', async () => {
  const r = await run({ flag: false, sub: null, store: new Map([['APP_PUSH_LAST_REGISTERED', '1']]) });
  assert.equal(r.calls.subscribe, 0);
  assert.equal(r.calls.rpc.length, 0);
  assert.equal(r.flag, undefined);
});

test('크롬 사이트 데이터 삭제로 구독·표시·등록 기록이 모두 지워졌는데 권한은 허용이면 다시 켠다', async () => {
  const r = await run({ flag: false, sub: null });
  assert.equal(r.calls.subscribe, 1);
  assert.deepEqual(r.calls.rpc, ['https://fcm.googleapis.com/new']);
  assert.equal(r.flag, 'true');
});

test('알림 권한이 없으면 아무것도 하지 않는다', async () => {
  const r = await run({ flag: true, sub: null, permission: 'default' });
  assert.equal(r.calls.subscribe, 0);
  assert.equal(r.calls.rpc.length, 0);
});

test('같은 폰에 다른 작업자가 인증하면 하루를 기다리지 않고 새 작업자로 다시 등록', async () => {
  const store = new Map();
  await run({ flag: false, sub: oldSub, store, worker: { name: '김작업', id: 1 } });
  const same = await run({ flag: true, sub: oldSub, store, worker: { name: '김작업', id: 1 } });
  assert.equal(same.calls.rpc.length, 0, '같은 작업자는 하루 한 번만 갱신');
  const other = await run({ flag: true, sub: oldSub, store, worker: { name: '이작업', id: 2 } });
  assert.equal(other.calls.rpc.length, 1, '다른 작업자면 바로 다시 등록');
});
