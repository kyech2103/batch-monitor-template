const test = require('node:test');
const assert = require('node:assert/strict');

let PushDue;
test.before(async () => {
  PushDue = await import('../supabase/functions/_shared/push_due.mjs');
});

test('AC-1: 서울 2026-10-26 09:00 과업의 due_at은 08:55 KST', () => {
  const startMs = PushDue.getTaskStartMs('2026-10-26', '09:00');
  const dueAtMs = PushDue.getTaskDueAtMs('2026-10-26', '09:00');

  assert.equal(new Date(startMs).toISOString(), '2026-10-26T00:00:00.000Z'); // 09:00 KST is 00:00 UTC
  assert.equal(new Date(dueAtMs).toISOString(), '2026-10-25T23:55:00.000Z'); // 08:55 KST is 23:55 UTC
  assert.equal(startMs - dueAtMs, 5 * 60 * 1000);
});

test('AC-1: 창 판정: 08:55 대상, 08:59 대상, 09:00 이후 제외, 08:44 제외', () => {
  const taskDate = '2026-10-26';
  const taskTime = '09:00';

  const t0855 = Date.parse('2026-10-26T08:55:00+09:00');
  const t0859 = Date.parse('2026-10-26T08:59:00+09:00');
  const t0900 = Date.parse('2026-10-26T09:00:00+09:00');
  const t0905 = Date.parse('2026-10-26T09:05:00+09:00');
  const t0844 = Date.parse('2026-10-26T08:44:59+09:00');

  assert.equal(PushDue.isDueInWindow(taskDate, taskTime, t0855), true, '08:55 대상이어야 함');
  assert.equal(PushDue.isDueInWindow(taskDate, taskTime, t0859), true, '08:59 대상이어야 함');
  assert.equal(PushDue.isDueInWindow(taskDate, taskTime, t0900), false, '09:00 정각은 시작되어 제외');
  assert.equal(PushDue.isDueInWindow(taskDate, taskTime, t0905), false, '09:05 시작 후는 제외');
  assert.equal(PushDue.isDueInWindow(taskDate, taskTime, t0844), false, '08:44 과업 5분 전(08:55) 이전은 제외');
});

test('AC-1: 같은 작업자·시각 3건 -> 묶음 1개, 본문 [계량, 공정1 준비 점검 외 1건], 다른 작업자는 별도 묶음', () => {
  const tasks = [
    { worker_id: 1, worker_name: '홍길동', target_date: '2026-10-26', target_time: '09:00', sort_order: 10, title: '계량', lot_id: 'LOT-999', lot_ids: ['LOT-999'] },
    { worker_id: 1, worker_name: '홍길동', target_date: '2026-10-26', target_time: '09:00', sort_order: 20, title: '공정1 준비 점검', lot_id: 'LOT-888' },
    { worker_id: 1, worker_name: '홍길동', target_date: '2026-10-26', target_time: '09:00', sort_order: 30, title: '여과', lot_id: 'LOT-777' },
    { worker_id: 2, worker_name: '김철수', target_date: '2026-10-26', target_time: '09:00', sort_order: 10, title: '공정2-A', lot_id: 'LOT-666' }
  ];

  const bundles = PushDue.groupTasks(tasks);
  assert.equal(bundles.length, 2, '작업자 1과 2는 별도 묶음이어야 함');

  const bundle1 = bundles.find((b) => b.worker_id === 1);
  assert.ok(bundle1);
  assert.equal(bundle1.title, '⏰ 5분 뒤 작업 · 09:00');
  assert.equal(bundle1.body, '계량, 공정1 준비 점검 외 1건');
  assert.equal(bundle1.tag, 'todo-2026-10-26-09:00');

  // 어떤 입력에서도 본문·제목에 lot_id·lot_ids 값과 작업자 이름이 없어야 함
  assert.equal(bundle1.title.includes('홍길동'), false);
  assert.equal(bundle1.body.includes('홍길동'), false);
  assert.equal(bundle1.body.includes('LOT-999'), false);
  assert.equal(bundle1.body.includes('LOT-888'), false);
  assert.equal(bundle1.body.includes('LOT-777'), false);

  const bundle2 = bundles.find((b) => b.worker_id === 2);
  assert.ok(bundle2);
  assert.equal(bundle2.body, '공정2-A');
  assert.equal(bundle2.body.includes('김철수'), false);
  assert.equal(bundle2.body.includes('LOT-666'), false);
});

test('AC-1: 본문 1건 / 2건 / 3건 형식 검증', () => {
  const b1 = PushDue.formatNotificationBody([{ title: '계량', sort_order: 1 }]);
  assert.equal(b1, '계량');

  const b2 = PushDue.formatNotificationBody([
    { title: '공정1 준비 점검', sort_order: 2 },
    { title: '계량', sort_order: 1 }
  ]);
  assert.equal(b2, '계량, 공정1 준비 점검');

  const b3 = PushDue.formatNotificationBody([
    { title: 'C', sort_order: 3 },
    { title: 'A', sort_order: 1 },
    { title: 'B', sort_order: 2 }
  ]);
  assert.equal(b3, 'A, B 외 1건');
});

test('AC-1: endpoint 호스트 허용 목록 검사', () => {
  // 허용
  assert.equal(PushDue.isAllowedEndpoint('https://fcm.googleapis.com/fcm/send/abc123xyz'), true);
  assert.equal(PushDue.isAllowedEndpoint('https://web.push.apple.com/qv1/abcde'), true);
  assert.equal(PushDue.isAllowedEndpoint('https://updates.push.services.mozilla.com/wpush/v2/def'), true);
  assert.equal(PushDue.isAllowedEndpoint('https://wns2.notify.windows.com/w/12345'), true);

  // 거부: http
  assert.equal(PushDue.isAllowedEndpoint('http://fcm.googleapis.com/test'), false);

  // 거부: evil 도메인
  assert.equal(PushDue.isAllowedEndpoint('https://evil.example.com/push'), false);
  assert.equal(PushDue.isAllowedEndpoint('https://fcm.googleapis.com.evil.io/send'), false);

  // 거부: IP 주소
  assert.equal(PushDue.isAllowedEndpoint('https://127.0.0.1/push'), false);
  assert.equal(PushDue.isAllowedEndpoint('https://192.168.0.1/push'), false);
  assert.equal(PushDue.isAllowedEndpoint('https://[::1]/push'), false);

  // 거부: 길이 1024 초과
  const longUrl = 'https://fcm.googleapis.com/' + 'a'.repeat(1020);
  assert.equal(PushDue.isAllowedEndpoint(longUrl), false);
});

test('AC-1: 플랫폼 판정: Android / iOS / other', () => {
  const androidUa = 'Mozilla/5.0 (Linux; Android 13; SM-S908N) AppleWebKit/537.36 Chrome/114.0.0.0 Mobile Safari/537.36';
  const iphoneUa = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
  const ipadUa = 'Mozilla/5.0 (iPad; CPU OS 16_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
  const desktopUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/114.0.0.0 Safari/537.36';

  assert.equal(PushDue.detectPlatform(androidUa), 'android');
  assert.equal(PushDue.detectPlatform(iphoneUa), 'ios');
  assert.equal(PushDue.detectPlatform(ipadUa), 'ios');
  assert.equal(PushDue.detectPlatform(desktopUa), 'other');
  assert.equal(PushDue.detectPlatform(''), 'other');
});
