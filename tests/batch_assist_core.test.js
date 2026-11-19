const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Core = require('../js/ai_input/core.js');
const shared = require('../supabase/functions/batch-assist/rules.mjs');

const FIX = path.join(__dirname, 'fixtures', 'batch_assist');
const NOW = new Date('2026-11-09T05:00:00.000Z'); // 한국 시각 11/09 14:00
const ZONES = { 'stage3': { name: '공정3실' }, stage5: { name: '공정5실', maxCapacity: 1 }, stage4: { name: '공정4실' } };
const batches = () => JSON.parse(fs.readFileSync(path.join(FIX, 'batches.json'), 'utf8'));
const planFor = (changes, list = batches()) => Core.plan(changes, { batches: list, zones: ZONES, now: NOW, zoneOf: b => b.manualZone || b.assignedZone });
const line = (p, id) => p.groups.flatMap(g => g.lines).find(l => l.id === id);
const allOn = p => new Set(p.groups.flatMap(g => g.lines).filter(l => l.on).map(l => l.id));
const C = (op, lot, extra) => ({ op, lot, quote: `${op} 보고`, ...extra });

test('어휘: 화면 OPS와 서버 OPS가 같고, 삭제·생성·이름 변경 op가 없다', () => {
  assert.deepEqual(Core.OPS, Object.keys(shared.OPS));
  for (const op of Core.OPS) assert.ok(!/del|remov|creat|rename|lot/i.test(op), op);
});

for (const file of fs.readdirSync(FIX).filter(f => f.endsWith('.json') && f !== 'batches.json')) {
  test(`보고 예시 ${file}: 미리보기 줄과 적용 결과`, () => {
    const fx = JSON.parse(fs.readFileSync(path.join(FIX, file), 'utf8'));
    const list = batches();
    const p = planFor(fx.changes, list);
    const lines = p.groups.flatMap(g => g.lines).map(({ id, label, before, after, on }) => ({ id, label, before, after, on }));
    assert.deepEqual(lines, fx.expectedLines);
    assert.equal(p.skipped.length, fx.expectedSkipped);
    const out = Core.apply(list, p, allOn(p), NOW);
    if (!fx.expectedLines.length) return assert.equal(out.reason, 'nothing');
    assert.equal(out.ok, true);
    assert.deepEqual(out.list.map(b => b.lotNumber), list.map(b => b.lotNumber));
  });
}

test('묶기: 로트는 처음 나온 순서, 로트 없음·목록 밖 로트·모르는 op·모르는 구역은 건너뛴다', () => {
  const p = planFor([
    C('step2_qty', 'PA-2', { qty: 600 }), C('loss', 'PA-1', { step: 'B', qty: 12 }), C('step2_qty', 'PA-2', { qty: 610 }),
    C('end', null, { step: 'C', at: null }), C('create_batch', 'PA-9'), C('loss', 'PA-404', { step: 'C', qty: 1 }), C('zone', 'PA-1', { zone: 'mars' })
  ]);
  assert.deepEqual(p.groups.map(g => g.lot), ['PA-2', 'PA-1']);
  assert.equal(line(p, 'PA-2|step2_qty|').value.qty, 610);
  assert.match(line(p, 'PA-2|step2_qty|').warn, /마지막 값/);
  assert.deepEqual(p.skipped.map(s => s.why.slice(0, 6)), ['어느 로트인', '지원하지 않', '목록에 없는', '모르는 구역']);
  assert.match(p.skipped[2].why, /배치 등록 화면/);
});

test('시각: 시각 없는 시작·완료 보고는 시각을 바꾸지 않고(지금 시각을 넣지 않는다), 날짜만이면 기존 시각 또는 09:00', () => {
  const p = planFor([C('end', 'PA-1', { step: 'D', at: null }), C('start', 'PA-1', { step: 'C', at: null }), C('start', 'PA-3', { step: 'packaging', at: '2026-11-12' })]);
  assert.equal(line(p, 'PA-1|end|D'), undefined);
  assert.equal(line(p, 'PA-1|start|C'), undefined);
  assert.equal(p.skipped.length, 2);
  assert.match(p.skipped[0].why, /시각이 없어/);
  assert.equal(line(p, 'PA-3|start|packaging').after, '11/12 09:00 ~ -');
});

