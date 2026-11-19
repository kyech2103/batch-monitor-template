// 코드 추출기가 정답 변경 목록에 필요한 로트·날짜·시각·수량 후보를 빠짐없이 뽑는지 확인한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractReport } = require('../supabase/functions/batch-assist/extract.mjs');

const NOW = Date.parse('2026-11-09T05:00:00.000Z'); // 한국 시각 11/09 14:00
const SYNTH = ['stage3_done', 'packaging_tomorrow'].map(n => ({ name: n, lots: ['PA-1', 'PA-2'], ...require(`./fixtures/batch_assist/${n}.json`) }));
const QTY_OPS = new Set(['step2_qty', 'deduct', 'net', 'loss']);

/** 정답 Change 하나를 만들 재료가 추출 결과에 다 있는지. 없으면 이유 글. */
function missing(c, ex) {
  const line = ex.lines.find(l => l.text === c.quote.trim());
  if (!line) return `근거 줄 없음: ${c.quote}`;
  if (c.op === 'start' || c.op === 'end') {
    if (!ex.lots.includes(c.lot)) return `보고 로트에 ${c.lot} 없음`;
  } else if (!line.lots.includes(c.lot)) return `"${c.quote}" 줄의 로트에 ${c.lot} 없음 (${line.lots})`;
  if (QTY_OPS.has(c.op) && !line.nums.includes(c.qty)) return `"${c.quote}" 수량 후보에 ${c.qty} 없음 (${line.nums})`;
  if (c.at) {
    const [day, time] = c.at.split('T');
    if (line.date !== day) return `날짜 ${line.date} ≠ ${day}`;
    if (time && !line.times.includes(time)) return `시각 후보에 ${time} 없음 (${line.times})`;
  }
  return null;
}

for (const fx of SYNTH) {
  test(`추출: ${fx.name}`, () => {
    const ex = extractReport(fx.report, fx.lots, NOW);
    assert.deepEqual(fx.changes.map(c => missing(c, ex)).filter(Boolean), []);
  });
}

test('추출: 쓰지 않는 숫자는 후보에서 미리 빠진다 (괄호 수량, 퍼센트)', () => {
  const ex = extractReport('PA260401 : 1,000개\nPA260402 : 980개\n합계 1,980개 (98.0%)\n공정5 중 파손 3개 (남은 1,200개)', ['PA260401', 'PA260402'], NOW);
  assert.deepEqual(ex.lines.map(l => l.nums), [[1000], [980], [1980], [3]]); // 합계 1980은 남기고 AI가 버린다
});

test('추출: 로트 없는 줄은 바로 위 로트를 물려받고, 첫 로트보다 위 줄은 처음 나오는 로트를 받는다', () => {
  const ex = extractReport('차감 2\nPA260401 공정3 완료\n시험용 샘플 5개', ['PA260401', 'PA260402'], NOW);
  assert.deepEqual(ex.lines.map(l => [l.lots, l.own]), [[['PA260401'], false], [['PA260401'], true], [['PA260401'], false]]);
  assert.deepEqual(ex.lines[2], { text: '시험용 샘플 5개', row: '시험용 샘플 5개', lots: ['PA260401'], own: false, date: '2026-11-09', dated: false, nums: [5], times: [], zones: [] });
});

test('추출: 목록에 없는 로트 모양 글자는 unknownLots로, 날짜는 오늘·내일·"11/12" 기준', () => {
  const ex = extractReport('새 배치 PA-404 공정3 차감 1\n내일 PA-1 포장 오후 2시 30분\nPA-1 11/12 13:00 공정4', ['PA-1'], NOW);
  assert.deepEqual(ex.unknownLots, ['PA-404']);
  assert.deepEqual(ex.lines[0].nums, [1]);
  assert.equal(ex.lines[1].date, '2026-11-10');
  assert.deepEqual(ex.lines[1].times, ['14:30']);
  assert.deepEqual([ex.lines[2].date, ex.lines[2].dated, ex.lines[2].times], ['2026-11-12', true, ['13:00']]);
  assert.equal(extractReport('PA-1 완료', ['PA-1'], NOW).date, '2026-11-09');
});

test('추출: 긴 로트 이름부터 찾고, 한 줄의 로트+수량 짝은 로트마다 나눈다', () => {
  const ex = extractReport('PA260401A 샘플 2개, PA260401 샘플 4개 빼', ['PA260401', 'PA260401A'], NOW);
  assert.deepEqual(ex.lines.map(l => [l.lots, l.nums]), [[['PA260401A'], [2]], [['PA260401'], [4]]]);
});
