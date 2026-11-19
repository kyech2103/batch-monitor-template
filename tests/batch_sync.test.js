const test = require('node:test');
const assert = require('node:assert/strict');
const { createBatchSync } = require('../src/batch/sync.ts');

const clone = v => JSON.parse(JSON.stringify(v));

// 서버의 배치 한 행(current_batches)을 흉내 낸다: 읽으면 지금 목록, 쓰면 받은 목록으로 바뀐다
function load({ server = [], local = server, upsertError = null } = {}) {
  const store = new Map([['APP_BATCH_RECORDS', JSON.stringify(local)]]);
  const row = { data: clone(server) };
  const upserts = [];
  const sb = {
    from: () => ({
      upsert: async (r) => {
        upserts.push(clone(r.data));
        if (upsertError) return { data: null, error: upsertError };
        row.data = clone(r.data);
        return { data: null, error: null };
      },
      select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'current_batches', data: clone(row.data) }, error: null }) }) })
    })
  };
  const sync = createBatchSync(sb, () => {}, { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) });
  const ctx = { saveBatchesToServer: sync.save, commitBatchChange: sync.commit, fetchInitialBatchData: sync.refresh };
  return { ctx, upserts, row, local: () => JSON.parse(store.get('APP_BATCH_RECORDS')) };
}

test('연달아 저장해도 버리지 않고 차례대로 서버에 쓴다', async () => {
  const { ctx, upserts } = load();
  const a = [{ lotNumber: 'A' }];
  const b = [{ lotNumber: 'A' }, { lotNumber: 'B' }];
  const [ra, rb] = await Promise.all([ctx.saveBatchesToServer(a), ctx.saveBatchesToServer(b)]);
  assert.equal(ra.success, true);
  assert.equal(rb.success, true);
  assert.deepEqual(upserts, [a, b]);
});

test('50개를 넘으면 쓰지 않고, 화면에 보일 이유를 돌려준다', async () => {
  const { ctx, upserts } = load();
  const many = Array.from({ length: 51 }, (_, i) => ({ lotNumber: `L${i}` }));
  const r = await ctx.saveBatchesToServer(many);
  assert.equal(r.success, false);
  assert.match(r.message, /50개/);
  assert.equal(upserts.length, 0);
});

test('서버가 쓰기를 거부하면 화면에 보일 이유를 돌려준다', async () => {
  const { ctx } = load({ upsertError: { message: 'permission denied' } });
  const r = await ctx.saveBatchesToServer([{ lotNumber: 'A' }]);
  assert.equal(r.success, false);
  assert.match(r.message, /저장 실패/);
});

test('PC 쓰기는 서버 최신 목록에서 그 로트만 바꿔, 다른 PC가 만든 배치를 지우지 않는다', async () => {
  const mine = { lotNumber: 'A', manualZone: 'stage1-wait' };
  const theirs = { lotNumber: 'X', manualZone: 'packaging' };
  const { ctx, upserts, local } = load({ server: [theirs, mine], local: [mine] });
  const r = await ctx.commitBatchChange('A', b => { b.manualZone = 'stage5-wait'; return b; });
  assert.equal(r.success, true);
  assert.deepEqual(upserts, [[theirs, { lotNumber: 'A', manualZone: 'stage5-wait' }]]);
  assert.deepEqual(local(), upserts[0]);
});

test('새 배치는 맨 앞에 넣고, null을 돌려주면 그 로트만 지운다', async () => {
  const { ctx, row } = load({ server: [{ lotNumber: 'A' }, { lotNumber: 'B' }] });
  await ctx.commitBatchChange(null, () => ({ lotNumber: 'N' }));
  await ctx.commitBatchChange('A', () => null);
  assert.deepEqual(row.data, [{ lotNumber: 'N' }, { lotNumber: 'B' }]);
});

test('다른 곳에서 이미 지운 로트는 쓰지 않고, 화면을 서버 목록으로 되돌린다', async () => {
  const { ctx, upserts, local } = load({ server: [{ lotNumber: 'X' }], local: [{ lotNumber: 'A' }, { lotNumber: 'X' }] });
  const r = await ctx.commitBatchChange('A', b => { b.manualZone = 'stage5-wait'; return b; });
  assert.equal(r.success, false);
  assert.match(r.message, /\[A\]/);
  assert.equal(upserts.length, 0);
  assert.deepEqual(local(), [{ lotNumber: 'X' }]);
});

test('서버 목록이 비어 있으면 이 탭의 목록도 비운다', async () => {
  const { ctx, local } = load({ server: [], local: [{ lotNumber: 'A' }] });
  await ctx.fetchInitialBatchData();
  assert.deepEqual(local(), []);
});

test('한 쓰기가 예외로 끝나도 다음 쓰기는 막히지 않는다', async () => {
  const { ctx, upserts } = load({ server: [{ lotNumber: 'A', fromServer: true }], local: [{ lotNumber: 'A' }] });
  const failed = await ctx.commitBatchChange('A', b => { if (b.fromServer) throw new Error('boom'); return b; });
  assert.deepEqual([failed.success, failed.message], [false, 'boom']);
  const r = await ctx.saveBatchesToServer([{ lotNumber: 'B' }]);
  assert.equal(r.success, true);
  assert.deepEqual(upserts, [[{ lotNumber: 'B' }]]);
});

test('저장 검사는 받은 목록을 고치지 않고, 허용 안 된 글자만 뺀 사본을 쓴다', async () => {
  const { ctx, upserts } = load();
  const list = [{ lotNumber: 'A<B' }];
  await ctx.saveBatchesToServer(list);
  assert.equal(list[0].lotNumber, 'A<B');
  assert.deepEqual(upserts, [[{ lotNumber: 'AB' }]]);
});

test('PC에서 이미 있는 로트로 새로 만들거나 이름을 바꾸면 쓰지 않고 거부한다', async () => {
  const { ctx, upserts } = load({ server: [{ lotNumber: 'A' }, { lotNumber: 'B' }] });
  const created = await ctx.commitBatchChange(null, () => ({ lotNumber: 'A' }));
  const renamed = await ctx.commitBatchChange('B', b => ({ ...b, lotNumber: 'A' }));
  assert.match(created.message, /이미 있는 로트넘버/);
  assert.match(renamed.message, /이미 있는 로트넘버/);
  assert.equal(upserts.length, 0);
});

test('바꾸는 함수가 오류를 던지면(먼저 수정됨 등) 쓰지 않고 그 문장을 돌려주며, 화면은 서버 목록으로', async () => {
  const server = [{ lotNumber: 'A', remarks: { A: '서버에서 바뀜' } }];
  const { ctx, upserts, local } = load({ server, local: [{ lotNumber: 'A' }] });
  const r = await ctx.commitBatchChange('A', b => {
    if (b.remarks) throw new Error('다른 곳에서 먼저 수정했어요');
    return { ...b, memo: 'x' };
  });
  assert.equal(r.success, false);
  assert.equal(r.message, '다른 곳에서 먼저 수정했어요');
  assert.equal(upserts.length, 0);
  assert.deepEqual(local(), server);
});
