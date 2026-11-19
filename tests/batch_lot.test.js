const test = require('node:test');
const assert = require('node:assert/strict');
const { compareLots, productLine } = require('../src/batch/lot.ts');

test('칸 안 순서: 로트 번호가 큰 것이 왼쪽, 숫자는 값으로 비교 (LOT 접두어 무시)', () => {
  const lots = ['PA260301', 'LOT-PA260310', 'PA260302A', 'PA260302', 'PA9', 'PA10'];
  assert.deepEqual(lots.slice().sort(compareLots), ['LOT-PA260310', 'PA260302A', 'PA260302', 'PA260301', 'PA10', 'PA9']);
});

test('제품: 앞 글자(LOT 접두어 무시), 모르면 기타', () => {
  assert.equal(productLine('LOT-PA2608').name, '제품 A');
  assert.equal(productLine('pe1').name, '제품 B');
  assert.equal(productLine('(PC').name, '제품 C');
  assert.equal(productLine('').name, '기타 제품');
});
