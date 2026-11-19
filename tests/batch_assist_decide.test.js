// 질문 만들기와 답 조립(회사 규칙 자리, 확신도 문턱, 낯선 로트)을 가짜 답으로 확인한다. API는 부르지 않는다.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDecisionRequest, assemble, deductStep, GATE, CUSTOM_DEDUCT_RULES } = require('../supabase/functions/batch-assist/decide.mjs');

const NOW = Date.parse('2026-11-09T05:00:00.000Z');
const INPUT = text => ({ text, lots: ['PA260401', 'PA260401A'], zones: [['stage5', '공정5실']] });
const choice = (c, confidence = 0.9) => ({ type: 'choice', choice: c, confidence });
const noul = (p, confidence = 0.9) => ({ type: 'noul', noul: p, confidence });
const run = (text, answers) => {
  const input = INPUT(text);
  const { ex, body } = buildDecisionRequest(input, NOW);
  return { out: assemble(ex, answers, input), q: body.questions };
};
const brief = cs => cs.map(c => [c.op, c.lot, c.step ?? null, c.qty ?? ('at' in c ? c.at : c.zone ?? c.text)]);

test('차감 공정: 회사 규칙(비어 있음) → 줄의 공정 이름 → 보고 공정 → 지금 공정', () => {
  assert.equal(deductStep('공정5 중 용기 파손 3개', null), 'E');
  assert.equal(deductStep('무게 샘플 사용', 'C'), 'C');
  assert.equal(deductStep('무게 샘플 사용', null), null);
  CUSTOM_DEDUCT_RULES.push([/시험용\s*샘플/, 'D']);
  try {
    assert.equal(deductStep('시험용 샘플 5개', 'C'), 'D');
  } finally {
    CUSTOM_DEDUCT_RULES.length = 0;
  }
});

test('조립: 공정5 완료 + 공정 중 차감 → deduct E와 end E (질문은 숫자 줄마다)', () => {
  const { out, q } = run('PA260401 11/08\n공정5 중 자재 열림 4개\n공정5 완료했습니다.', {
    kind: choice('end'), finished: noul(0.95), step: choice('E'), role_1_0: choice('deduct')
  });
  assert.deepEqual(Object.keys(q).sort(), ['finished', 'kind', 'role_1_0', 'started', 'step']);
  assert.deepEqual(brief(out.changes), [['deduct', 'PA260401', 'E', 4], ['end', 'PA260401', 'E', '2026-11-08']]);
});

test('조립: 확신이 문턱보다 낮은 답으로는 바꾸지 않고 그 줄을 notes로', () => {
  const { out } = run('PA260401\n샘플 5개', { kind: choice('other'), step: choice('none'), role_1_0: choice('deduct', GATE - 0.01) });
  assert.deepEqual(out.changes, []);
  assert.deepEqual(out.unsure, ['샘플 5개']);
  assert.match(out.notes, /샘플 5개/);
});

test('조립: 공정 보고가 아니면(none) 아무것도 바꾸지 않는다', () => {
  const { out } = run('PA260401 배치 삭제해', { kind: choice('none'), step: choice('none') });
  assert.deepEqual(out.changes, []);
});

test('조립: "보고 아님"은 0.8 이상일 때만 통째로 버리고, 애매하면 다음으로 높은 보고 종류를 쓴다', () => {
  const kind = c => ({ choice: 'none', confidence: c, probabilities: { none: c, start: 1 - c - 0.05, end: 0.05 } });
  const weak = run('모레 PA260401 공정4', { kind: kind(0.52), started: noul(0.9), step: choice('D') });
  assert.deepEqual(brief(weak.out.changes), [['start', 'PA260401', 'D', '2026-11-11']]);
  const strong = run('PA260401 배치 삭제해', { kind: kind(0.95), step: choice('none') });
  assert.deepEqual(strong.out.changes, []);
});

test('조립: 목록에 없는 로트 줄은 묻지도 바꾸지도 않는다', () => {
  const { out, q } = run('새 배치 PA-404 공정3 차감 1', { kind: choice('other'), step: choice('C') });
  assert.deepEqual(Object.keys(q).sort(), ['finished', 'kind', 'started', 'step']);
  assert.deepEqual(out.changes, []);
  assert.match(out.notes, /PA-404/);
});

