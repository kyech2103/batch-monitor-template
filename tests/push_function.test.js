const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { handleRequest, createDbDeps, createSender, toBase64Url } = require('../supabase/functions/todo-push/index.ts');

function createMockReq(method, bodyObj, headers = {}) {
  const bodyText = typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj);
  const hMap = new Map();
  for (const [k, v] of Object.entries(headers)) {
    hMap.set(k.toLowerCase(), v);
  }
  return {
    method,
    headers: {
      get: (name) => hMap.get(name.toLowerCase()) || null,
      ...headers
    },
    text: async () => bodyText,
    json: async () => JSON.parse(bodyText)
  };
}

function createMockDeps(options = {}) {
  const subs = options.subs || [
    {
      id: 1,
      worker_id: 10,
      endpoint: 'https://fcm.googleapis.com/fcm/send/valid-token-1',
      p256dh: 'test-p256dh',
      auth: 'test-auth',
      fail_count: 0
    }
  ];
  const tasks = options.tasks || [
    {
      id: 101,
      worker_id: 10,
      target_date: '2026-10-26',
      target_time: '09:00',
      title: '계량',
      sort_order: 10
    }
  ];
  const sentLogs = new Set(options.sentLogs || []);
  const sentCalls = [];
  const deleted_ids = [];

  const db = {
    getCandidateTasks: async () => tasks,
    claimEquipmentPushes: async () => options.eqJobs || [],
    getSubscriptionsByWorker: async (workerId) => subs.filter((s) => s.worker_id === workerId),
    getSubscriptionByEndpoint: async (ep) => subs.find((s) => s.endpoint === ep) || null,
    isAlreadySent: async (subId, date, time) => sentLogs.has(`${subId}_${date}_${time}`),
    insertPushLog: async (log) => {
      sentLogs.add(`${log.subscription_id}_${log.target_date}_${log.target_time}`);
    },
    deleteSubscription: async (subId) => {
      deleted_ids.push(subId);
      const idx = subs.findIndex((s) => s.id === subId);
      if (idx >= 0) subs.splice(idx, 1);
    },
    incrementFailCount: async (subId) => {
      const s = subs.find((sub) => sub.id === subId);
      if (s) s.fail_count = (s.fail_count || 0) + 1;
    },
    updateSubscription: async (oldEp, newSub) => {
      const s = subs.find((sub) => sub.endpoint === oldEp);
      if (s) {
        s.endpoint = newSub.endpoint;
        s.p256dh = newSub.keys?.p256dh || s.p256dh;
        s.auth = newSub.keys?.auth || s.auth;
      }
    }
  };

  const sender = {
    sendNotification: async (sub, payload) => {
      sentCalls.push({ sub, payload });
      if (options.senderError) throw options.senderError;
      return { statusCode: options.senderStatus || 201 };
    }
  };

  let simulatedNow = options.nowMs || Date.parse('2026-10-26T08:55:30+09:00');

  return {
    db,
    sender,
    sentCalls,
    deleted_ids,
    config: { cron_secret: 'test-cron-secret-123' },
    now: () => simulatedNow,
    setNow: (ms) => { simulatedNow = ms; }
  };
}

