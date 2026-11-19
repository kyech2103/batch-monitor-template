const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/todo/core.ts');

// 2026 ~ 2027 공휴일 세트 준비
const sampleHolidays = new Set([
  '2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18', '2026-03-02',
  '2026-05-01', '2026-05-05', '2026-05-25', '2026-06-03', '2026-06-06',
  '2026-08-15', '2026-08-17', '2026-09-24', '2026-09-25', '2026-09-26',
  '2026-10-03', '2026-10-05', '2026-10-09', '2026-12-25',
  '2027-01-01', '2027-02-06', '2027-02-07', '2027-02-08', '2027-02-09',
  '2027-03-01', '2027-05-01', '2027-05-05', '2027-05-13', '2027-06-06',
  '2027-08-15', '2027-08-16', '2027-09-14', '2027-09-15', '2027-09-16',
  '2027-10-03', '2027-10-04', '2027-10-09', '2027-10-11', '2027-12-25',
  '2027-12-27'
]);

const sampleManagers = {
  p1_a: '홍길동', p1_b: '김철수',
  p2_a: '이영희', p2_b: '박찬호', p2_c: '최민수',
  p3_a: '정우성', p3_b: '강동원',
  p4_a: '송강호', p4_b: '이병헌',
  stage5: '유재석',
  pk_a: '하하', pk_b: '노홍철'
};

test('AC1: 연도 보정 - 12월에서 1월로 넘어갈 때 Year + 1 보정', () => {
  const sch = {
    A: { startCode: '12280900', endCode: '12281800' },
    B: { startCode: '01040900', endCode: '01041700' },
    C: { startCode: '01050900', endCode: '01080900' }
  };
  const norm = core.normalizeScheduleYears(sch, { baseYear: 2026 });
  assert.equal(norm.A.start.getFullYear(), 2026);
  assert.equal(norm.A.start.getMonth(), 11);
  assert.equal(norm.A.start.getDate(), 28);

  assert.equal(norm.B.start.getFullYear(), 2027, 'B는 다음 해 2027년이어야 함');
  assert.equal(norm.B.start.getMonth(), 0);
  assert.equal(norm.B.start.getDate(), 4);

  assert.equal(norm.C.start.getFullYear(), 2027, 'C도 2027년을 유지해야 함');
});

test('AC2: 영업일 유틸리티 계산 검증', () => {
  // 1. getPreviousBusinessDay
  // 2026-10-06(화) 직전: 10-05(개천절 대체공휴일), 10-04(일), 10-03(토) -> 직전 평일은 2026-10-02(금)
  const prevBiz = core.getPreviousBusinessDay(new Date(2026, 9, 6), sampleHolidays);
  assert.equal(core.toDateKey(prevBiz), '2026-10-02');

  // 2. getNextBusinessDay
  // 2026-09-23(수) 직후: 24(목, 추석연휴), 25(금, 추석), 26(토, 추석연휴), 27(일) -> 2026-09-28(월)
  const nextBiz = core.getNextBusinessDay(new Date(2026, 8, 23), sampleHolidays);
  assert.equal(core.toDateKey(nextBiz), '2026-09-28');

  // 3. getLastBusinessDayOfWeek
  // 2026-10-07(수)가 속한 주: 금요일 10-09가 한글날 공휴일 -> 마지막 평일은 2026-10-08(목)
  const lastBiz = core.getLastBusinessDayOfWeek(new Date(2026, 9, 7), sampleHolidays);
  assert.equal(core.toDateKey(lastBiz), '2026-10-08');
});

test('AC3: 공정 C 종료 후속 작업 시각 배정 (결정 사항 8)', () => {
  // 케이스 1a: 평일 18:00 초과 종료 -> 2026-10-08(목) 19:00 종료 -> 10-09는 한글날이므로 2026-10-12(월) 09:00
  const c1a = core.resolveFollowUpSlot(new Date(2026, 9, 8, 19, 0), sampleHolidays);
  assert.deepEqual(c1a, { targetDate: '2026-10-12', targetTime: '09:00' });

  // 케이스 1b: 주말 종료 -> 2026-10-04(일) 14:00 종료 -> 10-05는 대체공휴일이므로 2026-10-06(화) 09:00
  const c1b = core.resolveFollowUpSlot(new Date(2026, 9, 4, 14, 0), sampleHolidays);
  assert.deepEqual(c1b, { targetDate: '2026-10-06', targetTime: '09:00' });

  // 케이스 2: 평일 09:00 미만 종료 -> 2026-10-07(수) 07:30 종료 -> 당일 09:00
  const c2 = core.resolveFollowUpSlot(new Date(2026, 9, 7, 7, 30), sampleHolidays);
  assert.deepEqual(c2, { targetDate: '2026-10-07', targetTime: '09:00' });

  // 케이스 3a: 평일 근무시간 내 종료 -> 2026-10-07(수) 14:25 종료 -> 당일 14:25
  const c3a = core.resolveFollowUpSlot(new Date(2026, 9, 7, 14, 25), sampleHolidays);
  assert.deepEqual(c3a, { targetDate: '2026-10-07', targetTime: '14:25' });

  // 케이스 3b: 평일 18:00 정각 종료 -> 당일 18:00
  const c3b = core.resolveFollowUpSlot(new Date(2026, 9, 7, 18, 0), sampleHolidays);
  assert.deepEqual(c3b, { targetDate: '2026-10-07', targetTime: '18:00' });
});