test('시각: 예정 공정의 시작만 옮기면 끝도 밀고, 끝난 공정이면 끝은 그대로, 시작이 끝보다 늦으면 오류', () => {
  const p = planFor([C('start', 'PA-1', { step: 'packaging', at: '2026-11-10T11:00' }), C('start', 'PA-1', { step: 'C', at: '2026-11-08T14:00' })]);
  assert.equal(line(p, 'PA-1|start|packaging').after, '11/10 11:00 ~ 11/10 14:00');
  assert.equal(line(p, 'PA-1|start|C').after, '11/08 14:00 ~ 11/09 13:00');
  const bad = planFor([C('start', 'PA-1', { step: 'C', at: '2026-11-09T15:00' })]);
  assert.match(line(bad, 'PA-1|start|C').error, /종료가 시작보다/);
  assert.equal(line(bad, 'PA-1|start|C').on, false);
});

test('차감: 공정 중 + 공정 후를 더해 그 공정 값으로 넣고, 다른 공정 차감은 그대로 둔다', () => {
  const list = batches();
  const p = planFor([C('loss', 'PA-1', { step: 'D', qty: 3 }), C('loss', 'PA-1', { step: 'D', qty: 2 })], list);
  const out = Core.apply(list, p, allOn(p), NOW);
  assert.deepEqual(out.list[0].quantities.losses, { B: 10, C: 5, D: 5, E: null, inspection: null, packaging: null });
});

test('인계 실수량: 공정2 수량이 없으면 오류, 차감과 안 맞으면 둘 다 경고하고 실수량은 기본 꺼짐', () => {
  assert.match(line(planFor([C('net', 'PA-3', { step: 'C', qty: 10 })]), 'PA-3|net|C').error, /공정2 수량이 없어/);
  assert.match(line(planFor([C('net', 'PA-2', { step: 'C', qty: 999 })]), 'PA-2|net|C').error, /앞 공정 수량보다/);
  const p = planFor([C('loss', 'PA-2', { step: 'C', qty: 3 }), C('net', 'PA-2', { step: 'C', qty: 480 })]);
  assert.match(line(p, 'PA-2|loss|C').warn, /맞지 않아요/);
  assert.equal(line(p, 'PA-2|loss|C').on, true);
  assert.equal(line(p, 'PA-2|net|C').on, false);
});

test('비고: 저장된 글을 한 번 풀고 붙여 한 번만 escape, 같은 메모는 기본 꺼짐, 200자 넘으면 오류', () => {
  const list = batches();
  list[0].remarks.C = 'A&amp;B &lt;1&gt;';
  const p = planFor([C('memo', 'PA-1', { step: 'C', text: '파손 <2>' })], list);
  const out = Core.apply(list, p, allOn(p), NOW);
  assert.equal(out.list[0].remarks.C, 'A&amp;B &lt;1&gt; &#x2F; 파손 &lt;2&gt;');
  assert.equal(line(planFor([C('memo', 'PA-1', { step: 'C', text: '1호기' })]), 'PA-1|memo|C').on, false);
  assert.match(line(planFor([C('memo', 'PA-1', { step: 'C', text: '가'.repeat(199) })]), 'PA-1|memo|C').error, /200자/);
});

test('위치: 가득 찬 구역은 오류', () => {
  global.window = { ALLOWED_ZONES: ZONES };
  try {
    const p = planFor([C('zone', 'PA-1', { zone: 'stage5' }), C('zone', 'PA-2', { zone: 'stage3' })]);
    assert.match(line(p, 'PA-1|zone|').error, /가득 찼어요/);
    assert.equal(line(p, 'PA-2|zone|').after, '공정3실');
  } finally {
    delete global.window;
  }
});

test('적용 결과: 체크 없음 nothing, 미리보기 뒤 바뀐 배치·사라진 로트 conflict, 같은 로트 두 개 invalid', () => {
  const list = batches();
  const p = planFor([C('step2_qty', 'PA-2', { qty: 700 })], list);
  assert.equal(Core.apply(list, p, new Set(), NOW).reason, 'nothing');
  const changed = batches();
  changed[1].quantities.B = 501;
  assert.equal(Core.apply(changed, p, allOn(p), NOW).reason, 'conflict');
  assert.equal(Core.apply(batches().filter(b => b.lotNumber !== 'PA-2'), p, allOn(p), NOW).reason, 'conflict');
  const dup = [...batches(), batches()[1]];
  assert.equal(Core.apply(dup, p, allOn(p), NOW).reason, 'invalid');
  const ok = Core.apply(list, p, allOn(p), NOW);
  assert.equal(ok.audit[0].zone, 'AI 입력');
  assert.ok(ok.audit[0].detail.length <= 80);
});