test('AC-8: Edge Function 응답 코드 5가지 (401, 400, 413, 400, {ok:false}) 확인 및 업무 데이터 비노출', async () => {
  const deps = createMockDeps();

  // 1. cron 비밀 없음 -> 401
  const reqNoSecret = createMockReq('POST', { action: 'dispatch' });
  const resNoSecret = await handleRequest(reqNoSecret, deps);
  assert.equal(resNoSecret.status, 401);
  const bodyNoSecret = await resNoSecret.json();
  assert.equal(bodyNoSecret.ok, false);
  assert.equal(JSON.stringify(bodyNoSecret).includes('계량'), false);

  // 2. 모르는 action -> 400
  const reqUnknown = createMockReq('POST', { action: 'hack' });
  const resUnknown = await handleRequest(reqUnknown, deps);
  assert.equal(resUnknown.status, 400);
  const bodyUnknown = await resUnknown.json();
  assert.equal(bodyUnknown.ok, false);
  assert.equal(JSON.stringify(bodyUnknown).includes('계량'), false);

  // 3. 4KB 초과 -> 413
  const hugeString = 'x'.repeat(4500);
  const reqHuge = createMockReq('POST', { action: 'test', pad: hugeString });
  const resHuge = await handleRequest(reqHuge, deps);
  assert.equal(resHuge.status, 413);
  const bodyHuge = await resHuge.json();
  assert.equal(bodyHuge.ok, false);

  // 4. 허용 목록 밖 endpoint -> 400
  const reqEvil = createMockReq('POST', { action: 'test', endpoint: 'https://evil.attacker.com/sub' });
  const resEvil = await handleRequest(reqEvil, deps);
  assert.equal(resEvil.status, 400);
  const bodyEvil = await resEvil.json();
  assert.equal(bodyEvil.ok, false);

  // 5. DB에 없는 endpoint -> {ok:false, reason:'not_registered'}
  const reqNotInDb = createMockReq('POST', { action: 'test', endpoint: 'https://fcm.googleapis.com/fcm/send/unknown' });
  const resNotInDb = await handleRequest(reqNotInDb, deps);
  assert.equal(resNotInDb.status, 200);
  const bodyNotInDb = await resNotInDb.json();
  assert.deepEqual(bodyNotInDb, { ok: false, reason: 'not_registered' });
});

test('AC-8: resubscribe 및 test 응답 본문이 {ok} 키만 가짐', async () => {
  const deps = createMockDeps();

  // resubscribe 성공
  const reqResub = createMockReq('POST', {
    action: 'resubscribe',
    old_endpoint: 'https://fcm.googleapis.com/fcm/send/valid-token-1',
    old_auth: 'test-auth',
    subscription: {
      endpoint: 'https://fcm.googleapis.com/fcm/send/valid-token-2',
      keys: { p256dh: 'new-key', auth: 'new-auth' }
    }
  });
  const resResub = await handleRequest(reqResub, deps);
  assert.equal(resResub.status, 200);
  const bodyResub = await resResub.json();
  assert.deepEqual(Object.keys(bodyResub), ['ok']);
  assert.equal(bodyResub.ok, true);

  // test 성공
  const reqTest = createMockReq('POST', {
    action: 'test',
    endpoint: 'https://fcm.googleapis.com/fcm/send/valid-token-2'
  });
  const resTest = await handleRequest(reqTest, deps);
  assert.equal(resTest.status, 200);
  const bodyTest = await resTest.json();
  assert.deepEqual(Object.keys(bodyTest), ['ok']);
  assert.equal(bodyTest.ok, true);
});

test('resubscribe: 옛 구독의 auth 키가 맞아야 endpoint를 바꾼다 (endpoint만 아는 사람은 못 바꿈)', async () => {
  const oldEp = 'https://fcm.googleapis.com/fcm/send/valid-token-1';
  const evilSub = { endpoint: 'https://fcm.googleapis.com/fcm/send/attacker', keys: { p256dh: 'evil', auth: 'evil' } };
  for (const oldAuth of [undefined, '', 'wrong-auth']) {
    const deps = createMockDeps();
    const res = await handleRequest(createMockReq('POST', { action: 'resubscribe', old_endpoint: oldEp, old_auth: oldAuth, subscription: evilSub }), deps);
    assert.equal((await res.json()).ok, false, `old_auth=${oldAuth}`);
    assert.equal((await deps.db.getSubscriptionByEndpoint(oldEp))?.auth, 'test-auth', `old_auth=${oldAuth}: 구독이 바뀌면 안 됨`);
  }
});