test('전주 마지막 평일 규칙: 같은 주 공정2 로트는 모두 전주 마지막 평일 한 과업', () => {
  // 2026-10-20(화), 2026-10-22(목) 두 로트의 공정 B 시작 (같은 주)
  const batch1 = {
    lotNumber: 'LOT-2610-01',
    schedule: {
      B: { startCode: '10200900', endCode: '10201700' }
    }
  };
  const batch2 = {
    lotNumber: 'LOT-2610-02',
    schedule: {
      B: { startCode: '10220900', endCode: '10221700' }
    }
  };

  const res = core.generateDailyTodos({
    batches: [batch1, batch2],
    managers: sampleManagers,
    holidaySet: sampleHolidays,
    today: new Date(2026, 9, 14), // 10월 14일 수요일
    rules: [...core.DEFAULT_RULES, { rule_id: 'B-WEEK', kind: 'SIMPLE', enabled: true, title: '공정2 준비물 확인', process_code: 'B',
      anchor_step: 'B', anchor_point: 'start', day_rule: 'PREV_WEEK_LAST', time_mode: 'FIXED', target_time: '16:00', roles: ['p2_a'], sort_order: 180 }]
  });

  // 같은 주에 공정2하는 두 로트 모두 전주 마지막 평일(10-16 금) 16:00, 한 과업으로 합쳐짐
  const mats = res.tasks.filter(t => t.rule_id === 'B-WEEK');
  assert.equal(mats.length, 1);
  assert.deepEqual(mats[0].lot_ids, ['LOT-2610-01', 'LOT-2610-02']);
  assert.equal(mats[0].target_date, '2026-10-16');
  assert.equal(mats[0].target_time, '16:00');
  assert.deepEqual(mats[0].roles, ['p2_a']);
});

test('AC6: 차주 생산 로트 사전 준비 묶음 생성 (결정 사항 2, 3)', () => {
  // today: 2026-10-14(수). 이번 주: 10-12 ~ 10-18. 차주: 10-19 ~ 10-25.
  // 차주 공정 A 시작하는 로트 2개 등록
  const batchA1 = {
    lotNumber: 'LOT-NEXT-01',
    schedule: { A: { startCode: '10200900' } }
  };
  const batchA2 = {
    lotNumber: 'LOT-NEXT-02',
    schedule: { A: { startCode: '10210900' } }
  };

  const res = core.generateDailyTodos({
    batches: [batchA1, batchA2],
    managers: sampleManagers,
    holidaySet: sampleHolidays,
    today: new Date(2026, 9, 14)
  });

  // 이번 주 마지막 평일 = 2026-10-16(금)
  const matPrep = res.tasks.find(t => t.rule_id === 'PREP-MAT');

  assert.ok(matPrep, '공정1 시작 전주 마지막 평일 과업 존재');
  assert.equal(matPrep.target_date, '2026-10-16');
  assert.equal(matPrep.target_time, '10:00');
  assert.equal(matPrep.title, '자재 수령 및 준비');
  assert.equal(matPrep.roles.length, 12);
  assert.deepEqual(matPrep.lot_ids, ['LOT-NEXT-01', 'LOT-NEXT-02']);
});

test('공정2 부품 세척 마무리: 공정2 종료 다음 평일', () => {
  const res = core.generateDailyTodos({
    // 10-23(금) 공정2 종료 -> 주말 건너 10-26(월)
    batches: [{ lotNumber: 'LOT-W', schedule: { B: { startCode: '10230900', endCode: '10231700' } } }],
    managers: sampleManagers,
    holidaySet: sampleHolidays,
    today: new Date(2026, 9, 21)
  });
  const wash = res.tasks.find(t => t.rule_id === 'PREP-WASH');
  assert.equal(wash.target_date, '2026-10-26');
  assert.equal(wash.target_time, '09:00');
});

test('대청소: 생산 유무와 무관하게 이번 주·다음 주 마지막 평일', () => {
  const res = core.generateDailyTodos({
    batches: [{ lotNumber: 'LOT-NEXT', schedule: { A: { startCode: '10200900' } } }],
    managers: sampleManagers,
    holidaySet: sampleHolidays,
    today: new Date(2026, 9, 14)
  });
  const dates = res.tasks.filter(t => t.rule_id === 'CLEANING').map(t => t.target_date);
  assert.deepEqual(dates, ['2026-10-16', '2026-10-23']);
});

