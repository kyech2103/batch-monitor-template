const test = require('node:test');
const assert = require('node:assert/strict');
const BatchCore = require('../src/batch/core.ts');

test('AC-1: F-2 공정 시각 형식 및 요약 필드', () => {
  const baseBatch = {
    lotNumber: 'TEST-LOT-01',
    schedule: {
      A: { stepId: 'A', stepName: '공정1', room: '공정1실', machine: '공정1 설비 1호기' },
      B: { stepId: 'B', stepName: '공정2', room: '공정2실' },
      C: { stepId: 'C', stepName: '공정3', room: '공정3실' },
      D: { stepId: 'D', stepName: '공정4', room: '공정4실' },
      E: { stepId: 'E', stepName: '공정5', room: '공정5실' },
      packaging: { stepId: 'packaging', stepName: '포장', room: '포장실' }
    }
  };

  const edit = {
    times: {
      A: {
        start: new Date('2026-10-22T10:00:00'),
        end: new Date('2026-10-22T12:00:00')
      },
      packaging: {
        start: new Date('2026-10-23T09:00:00'),
        end: new Date('2026-10-23T11:30:00')
      }
    }
  };

  const now = new Date('2026-10-25T12:00:00Z');
  const result = BatchCore.applyBatchEdit(baseBatch, edit, now);

  const schA = result.schedule.A;
  assert.equal(schA.startCode, '10221000');
  assert.equal(schA.endCode, '10221200');
  assert.equal(schA.durationMinutes, 120);
  assert.equal(schA.durationText, '2시간 00분');
  assert.equal(schA.startFriendly, '10월 22일(목) 10:00');

  // 요약 필드: overallEndCode가 packaging 우선
  assert.equal(result.overallStartCode, '10221000');
  assert.equal(result.overallStartFriendly, '10월 22일(목) 10:00');
  assert.equal(result.overallEndCode, '10231130');
  assert.equal(result.packagingStartCode, '10230900');
  assert.equal(result.packagingEndCode, '10231130');
  assert.equal(result.totalDurationMinutes, 270);
  assert.equal(result.totalDurationText, '4시간 30분');
});

test('AC-1: F-3 수량 사슬과 하위 호환 키 및 빈 손실 null', () => {
  const baseBatch = { lotNumber: 'TEST-LOT-02' };

  // 1. 수량 입력 있음
  const editWithQty = {
    qtyB: 1000,
    losses: {
      B: 50,
      C: '', // 빈칸은 null로 저장되고 계산에서는 0
      D: 10,
      E: null,
      inspection: 20,
      packaging: 5
    }
  };

  const res1 = BatchCore.applyBatchEdit(baseBatch, editWithQty);
  assert.equal(res1.quantities.B, 1000);
  assert.equal(res1.quantities.BNet, 950);
  assert.equal(res1.quantities.C, 950);
  assert.equal(res1.quantities.D, 940);
  assert.equal(res1.quantities.E, 940);
  assert.equal(res1.quantities.inspection, 920);
  assert.equal(res1.quantities.packaging, 915);
  assert.equal(res1.quantities.losses.C, null);
  assert.equal(res1.quantities.losses.E, null);
  assert.equal(res1.quantities.losses.B, 50);

  // 하위 호환 키 검증
  assert.equal(res1.qtyB, 1000);
  assert.equal(res1.lossB, 50);
  assert.equal(res1.qtyC, 950);
  assert.equal(res1.qtyD, 940);
  assert.equal(res1.qtyE, 940);
  assert.equal(res1.qtyInspection, 920);
  assert.equal(res1.qtyPackaging, 915);
  assert.deepEqual(res1.lossQuantities, res1.quantities.losses);

  // 2. qtyB가 빈칸이면 모든 실적 null
  const editEmpty = {
    qtyB: '',
    losses: { B: 10 }
  };
  const res2 = BatchCore.applyBatchEdit(baseBatch, editEmpty);
  assert.equal(res2.quantities.B, null);
  assert.equal(res2.quantities.BNet, null);
  assert.equal(res2.quantities.packaging, null);
  assert.equal(res2.qtyB, null);
  assert.equal(res2.qtyPackaging, null);
});

test('AC-1: F-4 비고 엔티티 변환 및 schedule 동기화', () => {
  const baseBatch = {
    lotNumber: 'TEST-LOT-03',
    schedule: {
      D: { stepId: 'D', stepName: '공정4', remarks: '' }
    }
  };

  const edit = {
    remarks: {
      D: '온도 < 121°C & "주의" \'확인\' / 점검',
      inspection: '이물 < 1개'
    }
  };

  const res = BatchCore.applyBatchEdit(baseBatch, edit);
  const expectedD = '온도 &lt; 121°C &amp; &quot;주의&quot; &#x27;확인&#x27; &#x2F; 점검';
  assert.equal(res.remarks.D, expectedD);
  assert.equal(res.schedule.D.remarks, expectedD);
  assert.equal(res.remarks.inspection, '이물 &lt; 1개');
});

