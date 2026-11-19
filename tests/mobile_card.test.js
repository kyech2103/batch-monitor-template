const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBatchCardModel } = require('../src/mobile/card.ts');
const { normalizeScheduleYears } = require('../src/todo/core.ts');

test('AC-1: 카드 모델 분류 및 statusText 3종', () => {
  const now = new Date('2026-10-25T10:00:00');
  const batches = [
    // 1. 진행 중 (D 공정4, 09:00 ~ 17:00, 7시간 남음)
    {
      lotNumber: 'LOT-PROG-1',
      schedule: {
        D: { start: new Date('2026-10-25T09:00:00'), end: new Date('2026-10-25T17:00:00') }
      }
    },
    // 2. 대기 (A 공정1 대기, 시작 10/26 09:00)
    {
      lotNumber: 'LOT-WAIT-1',
      schedule: {
        A: { start: new Date('2026-10-26T09:00:00'), end: new Date('2026-10-26T17:00:00') }
      }
    },
    // 3. 보관 중 (semi-storage-pre)
    {
      lotNumber: 'LOT-STORE-1',
      assignedZone: 'semi-storage-pre'
    },
    // 4. 완제품 창고 (logistics)
    {
      lotNumber: 'LOT-LOG-1',
      assignedZone: 'logistics'
    }
  ];

  const zoneInfoMock = (b) => {
    if (b.lotNumber === 'LOT-PROG-1') return { zoneId: 'stage4-1', processName: '공정4', step: 'D', badgeText: '공정4 (1호기)' };
    if (b.lotNumber === 'LOT-WAIT-1') return { zoneId: 'stage1-wait', processName: '공정1 대기', step: 'A', badgeText: '공정1 (대기)' };
    if (b.lotNumber === 'LOT-STORE-1') return { zoneId: 'semi-storage-pre', processName: '보관', statusDesc: '반제품 보관실 보관 중' };
    return { zoneId: 'logistics', processName: '완제품 창고' };
  };

  const models = batches.map(b => buildBatchCardModel(b, zoneInfoMock(b), now, normalizeScheduleYears));
  const progress = models.filter(m => m.group === 'progress'), waiting = models.filter(m => m.group === 'waiting');
  const storage = models.filter(m => m.group === 'storage'), logisticsCount = models.filter(m => m.group === 'logistics').length;

  assert.equal(progress.length, 1);
  assert.equal(waiting.length, 1);
  assert.equal(storage.length, 1);
  assert.equal(logisticsCount, 1);

  // statusText 예시 3종 검증
  // 1) 진행 중 남은 시간 포함
  assert.match(progress[0].statusText, /공정4 진행 중 · 17:00 종료 \(7시간 남음\)/);
  assert.ok(progress[0].progressPct > 0);

  // 2) 대기 시작 예정
  assert.match(waiting[0].statusText, /공정1 대기 · 09:00 시작/);

  // 3) 보관
  assert.match(storage[0].statusText, /반제품 보관실 보관 중/);
});

test('운영 형식 startCode/endCode(MMDDHHmm)로도 진행률·종료 시각 계산', () => {
  const now = new Date('2026-10-25T13:00:00');
  const batch = { lotNumber: 'PC260507', schedule: { D: { startCode: '10250900', endCode: '10251700' } } };
  const model = buildBatchCardModel(batch, { zoneId: 'stage4-2', processName: '공정4' }, now, normalizeScheduleYears);
  assert.equal(model.progressPct, 50);
  assert.match(model.statusText, /공정4 진행 중 · 17:00 종료 \(4시간 남음\)/);
});