test('다른 로트도 같은 규칙·날짜·시각이면 한 과업으로 합친다', () => {
  const res = core.generateDailyTodos({
    batches: [
      { lotNumber: 'AAA1', schedule: { A: { startCode: '10200900' } } },
      { lotNumber: 'BBB2', schedule: { A: { startCode: '10200900' } } }
    ],
    managers: sampleManagers,
    holidaySet: sampleHolidays,
    today: new Date(2026, 9, 19)
  });
  const a1 = res.tasks.filter(t => t.rule_id === 'A-1');
  assert.equal(a1.length, 1);
  assert.equal(a1[0].lot_id, 'AAA1, BBB2');
});

test('AC7: 완제품 창고(logistics) 배치 제외 (결정 사항 5)', () => {
  const batchInStorage = {
    lotNumber: 'LOT-DONE-01',
    manualZone: 'logistics',
    completed_at: '2026-10-10T00:00:00.000Z',
    schedule: { A: { startCode: '10200900' } }
  };

  const res = core.generateDailyTodos({
    batches: [batchInStorage],
    managers: sampleManagers,
    holidaySet: sampleHolidays,
    today: new Date(2026, 9, 14)
  });

  const batchTasks = res.tasks.filter(t => t.lot_id === 'LOT-DONE-01');
  assert.equal(batchTasks.length, 0, '완제품 창고 배치는 배치 과업 생성에서 제외되어야 함');
});

test('AC8: 휴무일 과업 제외 vs 공정 E 무조건 생성 분기 및 공정D 없을 시 공정4후적재 미생성', () => {
  // 1) 2026-10-09는 한글날 공휴일. 공정 A 시작일이 10-09인 경우 -> 다음 평일(10-12) 09:00으로 미룸
  const holidayBatch = {
    lotNumber: 'LOT-HOLIDAY-01',
    schedule: { A: { startCode: '10090900' } }
  };

  // 2) 공정 E가 2026-10-10(토요일) 10:30인 경우 (공정 D 없음) -> 공정4후적재 없이 공정5 설비(E-2)만, 다음 평일 09:00에 생성
  const satBatch = {
    lotNumber: 'LOT-SAT-01',
    schedule: { E: { startCode: '10101030' } }
  };

  const res = core.generateDailyTodos({
    batches: [holidayBatch, satBatch],
    managers: sampleManagers,
    holidaySet: sampleHolidays,
    today: new Date(2026, 9, 5)
  });

  const aTasks = res.tasks.filter(t => t.lot_id === 'LOT-HOLIDAY-01');
  assert.equal(aTasks.length, 2, '휴무일 공정 A 과업 2건은 사라지지 않고 옮겨져야 함');
  assert.ok(aTasks.every(t => t.target_date === '2026-10-12' && t.target_time === '09:00'), '다음 평일 09:00');

  const eTasks = res.tasks.filter(t => t.lot_id === 'LOT-SAT-01');
  assert.equal(eTasks.length, 1, '공정 D가 없는 배치는 공정4후적재(E-1) 없이 E-2 1개 과업만 생성');
  const e2 = eTasks.find(t => t.rule_id === 'E-2');
  assert.equal(`${e2.target_date} ${e2.target_time}`, '2026-10-12 09:00', '토요일 E 시작은 다음 평일 09:00');
});

test('AC9: 포장 사전 준비 다중 로트 병합 (G6)', () => {
  // 2개 로트의 포장 시작일이 동일하게 2026-10-21(수)
  const pkg1 = { lotNumber: 'LOT-P1', packagingStartDate: '2026-10-21T09:00:00' };
  const pkg2 = { lotNumber: 'LOT-P2', packagingStartDate: '2026-10-21T13:00:00' };

  const res = core.generateDailyTodos({
    batches: [pkg1, pkg2],
    managers: sampleManagers,
    holidaySet: sampleHolidays,
    today: new Date(2026, 9, 14)
  });

  // 포장 시작 직전 평일 = 2026-10-20(화) 16:00
  const pkgPreps = res.tasks.filter(t => t.rule_id === 'PKG-PREP');
  assert.equal(pkgPreps.length, 1, '동일 날짜의 포장 준비는 1개 과업으로 병합되어야 함');
  assert.equal(pkgPreps[0].target_date, '2026-10-20');
  assert.equal(pkgPreps[0].target_time, '16:00');
  assert.equal(pkgPreps[0].roles.length, 12, '전원 12명 배정');
  assert.deepEqual(pkgPreps[0].lot_ids.sort(), ['LOT-P1', 'LOT-P2']);
});

test('AC10: DB 행 전개 및 컬럼 정규화 구조 검증', () => {
  const batch = {
    lotNumber: 'LOT-SINGLE',
    schedule: {
      A: { startCode: '10140900' }
    }
  };

  const res = core.generateDailyTodos({
    batches: [batch],
    managers: sampleManagers,
    holidaySet: sampleHolidays,
    today: new Date(2026, 9, 12)
  });

  assert.ok(res.rows.length > 0);
  const row = res.rows[0];
  assert.ok(row.target_date, 'target_date 필수');
  assert.match(row.target_time, /^[0-2][0-9]:[0-5][0-9]$/, 'target_time HH:mm 형식');
  assert.ok(row.role_key, 'role_key 필수');
  assert.ok(row.worker_name, 'worker_name 필수');
  assert.ok(row.lot_id, 'lot_id 필수');
  assert.ok(Array.isArray(row.lot_ids), 'lot_ids 배열');
  assert.ok(row.process_code, 'process_code 필수');
  assert.ok(row.rule_id, 'rule_id 필수');
  assert.ok(row.task_key, 'task_key 필수');
  assert.ok(row.title, 'title 필수');
});