test('AC-8: test 제한: 같은 endpoint 2번째 1분 안 요청 -> 보내지 않음 ({ok:false})', async () => {
  const deps = createMockDeps({
    subs: [{ id: 99, endpoint: 'https://web.push.apple.com/endpoint-apple-1' }]
  });

  const reqTest = createMockReq('POST', {
    action: 'test',
    endpoint: 'https://web.push.apple.com/endpoint-apple-1'
  });

  // 1회차 요청 (성공)
  const res1 = await handleRequest(reqTest, deps);
  const body1 = await res1.json();
  assert.equal(body1.ok, true, '1번째 테스트 요청은 전송 성공해야 함');
  assert.equal(deps.sentCalls.length, 1);

  // 2회차 요청 (1분 이내 동일 endpoint -> 거부)
  const res2 = await handleRequest(reqTest, deps);
  const body2 = await res2.json();
  assert.equal(body2.ok, false, '1분 이내 2번째 테스트 요청은 거부되어야 함');
  assert.equal(deps.sentCalls.length, 1, '발송 함수가 추가 호출되지 않아야 함');
});

test('AC-8: dispatch dry_run: true 검증', async () => {
  const deps = createMockDeps();
  const req = createMockReq('POST', { action: 'dispatch', dry_run: true }, { 'x-cron-secret': 'test-cron-secret-123' });
  const res = await handleRequest(req, deps);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.candidates, 1);
  assert.equal(body.sent, 0);
  assert.equal(deps.sentCalls.length, 0);
});

test('AC-8: createDbDeps의 getCandidateTasks 요청 URL에 날짜 범위, status 조건, select 컬럼 제한 포함 검사', async () => {
  let capturedUrl = '';
  let capturedOptions = null;
  const mockFetch = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return {
      ok: true,
      json: async () => [{ id: 1, title: '샘플' }]
    };
  };

  const db = createDbDeps(mockFetch, 'https://example.supabase.co', 'dummy-key');
  const nowMs = Date.parse('2026-10-26T08:55:00+09:00');
  const tasks = await db.getCandidateTasks(nowMs);

  assert.equal(tasks.length, 1);
  assert.ok(capturedUrl.includes('/rest/v1/todo_schedules'), 'todo_schedules 테이블 조회');
  assert.ok(capturedUrl.includes('select='), 'select 컬럼 제한 포함');
  assert.ok(capturedUrl.includes('target_date=gte.') && capturedUrl.includes('target_date=lte.'), '날짜 범위(gte/lte) 포함');
  assert.ok(capturedUrl.includes('workers.status=eq.') || capturedUrl.includes('status=eq.'), 'status 조건 포함');
  assert.ok(capturedUrl.includes('worker_id=not.is.null'), 'worker_id 조건 포함');
  assert.equal(capturedOptions.headers.apikey, 'dummy-key');
  assert.equal(capturedOptions.headers.Authorization, 'Bearer dummy-key');
});

test('AC-8: createDbDeps의 insertPushLog 및 incrementFailCount 동작 검증', async () => {
  let logHeaders = null;
  let rpcBody = null;
  const mockFetch = async (url, options) => {
    if (url.includes('/rest/v1/push_log')) {
      logHeaders = options.headers;
      return { ok: true, json: async () => [] };
    }
    if (url.includes('/rest/v1/rpc/push_mark_failed')) {
      rpcBody = JSON.parse(options.body);
      return { ok: true, json: async () => [] };
    }
    return { ok: true, json: async () => [] };
  };

  const db = createDbDeps(mockFetch, 'https://test.supabase.co', 'dummy-key');
  await db.insertPushLog({ subscription_id: 1, target_date: '2026-10-26', target_time: '09:00' });
  assert.equal(logHeaders['Prefer'], 'resolution=ignore-duplicates');

  await db.incrementFailCount(42, 'Push service error 500');
  assert.equal(rpcBody.p_id, 42);
  assert.equal(rpcBody.p_error, 'Push service error 500');
});

