const test = require('node:test');
const assert = require('node:assert/strict');
const MobileProcessGroups = require('../src/mobile/processGroups.ts');

test('AC-1: 모든 구역 id가 올바른 묶음(A~E, 공정5 이후 구역별)으로 매핑됨', () => {
  const testZones = [
    { zoneId: 'stage1-wait', expected: 'A' },
    { zoneId: 'stage1-1', expected: 'A' },
    { zoneId: 'stage1-2', expected: 'A' },
    { zoneId: 'stage1', expected: 'A' },
    { zoneId: 'stage2-wait', expected: 'B' },
    { zoneId: 'stage2', expected: 'B' },
    { zoneId: 'stage3-wait', expected: 'C' },
    { zoneId: 'stage3-1', expected: 'C' },
    { zoneId: 'stage3-2', expected: 'C' },
    { zoneId: 'stage3', expected: 'C' },
    { zoneId: 'stage4-wait', expected: 'D' },
    { zoneId: 'stage4-1', expected: 'D' },
    { zoneId: 'stage4-2', expected: 'D' },
    { zoneId: 'stage4', expected: 'D' },
    { zoneId: 'stage5-wait', expected: 'E' },
    { zoneId: 'stage5', expected: 'E' },
    { zoneId: 'semi-discharge', expected: 'semi-pre' },
    { zoneId: 'semi-storage-pre', expected: 'semi-pre' },
    { zoneId: 'semi-storage-post', expected: 'semi-post' },
    { zoneId: 'inspection', expected: 'inspection' },
    { zoneId: 'packaging-wait', expected: 'packaging-wait' },
    { zoneId: 'packaging', expected: 'packaging' }
  ];

  const models = testZones.map((tz, i) => ({
    lot: `LOT-${i}`,
    zoneId: tz.zoneId,
    group: 'storage',
    sortKey: i
  }));

  const groups = MobileProcessGroups.groupByProcess(models);
  // 공정5 이후는 현장 흐름 순서: 보관실(검사 전) → 검사실 → 보관실(검사 후) → 포장 대기 → 포장
  assert.deepEqual(groups.map(g => g.key), ['A', 'B', 'C', 'D', 'E', 'semi-pre', 'inspection', 'semi-post', 'packaging-wait', 'packaging']);

  testZones.forEach((tz, i) => {
    const lot = `LOT-${i}`;
    const targetGroup = groups.find(g => g.key === tz.expected);
    assert.ok(targetGroup.items.some(m => m.lot === lot), `${tz.zoneId} should be in ${tz.expected}`);
  });
});

test('AC-1: 알 수 없는 구역은 검사 전 보관실 묶음으로 가고, logistics는 제외됨', () => {
  const models = [
    { lot: 'UNKNOWN-1', zoneId: 'weird-zone-99', group: 'storage', sortKey: 1 },
    { lot: 'LOGI-1', zoneId: 'logistics', group: 'logistics', sortKey: 2 },
    { lot: 'LOGI-2', zoneId: 'warehouse', group: 'logistics', sortKey: 3 }
  ];

  const groups = MobileProcessGroups.groupByProcess(models);
  const preGroup = groups.find(g => g.key === 'semi-pre');
  assert.ok(preGroup.items.some(m => m.lot === 'UNKNOWN-1'), '알 수 없는 구역은 semi-pre에 포함');

  const allItems = groups.flatMap(g => g.items);
  assert.equal(allItems.some(m => m.lot === 'LOGI-1'), false, 'logistics zoneId는 제외');
  assert.equal(allItems.some(m => m.lot === 'LOGI-2'), false, 'logistics group은 제외');
});

test('AC-1: 묶음 안 정렬 (진행 -> 대기 -> sortKey 오름차순)', () => {
  const models = [
    { lot: 'LOT-WAIT-2', zoneId: 'stage1-wait', group: 'waiting', sortKey: 200 },
    { lot: 'LOT-STOR-1', zoneId: 'stage1-1', group: 'storage', sortKey: 50 },
    { lot: 'LOT-PROG-2', zoneId: 'stage1-2', group: 'progress', sortKey: 150 },
    { lot: 'LOT-WAIT-1', zoneId: 'stage1-wait', group: 'waiting', sortKey: 100 },
    { lot: 'LOT-PROG-1', zoneId: 'stage1-1', group: 'progress', sortKey: 50 }
  ];

  const groups = MobileProcessGroups.groupByProcess(models);
  const groupA = groups.find(g => g.key === 'A');
  const resultLots = groupA.items.map(m => m.lot);

  assert.deepEqual(resultLots, [
    'LOT-PROG-1', // progress, sortKey 50
    'LOT-PROG-2', // progress, sortKey 150
    'LOT-WAIT-1', // waiting, sortKey 100
    'LOT-WAIT-2', // waiting, sortKey 200
    'LOT-STOR-1'  // storage, sortKey 50
  ]);
});