test('AC11: 자식 로트(ex. PA260302A)와 부모 로트(ex. PA260302) 과업 병합 (요구사항 5)', () => {
  // 동일한 날짜 및 스케줄을 갖는 부모 로트와 자식 로트
  const parentBatch = {
    lotNumber: 'PA260302',
    schedule: {
      A: { startCode: '10200900' }
    }
  };
  const childBatch = {
    lotNumber: 'PA260302A',
    schedule: {
      A: { startCode: '10200900' }
    }
  };

  const res = core.generateDailyTodos({
    batches: [parentBatch, childBatch],
    managers: sampleManagers,
    holidaySet: sampleHolidays,
    today: new Date(2026, 9, 19)
  });

  // 10-20 09:00 계량 과업(A-1)이 2개가 아닌 정확히 1개로 병합되었는지 검증
  const weighingTasks = res.tasks.filter(t => t.rule_id === 'A-1');
  assert.equal(weighingTasks.length, 1, '부모-자식 로트 과업은 1개로 통합되어야 함');
  const mergedTask = weighingTasks[0];
  assert.deepEqual(mergedTask.lot_ids.sort(), ['PA260302', 'PA260302A'].sort());
  assert.match(mergedTask.lot_id, /PA260302/);
  assert.match(mergedTask.lot_id, /PA260302A/);
});

test('AC12: 공정4 후 적재 과업 공정 D 배정 및 공정 D 미존재 시 미생성 (요구사항 4, 6)', () => {
  // 1. 공정 D가 존재하는 배치 -> 공정4 종료 후 D-END(공정 D)로 배정
  const stage4Batch = {
    lotNumber: 'LOT-S4-01',
    schedule: {
      D: { startCode: '10200900', endCode: '10201700' },
      E: { startCode: '10211000' }
    }
  };

  const res = core.generateDailyTodos({
    batches: [stage4Batch],
    managers: sampleManagers,
    holidaySet: sampleHolidays,
    today: new Date(2026, 9, 19)
  });

  const dEndTask = res.tasks.find(t => t.rule_id === 'D-END' && t.lot_id === 'LOT-S4-01');
  assert.ok(dEndTask, '공정 D가 있는 배치는 D-END 과업이 생성되어야 함');
  assert.equal(dEndTask.process_code, 'D', '공정4 후 적재는 공정 D(공정4)이어야 함');
  assert.deepEqual(dEndTask.roles, ['p4_a', 'p4_b']);

  // E-1(기존 공정E 오표기 적재)은 생성되지 않아야 함
  const e1Tasks = res.tasks.filter(t => t.rule_id === 'E-1');
  assert.equal(e1Tasks.length, 0, 'E-1 과업은 생성되지 않아야 함');

  // 2. 공정 D가 없는 배치(PC260507 재현 케이스) -> 공정4 후 적재 생성 안 됨
  const noD_Batch = {
    lotNumber: 'PC260507',
    schedule: {
      C: { startCode: '10231100', endCode: '10241100' },
      E: { startCode: '10261000' } // 공정 D 없음
    }
  };

  const resNoD = core.generateDailyTodos({
    batches: [noD_Batch],
    managers: sampleManagers,
    holidaySet: sampleHolidays,
    today: new Date(2026, 9, 19)
  });

  const noD_tasks = resNoD.tasks.filter(t => t.lot_id === 'PC260507');
  const invalidLoadTask = noD_tasks.find(t => t.target_date === '2026-10-26' && t.rule_id === 'D-END');
  assert.equal(invalidLoadTask, undefined, '공정 D가 없는 배치는 공정4 후 적재 과업이 생성되지 않아야 함 (10.26 결함 해소)');
});

test('AC13: 차주 로트가 없는 주라도 금요일 15:00 전 작업자 주간 청소 생성 (요구사항 2)', () => {
  const resEmpty = core.generateDailyTodos({
    batches: [], // 배치 없음
    managers: sampleManagers,
    holidaySet: sampleHolidays,
    today: new Date(2026, 9, 21) // 10월 21일 수요일
  });

  // 10월 23일(금) 15:00 주간 청소 과업 존재
  const cleanTask = resEmpty.tasks.find(t => t.rule_id === 'CLEANING');
  assert.ok(cleanTask, '독립 대청소 과업 존재');
  assert.equal(cleanTask.target_date, '2026-10-23');
  assert.equal(cleanTask.target_time, '15:00');
  assert.equal(cleanTask.roles.length, 12, '12명 전원 배정');
});