test('AC-1: F-5 창고 이동 및 복원 필드', () => {
  const baseBatch = {
    lotNumber: 'TEST-LOT-04',
    manualZone: 'stage5',
    assignedZone: 'stage5'
  };

  const now1 = new Date('2026-10-25T14:00:00Z');
  // 1. logistics 이동
  const res1 = BatchCore.applyBatchEdit(baseBatch, { zoneId: 'logistics' }, now1);
  assert.equal(res1.manualZone, 'logistics');
  assert.equal(res1.assignedZone, 'logistics');
  assert.equal(res1.prevZoneBeforeLogistics, 'stage5');
  assert.equal(res1.completed_at, now1.toISOString());
  assert.equal(res1.moved_to_storage_at, now1.toISOString());
  assert.equal(res1.enteredLogisticsAt, now1.toISOString());

  // 2. logistics에서 다른 구역으로 이동 (복원)
  const now2 = new Date('2026-10-25T15:00:00Z');
  const res2 = BatchCore.applyBatchEdit(res1, { zoneId: 'packaging' }, now2);
  assert.equal(res2.manualZone, 'packaging');
  assert.equal(res2.assignedZone, 'packaging');
  assert.equal(res2.completed_at, undefined);
  assert.equal(res2.moved_to_storage_at, undefined);
  assert.equal(res2.enteredLogisticsAt, undefined);
  assert.equal(res2.prevZoneBeforeLogistics, undefined);
});

test('위치를 그대로 두고 저장하면 수동 이동 시각을 새로 찍지 않는다', () => {
  const batch = { lotNumber: 'TEST-LOT-05', manualZone: 'stage3-wait', assignedZone: 'stage3-wait', manualMovedAt: '2026-10-30T13:00:00.000Z' };
  const res = BatchCore.applyBatchEdit(batch, { zoneId: 'stage3-wait' }, new Date('2026-11-02T04:50:00Z'));
  assert.equal(res.manualMovedAt, '2026-10-30T13:00:00.000Z');
});

test('AC-1: F-6 검증 규칙 (중복 로트, 종료<시작, 잘못된 글자, 비고 200자)', () => {
  const batch = { lotNumber: 'ORIG-01' };
  const allBatches = [
    { lotNumber: 'ORIG-01' },
    { lotNumber: 'EXISTING-02' }
  ];

  // 1. 중복 로트
  const errsDup = BatchCore.validateEdit({ lotNumber: 'EXISTING-02' }, batch, allBatches);
  assert.ok(errsDup.includes('이미 있는 로트넘버예요'));

  // 2. 잘못된 글자
  const errsInvalidChar = BatchCore.validateEdit({ lotNumber: 'LOT<123>' }, batch, allBatches);
  assert.ok(errsInvalidChar.includes('로트넘버 형식이 올바르지 않아요'));

  // 3. 종료 < 시작
  const errsTime = BatchCore.validateEdit({
    lotNumber: 'VALID-01',
    times: {
      B: { start: '2026-10-25T14:00:00', end: '2026-10-25T13:00:00' }
    }
  }, batch, allBatches);
  assert.ok(errsTime.includes('공정2 종료가 시작보다 빨라요'));

  // 4. 비고 200자 초과
  const longRemark = 'a'.repeat(201);
  const errsRemark = BatchCore.validateEdit({
    lotNumber: 'VALID-01',
    remarks: { A: longRemark }
  }, batch, allBatches);
  assert.ok(errsRemark.includes('비고는 200자까지예요'));

  // 5. 정상 통과
  const errsOk = BatchCore.validateEdit({
    lotNumber: 'VALID-01',
    times: { B: { start: '2026-10-25T10:00:00', end: '2026-10-25T12:00:00' } },
    remarks: { A: '정상 비고' },
    qtyB: 100
  }, batch, allBatches);
  assert.equal(errsOk.length, 0);
});

test('AC-1: F-7 hasConflict 충돌 감지', () => {
  const snapshot = {
    lotNumber: 'PA-01',
    quantities: { B: 100, packaging: 95 },
    remarks: { A: '비고1' }
  };

  // 1. 키 순서만 다름 -> 충돌 아님 (false)
  const reversed = {
    remarks: { A: '비고1' },
    quantities: { packaging: 95, B: 100 },
    lotNumber: 'PA-01'
  };
  assert.equal(BatchCore.hasConflict(snapshot, reversed), false);

  // 2. 값이 다르면 충돌 (true)
  const modified = {
    ...snapshot,
    remarks: { A: '비고 변경됨' }
  };
  assert.equal(BatchCore.hasConflict(snapshot, modified), true);

  // 3. 서버에서 삭제됨(null/undefined) -> 충돌 (true)
  assert.equal(BatchCore.hasConflict(snapshot, null), true);
  assert.equal(BatchCore.hasConflict(snapshot, undefined), true);
});

test('비고: 저장된 값(한 번 변환)을 입력칸용 글자로 되돌려 다시 저장하면 그대로', () => {
  const raw = `a & b / 'c' <d> "e"`;
  const once = BatchCore.applyBatchEdit({ lotNumber: 'L', remarks: {} }, { remarks: { C: raw } }).remarks.C;
  assert.equal(BatchCore.unsanitizeInput(once), raw);
  const again = BatchCore.applyBatchEdit({ lotNumber: 'L', remarks: { C: once } }, { remarks: { C: BatchCore.unsanitizeInput(once) } }).remarks.C;
  assert.equal(again, once);
});