test('같은 보고를 두 번 적용해도 바뀌는 것이 없다', () => {
  for (const file of ['stage3_done.json', 'packaging_tomorrow.json']) {
    const { changes } = JSON.parse(fs.readFileSync(path.join(FIX, file), 'utf8'));
    const first = planFor(changes);
    const applied = Core.apply(batches(), first, allOn(first), NOW).list;
    const again = planFor(changes, applied);
    assert.equal(allOn(again).size, 0, file);
    assert.equal(Core.apply(applied, again, allOn(again), NOW).reason, 'nothing');
  }
});

test('마지막 관문: 짧아진 목록, 빠진 로트, 비거나 저장 때 지워질 로트는 throw', () => {
  const list = batches();
  assert.throws(() => Core.assertNoBatchLost(list, list.slice(1)));
  assert.throws(() => Core.assertNoBatchLost(list, [list[0], list[2], list[1]]));
  assert.throws(() => Core.assertNoBatchLost(list, [list[0], list[1], { ...list[2], lotNumber: '  ' }]));
  assert.throws(() => Core.assertNoBatchLost([{ lotNumber: '★★' }], [{ lotNumber: '★★' }]));
  assert.doesNotThrow(() => Core.assertNoBatchLost(list, list.map(b => ({ ...b }))));
});

test('삭제 불가 속성 검사: 무작위 보고·체크 조합에서 목록 길이·로트 순서가 그대로, 손대지 않은 배치는 똑같다', () => {
  let seed = 20261109, saved = 0;
  const rnd = n => { // mulberry32
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296 * n) | 0;
  };
  const pick = arr => arr[rnd(arr.length)];
  const base = batches();
  const big = Array.from({ length: 50 }, (_, i) => ({ ...JSON.parse(JSON.stringify(base[i % 3])), lotNumber: `P-${i}` }));
  const ops = ['end', 'start', 'loss', 'net', 'step2_qty', 'zone', 'memo', 'delete', 'create_batch', 'rename'];
  const steps = ['A', 'B', 'C', 'D', 'E', 'inspection', 'packaging'];
  for (let run = 0; run < 300; run++) {
    const list = run % 2 ? big : batches();
    const lots = [...list.map(b => b.lotNumber), 'GHOST', null];
    const changes = Array.from({ length: 1 + rnd(8) }, () => C(pick(ops), pick(lots), {
      step: pick(steps), qty: rnd(600), zone: pick(Object.keys(ZONES)), text: `메모${rnd(5)}`,
      at: pick([null, '2026-11-08', '2026-11-09T10:15', '2026-11-10T08:00']), lotNumber: 'HACK'
    }));
    const snapshot = JSON.parse(JSON.stringify(list));
    const p = planFor(changes, list);
    const ids = p.groups.flatMap(g => g.lines.map(l => l.id)).filter(() => rnd(2));
    const out = Core.apply(list, p, new Set(ids), NOW);
    assert.deepEqual(list, snapshot, '읽은 목록은 바뀌지 않는다');
    if (!out.ok) continue;
    saved++;
    assert.equal(out.list.length, list.length);
    assert.deepEqual(out.list.map(b => b.lotNumber), list.map(b => b.lotNumber));
    const touched = new Set(out.audit.map(a => a.item));
    out.list.forEach((b, i) => { if (!touched.has(b.lotNumber)) assert.equal(b, list[i]); });
  }
  assert.ok(saved > 100, `저장까지 간 경우가 너무 적어 검사가 비어 있음: ${saved}`);
});

test('추가 차감: 공정이 없으면 지금 있는 구역의 공정에서 빼고, 기존 차감에 더하고, 근거를 비고에 남긴다', () => {
  const quote = 'PA-1 시험용 샘플 21개';
  const list = batches();
  const p = planFor([{ op: 'deduct', lot: 'PA-1', step: null, qty: 21, quote }], list);
  const l = line(p, 'PA-1|deduct|C'); // PA-1은 공정3 진행 구역 → 공정3(C)에서 뺀다
  assert.equal(l.label, '공정3 추가 차감');
  assert.equal(l.before, '차감 5 · 남은 985');
  assert.equal(l.after, '차감 26 · 남은 964');
  const out = Core.apply(list, p, allOn(p), NOW);
  const b = out.list.find(x => x.lotNumber === 'PA-1');
  assert.equal(b.quantities.losses.C, 26);
  assert.equal(b.quantities.losses.B, 10);
  assert.ok(b.remarks.C.includes('시험용 샘플 21개'));
  const again = planFor([{ op: 'deduct', lot: 'PA-1', step: null, qty: 21, quote }], out.list);
  assert.equal(line(again, 'PA-1|deduct|C').on, false, '같은 보고를 다시 넣으면 기본 꺼짐');
});