test('AC14: ROLE_MAP 공정 마스킹 전면 해제 및 특이적 명칭(공정2-A, 공정2-B, 공정2-C, 포장-A, 포장-B) 검증', () => {
  const map = core.ROLE_MAP;
  assert.equal(map.p1_a.label, '공정1-1');
  assert.equal(map.p1_b.label, '공정1-2');
  assert.equal(map.p2_a.label, '공정2-A', '공정B 담당자 1 특이적 명칭 공정2-A');
  assert.equal(map.p2_b.label, '공정2-B', '공정B 담당자 2 특이적 명칭 공정2-B');
  assert.equal(map.p2_c.label, '공정2-C', '공정B 담당자 3 특이적 명칭 공정2-C');
  assert.equal(map.p3_a.label, '공정3-1');
  assert.equal(map.p3_b.label, '공정3-2');
  assert.equal(map.p4_a.label, '공정4-1');
  assert.equal(map.p4_b.label, '공정4-2');
  assert.equal(map.stage5.label, '공정5');
  assert.equal(map.pk_a.label, '포장-A', '포장실 담당자 1 특이적 명칭 포장-A');
  assert.equal(map.pk_b.label, '포장-B', '포장실 담당자 2 특이적 명칭 포장-B');
});


const fs = require('node:fs');
const path = require('node:path');

test('AC-2: 기본 규칙 결과가 변경 전 엔진의 골든 출력과 deep equal', () => {
  const goldenPath = path.join(__dirname, 'fixtures', 'todo_golden.json');
  const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
  assert.ok(golden.length >= 3, '골든 시나리오는 3개 이상이어야 함');

  for (const s of golden) {
    const params = {
      ...s.params,
      holidaySet: new Set(s.params.holidaySet),
      today: s.params.today ? new Date(s.params.today) : undefined
    };
    const result = core.generateDailyTodos(params);
    assert.deepEqual(result, s.output, `시나리오 [${s.name}] 골든 출력과 불일치`);
  }
});

test('AC-3: rules 생략 호출과 rules: DEFAULT_RULES 호출 결과의 동일성', () => {
  const params = {
    batches: [
      {
        lotNumber: 'LOT-AC3-01',
        schedule: {
          A: { startCode: '10190900', endCode: '10191800' },
          B: { startCode: '10200900', endCode: '10201800' }
        }
      }
    ],
    managers: sampleManagers,
    holidaySet: sampleHolidays,
    today: new Date('2026-10-19T00:00:00')
  };

  const res1 = core.generateDailyTodos(params);
  const res2 = core.generateDailyTodos({ ...params, rules: core.DEFAULT_RULES });
  assert.deepEqual(res1, res2, 'rules 생략과 DEFAULT_RULES 넘김 결과가 같아야 함');
});

test('AC-4: 일반 규칙 추가가 반영됨 (A 시작 · 당일 · 10:30 · p2_a)', () => {
  const customRule = {
    rule_id: 'U-TEST-A1030',
    kind: 'SIMPLE',
    enabled: true,
    title: '공정2 준비실 추가 점검',
    process_code: 'A',
    anchor_step: 'A',
    anchor_point: 'start',
    day_rule: 'SAME',
    time_mode: 'FIXED',
    target_time: '10:30',
    roles: ['p2_a'],
    sort_order: 115
  };

  const rules = [...core.DEFAULT_RULES, customRule];
  const params = {
    batches: [
      {
        lotNumber: 'LOT-AC4-01',
        schedule: {
          A: { startCode: '10190900', endCode: '10191800' }
        }
      }
    ],
    managers: sampleManagers,
    holidaySet: sampleHolidays,
    today: new Date('2026-10-19T00:00:00'),
    rules: rules
  };

  const res = core.generateDailyTodos(params);
  const foundTask = res.tasks.find(t => t.rule_id === 'U-TEST-A1030');
  assert.ok(foundTask, '추가한 규칙 과업이 생성되어야 함');
  assert.equal(foundTask.target_date, '2026-10-19');
  assert.equal(foundTask.target_time, '10:30');
  assert.equal(foundTask.task_key, 'U-TEST-A1030|2026-10-19|10:30|LOT-AC4-01');

  const foundRow = res.rows.find(r => r.rule_id === 'U-TEST-A1030');
  assert.ok(foundRow, '추가한 규칙의 row가 생성되어야 함');
  assert.equal(foundRow.worker_name, sampleManagers.p2_a);
  assert.equal(foundRow.role_key, 'p2_a');
});

test('AC-5: enabled: false인 규칙과 목록에서 뺀 규칙은 과업을 만들지 않음', () => {
  const extra = { ...core.DEFAULT_RULES.find(r => r.rule_id === 'A-2'), rule_id: 'A-3', title: '공정1 마무리', offset_minutes: 60 };
  const modifiedRules = [...core.DEFAULT_RULES, extra].map(r => {
    if (r.rule_id === 'A-1') return { ...r, enabled: false };
    return r;
  }).filter(r => r.rule_id !== 'A-2');

  const params = {
    batches: [
      {
        lotNumber: 'LOT-AC5-01',
        schedule: {
          A: { startCode: '10190900', endCode: '10191800' }
        }
      }
    ],
    managers: sampleManagers,
    holidaySet: sampleHolidays,
    today: new Date('2026-10-19T00:00:00'),
    rules: modifiedRules
  };

  const res = core.generateDailyTodos(params);
  assert.equal(res.tasks.some(t => t.rule_id === 'A-1'), false, 'disabled된 A-1은 과업 미생성');
  assert.equal(res.tasks.some(t => t.rule_id === 'A-2'), false, '목록에서 뺀 A-2는 과업 미생성');
  assert.ok(res.tasks.some(t => t.rule_id === 'A-3'), '다른 규칙(A-3)은 생성되어야 함');
});