test('AC-8: createSender가 VAPID 설정 및 TTL:600, urgency:high 옵션을 사용하는지 검사', async () => {
  let vapidConfig = null;
  let sentOpts = null;
  let sentSub = null;
  let sentPayload = null;

  const mockWebpush = {
    setVapidDetails: (subject, pubKey, privKey) => {
      vapidConfig = { subject, pubKey, privKey };
    },
    sendNotification: async (sub, payload, options) => {
      sentSub = sub;
      sentPayload = payload;
      sentOpts = options;
      return { statusCode: 201 };
    }
  };

  const sender = createSender(mockWebpush, {
    vapid_subject: 'mailto:admin@example.com',
    vapid_public_key: 'test-vapid-public-key',
    vapid_private_key: 'test-vapid-private-key'
  });

  assert.ok(vapidConfig, 'setVapidDetails가 호출되어야 함');
  assert.equal(vapidConfig.pubKey, 'test-vapid-public-key');
  assert.equal(vapidConfig.privKey, 'test-vapid-private-key');

  const sub = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/token',
    p256dh: 'p256dh-key',
    auth: 'auth-key'
  };
  await sender.sendNotification(sub, '{"title":"test"}');

  assert.ok(sentOpts, '전송 옵션이 전달되어야 함');
  assert.equal(sentOpts.TTL, 600, 'TTL은 600초여야 함');
  assert.equal(sentOpts.urgency, 'high', 'urgency는 high여야 함');
  assert.equal(sentSub.endpoint, sub.endpoint);
  assert.equal(sentSub.keys.p256dh, 'p256dh-key');
});