test('추가 차감: 구역별 공정 — 진행 구역은 그 공정, 대기·보관 구역은 방금 끝난 공정, 공정1 단계는 알 수 없음', () => {
  const want = { stage2: 'B', 'stage3-wait': 'B', 'stage3-2': 'C', 'stage4-wait': 'C', 'stage4-1': 'D', 'stage5-wait': 'D',
    stage5: 'E', 'semi-storage-pre': 'E', inspection: 'inspection', 'semi-storage-post': 'inspection', 'packaging-wait': 'inspection',
    packaging: 'packaging', logistics: 'packaging', 'stage1-1': null, '': null };
  for (const [zone, step] of Object.entries(want)) assert.equal(Core.lossStepOfZone(zone), step, zone);
  const p = Core.plan([{ op: 'deduct', lot: 'PA-1', step: null, qty: 3, quote: 'q' }], { batches: batches(), zones: ZONES, now: NOW, zoneOf: () => 'stage1-1' });
  assert.equal(p.groups.length, 0);
  assert.match(p.skipped[0].why, /어느 공정/);
});

test('보고된 차감(바꿈)과 추가 차감(더함)이 같은 공정에 같이 오면 바꾼 뒤 더한다', () => {
  const list = batches();
  const p = planFor([{ op: 'deduct', lot: 'PA-1', step: 'C', qty: 2, quote: '샘플 2개' }, { op: 'loss', lot: 'PA-1', step: 'C', qty: 7, quote: '깨짐 7개' }], list);
  const out = Core.apply(list, p, allOn(p), NOW);
  assert.equal(out.list.find(x => x.lotNumber === 'PA-1').quantities.losses.C, 9);
});

test('한 번에 배치 4개까지만: 서버와 같은 숫자이고, 5개를 적용하려 하면 저장하지 않는다', () => {
  assert.equal(Core.MAX_LOTS, shared.LIMITS.maxLots);
  assert.equal(Core.MAX_LOTS, 4);
  const base = batches()[0];
  const list = ['L1', 'L2', 'L3', 'L4', 'L5'].map(lotNumber => ({ ...JSON.parse(JSON.stringify(base)), lotNumber }));
  const mk = n => list.slice(0, n).map(b => ({ op: 'deduct', lot: b.lotNumber, step: 'C', qty: 1, quote: '샘플 1ea ' + b.lotNumber }));
  const p5 = planFor(mk(5), list);
  const out5 = Core.apply(list, p5, allOn(p5), NOW);
  assert.equal(out5.ok, false);
  assert.match(out5.message, /4개까지/);
  const p4 = planFor(mk(4), list);
  assert.equal(Core.apply(list, p4, allOn(p4), NOW).ok, true);
});

test('시각: 날짜만 적힌 완료 보고는 오늘이어도 지금 시각을 쓰지 않고 그 날짜의 기존 시각을 쓴다', () => {
  const p = planFor([C('end', 'PA-1', { step: 'D', at: '2026-11-09' }), C('end', 'PA-1', { step: 'B', at: '2026-11-07' })]);
  const d = line(p, 'PA-1|end|D'); // 기존 종료 11/09 15:00 → 그대로라 꺼짐
  assert.equal(d.value.at.toISOString(), '2026-11-09T06:00:00.000Z');
  assert.equal(d.on, false);
  assert.equal(line(p, 'PA-1|end|B').value.at.toISOString(), '2026-11-07T04:00:00.000Z');
});

test('검사 세부 줄은 비고에 "부적합 -N개" 한 줄로 합치고, 원문은 근거로 남긴다', () => {
  const texts = ['불량 : 9개', '자재 불량 : 18개', '찍힘 : 3개', '외관 : 0개', '용량 : 1,002개'];
  const p = planFor(texts.map(t => ({ op: 'memo', lot: 'PA-1', step: 'inspection', text: t, quote: t })));
  const l = line(p, 'PA-1|memo|inspection');
  assert.equal(l.value.text, '부적합 -1032개');
  assert.deepEqual(l.quotes, texts);
});