test('AC-6: 규칙의 날짜·시각 설정 동작 검증', () => {
  const customRules = [
    {
      rule_id: 'U-PREV',
      kind: 'SIMPLE',
      enabled: true,
      title: '직전평일 작업',
      process_code: 'A',
      anchor_step: 'A',
      anchor_point: 'start',
      day_rule: 'PREV_BIZ',
      time_mode: 'FIXED',
      target_time: '14:00',
      roles: ['p1_a'],
      sort_order: 10
    },
    {
      rule_id: 'U-NEXT',
      kind: 'SIMPLE',
      enabled: true,
      title: '다음평일 작업',
      process_code: 'A',
      anchor_step: 'A',
      anchor_point: 'start',
      day_rule: 'NEXT_BIZ',
      time_mode: 'FIXED',
      target_time: '15:00',
      roles: ['p1_a'],
      sort_order: 20
    }
  ];

  const p1 = {
    batches: [{ lotNumber: 'LOT-NORM', schedule: { A: { startCode: '10190930', endCode: '10191800' } } }],
    managers: sampleManagers,
    holidaySet: sampleHolidays,
    today: new Date('2026-10-12T00:00:00'),
    rules: customRules
  };
  const r1 = core.generateDailyTodos(p1);
  const tPrev = r1.tasks.find(t => t.rule_id === 'U-PREV');
  assert.equal(tPrev.target_date, '2026-10-16', '10-19(월)의 직전평일은 10-16(금)');

  const tNext = r1.tasks.find(t => t.rule_id === 'U-NEXT');
  assert.equal(tNext.target_date, '2026-10-20', '10-19(월)의 다음평일은 10-20(화)');

});

test('AC-7: 포장재 준비 규칙의 제목·시각·역할 수정 반영 및 로트 묶음', () => {
  const modifiedRules = core.DEFAULT_RULES.map(r => {
    if (r.rule_id === 'PKG-PREP') {
      return {
        ...r,
        title: '포장재 수령 및 포장실 세팅',
        target_time: '15:00',
        roles: ['stage5', 'p2_a']
      };
    }
    return r;
  });

  const params = {
    batches: [
      {
        lotNumber: 'LOT-PKG-01',
        schedule: { packaging: { startCode: '10210900' } }
      },
      {
        lotNumber: 'LOT-PKG-02',
        schedule: { packaging: { startCode: '10210900' } }
      }
    ],
    managers: sampleManagers,
    holidaySet: sampleHolidays,
    today: new Date('2026-10-19T00:00:00'),
    rules: modifiedRules
  };

  const res = core.generateDailyTodos(params);
  const pkgTask = res.tasks.find(t => t.rule_id === 'PKG-PREP');
  assert.ok(pkgTask, 'PKG-PREP 과업 생성됨');
  assert.equal(pkgTask.target_time, '15:00', '수정된 시각 15:00 반영');
  assert.deepEqual(pkgTask.roles, ['stage5', 'p2_a'], '수정된 역할 2개 반영');
  assert.equal(pkgTask.title, '포장재 수령 및 포장실 세팅');
  assert.deepEqual(pkgTask.lot_ids, ['LOT-PKG-01', 'LOT-PKG-02']);
});

test('AC-8: validateRule이 잘못된 규칙을 거부하고 올바른 규칙을 통과시킴', () => {
  const okRule = {
    rule_id: 'U-OK1',
    kind: 'SIMPLE',
    enabled: true,
    title: '올바른 규칙',
    process_code: 'A',
    anchor_step: 'A',
    anchor_point: 'start',
    day_rule: 'SAME',
    time_mode: 'FIXED',
    target_time: '09:00',
    roles: ['p1_a'],
    sort_order: 100
  };
  assert.equal(core.validateRule(okRule).ok, true);

  assert.equal(core.validateRule({ ...okRule, target_time: '24:00' }).ok, false);
  assert.equal(core.validateRule({ ...okRule, target_time: '9:00' }).ok, false);

  assert.equal(core.validateRule({ ...okRule, title: '' }).ok, false);
  assert.equal(core.validateRule({ ...okRule, title: 'a'.repeat(61) }).ok, false);

  assert.equal(core.validateRule({ ...okRule, roles: [] }).ok, false);
  assert.equal(core.validateRule({ ...okRule, roles: ['unknown_role'] }).ok, false);
  assert.equal(core.validateRule({ ...okRule, roles: ['p1_a', 'p1_a'] }).ok, false);

  assert.equal(core.validateRule({ ...okRule, process_code: 'Z' }).ok, false);
  assert.equal(core.validateRule({ ...okRule, anchor_step: 'X' }).ok, false);
  assert.equal(core.validateRule({ ...okRule, anchor_point: 'middle' }).ok, false);
  assert.equal(core.validateRule({ ...okRule, day_rule: 'YESTERDAY' }).ok, false);
  assert.equal(core.validateRule({ ...okRule, time_mode: 'RANDOM' }).ok, false);

  assert.equal(core.validateRule({ ...okRule, anchor_step: 'PKG', day_rule: 'PREV_BIZ' }).ok, true);
  assert.equal(core.validateRule({ ...okRule, anchor_step: 'WEEK', day_rule: 'WEEK_LAST' }).ok, true);
  assert.equal(core.validateRule({ ...okRule, anchor_step: 'WEEK', day_rule: 'SAME' }).ok, false);
  assert.equal(core.validateRule({ ...okRule, anchor_step: 'A', day_rule: 'WEEK_LAST' }).ok, false);

  assert.equal(core.validateRule({
    rule_id: 'OLD-SPECIAL',
    kind: 'SPECIAL',
    enabled: true,
    title: '알 수 없는 특수',
    target_time: '09:00',
    roles: ['p1_a'],
    sort_order: 100
  }).ok, false);
});

