const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoomStore, drag, SAVE_RETRY_MS } = require('../src/rooms/store.ts');

const clone = v => JSON.parse(JSON.stringify(v));
const kind = {
  initial: () => ({ items: [], tray: [] }),
  fromLocal: v => (v && Array.isArray(v.items) ? v : null),
  fromServer: v => (v && Array.isArray(v.items) ? { tray: [], ...v } : null),
  has: (m, uid) => m.items.includes(uid) || m.tray.some(t => t.uid === uid),
  arrive: (m, it, from) => m.tray.unshift({ uid: it.uid, from })
};

// 서버의 shelf_data 한 행과 실시간 채널을 흉내 낸다
function setup({ server = { items: ['s'], tray: [] }, local = null, failUpserts = 0, immediate = true } = {}) {
  const row = { data: clone(server) };
  const upserts = [], handlers = {}, sent = [];
  let fails = failUpserts, readGate = null;
  const sb = {
    from: () => ({
      upsert: async r => { upserts.push(clone(r)); if (fails > 0) { fails--; return { error: { message: 'x' } }; } row.data = clone(r.data); return { error: null }; },
      select: () => ({ eq: () => ({ single: async () => { if (readGate) await readGate; return { data: { data: clone(row.data) }, error: null }; } }) })
    }),
    channel: () => {
      const ch = { on: (type, f, cb) => { handlers[type] = cb; return ch; }, subscribe: () => ch, send: async m => sent.push(m) };
      return ch;
    }
  };
  const mem = new Map(local ? [['K', JSON.stringify(local)]] : []);
  const store = createRoomStore(sb, { dbId: 'room1', name: '방', storageKey: 'K', channel: 'shelf-room1', immediate, kind },
    { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) });
  return { store, row, upserts, handlers, sent, mem, gate: p => { readGate = p; } };
}
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

test('처음에는 이 기기 사본을 보여 주고, 서버를 읽으면 서버 값으로 바꾼다', async () => {
  const { store } = setup({ local: { items: ['local'], tray: [] } });
  assert.deepEqual(store.get().items, ['local']);
  await store.start();
  assert.deepEqual(store.get().items, ['s']);
  assert.equal(store.status().text, '실시간 동기화 완료');
});

test('편집은 서버에 쓰고 바뀌었다는 신호만 보낸다', async () => {
  const { store, upserts, sent, row } = setup();
  await store.start();
  store.edit(m => { m.items.push('new'); });
  await tick();
  assert.deepEqual(upserts.map(u => [u.room_id, u.data.items]), [['room1', ['s', 'new']]]);
  assert.deepEqual(row.data.items, ['s', 'new']);
  assert.deepEqual(sent, [{ type: 'broadcast', event: 'SHELF_DATA_UPDATED', payload: {} }]);
});

test('저장에 실패하면 편집을 지키고(서버 값으로 덮지 않음) 잠시 뒤 다시 보낸다', async t => {
  const { store, upserts, handlers } = setup({ failUpserts: 1 });
  await store.start();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  store.edit(m => { m.items.push('mine'); });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(store.status().text, '⚠️ 동기화 오류');
  handlers.postgres_changes({ new: { data: { items: ['other'] } } });
  assert.deepEqual(store.get().items, ['s', 'mine'], '저장 안 된 편집이 있으면 남의 값으로 덮지 않음');
  t.mock.timers.tick(SAVE_RETRY_MS);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(upserts.length, 2);
  assert.deepEqual(upserts[1].data.items, ['s', 'mine']);
});

test('300ms 묶어 저장하는 방은 연달은 편집을 한 번에 쓴다', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { store, upserts } = setup({ immediate: false });
  store.edit(m => { m.items.push('a'); });
  store.edit(m => { m.items.push('b'); });
  assert.equal(store.status().text, '동기화 대기 중...');
  t.mock.timers.tick(300);
  await Promise.resolve();
  assert.equal(upserts.length, 1);
  assert.deepEqual(upserts[0].data.items, ['a', 'b']);
});

test('끌기 중에는 서버 값을 받지 않는다', async () => {
  const { store, handlers } = setup();
  await store.start();
  drag.active = true;
  handlers.postgres_changes({ new: { data: { items: ['other'] } } });
  drag.active = false;
  assert.deepEqual(store.get().items, ['s']);
  handlers.postgres_changes({ new: { data: { items: ['other'] } } });
  assert.deepEqual(store.get().items, ['other']);
  assert.equal(store.status().text, '타인 변경 실시간 반영됨');
});

test('다른 방에서 온 품목은 서버를 다 읽은 뒤 넣고, 이미 있으면 다시 넣지 않는다', async () => {
  let open;
  const { store, upserts, gate } = setup({ local: { items: ['stale'], tray: [] } });
  gate(new Promise(r => { open = r; }));
  const p = store.receive({ uid: 'X', text: '보낸 것' }, '비품실');
  await tick();
  assert.equal(upserts.length, 0, '첫 읽기 전에는 쓰지 않음 (이 기기의 오래된 사본을 서버에 쓰지 않게)');
  open();
  await p;
  await tick();
  assert.deepEqual(upserts.map(u => u.data), [{ items: ['s'], tray: [{ uid: 'X', from: '비품실' }] }]);
  await store.receive({ uid: 'X', text: '보낸 것' }, '비품실');
  assert.equal(upserts.length, 1);
});
