const test = require('node:test');
const assert = require('node:assert/strict');
const { assignees, groupByTask, groupByTime } = require('../src/mobile/todo.ts');

const row = (over) => ({ id: over.role_key, title: '공정2 수행', task_key: 'B-1|2026-11-05|10:00|PA260505', lot_id: 'PA260505', lot_ids: ['PA260505'], worker_name: '김작업', ...over });
const label = k => ({ fd: '공정3-1' }[k]);

test('같은 과업은 한 줄로 묶고, 내 할 일 보기는 역할을 칩 하나에 모은다', () => {
  const groups = groupByTask([row({ role_key: '공정4-2' }), row({ role_key: '공정5' })]);
  assert.equal(groups.length, 1);
  assert.deepEqual(assignees(groups[0], false, label), [{ name: '', labels: ['공정4-2', '공정5'] }]);
});

test('전체 보기에서는 작업자별로 역할을 나누고 역할 이름을 보인다', () => {
  const rows = [row({ role_key: 'fd' }), row({ role_key: 'b', worker_name: '박작업' })];
  assert.equal(groupByTask(rows).length, 1);
  assert.deepEqual(assignees(rows, true, label), [{ name: '김작업', labels: ['공정3-1'] }, { name: '박작업', labels: ['b'] }]);
});

test('task_key가 없으면 묶지 않는다', () => {
  assert.equal(groupByTask([row({ role_key: 'a', task_key: null }), row({ role_key: 'b', task_key: null })]).length, 2);
});

test('시각별 묶음은 HH:MM, 시각 없으면 미지정', () => {
  const m = groupByTime([row({ role_key: 'a', target_time: '09:00:00' }), row({ role_key: 'b', target_time: null })]);
  assert.deepEqual([...m.keys()], ['09:00', '미지정']);
});
