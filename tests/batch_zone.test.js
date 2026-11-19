// 배치 위치 규칙(src/batch/zone.ts, src/batch/core.ts applyZoneChange). PC 평면도와 모바일이 같은 규칙을 쓴다.
const test = require('node:test');
const assert = require('node:assert/strict');
const { getBatchZoneInfo } = require('../src/batch/zone.ts');
const { applyZoneChange, applyBatchEdit } = require('../src/batch/core.ts');

const ZONES = Object.fromEntries(['stage1-wait', 'stage1-1', 'stage2-wait', 'stage2', 'stage3-wait', 'stage3-1',
  'stage4-wait', 'stage4-1', 'stage5-wait', 'stage5', 'semi-storage-pre', 'semi-storage-post', 'inspection',
  'packaging-wait', 'packaging', 'logistics'].map(id => [id, { name: id + ' 방', badge: id }]));
const at = h => new Date(Date.UTC(2026, 10, 10, h));
const step = (s, e) => ({ startDate: at(s).toISOString(), endDate: at(e).toISOString() });
// 공정1 0~2시, 공정2 3~5, 공정3 6~10, 공정4 11~13, 공정5 14~15, 포장 이틀 뒤 12~14시(포장 대기는 하루 전 12시부터)
const schedule = { A: step(0, 2), B: step(3, 5), C: step(6, 10), D: step(11, 13), E: step(14, 15), packaging: step(60, 62) };
const zoneAt = (batch, h) => getBatchZoneInfo(batch, ZONES, at(h)).zoneId;

test('스케줄대로: 진행 중이면 그 공정, 끝나면 다음 공정 대기, 공정5 뒤 반제품 보관실, 포장 24시간 전 포장 대기', () => {
  const b = { lotNumber: 'L', schedule };
  assert.deepEqual([-1, 1, 2, 4, 7, 12, 14.5, 16, 37, 61, 63].map(h => zoneAt(b, h)),
    ['stage1-wait', 'stage1-1', 'stage2-wait', 'stage2', 'stage3-1', 'stage4-1', 'stage5', 'semi-storage-pre', 'packaging-wait', 'packaging', 'semi-storage-pre']);
  assert.equal(zoneAt(b, 12 + 1), 'stage5-wait');
  assert.equal(zoneAt({ ...b, stage1Machine: '공정1 설비 2호기' }, 1), 'stage1-2');
});

test('포장 일정은 공정5이 끝난 뒤에만 위치를 정하고, 완제품 창고 배치는 포장 시간에도 창고', () => {
  const tight = { ...schedule, packaging: step(30, 32) }; // 포장 대기 시작(6시)이 공정5 끝(15시)보다 이르다
  const b = { lotNumber: 'L', schedule: tight };
  assert.equal(zoneAt(b, 12), 'stage4-1');
  assert.equal(zoneAt(b, 14.5), 'stage5');
  assert.equal(zoneAt(b, 16), 'packaging-wait');
  assert.equal(zoneAt(b, 31), 'packaging');
  const stored = { ...b, manualZone: 'logistics', assignedZone: 'logistics', manualMovedAt: at(16).toISOString() };
  assert.equal(zoneAt(stored, 31), 'logistics');
});

test('사람이 공정 구역에 옮기면 그 뒤에 시작·종료된 공정만 따라간다', () => {
  const b = { lotNumber: 'L', schedule, manualZone: 'stage2-wait', assignedZone: 'stage2-wait', manualMovedAt: at(1).toISOString() };
  assert.equal(zoneAt(b, 1.5), 'stage2-wait'); // 공정1 중이지만 옮긴 뒤라 그대로
  assert.equal(zoneAt(b, 4), 'stage2'); // 옮긴 뒤 공정2이 시작됨
  assert.equal(getBatchZoneInfo(b, ZONES, at(1.5)).isManual, true);
});

test('공정5 뒤 구역(검사 등)에 옮기면 스케줄과 상관없이 그대로, 포장 시간만 예외', () => {
  const b = { lotNumber: 'L', schedule, manualZone: 'inspection', assignedZone: 'inspection', manualMovedAt: at(16).toISOString() };
  assert.equal(zoneAt(b, 20), 'inspection');
  assert.equal(zoneAt(b, 40), 'packaging-wait');
  assert.equal(zoneAt(b, 63), 'inspection');
});

test('위치 이동은 화면에 보이는 위치와 비교한다: 같으면 아무것도 바꾸지 않고, 다르면 이동 시각을 찍는다', () => {
  const stored = { lotNumber: 'L', schedule, manualZone: 'stage1-wait', assignedZone: 'stage1-wait' };
  const shown = zoneAt(stored, 4); // 자동 진행으로 공정2 중
  assert.equal(shown, 'stage2');

  const same = JSON.parse(JSON.stringify(stored));
  applyZoneChange(same, 'stage2', at(4).toISOString(), shown);
  assert.deepEqual(same, stored, '보이는 위치 그대로 저장해도 고정되지 않는다');

  const back = JSON.parse(JSON.stringify(stored));
  applyZoneChange(back, 'stage1-wait', at(4).toISOString(), shown);
  assert.equal(back.manualMovedAt, at(4).toISOString(), '저장된 위치로 되돌리는 것도 이동이다');
  assert.equal(zoneAt(back, 4.5), 'stage1-wait');
});

test('완제품 창고: 들어갈 때 보이던 위치를 기억하고, 나올 때 완료 기록을 지운다. 다시 넣어도 원래 위치는 그대로', () => {
  const b = { lotNumber: 'L', schedule, manualZone: 'stage1-wait', assignedZone: 'stage1-wait' };
  applyZoneChange(b, 'logistics', at(20).toISOString(), 'semi-storage-pre');
  assert.equal(b.prevZoneBeforeLogistics, 'semi-storage-pre');
  assert.ok(b.completed_at);
  applyZoneChange(b, 'logistics', at(21).toISOString(), 'packaging');
  assert.equal(b.prevZoneBeforeLogistics, 'semi-storage-pre');
  applyZoneChange(b, 'inspection', at(22).toISOString(), 'packaging');
  assert.equal(b.manualZone, 'inspection');
  assert.equal(b.completed_at, undefined);
  assert.equal(b.prevZoneBeforeLogistics, undefined);
});

test('모바일 수정(applyBatchEdit)도 fromZoneId로 같은 규칙을 쓴다', () => {
  const b = { lotNumber: 'L', schedule, manualZone: 'stage1-wait', assignedZone: 'stage1-wait' };
  assert.equal(applyBatchEdit(b, { zoneId: 'stage2', fromZoneId: 'stage2' }, at(4)).manualMovedAt, undefined);
  assert.equal(applyBatchEdit(b, { zoneId: 'stage1-wait', fromZoneId: 'stage2' }, at(4)).manualMovedAt, at(4).toISOString());
});