test('질문: 로트 옆 수량 줄은 한 번에 묻고, 한 줄에 숫자가 둘이면 숫자마다 따로 묻는다', () => {
  const { q } = run('PA260401 : 1,000개\nPA260401A : 980개', { kind: choice('step2_done') });
  assert.deepEqual(Object.keys(q).sort(), ['finished', 'kind', 'lot_op_0', 'lot_op_1', 'lot_qty', 'started', 'step']); // 로트가 둘이라 로트별 시작·완료도 묻는다
  const two = run('PA260401 적합수량 950개 외관 불량 12개', {
    kind: choice('inspection'), step: choice('inspection'), role_0_0: choice('net'), role_0_1: choice('inspection_detail')
  });
  assert.deepEqual(Object.keys(two.q).sort(), ['finished', 'kind', 'role_0_0', 'role_0_1', 'started', 'step']);
  assert.deepEqual(brief(two.out.changes), [['net', 'PA260401', 'inspection', 950], ['memo', 'PA260401', 'inspection', 'PA260401 적합수량 950개 외관 불량 12개']]);
});

test('추출+질문: 쉼표로 나열한 수량은 항목마다 나눠 회사 규칙을 따로 적용한다', () => {
  CUSTOM_DEDUCT_RULES.push([/시험용/, 'C']);
  try {
    const { out } = run('PA260401 무게 샘플 2개, 시험용 샘플 5개', {
      kind: choice('other'), step: choice('none'), lot_qty: choice('deduct'), role_1_0: choice('deduct')
    });
    assert.deepEqual(brief(out.changes), [['deduct', 'PA260401', null, 2], ['deduct', 'PA260401', 'C', 5]]);
  } finally {
    CUSTOM_DEDUCT_RULES.length = 0;
  }
});

test('조립: 로트가 여럿이면 로트별 시작·완료 답을 따른다', () => {
  const { out } = run('PA260401 공정5 완료했고 PA260401A는 공정5 시작', {
    kind: choice('start', 0.5), started: noul(0.98), finished: noul(0.98), step: choice('E'), lot_op_0: choice('end'), lot_op_1: choice('start')
  });
  assert.deepEqual(brief(out.changes), [['end', 'PA260401', 'E', null], ['start', 'PA260401A', 'E', null]]);
});

test('조립: 시작·완료는 예/아니요로도 묻고(종류가 애매한 기타일 때만 0.7 이상으로 더함), 로트가 적힌 줄의 시각은 그 로트에만', () => {
  const { out } = run('PA260401 공정5 시작 13:10\nPA260401A 공정5 시작 13:40', {
    kind: choice('start'), started: noul(0.95), finished: noul(0.05), step: choice('E'), time_0_0: noul(0.9), time_1_0: noul(0.9)
  });
  assert.deepEqual(brief(out.changes), [['start', 'PA260401', 'E', '2026-11-09T13:10'], ['start', 'PA260401A', 'E', '2026-11-09T13:40']]);
  const mixed = run('PA260401 공정4 완료 실수량 900 파손 3개', {
    kind: choice('other', 0.45), finished: noul(0.9), step: choice('D'), role_0_0: choice('net'), role_0_1: choice('deduct')
  });
  assert.deepEqual(brief(mixed.out.changes), [['net', 'PA260401', 'D', 900], ['deduct', 'PA260401', 'D', 3], ['end', 'PA260401', 'D', null]]); // 날짜 없는 보고: 일정은 바꾸지 않는다
  const during = run('PA260401 공정5 중 깨짐 2개', { kind: choice('other', 0.96), started: noul(0.95), step: choice('E'), lot_qty: choice('deduct') });
  assert.deepEqual(brief(during.out.changes), [['deduct', 'PA260401', 'E', 2]]); // 종류가 확실한 기타면 '중'을 시작으로 읽지 않는다
});

test('조립: 로트 이름 없는 보고는 목록에서 고르게 묻는다, 시각·구역 질문', () => {
  const { out, q } = run('공정5실로 옮겼고 14:30에 공정5 끝', {
    kind: choice('end'), finished: noul(0.9), step: choice('E'), lot: choice('o1'), time_0_0: noul(0.9), zone_0_0: noul(0.8)
  });
  assert.ok(q.lot && q.lot.criteria.o1 === 'PA260401A');
  assert.deepEqual(brief(out.changes), [['zone', 'PA260401A', null, 'stage5'], ['end', 'PA260401A', 'E', '2026-11-09T14:30']]);
});