test('AC-8: index.ts 정적 검사 (Deno.serve 존재, Buffer 미사용, push_due.mjs import)', () => {
  const indexPath = path.join(__dirname, '../supabase/functions/todo-push/index.ts');
  const code = fs.readFileSync(indexPath, 'utf8');

  assert.ok(code.includes('Deno.serve'), 'Deno.serve 입구가 존재해야 함');
  assert.ok(!code.includes('Buffer'), 'Buffer 대신 TextEncoder를 사용하고 Buffer가 없어야 함');
  assert.ok(/import\s+pushDue\s+from\s+['"]\.\.\/_shared\/push_due\.mjs['"]/.test(code), 'push_due.mjs를 import 문으로 불러와야 함');
});

// todo_schedules의 실제 컬럼 = supabase/schema.sql의 생성문 컬럼
function readTodoScheduleColumns() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');
  const body = /CREATE TABLE IF NOT EXISTS public\.todo_schedules \(([\s\S]*?)\n\);/.exec(sql)[1];
  return new Set(body.split('\n').map((l) => l.trim().split(/\s+/)[0]).filter((c) => /^[a-z_]+$/.test(c) && c !== 'constraint'));
}

test('AC-8: getCandidateTasks가 todo_schedules에 실제로 있는 컬럼만 select한다', async () => {
  let capturedUrl = '';
  const db = createDbDeps(async (url) => {
    capturedUrl = url;
    return { ok: true, json: async () => [] };
  }, 'https://example.supabase.co', 'k');
  await db.getCandidateTasks(Date.parse('2026-10-26T08:55:00+09:00'));

  const select = new URL(capturedUrl).searchParams.get('select');
  const ownColumns = select.split(',').filter((c) => !c.includes('('));
  const real = readTodoScheduleColumns();
  assert.ok(real.has('worker_id') && real.has('target_time'), '컬럼 목록을 SQL에서 읽어야 함');
  for (const c of ownColumns) {
    assert.ok(real.has(c), `todo_schedules에 없는 컬럼을 조회함: ${c}`);
  }
  assert.ok(select.includes('workers!inner(status)'), '작업자 상태 조인 포함');
});

test('AC-8: createRuntime은 설정 읽기에 실패하면 캐시하지 않고 다음 요청에서 다시 읽는다', async () => {
  const { createRuntime } = require('../supabase/functions/todo-push/index.ts');
  let calls = 0;
  const configs = [
    Promise.reject(new Error('down')),
    Promise.resolve({ cron_secret: 's', vapid_public_key: 'p', vapid_private_key: 'q' })
  ];
  configs[0].catch(() => {});
  const db = { getConfig: () => configs[calls++] || Promise.resolve({}) };
  const fakeWebpush = { setVapidDetails() {}, sendNotification: async () => ({ statusCode: 201 }) };
  const getDeps = createRuntime(async () => fakeWebpush, db);

  const first = await getDeps();
  assert.equal(first.config.cron_secret, undefined, '첫 요청은 빈 설정');
  const second = await getDeps();
  assert.equal(second.config.cron_secret, 's', '두 번째 요청에서 다시 읽어 성공');
  await getDeps();
  assert.equal(calls, 2, '정상 설정은 캐시되어 더 읽지 않음');
});

test('AC-8: todo-push 소스 파일은 각각 300줄 이하이고 Buffer를 쓰지 않는다', () => {
  const dir = path.join(__dirname, '../supabase/functions/todo-push');
  for (const name of ['index.ts', 'db.ts', 'sender.ts']) {
    const code = fs.readFileSync(path.join(dir, name), 'utf8');
    assert.ok(code.split('\n').length <= 300, `${name}이 300줄을 넘음`);
    assert.ok(!/\bBuffer\b/.test(code), `${name}에서 Buffer 사용`);
  }
});

test('AC-1: Edge Function 테스트 응답 reason과 키 정규화 단위 테스트', async () => {
  // AC-1.unit.not_registered
  {
    const deps = createMockDeps();
    const req = createMockReq('POST', { action: 'test', endpoint: 'https://fcm.googleapis.com/fcm/send/unknown' });
    const res = await handleRequest(req, deps);
    const body = await res.json();
    const pass = JSON.stringify(body) === JSON.stringify({ ok: false, reason: 'not_registered' });
    console.log('MEASURED AC-1.unit.not_registered ' + JSON.stringify({ body, pass }));
    assert.deepEqual(body, { ok: false, reason: 'not_registered' });
  }

  // AC-1.unit.bad_endpoint
  {
    const deps = createMockDeps();
    const req = createMockReq('POST', { action: 'test', endpoint: 'https://evil.attacker.com/sub' });
    const res = await handleRequest(req, deps);
    const status = res.status;
    const body = await res.json();
    const pass = status === 400 && body.reason === 'bad_endpoint';
    console.log('MEASURED AC-1.unit.bad_endpoint ' + JSON.stringify({ status, body, pass }));
    assert.equal(status, 400);
    assert.equal(body.reason, 'bad_endpoint');
  }

  // AC-1.unit.ok
  {
    const deps = createMockDeps();
    const req = createMockReq('POST', { action: 'test', endpoint: 'https://fcm.googleapis.com/fcm/send/valid-token-1' });
    const res = await handleRequest(req, deps);
    const body = await res.json();
    const pass = JSON.stringify(body) === JSON.stringify({ ok: true });
    console.log('MEASURED AC-1.unit.ok ' + JSON.stringify({ body, pass }));
    assert.deepEqual(body, { ok: true });
  }

  // AC-1.unit.rate_limited
  {
    const deps = createMockDeps();
    const req1 = createMockReq('POST', { action: 'test', endpoint: 'https://fcm.googleapis.com/fcm/send/valid-token-1' });
    await handleRequest(req1, deps);
    const req2 = createMockReq('POST', { action: 'test', endpoint: 'https://fcm.googleapis.com/fcm/send/valid-token-1' });
    const res2 = await handleRequest(req2, deps);
    const body2 = await res2.json();
    const pass = body2.ok === false && body2.reason === 'rate_limited';
    console.log('MEASURED AC-1.unit.rate_limited ' + JSON.stringify({ body2, pass }));
    assert.equal(body2.ok, false);
    assert.equal(body2.reason, 'rate_limited');
  }

  // AC-1.unit.gone_returned
  {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/gone-ret-token';
    const subs = [{ id: 10, worker_id: 1, endpoint, p256dh: 'k', auth: 'a', fail_count: 0 }];
    const deps = createMockDeps({ subs, senderStatus: 404, nowMs: Date.now() + 300000 });
    const req = createMockReq('POST', { action: 'test', endpoint });
    const res = await handleRequest(req, deps);
    const body = await res.json();
    const deleted_ids = deps.deleted_ids;
    const pass = body.reason === 'gone' && deleted_ids.includes(10);
    console.log('MEASURED AC-1.unit.gone_returned ' + JSON.stringify({ body, deleted_ids, pass }));
    assert.equal(body.reason, 'gone');
    assert.ok(deleted_ids.includes(10));
  }

  // AC-1.unit.gone
  {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/gone-err-token';
    const subs = [{ id: 11, worker_id: 1, endpoint, p256dh: 'k', auth: 'a', fail_count: 0 }];
    const goneErr = new Error('Subscription expired');
    goneErr.statusCode = 410;
    const deps = createMockDeps({ subs, senderError: goneErr, nowMs: Date.now() + 400000 });
    const req = createMockReq('POST', { action: 'test', endpoint });
    const res = await handleRequest(req, deps);
    const body = await res.json();
    const deleted_ids = deps.deleted_ids;
    const pass = body.reason === 'gone' && deleted_ids.includes(11);
    console.log('MEASURED AC-1.unit.gone ' + JSON.stringify({ body, deleted_ids, pass }));
    assert.equal(body.reason, 'gone');
    assert.ok(deleted_ids.includes(11));
  }

  // AC-1.unit.send_failed
  {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/fail-err-token';
    const subs = [{ id: 12, worker_id: 1, endpoint, p256dh: 'k', auth: 'a', fail_count: 0 }];
    const failErr = new Error('x');
    failErr.statusCode = 403;
    const deps = createMockDeps({ subs, senderError: failErr, nowMs: Date.now() + 500000 });
    const req = createMockReq('POST', { action: 'test', endpoint });
    const res = await handleRequest(req, deps);
    const body = await res.json();
    const deleted_ids = deps.deleted_ids;
    const pass = body.reason === 'send_failed' && deleted_ids.length === 0;
    console.log('MEASURED AC-1.unit.send_failed ' + JSON.stringify({ body, deleted_ids, pass }));
    assert.equal(body.reason, 'send_failed');
    assert.equal(deleted_ids.length, 0);
  }

  // AC-1.unit.dispatch_keys
  {
    let passed_keys = null;
    const fakeWebpush = {
      setVapidDetails() {},
      sendNotification: async (sub, payload, options) => {
        passed_keys = sub.keys;
        return { statusCode: 201 };
      }
    };
    const sender = createSender(fakeWebpush, { vapid_public_key: 'pub', vapid_private_key: 'priv' });
    await sender.sendNotification({ endpoint: 'https://fcm.googleapis.com/fcm/send/valid-token-1', p256dh: 'ab+c/d==', auth: 'x/y+z=' }, '{}');
    const pass = passed_keys && passed_keys.p256dh === 'ab-c_d' && passed_keys.auth === 'x_y-z';
    console.log('MEASURED AC-1.unit.dispatch_keys ' + JSON.stringify({ passed_keys, pass }));
    assert.equal(passed_keys.p256dh, 'ab-c_d');
    assert.equal(passed_keys.auth, 'x_y-z');
  }

  // AC-1.unit.base64url_fn
  {
    const r1 = toBase64Url('a+b/c==');
    const r2 = toBase64Url(null);
    const pass = r1 === 'a-b_c' && r2 === '';
    console.log('MEASURED AC-1.unit.base64url_fn ' + JSON.stringify({ r1, r2, pass }));
    assert.equal(r1, 'a-b_c');
    assert.equal(r2, '');
  }
});

test('AC-3: 정적 검사 (sw.js / src/push/client.ts / index.html)', () => {
  // AC-3.sw_url
  {
    const sw = fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8');
    const hasFull = sw.includes("importScripts('/js/config.js')") && sw.includes("SUPABASE_URL + '/functions/v1/todo-push'");
    const noRel = !sw.includes("fetch('/functions/v1");
    const pass = hasFull && noRel;
    console.log('MEASURED AC-3.sw_url ' + JSON.stringify({ hasFull, noRel, pass }));
    assert.ok(hasFull, 'sw.js는 config.js의 주소로 함수를 부른다');
    assert.ok(noRel, 'sw.js에 상대 주소 fetch 없음');
  }

  // AC-3.client_url
  {
    const pc = fs.readFileSync(path.join(__dirname, '../src/push/client.ts'), 'utf8');
    const noRel = !pc.includes("fetch('/functions/v1");
    const hasPath = pc.includes('/functions/v1/todo-push');
    const matches = pc.match(/\bshowToast\(/g) || [];
    const onlyOne = matches.length === 1 && pc.includes('showToast(msg)');
    const pass = noRel && hasPath && onlyOne;
    console.log('MEASURED AC-3.client_url ' + JSON.stringify({ noRel, hasPath, onlyOne, showToastCount: matches.length, pass }));
    assert.ok(noRel, 'push/client.ts에 상대 주소 fetch 없음');
    assert.ok(hasPath, 'push/client.ts에 함수 경로 포함');
    assert.ok(onlyOne, 'showToast 호출은 pushNotice 안 한 곳뿐');
  }

  // AC-3.msg_dom
  {
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    const count = (html.match(/id="push-action-msg"/g) || []).length;
    const modalIdx = html.indexOf('id="push-settings-modal"');
    const msgIdx = html.indexOf('id="push-action-msg"');
    const notesIdx = html.indexOf('id="push-info-notes"');
    const modalEnd = html.indexOf('</dialog>', modalIdx);
    const inModal = msgIdx > modalIdx && msgIdx < modalEnd;
    const beforeNotes = msgIdx < notesIdx;
    const pass = count === 1 && inModal && beforeNotes;
    console.log('MEASURED AC-3.msg_dom ' + JSON.stringify({ count, inModal, beforeNotes, pass }));
    assert.equal(count, 1, 'id="push-action-msg" 1회');
    assert.ok(inModal, '#push-settings-modal 안');
    assert.ok(beforeNotes, '#push-info-notes보다 앞');
  }
});


test('장비: 가져간(claim) 작업마다 알림 대상 직원의 구독에 시작·종료 알림을 보낸다', async () => {
  const deps = createMockDeps({
    tasks: [],
    eqJobs: [
      { id: 7, kind: 'end', setting_type: '예시 품목 B', start_code: '281200', end_code: '281430', notify_worker_ids: [10] },
      { id: 8, kind: 'start', setting_type: '예시 품목 A', start_code: '281500', end_code: '281630', notify_worker_ids: [99] }
    ]
  });
  const res = await handleRequest(createMockReq('POST', { action: 'dispatch' }, { 'x-cron-secret': 'test-cron-secret-123' }), deps);
  const body = await res.json();
  assert.equal(body.equipment_sent, 1, '구독이 있는 직원(10)에게만 1건');
  const p = JSON.parse(deps.sentCalls[0].payload);
  assert.equal(p.title, '✅ 장비 종료 · 예시 품목 B');
  assert.equal(p.body, '28일 12:00 시작 → 28일 14:30 종료');
  assert.equal(p.tag, 'equipment-7-end');
});

test('장비: claimEquipmentPushes는 지난 10분 안·아직 안 보낸 행만 보냄으로 바꾸며 가져온다', async () => {
  const calls = [];
  const mockFetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => (url.includes('start_push_done') ? [] : [{ id: 3, notify_worker_ids: [1] }]) };
  };
  const db = createDbDeps(mockFetch, 'https://x.supabase.co', 'k');
  const jobs = await db.claimEquipmentPushes(Date.parse('2026-10-28T05:30:00Z'));
  assert.deepEqual(jobs, [{ id: 3, notify_worker_ids: [1], kind: 'end' }]);
  const end = calls[1];
  assert.equal(end.options.method, 'PATCH');
  assert.ok(end.url.includes('end_push_done=eq.false'));
  assert.ok(end.url.includes('end_at=gte.2026-10-28T05:20:00.000Z') && end.url.includes('end_at=lte.2026-10-28T05:30:00.000Z'));
  assert.deepEqual(JSON.parse(end.options.body), { end_push_done: true });
  assert.equal(end.options.headers.Prefer, 'return=representation');
});

