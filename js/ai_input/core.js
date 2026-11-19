// AI 입력 계산 (순수 UMD, node 테스트 대상). 화면·네트워크 없음.
// plan: 서버가 준 변경 사실(Change[])을 로트별 체크리스트로 접는다. apply: 방금 서버에서 읽은 전체 목록에 체크된 줄만 적용한다.
// 배치 한 건의 편집은 전부 BatchCore.applyBatchEdit/validateEdit (src/batch/core.ts)에 맡긴다 (모바일 수정 시트와 같은 규칙).
// 새 목록은 latest.map으로만 만든다: 목록 길이와 로트 순서는 바뀌지 않는다 (배치 삭제 불가).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../../src/batch/core.ts'));
  // BatchCore는 모듈이라 이 파일보다 늦게 생긴다: 쓸 때 찾는다
  else root.BatchAssistCore = factory(new Proxy({}, { get: (_, k) => root.BatchCore[k] }));
}(typeof self !== 'undefined' ? self : this, function (EditCore) {
  'use strict';

  /** 서버 supabase/functions/batch-assist/rules.mjs OPS 키와 같아야 한다 (테스트가 강제). 여기 없는 op는 건너뛴다. */
  const OPS = ['end', 'start', 'loss', 'deduct', 'net', 'step2_qty', 'zone', 'memo'];
  const MAX_LOTS = 4; // 한 번에 바꿀 수 있는 배치 수 (서버 rules.mjs LIMITS.maxLots와 같아야 함)
  const LOSS_ORDER = ['B', 'C', 'D', 'E', 'inspection', 'packaging'];
  const NET_KEY = { B: 'BNet', C: 'C', D: 'D', E: 'E', inspection: 'inspection', packaging: 'packaging' };
  const PREV_KEY = { B: 'B', C: 'BNet', D: 'C', E: 'D', inspection: 'E', packaging: 'inspection' };
  const STEP_LABELS = { A: '공정1', B: '공정2', C: '공정3', D: '공정4', E: '공정5', inspection: '검사', packaging: '포장' };
  const OP_LABELS = { end: '종료', start: '시작', loss: '차감', deduct: '추가 차감', net: '인계 실수량', step2_qty: '공정2 수량', zone: '위치', memo: '비고' };
  // 공정이 적히지 않은 차감("샘플 5개 빼")을 넣을 칸: 진행 구역은 그 공정, 대기·보관 구역은 방금 끝난 공정 (평면도가 보여 주는 수량과 같은 기준)
  const ZONE_LOSS_STEP = [[/^stage2/, 'B'], [/^stage3-wait/, 'B'], [/^stage3/, 'C'], [/^stage4-wait/, 'C'], [/^stage4/, 'D'],
    [/^stage5-wait/, 'D'], [/^stage5/, 'E'], [/^semi-(storage-pre|discharge)/, 'E'], [/^inspection/, 'inspection'], [/^semi-storage-post/, 'inspection'],
    [/^packaging-wait/, 'inspection'], [/^(packaging|logistics)/, 'packaging']];
  const lossStepOfZone = zoneId => (ZONE_LOSS_STEP.find(([re]) => re.test(String(zoneId || ''))) || [])[1] || null;
  const KST_MS = 9 * 3600000;
  const DEFAULT_HM = [9, 0]; // 날짜만 있고 기존 시각도 없을 때 (근무 시작)
  const FUTURE_SLACK_MS = 10 * 60000;
  const LOT_CHAR = /[a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ_\-\.\s\(\)\/\#]/; // saveBatchesToServer가 지우지 않는 글자

  /**
   * @typedef {{ op: string, lot: string | null, step?: string, at?: string | null, qty?: number, zone?: string, text?: string, quote: string }} Change
   * 한 줄 = 체크박스 하나 = (lot, op, step) 하나. 같은 칸의 사실은 한 줄로 접힌다 (차감은 합, 메모는 이음, 나머지는 마지막 값).
   * @typedef {{ id: string, lot: string, op: string, step: string | null, value: { at?: Date, qty?: number, zone?: string, text?: string },
   *   label: string, before: string, after: string, quotes: string[], warn: string | null, error: string | null, on: boolean }} Line
   * @typedef {{ lot: string, snapshot: object, lines: Line[] }} LotGroup  snapshot = 계획 때 본 배치 (충돌 판정 기준)
   * @typedef {{ groups: LotGroup[], skipped: Array<{ quote: string, why: string }> }} Plan
   */

  const pad2 = n => String(n).padStart(2, '0');
  const toDate = v => { if (!v) return null; const d = v instanceof Date ? v : new Date(v); return isNaN(d.getTime()) ? null : d; };
  const kstParts = d => { const k = new Date(d.getTime() + KST_MS); return [k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate(), k.getUTCHours(), k.getUTCMinutes()]; };
  const fromKst = (y, mo, d, h, mi) => new Date(Date.UTC(y, mo, d, h, mi) - KST_MS);
  const fmtKst = d => { if (!d) return '-'; const p = kstParts(d); return `${pad2(p[1] + 1)}/${pad2(p[2])} ${pad2(p[3])}:${pad2(p[4])}`; };
  const stepOf = (b, step) => (b.schedule || {})[step] || {};
  const stepTime = (b, step, key) => toDate(stepOf(b, step)[key + 'Date'] || stepOf(b, step)[key]);
  const lotOf = b => (b && typeof b === 'object' ? String(b.lotNumber || '').trim() : '');

  /** sanitizeInput의 역. 저장된 비고는 이미 escape되어 있어 풀고 합쳐야 applyRemarksEdit가 한 번만 escape한다. */
  function unescapeRemark(s) {
    return String(s || '').replace(/&#x2F;/g, '/').replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
      .replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
  }

  function quantitiesOf(b) {
    const q = b.quantities || {};
    return EditCore.calcQuantities(q.B ?? b.qtyB, q.losses || b.lossQuantities || {}).quantities;
  }

  /**
   * 줄(의도) → BatchCore edit. 기존 값과 합친 뒤 넘긴다:
   * applyQuantitiesEdit는 losses 객체를 통째로 바꾸고, buildSchedule은 times[k]가 있으면 start/end 둘 다 그 값으로 쓴다.
   * lotNumber는 절대 넣지 않는다 (로트 이름 변경 = 키 삭제 + 생성).
   */
  function toEdit(batch, lines, now) {
    const edit = {};
    const of = op => lines.filter(l => l.op === op);
    const step2_qty = of('step2_qty').pop();
    if (step2_qty) edit.qtyB = step2_qty.value.qty;

    const qtyLines = lines.filter(l => l.op === 'loss' || l.op === 'net' || l.op === 'deduct');
    if (qtyLines.length) {
      const B = step2_qty ? step2_qty.value.qty : (batch.quantities || {}).B ?? batch.qtyB;
      const losses = { ...((batch.quantities && batch.quantities.losses) || batch.lossQuantities || {}) };
      // 한 공정 안에서는 보고된 차감(바꿈) → 인계 실수량 → 추가 차감(더함) 순서
      const rank = { loss: 0, net: 1, deduct: 2 };
      LOSS_ORDER.forEach(step => qtyLines.filter(l => l.step === step).sort((a, b) => rank[a.op] - rank[b.op]).forEach(l => {
        if (l.op === 'loss') { losses[step] = l.value.qty; return; }
        if (l.op === 'deduct') { losses[step] = (Number(losses[step]) || 0) + l.value.qty; return; }
        const prev = EditCore.calcQuantities(B, losses).quantities[PREV_KEY[step]];
        losses[step] = prev == null ? null : prev - l.value.qty;
      }));
      edit.losses = losses;
    }

    const timeLines = lines.filter(l => l.op === 'start' || l.op === 'end');
    if (timeLines.length) {
      edit.times = {};
      new Set(timeLines.map(l => l.step)).forEach(step => {
        const oldStart = stepTime(batch, step, 'start'), oldEnd = stepTime(batch, step, 'end');
        const st = timeLines.find(l => l.step === step && l.op === 'start');
        const en = timeLines.find(l => l.step === step && l.op === 'end');
        const start = st ? st.value.at : oldStart;
        let end = en ? en.value.at : oldEnd;
        // 예정(아직 안 끝난) 공정의 시작만 옮기면 끝도 같은 만큼 민다. 끝난 공정의 시작 정정이면 끝은 그대로
        if (st && !en && oldStart && oldEnd && oldEnd > now) end = new Date(oldEnd.getTime() + (start - oldStart));
        edit.times[step] = { start, end };
      });
    }

    // 추가 차감은 근거 원문을 비고에 함께 남긴다 (왜 뺐는지 기록 + 같은 보고를 두 번 넣었는지 알아보는 표시)
    const memos = [...of('memo'), ...of('deduct').filter(l => l.quotes.length)];
    if (memos.length) {
      edit.remarks = {};
      memos.forEach(l => {
        const old = edit.remarks[l.step] ?? unescapeRemark((batch.remarks || {})[l.step]);
        const text = l.op === 'memo' ? l.value.text : l.quotes.join(' / ');
        edit.remarks[l.step] = old ? (old.includes(text) ? old : `${old} / ${text}`) : text;
      });
    }

    const zone = of('zone').pop();
    if (zone) edit.zoneId = zone.value.zone;
    return edit;
  }

  function describe(b, line, zones) {
    const q = () => quantitiesOf(b);
    switch (line.op) {
      case 'end': return fmtKst(stepTime(b, line.step, 'end'));
      case 'start': return `${fmtKst(stepTime(b, line.step, 'start'))} ~ ${fmtKst(stepTime(b, line.step, 'end'))}`;
      case 'loss': case 'net': case 'deduct': { const v = q(); return `차감 ${v.losses[line.step] ?? 0} · 남은 ${v[NET_KEY[line.step]] ?? '-'}`; }
      case 'step2_qty': return String(q().B ?? '-');
      case 'zone': { const id = b.manualZone || b.assignedZone; return (zones[id] && zones[id].name) || id || '-'; }
      default: return unescapeRemark((b.remarks || {})[line.step]) || '-';
    }
  }

  function skipReason(c, ctx) {
    if (!c || !OPS.includes(c.op)) return '지원하지 않는 변경이에요';
    if (c.lot == null) return '어느 로트인지 찾지 못했어요';
    if (!ctx.batches.some(b => b && b.lotNumber === c.lot)) return `목록에 없는 로트예요 (${c.lot}). 새 배치는 배치 등록 화면에서 만들어 주세요`;
    if (c.op === 'zone' && !(ctx.zones || {})[c.zone]) return '모르는 구역이에요';
    return null;
  }

  /** 같은 칸을 가리키는 사실들 → 해석이 끝난 한 줄 (값, 경고, 기본 꺼짐 이유). */
  function foldLine(id, cs, snapshot, now) {
    const last = cs[cs.length - 1], { op, lot } = last, step = last.step || null;
    const line = { id, lot, op, step, value: {}, quotes: cs.map(c => c.quote).filter(Boolean), warn: null, error: null, off: false };
    line.label = step ? `${STEP_LABELS[step]} ${OP_LABELS[op]}` : OP_LABELS[op];
    const field = { end: 'at', start: 'at', loss: 'qty', deduct: 'qty', net: 'qty', step2_qty: 'qty', zone: 'zone', memo: 'text' }[op];
    if (op === 'loss' || op === 'deduct') {
      line.value.qty = cs.reduce((s, c) => s + c.qty, 0);
      if (cs.length > 1) line.label += ` (${cs.map(c => c.qty).join('+')})`;
    } else if (op === 'memo' && step === 'inspection') {
      // 검사 세부 줄("불량 : 2개", "외관 : 0개"…)은 비고가 길어지므로 개수만 더해 한 줄로. 원문은 근거(quotes)로 남는다
      const n = cs.reduce((s, c) => s + Number(((String(c.text).match(/\d[\d,]*/g) || ['0']).pop()).replace(/,/g, '')), 0);
      line.value.text = `부적합 -${n}개`;
    } else if (op === 'memo') {
      line.value.text = [...new Set(cs.map(c => c.text))].join(' / ');
    } else {
      if (new Set(cs.map(c => c[field])).size > 1) line.warn = '보고에 값이 여러 개라 마지막 값을 써요';
      line.value[field] = last[field];
    }
    if (field === 'at') resolveAt(line, last.at, stepTime(snapshot, step, op), now);
    if (op === 'memo' && unescapeRemark((snapshot.remarks || {})[step]).includes(line.value.text)) {
      line.warn = '이미 같은 메모가 있어요'; line.off = true;
    }
    if (op === 'deduct' && line.quotes.some(q => unescapeRemark((snapshot.remarks || {})[step]).includes(q))) {
      line.warn = '비고에 같은 내용이 있어요. 이미 뺀 것 같아요. 또 빼려면 체크하세요'; line.off = true;
    }
    return line;
  }

  // 날짜만 → 그 칸의 기존 시각(한국 시각) 또는 09:00. 보고에 시각이 없다고 '지금'을 넣지 않는다:
  // 이 기능을 쓰는 시각은 실제 공정 시각이 아니다 (시각 없는 보고는 plan에서 건너뛴다)
  function resolveAt(line, at, existing, now) {
    const [y, mo, d, h, mi] = at.split(/[-T:]/).map(Number);
    if (h !== undefined) line.value.at = fromKst(y, mo - 1, d, h, mi);
    else {
      const hm = existing ? kstParts(existing).slice(3) : DEFAULT_HM;
      line.value.at = fromKst(y, mo - 1, d, hm[0], hm[1]);
      line.warn = `날짜만 있어 시각은 ${pad2(hm[0])}:${pad2(hm[1])}로 넣어요`;
    }
    if (line.op === 'end' && line.value.at - now > FUTURE_SLACK_MS) line.warn = '아직 오지 않은 시각이에요';
  }

  function lineError(line, snapshot, edit, batches) {
    if (line.op === 'net') {
      const loss = edit.losses[line.step];
      if (loss == null) return '공정2 수량이 없어 실수량을 계산할 수 없어요';
      if (loss < 0) return '실수량이 앞 공정 수량보다 많아요';
    }
    return EditCore.validateEdit(edit, snapshot, batches)[0] || null;
  }

  /**
   * @param {Change[]} changes
   * @param {{ batches: object[], zones: Record<string, { name?: string }>, now: Date, zoneOf?: (batch: object) => string | null }} ctx
   *   zoneOf: 배치가 지금 있는 구역 id (공정이 적히지 않은 차감을 어느 공정에서 뺄지 정할 때 쓴다)
   * @returns {Plan}
   */
  function plan(changes, ctx) {
    const skipped = [], byLot = new Map();
    (changes || []).forEach(c => {
      let why = skipReason(c, ctx);
      if (!why && (c.op === 'end' || c.op === 'start') && c.at == null) why = '보고에 시각이 없어 시작·종료 시각은 바꾸지 않아요';
      if (!why && c.op === 'deduct' && !c.step) {
        const step = lossStepOfZone(ctx.zoneOf && ctx.zoneOf(ctx.batches.find(b => b && b.lotNumber === c.lot)));
        if (step) c = { ...c, step }; else why = '이 배치가 지금 어느 공정인지 알 수 없어요. 공정 이름을 같이 적어 주세요';
      }
      if (why) return skipped.push({ quote: (c && c.quote) || '', why });
      if (!byLot.has(c.lot)) byLot.set(c.lot, new Map());
      const facts = byLot.get(c.lot), id = `${c.lot}|${c.op}|${c.step || ''}`;
      if (!facts.has(id)) facts.set(id, []);
      facts.get(id).push(c);
    });

    const groups = [...byLot].map(([lot, facts]) => {
      const snapshot = ctx.batches.find(b => b && b.lotNumber === lot);
      const lines = [...facts].map(([id, cs]) => foldLine(id, cs, snapshot, ctx.now));
      lines.forEach(line => {
        const edit = toEdit(snapshot, [line], ctx.now);
        line.error = lineError(line, snapshot, edit, ctx.batches);
        line.before = describe(snapshot, line, ctx.zones || {});
        line.after = line.error ? line.before : describe(EditCore.applyBatchEdit(snapshot, edit, ctx.now), line, ctx.zones || {});
      });
      lines.filter(l => l.op === 'net').forEach(net => {
        const loss = lines.find(l => l.op === 'loss' && l.step === net.step);
        if (loss && !net.error && toEdit(snapshot, [net], ctx.now).losses[net.step] !== loss.value.qty) {
          loss.warn = net.warn = '차감과 인계 실수량이 서로 맞지 않아요. 맞는 쪽만 체크하세요';
          net.off = true;
        }
      });
      lines.forEach(l => { l.on = !l.error && !l.off && l.before !== l.after; delete l.off; });
      // 켜진 줄을 함께 적용한 결과로 '후'를 다시 그린다 (예: 앞 공정 차감이 바뀌면 남은 수량도 바뀜)
      const onLines = lines.filter(l => l.on);
      if (onLines.length > 1) {
        const after = EditCore.applyBatchEdit(snapshot, toEdit(snapshot, onLines, ctx.now), ctx.now);
        onLines.forEach(l => { l.after = describe(after, l, ctx.zones || {}); });
      }
      return { lot, snapshot, lines };
    });
    return { groups, skipped };
  }

  /**
   * 마지막 관문. 저장할 목록의 길이가 다르거나, 읽은 로트가 같은 자리에 없거나,
   * saveBatchesToServer가 지워 버릴 로트(빈 이름, 허용 글자 없음)가 있으면 throw.
   */
  function assertNoBatchLost(before, after) {
    if (!Array.isArray(before) || !Array.isArray(after) || after.length !== before.length) throw new Error('배치 수가 달라졌어요');
    before.forEach((b, i) => {
      const lot = lotOf(b);
      if (!lot) return;
      if (lotOf(after[i]) !== lot) throw new Error(`로트 ${lot}가 빠졌어요`);
      if (!LOT_CHAR.test(lot)) throw new Error(`로트 ${lot}는 저장할 때 지워질 수 있어요`);
    });
  }

  /**
   * 적용. latest는 저장 직전에 서버에서 다시 읽은 전체 목록이어야 한다 (오래된 로컬 캐시는 다른 사람이 만든 배치를 지운다).
   * @param {object[]} latest @param {Plan} plan @param {Set<string>} checked 체크된 Line.id @param {Date} now
   * @returns {{ ok: true, list: object[], audit: object[] } | { ok: false, reason: 'nothing' | 'conflict' | 'invalid' | 'lost', message: string }}
   */
  function apply(latest, plan, checked, now) {
    const updated = new Map(), audit = [];
    for (const g of plan.groups) {
      const lines = g.lines.filter(l => checked.has(l.id) && !l.error);
      if (!lines.length) continue;
      const same = latest.filter(b => b && b.lotNumber === g.lot);
      if (same.length > 1) return { ok: false, reason: 'invalid', message: `${g.lot}: 같은 로트가 두 개 있어요. 배치 화면에서 먼저 정리해 주세요` };
      if (!same.length || EditCore.hasConflict(g.snapshot, same[0])) {
        return { ok: false, reason: 'conflict', message: '다른 곳에서 먼저 수정했어요' };
      }
      const edit = toEdit(same[0], lines, now);
      const errs = EditCore.validateEdit(edit, same[0], latest);
      if (errs.length) return { ok: false, reason: 'invalid', message: `${g.lot}: ${errs[0]}` };
      updated.set(g.lot, EditCore.applyBatchEdit(same[0], edit, now));
      const quote = lines.flatMap(l => l.quotes)[0];
      const detail = lines.map(l => `${l.label} ${l.after}`).join(', ') + (quote ? ` · ${quote}` : '');
      audit.push({ zone: 'AI 입력', action: '배치 수정', item: g.lot, from: '-', to: '-', detail: detail.slice(0, 80) });
    }
    if (!updated.size) return { ok: false, reason: 'nothing', message: '적용할 줄이 없어요' };
    if (updated.size > MAX_LOTS) return { ok: false, reason: 'invalid', message: `한 번에 배치 ${MAX_LOTS}개까지만 바꿀 수 있어요. 나눠서 넣어 주세요` };
    const list = latest.map(b => (b && updated.get(b.lotNumber)) || b);
    try {
      assertNoBatchLost(latest, list);
    } catch (e) {
      return { ok: false, reason: 'lost', message: `저장하지 않았어요: ${e.message}` };
    }
    return { ok: true, list, audit };
  }

  return { OPS, MAX_LOTS, plan, apply, assertNoBatchLost, lossStepOfZone };
}));
