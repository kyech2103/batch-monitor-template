const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// 평면도 칩(qtyForZone)과 툴팁·창고(batchQuantities)가 같은 숫자를 내는지 본다.
// 기대값(fixtures/batch_quantities_pin.json)은 두 함수를 합치기 전 코드로 만든 기록이다.
const Q = require('../src/batch/quantity.ts');
const calc = Q.batchQuantities, forZone = Q.qtyForZone;

const ZONES = ['stage1-wait', 'stage1', 'stage2-wait', 'stage2', 'stage3-wait', 'stage3-1', 'stage4-wait',
  'stage4-2', 'stage5-wait', 'stage5', 'semi-storage-pre', 'inspection', 'semi-storage-post', 'packaging-wait', 'packaging', 'logistics', 'unknown-zone'];
const L = (B, C, D, E, inspection, packaging) => ({ B, C, D, E, inspection, packaging });
const BATCHES = {
  '정상(새 형식)': { quantities: { B: 1000, BNet: 990, C: 985, D: 985, E: 980, inspection: 970, packaging: 968, losses: L(10, 5, 0, 5, 10, 2) } },
  '차감 일부 비어 있음': { quantities: { B: 500, losses: L(3, null, '', 2, null, null) } },
  '문자열 숫자': { quantities: { B: '1200', losses: L('20', '5', '0', '0', '0', '0') } },
  '옛 형식(qtyB, lossQuantities)': { qtyB: 800, lossQuantities: L(8, 2, 0, 0, 0, 0), qtyC: 790 },
  '공정2 수량 없음': { quantities: { losses: L(null, null, null, null, null, null) } },
  '공정2 수량 없이 저장된 실수량만': { quantities: { C: 700, E: 690, losses: L(null, null, null, null, 5, null) } },
  '수량 정보 없음': {},
  '차감이 0': { quantities: { B: 300, losses: L(0, 0, 0, 0, 0, 0) } }
};

function snapshot() {
  const out = {};
  for (const [name, b] of Object.entries(BATCHES)) {
    out[name] = { calc: calc(b), zones: Object.fromEntries(ZONES.map(z => [z, forZone(b, z)])) };
  }
  return JSON.parse(JSON.stringify(out));
}

const PIN = path.join(__dirname, 'fixtures', 'batch_quantities_pin.json');
if (process.env.RECORD_QTY_PIN) fs.writeFileSync(PIN, JSON.stringify(snapshot(), null, 1) + '\n');

test('배치 수량 계산 결과가 기록과 같다', () => {
  assert.deepEqual(snapshot(), JSON.parse(fs.readFileSync(PIN, 'utf8')));
});

test('칩에 쓰는 구역별 수량은 calcBatchQuantities가 낸 숫자 중 하나다', () => {
  for (const [name, b] of Object.entries(BATCHES)) {
    const c = calc(b);
    const allowed = [c.actualB, c.actualBNet, c.actualC, c.actualD, c.actualE, c.actualInspection, c.actualPackaging, null];
    for (const z of ZONES) assert.ok(allowed.includes(forZone(b, z)), `${name} / ${z}`);
  }
});
