const test = require('node:test');
const assert = require('node:assert/strict');
const MobileCore = require('../src/equipment/core.ts');

test('AC-1: DDHHMM↔Date 변환 및 월말 넘김', () => {
  const ref = new Date('2026-10-25T10:00:00');
  
  // 기본 파싱
  const d1 = MobileCore.parseDDHHMM('251430', ref);
  assert.equal(d1.getDate(), 25);
  assert.equal(d1.getHours(), 14);
  assert.equal(d1.getMinutes(), 30);
  assert.equal(MobileCore.formatDDHHMM(d1), '251430');

  // 월말 넘김: 10월 28일 기준 02일(다음 달 11월 2일)
  const refLate = new Date('2026-10-28T10:00:00');
  const dNextMonth = MobileCore.parseDDHHMM('021000', refLate);
  assert.equal(dNextMonth.getMonth(), 10); // 11월
  assert.equal(dNextMonth.getDate(), 2);

  // 월초 넘김: 11월 2일 기준 29일(이전 달 10월 29일)
  const refEarly = new Date('2026-11-02T10:00:00');
  const dPrevMonth = MobileCore.parseDDHHMM('291000', refEarly);
  assert.equal(dPrevMonth.getMonth(), 9); // 10월
  assert.equal(dPrevMonth.getDate(), 29);

  // addMinutesToDDHHMM
  const added = MobileCore.addMinutesToDDHHMM('251000', 90, ref);
  assert.equal(added, '251130');

  // formatDateTime (MM/DD HH:mm 24시간제)
  assert.equal(MobileCore.formatDateTime(d1), '10/25 14:30');
  assert.equal(MobileCore.formatDateTime('251430', ref), '10/25 14:30');
  assert.equal(MobileCore.formatDateTime(new Date('2026-05-09T08:05:00')), '05/09 08:05');
  assert.equal(MobileCore.formatDateTime(null), '-');
});

test('AC-1: equipment 예약 겹침 검사 (경계조건: 끝=시작은 비중복)', () => {
  const ref = new Date('2026-10-25T10:00:00');
  const existing = [
    { id: 1, start_code: '251000', end_code: '251130' } // 10:00 ~ 11:30
  ];

  // 1. 끝=시작 (11:30 ~ 13:00) -> 겹치지 않음
  assert.equal(MobileCore.isJobOverlapping({ id: 2, start_code: '251130', end_code: '251300' }, existing, ref), false);

  // 2. 시작=끝 (08:30 ~ 10:00) -> 겹치지 않음
  assert.equal(MobileCore.isJobOverlapping({ id: 3, start_code: '250830', end_code: '251000' }, existing, ref), false);

  // 3. 겹침 (10:30 ~ 12:00) -> 겹침
  assert.equal(MobileCore.isJobOverlapping({ id: 4, start_code: '251030', end_code: '251200' }, existing, ref), true);

  // 4. 완전 포함 (09:00 ~ 12:00) -> 겹침
  assert.equal(MobileCore.isJobOverlapping({ id: 5, start_code: '250900', end_code: '251200' }, existing, ref), true);

  // 5. 수정 시 자기 자신(id=1)은 겹치지 않음
  assert.equal(MobileCore.isJobOverlapping({ id: 1, start_code: '251000', end_code: '251130' }, existing, ref), false);
});

test('AC-1: equipmentState - 0건 / 미래 예약만 / 지금 가동 중 / 모두 끝남', () => {
  const now = new Date('2026-10-25T10:30:00');

  // 1. 0건
  const st0 = MobileCore.equipmentState([], now);
  assert.equal(st0.mode, 'none');
  assert.equal(st0.statusText, '대기 중');
  assert.equal(st0.remainMinutes, 0);

  // 2. 지금 가동 중 (10:00 ~ 11:00)
  const jobsRunning = [
    { id: 10, setting_type: '예시 품목 A', start_code: '251000', end_code: '251100' }
  ];
  const stRun = MobileCore.equipmentState(jobsRunning, now);
  assert.equal(stRun.mode, 'running');
  assert.equal(stRun.statusText, '가동 중');
  assert.equal(stRun.remainMinutes, 30); // 11:00까지 30분 남음
  assert.equal(stRun.pct, 50);

  // 3. 미래 예약만 (11:00 ~ 12:30)
  const jobsSched = [
    { id: 11, setting_type: '예시 품목 B', start_code: '251100', end_code: '251230' }
  ];
  const stSched = MobileCore.equipmentState(jobsSched, now);
  assert.equal(stSched.mode, 'scheduled');
  assert.equal(stSched.statusText, '예약 대기');
  assert.equal(stSched.waitMinutes, 30); // 시작까지 30분 전

  // 4. 모두 끝남 (09:00 ~ 10:00)
  const jobsComp = [
    { id: 12, setting_type: '예시 품목 A', start_code: '250900', end_code: '251000' }
  ];
  const stComp = MobileCore.equipmentState(jobsComp, now);
  assert.equal(stComp.mode, 'completed');
  assert.equal(stComp.statusText, '가동 완료');
  assert.equal(stComp.remainMinutes, 0);
});

test('equipmentJobTimes: 이미 지난 시작·종료는 알림을 보낸 것으로 두고, 앞으로 올 시각만 알림 대상', () => {
  const now = new Date('2026-10-28T10:00:00+09:00');
  const future = MobileCore.equipmentJobTimes(new Date('2026-10-28T11:00:00+09:00'), 90, [3], now);
  assert.deepEqual(future, {
    start_at: '2026-10-28T02:00:00.000Z', end_at: '2026-10-28T03:30:00.000Z',
    notify_worker_ids: [3], start_push_done: false, end_push_done: false
  });
  const startedNow = MobileCore.equipmentJobTimes(now, 90, null, now);
  assert.equal(startedNow.start_push_done, true, '지금 시작으로 등록하면 시작 알림 생략');
  assert.equal(startedNow.end_push_done, false);
  assert.deepEqual(startedNow.notify_worker_ids, []);
});

test('buildEquipmentJob: PC·모바일 같은 검사와 저장값', () => {
  const now = new Date('2026-10-28T10:00:00+09:00'), start = new Date('2026-10-28T11:00:00+09:00');
  const base = { start, durationMinutes: 90, type: '공정4', notifyWorkerIds: [3] };
  const { row } = MobileCore.buildEquipmentJob(base, [], now);
  assert.equal(row.start_code, '281100'); assert.equal(row.end_code, '281230');
  assert.equal(row.status, '예약'); assert.equal(row.start_push_done, false);
  assert.match(MobileCore.buildEquipmentJob({ ...base, durationMinutes: 0 }, [], now).error, /1~1440/);
  assert.match(MobileCore.buildEquipmentJob({ ...base, type: '' }, [], now).error, /종류/);
  assert.match(MobileCore.buildEquipmentJob({ ...base, start: null }, [], now).error, /시작/);
  const other = { id: 7, start_code: '281200', end_code: '281300' };
  assert.match(MobileCore.buildEquipmentJob(base, [other], now).error, /겹칩니다/);
  assert.ok(MobileCore.buildEquipmentJob({ ...base, id: 7 }, [other], now).row, '자기 자신과는 겹침 아님');
});