test('dispatch: 한 작업자의 DB 조회가 실패해도 나머지 작업자·장비 알림은 보낸다', async () => {
  const deps = createMockDeps({
    subs: [
      { id: 1, worker_id: 10, endpoint: 'https://fcm.googleapis.com/fcm/send/w10' },
      { id: 2, worker_id: 20, endpoint: 'https://fcm.googleapis.com/fcm/send/w20' }
    ],
    tasks: [
      { id: 101, worker_id: 10, target_date: '2026-10-26', target_time: '09:00', title: '계량', sort_order: 10 },
      { id: 102, worker_id: 20, target_date: '2026-10-26', target_time: '09:00', title: '세척', sort_order: 20 }
    ],
    eqJobs: [{ id: 7, kind: 'end', setting_type: '예시 품목 B', start_code: '281200', end_code: '281430', notify_worker_ids: [10, 20] }]
  });
  const original = deps.db.getSubscriptionsByWorker;
  deps.db.getSubscriptionsByWorker = async (workerId) => {
    if (workerId === 10) throw new Error('db timeout');
    return original(workerId);
  };
  const res = await handleRequest(createMockReq('POST', { action: 'dispatch' }, { 'x-cron-secret': 'test-cron-secret-123' }), deps);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.sent, 1, '작업자 20의 할 일 알림은 발송');
  assert.equal(body.equipment_sent, 1, '작업자 20의 장비 알림은 발송');
  assert.equal(body.failed, 2, '작업자 10의 실패는 failed로 집계');
});

test('dispatch: 발송 기록 저장이 실패하면 sent가 아니라 failed로 집계하고 다음 작업자로 넘어간다', async () => {
  const deps = createMockDeps({
    subs: [
      { id: 1, worker_id: 10, endpoint: 'https://fcm.googleapis.com/fcm/send/w10' },
      { id: 2, worker_id: 20, endpoint: 'https://fcm.googleapis.com/fcm/send/w20' }
    ],
    tasks: [
      { id: 101, worker_id: 10, target_date: '2026-10-26', target_time: '09:00', title: '계량', sort_order: 10 },
      { id: 102, worker_id: 20, target_date: '2026-10-26', target_time: '09:00', title: '세척', sort_order: 20 }
    ]
  });
  const original = deps.db.insertPushLog;
  deps.db.insertPushLog = async (log) => {
    if (log.worker_id === 10) throw new Error('insert failed');
    return original(log);
  };
  const res = await handleRequest(createMockReq('POST', { action: 'dispatch' }, { 'x-cron-secret': 'test-cron-secret-123' }), deps);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(deps.sentCalls.length, 2, '두 작업자 모두 발송 시도');
  assert.equal(body.sent, 1);
  assert.equal(body.failed, 1);
});
