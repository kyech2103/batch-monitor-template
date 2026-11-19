const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/todo/rules.ts');

const base = { rule_id: 'X', kind: 'SIMPLE', enabled: false, title: 't', process_code: 'PREP', anchor_step: 'A', anchor_point: 'start', day_rule: 'SAME', time_mode: 'OFFSET', offset_minutes: -80, target_time: null, roles: ['b', 'a'], sort_order: 7 };

test('언제 문구', () => {
  assert.equal(R.ruleWhenText(base), '공정1 시작 1시간 20분 전');
  assert.equal(R.ruleWhenText({ ...base, offset_minutes: 0 }), '공정1 시작 시');
  assert.equal(R.ruleWhenText({ ...base, time_mode: 'FIXED', day_rule: 'PREV_BIZ', target_time: '09:00', anchor_point: 'end' }), '공정1 종료 직전 평일 09:00');
  assert.equal(R.ruleWhenText({ ...base, anchor_step: 'WEEK', target_time: '09:00' }), '매주 마지막 평일 09:00');
});

test('패널 값 ↔ 규칙: 그대로 돌아오고 사용 여부·정렬·공정 칩은 기존 값 유지', () => {
  const back = R.ruleFromForm(R.formFromRule(base), base);
  assert.equal(R.rulesKey([back]), R.rulesKey([base]));
  assert.equal(back.sort_order, 7);
  assert.equal(back.enabled, false);
});

test('매주 규칙은 마지막 평일·시각 고정·대청소, 포장 기준은 포장 칩', () => {
  const f = { ...R.formFromRule(base), anchor_step: 'WEEK', target_time: '10:00' };
  const w = R.ruleFromForm(f, base);
  assert.deepEqual([w.day_rule, w.time_mode, w.process_code, w.target_time, w.anchor_point], ['WEEK_LAST', 'FIXED', 'CLEAN', '10:00', 'start']);
  const p = R.ruleFromForm({ ...R.formFromRule(base), anchor_step: 'PKG', day_rule: 'PREV_WEEK_LAST' }, base);
  assert.deepEqual([p.process_code, p.time_mode, p.offset_minutes], ['PKG', 'FIXED', 0]);
});