test('AC-9: normalizeRules가 잘못된 규칙과 중복 ID를 버리고, 지운 규칙을 되살리지 않음', () => {
  const invalidRule = { rule_id: 'BAD-1', kind: 'SIMPLE', title: '' };
  const dupRule1 = { ...core.DEFAULT_RULES[0], title: '첫번째' };
  const dupRule2 = { ...core.DEFAULT_RULES[0], title: '중복' };

  const partialRules = [
    invalidRule,
    dupRule1,
    dupRule2,
    ...core.DEFAULT_RULES.filter(r => r.rule_id !== dupRule1.rule_id && r.rule_id !== 'PKG-PREP')
  ];

  const norm = core.normalizeRules(partialRules);
  assert.ok(norm.warnings.length >= 2, '잘못된 규칙 및 중복 ID 경고 발생');

  const matched = norm.rules.filter(r => r.rule_id === dupRule1.rule_id);
  assert.equal(matched.length, 1);
  assert.equal(matched[0].title, '첫번째');

  assert.equal(norm.rules.some(r => r.rule_id === 'PKG-PREP'), false, '지운 규칙은 되살아나지 않음');

  for (let i = 1; i < norm.rules.length; i++) {
    assert.ok(norm.rules[i].sort_order >= norm.rules[i - 1].sort_order);
  }
});

test('기준 시각 ±분(OFFSET) 규칙: 배치 시각을 따라가고, 근무시간 밖이면 다음 근무 시작 09:00으로 미룸', () => {
  const offsetRule = (rule_id, anchor_step, anchor_point, offset_minutes) => ({
    rule_id, kind: 'SIMPLE', enabled: true, title: rule_id, process_code: anchor_step,
    anchor_step, anchor_point, day_rule: 'SAME', time_mode: 'OFFSET', offset_minutes,
    roles: ['p1_a'], sort_order: 100
  });
  const rules = [
    offsetRule('PLUS20', 'A', 'start', 20),     // 2026-10-20(화) 13:00 + 20분 -> 13:20
    offsetRule('MINUS2H', 'A', 'start', -240),  // 13:00 - 4시간 = 09:00
    offsetRule('EARLY', 'A', 'start', -300),    // 08:00 -> 당일 09:00
    offsetRule('LATE', 'A', 'start', 330),      // 18:30 -> 다음 평일(10-21) 09:00
    offsetRule('FRI_END', 'B', 'end', 60)       // 2026-10-23(금) 17:30 + 60분 = 18:30 -> 다음 평일(10-26 월) 09:00
  ];
  const res = core.generateDailyTodos({
    batches: [{ lotNumber: 'LOT-OFF', schedule: { A: { startCode: '10201300' }, B: { startCode: '10230900', endCode: '10231730' } } }],
    managers: sampleManagers,
    holidaySet: sampleHolidays,
    today: new Date(2026, 9, 19),
    rules
  });
  const at = id => {
    const t = res.tasks.find(x => x.rule_id === id);
    return t && `${t.target_date} ${t.target_time}`;
  };
  assert.equal(at('PLUS20'), '2026-10-20 13:20');
  assert.equal(at('MINUS2H'), '2026-10-20 09:00');
  assert.equal(at('EARLY'), '2026-10-20 09:00');
  assert.equal(at('LATE'), '2026-10-21 09:00');
  assert.equal(at('FRI_END'), '2026-10-26 09:00');
});

test('OFFSET 규칙 검증: 당일만 허용, 정수 분, ±24시간 이내', () => {
  const base = {
    rule_id: 'U-x', kind: 'SIMPLE', enabled: true, title: 't', process_code: 'A',
    anchor_step: 'A', anchor_point: 'start', day_rule: 'SAME', time_mode: 'OFFSET',
    offset_minutes: -60, roles: ['p1_a'], sort_order: 100
  };
  assert.equal(core.validateRule(base).ok, true);
  assert.equal(core.validateRule({ ...base, day_rule: 'PREV_BIZ' }).ok, false);
  assert.equal(core.validateRule({ ...base, offset_minutes: 1.5 }).ok, false);
  assert.equal(core.validateRule({ ...base, offset_minutes: 1441 }).ok, false);
  assert.equal(core.validateRule({ ...base, offset_minutes: undefined }).ok, false);
});

