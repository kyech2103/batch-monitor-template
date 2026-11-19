const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/main/summary.ts');
const zoneOf = b => b._activeZoneInfo?.zoneId || '';

test('AC-2: computeSummary - 0건 배치 시 모두 0 반환', () => {
  const res = S.computeSummary([], new Date(), zoneOf, () => null);
  assert.deepEqual(res, {
    inProgress: 0,
    endingSoon48h: 0,
    waiting: 0,
    storage: 0
  });
});

function createMixedBatches() {
  return [
    { lotNumber: 'LOT-01', _activeZoneInfo: { zoneId: 'stage1-1' } },
    { lotNumber: 'LOT-02', _activeZoneInfo: { zoneId: 'stage2' } },
    { lotNumber: 'LOT-03', _activeZoneInfo: { zoneId: 'stage3-wait' } },
    { lotNumber: 'LOT-04', _activeZoneInfo: { zoneId: 'semi-storage-pre' } },
    { lotNumber: 'LOT-05', _activeZoneInfo: { zoneId: 'inspection' } },
    { lotNumber: 'LOT-LOG-1', manualZone: 'logistics', _activeZoneInfo: { zoneId: 'stage1-1' } },
    { lotNumber: 'LOT-LOG-2', completed_at: '2026-10-20T00:00:00Z', _activeZoneInfo: { zoneId: 'stage1-wait' } }
  ];
}

test('AC-2: computeSummary - 섞인 데이터 및 logistics 제외 검증', () => {
  const baseTime = new Date('2026-10-23T10:00:00Z');
  const batches = createMixedBatches();
  const getStepWindow = (b) => {
    if (b.lotNumber === 'LOT-01') return { end: new Date(baseTime.getTime() + 20 * 3600 * 1000) };
    if (b.lotNumber === 'LOT-02') return { end: new Date(baseTime.getTime() + 52 * 3600 * 1000) };
    return { end: null };
  };

  const res = S.computeSummary(batches, baseTime, zoneOf, b => getStepWindow(b).end);
  assert.equal(res.inProgress, 2, '진행 중 배치 수 (inspection 제외)');
  assert.equal(res.endingSoon48h, 1, '48시간 내 종료 배치 수');
  assert.equal(res.waiting, 1, '대기 구역 배치 수');
  assert.equal(res.storage, 2, '보관 구역 배치 수 (semi-storage-pre + inspection)');
});

test('AC-2: computeSummary - inspection 배치는 storage에만 집계되고 inProgress와 비중복', () => {
  const b = [{ lotNumber: 'LOT-INSP', _activeZoneInfo: { zoneId: 'inspection' } }];
  const res = S.computeSummary(b, new Date(), zoneOf, () => null);
  assert.equal(res.inProgress, 0, '진행 중에 집계되지 않음');
  assert.equal(res.storage, 1, '보관 중에만 집계됨');
});

function createUpcomingBatches(baseTime) {
  return [
    {
      lotNumber: 'LOT-A',
      schedule: {
        A: { start: new Date(baseTime.getTime() - 1000), end: new Date(baseTime.getTime() + 10 * 3600 * 1000) },
        B: { start: new Date(baseTime.getTime() + 20 * 3600 * 1000), end: new Date(baseTime.getTime() + 72 * 3600 * 1000) },
        C: { start: new Date(baseTime.getTime() + 73 * 3600 * 1000) }
      }
    },
    {
      lotNumber: 'LOT-B',
      schedule: {
        A: { start: new Date(baseTime.getTime() + 5 * 3600 * 1000), end: new Date(baseTime.getTime() + 15 * 3600 * 1000) }
      }
    },
    { lotNumber: 'LOT-POST-E', schedule: { A: { start: new Date(baseTime.getTime() + 2 * 3600 * 1000) } } },
    { lotNumber: 'LOT-WH', assignedZone: 'logistics', schedule: { A: { start: new Date(baseTime.getTime() + 3 * 3600 * 1000) } } }
  ];
}

test('AC-3: buildUpcomingEvents - 72시간 창 경계, 시간순 정렬, 최대 8개, post-E 및 logistics 제외', () => {
  const baseTime = new Date('2026-10-23T09:00:00Z');
  const batches = createUpcomingBatches(baseTime);

  const events = S.upcomingEvents(batches, baseTime, undefined, (b) => b.lotNumber === 'LOT-POST-E');

  assert.equal(events.length, 5);
  assert.equal(events[0].lot, 'LOT-B');
  assert.equal(events[0].type, 'start');
  assert.equal(events[1].lot, 'LOT-A');
  assert.equal(events[1].type, 'end');
  assert.equal(events[4].lot, 'LOT-A');
  assert.equal(events[4].type, 'end');
  assert.ok(events[0].text.includes('LOT-B 공정1 시작'));
});

test('AC-3: buildUpcomingEvents - 8개 제한 및 빈 결과 검증', () => {
  const baseTime = new Date('2026-10-23T09:00:00Z');
  assert.deepEqual(S.upcomingEvents([], baseTime), []);

  const manyBatches = Array.from({ length: 5 }, (_, i) => ({
    lotNumber: `LOT-${i + 1}`,
    schedule: {
      A: {
        start: new Date(baseTime.getTime() + (i * 2 + 1) * 3600 * 1000),
        end: new Date(baseTime.getTime() + (i * 2 + 2) * 3600 * 1000)
      }
    }
  }));

  const limited = S.upcomingEvents(manyBatches, baseTime);
  assert.equal(limited.length, 8, '최대 8개로 잘림');
});

test('AC-4: formatRemaining - 분, 시간+분, 일 단위 표시 및 음수(지남) 처리', () => {
  assert.equal(S.formatRemaining(25 * 60 * 1000), '25분');
  assert.equal(S.formatRemaining(0), '0분');
  assert.equal(S.formatRemaining(75 * 60 * 1000), '1시간 15분');
  assert.equal(S.formatRemaining(120 * 60 * 1000), '2시간');
  assert.equal(S.formatRemaining(24 * 3600 * 1000), '1일');
  assert.equal(S.formatRemaining(26 * 3600 * 1000), '1일 2시간');
  assert.equal(S.formatRemaining(48 * 3600 * 1000), '2일');
  assert.equal(S.formatRemaining(-25 * 60 * 1000), '25분 지남');
  assert.equal(S.formatRemaining(-(75 * 60 * 1000)), '1시간 15분 지남');
  assert.equal(S.formatRemaining(-(24 * 3600 * 1000)), '1일 지남');
  assert.equal(S.formatRemaining(-(26 * 3600 * 1000)), '1일 2시간 지남');
  assert.equal(S.formatRemaining(null), '-');
  assert.equal(S.formatRemaining(NaN), '-');
});
