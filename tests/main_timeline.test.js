const test = require('node:test');
const assert = require('node:assert/strict');
const TimelineCore = require('../src/main/timelineBars.ts');

test('AC-2: computeRange - 2주는 오늘-3일 00:00부터 14일, 1주는 오늘-1일 00:00부터 7일 (자정 및 월말 경계)', () => {
  const now = new Date('2026-10-23T14:30:00Z');
  const r2w = TimelineCore.computeRange('2w', now);
  assert.equal(r2w.days, 14);
  assert.equal(r2w.start.getFullYear(), 2026);
  assert.equal(r2w.start.getMonth(), 9); // October (0-indexed 9)
  assert.equal(r2w.start.getDate(), 20);
  assert.equal(r2w.start.getHours(), 0);
  assert.equal(r2w.start.getMinutes(), 0);

  const r1w = TimelineCore.computeRange('1w', now);
  assert.equal(r1w.days, 7);
  assert.equal(r1w.start.getDate(), 22);
  assert.equal(r1w.start.getHours(), 0);

  // 월초 자정 경계 테스트 (11월 1일 00:00 -> 10월 29일 00:00)
  const nov1 = new Date(2026, 10, 1, 0, 0, 0);
  const rNov = TimelineCore.computeRange('2w', nov1);
  assert.equal(rNov.start.getMonth(), 9); // 10월
  assert.equal(rNov.start.getDate(), 29);
});

test('AC-3: buildDayColumns - 칸 수, 라벨 형식, 주말과 오늘 표시 검증', () => {
  const now = new Date(2026, 9, 23, 15, 0, 0); // 2026-10-23 금요일
  const start = new Date(2026, 9, 20, 0, 0, 0); // 2026-10-20 화요일
  const cols = TimelineCore.buildDayColumns(start, 14, now);

  assert.equal(cols.length, 14, '2주 14칸 생성');
  assert.equal(cols[0].label, '10/20 화');
  assert.equal(cols[0].isWeekend, false);
  assert.equal(cols[0].isToday, false);

  // 10/23은 오늘 (금요일)
  assert.equal(cols[3].label, '10/23 금');
  assert.equal(cols[3].isToday, true);
  assert.equal(cols[3].isWeekend, false);

  // 10/24는 토요일 (주말)
  assert.equal(cols[4].label, '10/24 토');
  assert.equal(cols[4].isWeekend, true);
  assert.equal(cols[4].isToday, false);

  // 10/25는 일요일 (주말)
  assert.equal(cols[5].label, '10/25 일');
  assert.equal(cols[5].isWeekend, true);
});

test('AC-4: buildTimelineRows - logistics/post-E 제외, 기간 밖 배치 제외, 정렬 및 막대 계산', () => {
  const start = new Date('2026-10-20T00:00:00Z');
  const now = new Date('2026-10-23T12:00:00Z');
  const days = 14;

  const batches = [
    // 1. logistics 제외
    { lotNumber: 'LOT-LOG', manualZone: 'logistics', schedule: { A: { start: '2026-10-21T08:00:00Z', end: '2026-10-21T16:00:00Z' } } },
    // 2. post-E 제외
    { lotNumber: 'LOT-POST-E', schedule: { E: { end: '2026-10-22T00:00:00Z' } } },
    // 3. 기간 밖 배치 제외 (2026-11-10)
    { lotNumber: 'LOT-FUTURE', schedule: { A: { start: '2026-11-10T08:00:00Z', end: '2026-11-10T16:00:00Z' } } },
    // 4. 정상 배치 1: A 시작이 10/22 (24시간 -> widthPct > 4%, 과거 공정 포함)
    {
      lotNumber: 'LOT-01',
      schedule: {
        A: { start: '2026-10-22T00:00:00Z', end: '2026-10-23T00:00:00Z' }, // past=true, 24h = 7.14% (>4%)
        B: { start: '2026-10-24T08:00:00Z', end: '2026-10-25T08:00:00Z' }  // past=false
      }
    },
    // 5. 정상 배치 2: A 시작이 10/21 (더 빠름 -> 정렬 1순위)
    {
      lotNumber: 'LOT-02',
      schedule: {
        A: { start: '2026-10-21T08:00:00Z', end: '2026-10-21T16:00:00Z' }
      }
    },
    // 6. 누락 공정 배치 (A 없이 B만 있음)
    {
      lotNumber: 'LOT-03',
      schedule: {
        B: { start: '2026-10-25T00:00:00Z', end: '2026-10-25T02:00:00Z' } // 2시간 -> width < 4%
      }
    }
  ];

  const rows = TimelineCore.buildTimelineRows({
    batches,
    now,
    start,
    days,
    zoneOf: (b) => b.manualZone || '',
    isPostE: (b) => b.lotNumber === 'LOT-POST-E'
  });

  assert.equal(rows.length, 3, '제외 대상 3개 제외 후 3개 로트만 줄 생성');
  assert.equal(rows[0].lotNumber, 'LOT-02', '10/21 시작 LOT-02가 1순위');
  assert.equal(rows[1].lotNumber, 'LOT-01', '10/22 시작 LOT-01이 2순위');
  assert.equal(rows[2].lotNumber, 'LOT-03', 'A 없는 LOT-03는 첫 공정(B) 시작 순 정렬');

  // 막대 세부 검증 (LOT-01)
  const r1 = rows[1];
  assert.equal(r1.segments.length, 2);
  const segA = r1.segments[0];
  assert.equal(segA.step, 'A');
  assert.equal(segA.past, true, '종료 시각이 now보다 이전이므로 past=true');
  assert.equal(segA.color, '#0D9488');
  assert.match(segA.title, /공정1/);

  // LOT-03: 짧은 막대도 그린다
  const segB = rows[2].segments[0];
  assert.ok(segB.widthPct < 4, '2시간은 14일 중 약 0.59%');
  assert.match(segB.title, /공정2/);
});

test('AC-5: nowLinePct - 기간 안이면 0~100 값, 밖이면 null', () => {
  const start = new Date('2026-10-20T00:00:00Z');
  const days = 14;

  // 기간 정확히 중간 (7일 후) -> 50%
  const mid = new Date('2026-10-27T00:00:00Z');
  const pctMid = TimelineCore.nowLinePct(start, days, mid);
  assert.ok(Math.abs(pctMid - 50.0) < 0.001);

  // 기간 이전 -> null
  const before = new Date('2026-10-19T23:59:59Z');
  assert.equal(TimelineCore.nowLinePct(start, days, before), null);

  // 기간 이후 -> null
  const after = new Date('2026-11-04T00:00:01Z');
  assert.equal(TimelineCore.nowLinePct(start, days, after), null);
});

test('AC-1: 공정 색표 및 글자 색표 단일 기준 검증', () => {
  assert.deepEqual(TimelineCore.STEP_COLORS, {
    A: '#0D9488',
    B: '#DC2626',
    C: '#7C3AED',
    D: '#F59E0B',
    E: '#2563EB'
  });

  assert.deepEqual(TimelineCore.STEP_TEXT_COLORS, {
    A: '#0F766E',
    B: '#DC2626',
    C: '#7C3AED',
    D: '#B45309',
    E: '#2563EB'
  });

  const colors = Object.values(TimelineCore.STEP_COLORS);
  assert.equal(new Set(colors).size, 5, '5개 막대 색이 서로 모두 달라야 함');
});
