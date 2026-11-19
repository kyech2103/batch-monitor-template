const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/rooms/shelf/model.ts');

const it = (uid, text = uid) => ({ uid, text, cat: 'equip' });
const single = (label, items = []) => ({ colId: label, label, colType: 'single', slots: [{ slotName: `${label} 칸`, items }] });
const grid = label => ({ colId: label, label, colType: 'grid2x2', slots: ['1행-좌', '1행-우', '2행-좌', '2행-우'].map((slotName, i) => ({ slotName, items: [it(`${label}${i}`)] })) });
const model = () => ({ toBe: [{ tierTitle: '상단', columns: [single('A', [it('a1')]), single('B', [it('b1')]), grid('G')] }, { tierTitle: '하단', columns: [single('C')] }], custom: [it('T1', '대기')] });

test('적재함을 다른 1단 위에 쌓으면 2단이 되고, 나누면 원래 두 열로 돌아온다', () => {
  const m = model();
  const log = M.stackUnit(m, 0, 0, 'single', 0, 1, 'top');
  assert.equal(log[0], '선반 적층');
  assert.deepEqual(m.toBe[0].columns.map(c => [c.label, c.colType]), [['A + B', 'split2'], ['G', 'grid2x2']]);
  assert.deepEqual(m.toBe[0].columns[0].slots.map(s => [s.slotName, s.items.map(i => i.uid)]), [['상단 적재함', ['a1']], ['하단 적재함', ['b1']]]);
  M.unstack(m, 0, 0);
  assert.deepEqual(m.toBe[0].columns.map(c => [c.label, c.colType, c.slots[0].items.map(i => i.uid)]), [['A', 'single', ['a1']], ['B', 'single', ['b1']], ['G', 'grid2x2', ['G0']]]);
});

test('4구 위에 1단을 쌓으면 split_1_4, 이미 2단인 곳에는 쌓지 못한다', () => {
  const m = model();
  M.stackUnit(m, 0, 0, 'single', 0, 2, 'top');
  const g = m.toBe[0].columns[1];
  assert.equal(g.colType, 'split_1_4');
  assert.equal(g.slots.length, 5);
  assert.throws(() => M.stackUnit(m, 0, 0, 'single', 0, 1, 'bottom'), /이미 2단으로 적층된 구역/);
});

test('2단에서 위 적재함만 떼어 다른 단으로 옮기면 남은 쪽은 1단 열이 된다', () => {
  const m = model();
  M.stackUnit(m, 0, 0, 'single', 0, 1, 'top');
  M.moveUnitToShelf(m, 0, 0, 'top', 1, -1);
  assert.deepEqual(m.toBe[0].columns[0].colType, 'single');
  assert.deepEqual(m.toBe[0].columns[0].slots[0].items.map(i => i.uid), ['b1']);
  assert.deepEqual(m.toBe[1].columns.map(c => c.slots[0].items.map(i => i.uid)), [[], ['a1']]);
});

test('대기 품목을 칸에 놓으면 대기함에서 빠지고, 칸 사이 이동은 기록을 남긴다', () => {
  const m = model();
  const log = M.placeItem(m, { uid: 'T1', fromLoc: '신규 등록 대기열' }, 1, 0, 0);
  assert.deepEqual(log.slice(0, 3), ['물건 배치', '대기', '신규 등록 대기열']);
  assert.equal(m.custom.length, 0);
  assert.equal(m.toBe[1].columns[0].slots[0].items[0].origLoc, '신규 등록 대기열');
  const mv = M.placeItem(m, { t: 1, c: 0, s: 0, i: 0 }, 0, 0, 0);
  assert.equal(mv[0], '물건 이동');
  assert.deepEqual(m.toBe[0].columns[0].slots[0].items.map(i => i.uid), ['a1', 'T1']);
  assert.equal(M.placeItem(m, { t: 0, c: 0, s: 0, i: 0 }, 0, 0, 0), undefined, '같은 칸이면 그대로');
});

test('다른 방에서 온 품목은 대기함 맨 앞에, 서버 값은 옛 배열 모양도 받고 비운 단은 품목이 있을 때만 남긴다', () => {
  const m = model();
  M.arrive(m, { uid: 'X', text: '보낸 것', color: 'blue' }, '비품실');
  assert.deepEqual(m.custom[0], { uid: 'X', text: '보낸 것', cat: 'equip', customColor: 'blue', containerType: '이송 품목', origLoc: '비품실 전송' });
  assert.equal(M.hasUid(m, 'a1'), true);
  const tiers = [{ tierTitle: '방출', columns: [single('R')] }, { tierTitle: '상단', columns: [] }];
  assert.deepEqual(M.fromServer(tiers, m, '방출').toBe.map(t => t.tierTitle), ['상단']);
  assert.equal(M.fromServer(tiers, m, '방출').custom, m.custom);
  tiers[0].columns[0].slots[0].items.push(it('r1'));
  assert.equal(M.fromServer({ toBe: tiers, custom: [] }, m, '방출').toBe.length, 2);
  assert.equal(M.fromServer({ nope: 1 }, m, null), null);
});

test('CSV는 BOM과 머리줄, 품목마다 한 줄 (쉼표는 빈칸으로)', () => {
  const m = model();
  m.toBe[0].columns[0].slots[0].items[0] = { uid: 'a1', text: '부품 25, 큰것', customColor: 'red' };
  const lines = M.toCSV(m).split('\n');
  assert.equal(lines[0], '﻿No,선반 단(위치),구역 및 적재함,보관 품목/장비명,용기/적재 형태,지정 색상,보관 상태');
  assert.equal(lines[1], '"1","상단","A [A 칸]","부품 25  큰것","보관함","연한 빨강","정상보관"');
  assert.equal(lines.length, 2 + 1 + 4 + 1);
});