test('알 수 없는 역할을 쓰는 규칙은 버려짐', () => {
  const { rules } = core.normalizeRules([{
    rule_id: 'CUSTOM-X', kind: 'SIMPLE', enabled: true, title: 'x', process_code: 'A',
    anchor_step: 'A', anchor_point: 'start', day_rule: 'SAME', time_mode: 'OFFSET', offset_minutes: 0,
    roles: ['custom_1'], sort_order: 100
  }]);
  assert.equal(rules.some(r => r.rule_id === 'CUSTOM-X'), false);
});

test('한 칸에 여러 명(쉼표): 사람마다 같은 할 일 행, 공백·중복·빈 항목 정리', () => {
  assert.deepEqual(core.splitManagerNames(' 홍길동 ,신입,, 홍길동 '), ['홍길동', '신입']);
  assert.deepEqual(core.splitManagerNames(''), []);
  assert.deepEqual(core.splitManagerNames(null), []);

  const rule = {
    rule_id: 'MULTI', kind: 'SIMPLE', enabled: true, title: '공정1 준비', process_code: 'A',
    anchor_step: 'A', anchor_point: 'start', day_rule: 'SAME', time_mode: 'OFFSET', offset_minutes: 0,
    roles: ['p1_a', 'p1_b'], sort_order: 100
  };
  const res = core.generateDailyTodos({
    batches: [{ lotNumber: 'LOT-M', schedule: { A: { startCode: '10201300' } } }],
    managers: { p1_a: '홍길동, 신입', p1_b: ' , ' },
    holidaySet: sampleHolidays,
    today: new Date(2026, 9, 19),
    rules: [rule]
  });
  const rows = res.rows.filter(r => r.rule_id === 'MULTI');
  const mix1 = rows.filter(r => r.role_key === 'p1_a').map(r => r.worker_name);
  assert.deepEqual(mix1, ['홍길동', '신입']);
  // 쉼표만 있는 칸은 미배정 1행 + 경고
  const mix2 = rows.filter(r => r.role_key === 'p1_b');
  assert.equal(mix2.length, 1);
  assert.equal(mix2[0].worker_name, null);
  assert.ok(res.warnings.some(w => w.code === 'UNASSIGNED_ROLE' && w.role_key === 'p1_b'));
  // 두 사람의 행은 같은 할 일(task_key)·시각
  const mix1Rows = rows.filter(r => r.role_key === 'p1_a');
  assert.equal(mix1Rows[0].task_key, mix1Rows[1].task_key);
  assert.equal(mix1Rows[1].target_time, '13:00');
});

test('공정 E가 끝난 배치(반제품 보관 구역·E 종료일 지남)는 공정 과업을 만들지 않고, 포장 준비에는 남음', () => {
  const future = { A: { startCode: '10200900', endCode: '10201800' }, E: { startCode: '10230900', endCode: '10231800' } };
  const inZone = { lotNumber: 'LOT-ZONE', manualZone: 'semi-storage-pre', packagingStartDate: '2026-10-22T09:00:00',
    schedule: { A: { startCode: '10240900', endCode: '10241800' }, E: { startCode: '10260900', endCode: '10261800' } } };
  const endedE = { lotNumber: 'LOT-ENDED', schedule: { A: { startCode: '10120900', endCode: '10121800' }, E: { startCode: '10160900', endCode: '10161800' } } };
  const active = { lotNumber: 'LOT-ACTIVE', schedule: future };
  const pastHoliday = { lotNumber: 'LOT-PAST-HOLI', schedule: { A: { startCode: '10090900', endCode: '10091800' } } };

  const res = core.generateDailyTodos({
    batches: [inZone, endedE, active, pastHoliday],
    managers: sampleManagers,
    holidaySet: sampleHolidays,
    today: new Date(2026, 9, 19)
  });

  const lotsOf = t => [t.lot_id, ...(t.lot_ids || [])];
  const processTasks = res.tasks.filter(t => t.rule_id !== 'PKG-PREP');
  assert.ok(processTasks.some(t => lotsOf(t).includes('LOT-ACTIVE')), '진행 중 배치는 과업 생성');
  for (const lot of ['LOT-ZONE', 'LOT-ENDED']) {
    assert.equal(processTasks.some(t => lotsOf(t).includes(lot)), false, `${lot}: 공정 과업 없어야 함`);
    assert.equal(res.warnings.some(w => w.lotNumber === lot), false, `${lot}: 경고 없어야 함`);
  }
  assert.ok(res.tasks.some(t => t.rule_id === 'PKG-PREP' && lotsOf(t).includes('LOT-ZONE')), '포장 준비 과업에는 남음');
});
