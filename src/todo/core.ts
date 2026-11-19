// 하루 할 일 계산: 역할, 기본 규칙, 연도 넘김 보정, 평일 계산, 규칙 검사, 할 일 생성 (옛 js/daily_todo_core.js).
// PC 할 일 창·모바일 할 일 탭·평면도 위치 계산이 같이 쓴다
// @ts-nocheck
// shortcut: 옛 JS를 그대로 옮겨 타입 검사를 끈다, 이 파일 로직을 고칠 때 타입을 붙인다
// ====================================================================
// 1. 역할 및 상수 정의
// ====================================================================
export const ROLE_MAP: Record<string, { label: string; title: string }> = {
  p1_a: { label: '공정1-1', title: '공정1 담당자 1' },
  p1_b: { label: '공정1-2', title: '공정1 담당자 2' },
  p2_a: { label: '공정2-A', title: '공정2-A 담당자' },
  p2_b: { label: '공정2-B', title: '공정2-B 담당자' },
  p2_c: { label: '공정2-C', title: '공정2-C 담당자' },
  p3_a: { label: '공정3-1', title: '공정3 담당자 1' },
  p3_b: { label: '공정3-2', title: '공정3 담당자 2' },
  p4_a: { label: '공정4-1', title: '공정4 담당자 1' },
  p4_b: { label: '공정4-2', title: '공정4 담당자 2' },
  stage5: { label: '공정5', title: '공정5 담당자' },
  pk_a: { label: '포장-A', title: '포장-A 담당자' },
  pk_b: { label: '포장-B', title: '포장-B 담당자' }
};

export const ALL_ROLES = [
  'p1_a', 'p1_b', 'p2_a', 'p2_b', 'p2_c',
  'p3_a', 'p3_b', 'p4_a', 'p4_b',
  'stage5', 'pk_a', 'pk_b'
];

export const ALL_EXCEPT_D = ALL_ROLES.filter(r => r !== 'p4_a' && r !== 'p4_b');

export const POST_E_ZONES = [
  'semi-storage-pre', 'semi-storage-post', 'semi-discharge',
  'inspection', 'packaging-wait', 'packaging', 'logistics'
];

export const PROCESS_ORDER = { PREP: 1, CLEAN: 1.5, A: 2, B: 3, C: 4, D: 5, E: 6, PKG: 7 };



// 기본 할 일 규칙: 구조를 보여 주는 예시다. 실제 규칙은 화면의 [⚙️ 규칙 관리]에서 회사 작업 순서에 맞게 만든다
export const DEFAULT_RULES = [
  {
    rule_id: 'PREP-MAT',
    kind: 'SIMPLE',
    enabled: true,
    title: '자재 수령 및 준비',
    process_code: 'PREP',
    anchor_step: 'A',
    anchor_point: 'start',
    day_rule: 'PREV_WEEK_LAST',
    time_mode: 'FIXED',
    target_time: '10:00',
    roles: [...ALL_ROLES],
    sort_order: 10
  },
  {
    rule_id: 'PREP-WASH',
    kind: 'SIMPLE',
    enabled: true,
    title: '사용 부품 세척 마무리',
    process_code: 'B',
    anchor_step: 'B',
    anchor_point: 'end',
    day_rule: 'NEXT_BIZ',
    time_mode: 'FIXED',
    target_time: '09:00',
    roles: ['p2_b', 'p2_c'],
    sort_order: 20
  },
  {
    rule_id: 'CLEANING',
    kind: 'SIMPLE',
    enabled: true,
    title: '주간 청소',
    process_code: 'CLEAN',
    anchor_step: 'WEEK',
    anchor_point: 'start',
    day_rule: 'WEEK_LAST',
    time_mode: 'FIXED',
    target_time: '15:00',
    roles: [...ALL_ROLES],
    sort_order: 30
  },
  {
    rule_id: 'A-1',
    kind: 'SIMPLE',
    enabled: true,
    title: '원료 계량',
    process_code: 'A',
    anchor_step: 'A',
    anchor_point: 'start',
    day_rule: 'SAME',
    time_mode: 'OFFSET',
    offset_minutes: 0,
    roles: ['p1_b'],
    sort_order: 100
  },
  {
    rule_id: 'A-2',
    kind: 'SIMPLE',
    enabled: true,
    title: '공정1 준비 점검',
    process_code: 'A',
    anchor_step: 'A',
    anchor_point: 'start',
    day_rule: 'SAME',
    time_mode: 'OFFSET',
    offset_minutes: 30,
    roles: ['p1_a', 'p1_b'],
    sort_order: 110
  },
  {
    rule_id: 'B-PREP',
    kind: 'SIMPLE',
    enabled: true,
    title: '공정2 설비 예약',
    process_code: 'B',
    anchor_step: 'B',
    anchor_point: 'start',
    day_rule: 'PREV_BIZ',
    time_mode: 'FIXED',
    target_time: '10:00',
    roles: ['p2_a'],
    sort_order: 190
  },
  {
    rule_id: 'B-1',
    kind: 'SIMPLE',
    enabled: true,
    title: '공정2 설비 조립',
    process_code: 'B',
    anchor_step: 'B',
    anchor_point: 'start',
    day_rule: 'SAME',
    time_mode: 'OFFSET',
    offset_minutes: -60,
    roles: ['p2_b', 'p2_c'],
    sort_order: 200
  },
  {
    rule_id: 'B-2',
    kind: 'SIMPLE',
    enabled: true,
    title: '공정2 시작',
    process_code: 'B',
    anchor_step: 'B',
    anchor_point: 'start',
    day_rule: 'SAME',
    time_mode: 'OFFSET',
    offset_minutes: 0,
    roles: [...ALL_ROLES],
    sort_order: 210
  },
  {
    rule_id: 'C-1',
    kind: 'SIMPLE',
    enabled: true,
    title: '공정3 설비 점검',
    process_code: 'C',
    anchor_step: 'C',
    anchor_point: 'start',
    day_rule: 'SAME',
    time_mode: 'OFFSET',
    offset_minutes: -60,
    roles: ['p3_a', 'p3_b'],
    sort_order: 300
  },
  {
    rule_id: 'C-END',
    kind: 'SIMPLE',
    enabled: true,
    title: '공정3 완료품 이동',
    process_code: 'C',
    anchor_step: 'C',
    anchor_point: 'end',
    day_rule: 'SAME',
    time_mode: 'OFFSET',
    offset_minutes: 0,
    roles: ['p3_a', 'p3_b'],
    sort_order: 320
  },
  {
    rule_id: 'D-1',
    kind: 'SIMPLE',
    enabled: true,
    title: '공정4 준비',
    process_code: 'D',
    anchor_step: 'D',
    anchor_point: 'start',
    day_rule: 'SAME',
    time_mode: 'OFFSET',
    offset_minutes: -30,
    roles: ['p4_a', 'p4_b'],
    sort_order: 400
  },
  {
    rule_id: 'D-END',
    kind: 'SIMPLE',
    enabled: true,
    title: '공정4 완료품 이동',
    process_code: 'D',
    anchor_step: 'D',
    anchor_point: 'end',
    day_rule: 'SAME',
    time_mode: 'OFFSET',
    offset_minutes: 0,
    roles: ['p4_a', 'p4_b'],
    sort_order: 420
  },
  {
    rule_id: 'E-2',
    kind: 'SIMPLE',
    enabled: true,
    title: '공정5 시작',
    process_code: 'E',
    anchor_step: 'E',
    anchor_point: 'start',
    day_rule: 'SAME',
    time_mode: 'OFFSET',
    offset_minutes: 0,
    roles: ['stage5'],
    sort_order: 500
  },
  {
    rule_id: 'PKG-PREP',
    kind: 'SIMPLE',
    enabled: true,
    title: '포장재 준비',
    process_code: 'PKG',
    anchor_step: 'PKG',
    anchor_point: 'start',
    day_rule: 'PREV_BIZ',
    time_mode: 'FIXED',
    target_time: '16:00',
    roles: [...ALL_ROLES],
    sort_order: 600
  }
];

/**
 * 로트 번호에서 끝자리 영문 서브로트(ex. PA260302A -> PA260302)를 분리하여 베이스 로트 번호 반환
 */
// ====================================================================
// 2. 날짜 및 MMDDHHMM 연도 보정 유틸리티
// ====================================================================
function pad2(n) {
  return String(n).padStart(2, '0');
}

export function toDateKey(d) {
  if (!d || isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function toTimeKey(d) {
  if (!d || isNaN(d.getTime())) return '';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function parseCodeParts(str) {
  if (!str) return null;
  const c = String(str).replace(/\D/g, '');
  if (c.length !== 8) return null;
  const m = parseInt(c.slice(0, 2), 10);
  const d = parseInt(c.slice(2, 4), 10);
  const h = parseInt(c.slice(4, 6), 10);
  const mn = parseInt(c.slice(6, 8), 10);
  if (m < 1 || m > 12 || d < 1 || d > 31 || h > 23 || mn > 59) return null;
  return { month: m, day: d, hour: h, minute: mn };
}

function parseStepDate(raw, currentYear) {
  const parts = parseCodeParts(raw);
  if (parts) {
    const dt = new Date(currentYear, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
    return { dt, month: parts.month };
  }
  if (raw) {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      const dt = new Date(currentYear, d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), 0, 0);
      return { dt, month: d.getMonth() + 1 };
    }
  }
  return null;
}

function applyParsedStep(res, parsed, state, isStart) {
  if (!parsed) return;
  if (state.lastMonth !== null && parsed.month < state.lastMonth) state.year += 1;
  state.lastMonth = parsed.month;
  const dt = new Date(state.year, parsed.dt.getMonth(), parsed.dt.getDate(),
    parsed.dt.getHours(), parsed.dt.getMinutes(), 0, 0);
  if (isStart) res.start = dt;
  else res.end = dt;
}

function normalizeStepSchedule(sObj, state) {
  const res = { start: null, end: null, raw: sObj || {} };
  if (!sObj) return res;

  const startRaw = sObj.startCode || sObj.startDate || sObj.start;
  applyParsedStep(res, parseStepDate(startRaw, state.year), state, true);

  const endRaw = sObj.endCode || sObj.endDate || sObj.end;
  applyParsedStep(res, parseStepDate(endRaw, state.year), state, false);

  if (res.start && !res.end && sObj.durationMinutes) {
    res.end = new Date(res.start.getTime() + sObj.durationMinutes * 60000);
  }
  return res;
}

export function normalizeScheduleYears(schedule, opts) {
  opts = opts || {};
  let curYear = opts.baseYear || new Date().getFullYear();
  const rawA = schedule && schedule.A && (schedule.A.startDate || schedule.A.start);
  if (rawA) {
    const dA = new Date(rawA);
    if (!isNaN(dA.getTime())) curYear = dA.getFullYear();
  }

  const state = { year: curYear, lastMonth: null };
  const result = {};
  const steps = ['A', 'B', 'C', 'D', 'E', 'packaging'];

  steps.forEach(step => {
    const sObj = (schedule && (schedule[step] || (step === 'packaging' ? schedule.pkg : null))) || {};
    result[step] = normalizeStepSchedule(sObj, state);
  });
  return result;
}

// ====================================================================
// 3. 평일(영업일) 계산 유틸리티
// ====================================================================
export function isBusinessDay(d, holidaySet) {
  if (!d || isNaN(d.getTime())) return false;
  const day = d.getDay();
  if (day === 0 || day === 6) return false;
  const key = toDateKey(d);
  if (holidaySet && holidaySet.has(key)) return false;
  return true;
}

export function getPreviousBusinessDay(d, holidaySet) {
  if (!d || isNaN(d.getTime())) return null;
  const cur = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  for (let i = 0; i < 60; i++) {
    cur.setDate(cur.getDate() - 1);
    if (isBusinessDay(cur, holidaySet)) {
      return new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), 0, 0, 0, 0);
    }
  }
  throw new Error('getPreviousBusinessDay: 60일 이내에 유효한 영업일을 찾을 수 없습니다.');
}

export function getNextBusinessDay(d, holidaySet) {
  if (!d || isNaN(d.getTime())) return null;
  const cur = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  for (let i = 0; i < 60; i++) {
    cur.setDate(cur.getDate() + 1);
    if (isBusinessDay(cur, holidaySet)) {
      return new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), 0, 0, 0, 0);
    }
  }
  throw new Error('getNextBusinessDay: 60일 이내에 유효한 영업일을 찾을 수 없습니다.');
}

export function getWeekStart(d) {
  if (!d || isNaN(d.getTime())) return null;
  const cur = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = cur.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  cur.setDate(cur.getDate() + diff);
  cur.setHours(0, 0, 0, 0);
  return cur;
}

export function getLastBusinessDayOfWeek(d, holidaySet) {
  if (!d || isNaN(d.getTime())) return null;
  const mon = getWeekStart(d);
  for (let offset = 4; offset >= 0; offset--) {
    const candidate = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + offset, 0, 0, 0, 0);
    if (isBusinessDay(candidate, holidaySet)) {
      return candidate;
    }
  }
  return getPreviousBusinessDay(mon, holidaySet);
}

export function resolveFollowUpSlot(endDate, holidaySet) {
  if (!endDate || isNaN(endDate.getTime())) return null;

  const isBiz = isBusinessDay(endDate, holidaySet);
  const h = endDate.getHours();
  const m = endDate.getMinutes();
  const totalMinutes = h * 60 + m;

  if (!isBiz || totalMinutes > 18 * 60) {
    const nextBiz = getNextBusinessDay(endDate, holidaySet);
    return { targetDate: toDateKey(nextBiz), targetTime: '09:00' };
  }
  if (totalMinutes < 9 * 60) {
    return { targetDate: toDateKey(endDate), targetTime: '09:00' };
  }
  return { targetDate: toDateKey(endDate), targetTime: `${pad2(h)}:${pad2(m)}` };
}

function isInPostEZone(b) {
  const mz = b.manualZone;
  const az = b.assignedZone;
  return Boolean((mz && POST_E_ZONES.includes(mz)) || (az && POST_E_ZONES.includes(az)));
}

function isEndBeforeToday(eEndRaw, today) {
  if (!eEndRaw) return false;
  const eEnd = eEndRaw instanceof Date ? eEndRaw : new Date(eEndRaw);
  const refToday = today instanceof Date ? today : (today ? new Date(today) : new Date());
  return !isNaN(eEnd.getTime()) && !isNaN(refToday.getTime()) && eEnd.getTime() <= refToday.getTime();
}

export function isPostEBatch(rawBatch, normSchedule, today) {
  if (!rawBatch) return false;
  if (isInPostEZone(rawBatch)) return true;
  return isEndBeforeToday(normSchedule && normSchedule.E && normSchedule.E.end, today);
}

// ====================================================================
// 4. 규칙 유효성 검증 및 정규화
// ====================================================================
function isValidTimeFormat(t) {
  if (typeof t !== 'string') return false;
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t);
}

function validateRuleRoles(roles, errors) {
  if (!Array.isArray(roles) || roles.length === 0) {
    errors.push('담당을 1개 이상 골라 주세요.');
    return;
  }
  const seenRoles = new Set();
  roles.forEach(r => {
    if (!ROLE_MAP[r]) errors.push(`알 수 없는 역할입니다: ${r}`);
    if (seenRoles.has(r)) errors.push(`roles에 중복된 역할이 있습니다: ${r}`);
    seenRoles.add(r);
  });
}

function validateSimpleRuleEnums(rule, errors) {
  if (!['A', 'B', 'C', 'D', 'E', 'PKG', 'PREP', 'CLEAN'].includes(rule.process_code)) errors.push(`허용되지 않은 process_code입니다: ${rule.process_code}`);
  if (!['A', 'B', 'C', 'D', 'E', 'PKG', 'WEEK'].includes(rule.anchor_step)) errors.push(`허용되지 않은 anchor_step입니다: ${rule.anchor_step}`);
  if (rule.anchor_point !== 'start' && rule.anchor_point !== 'end') errors.push('anchor_point는 start 또는 end여야 합니다.');
  if (!['SAME', 'PREV_BIZ', 'NEXT_BIZ', 'PREV_WEEK_LAST', 'WEEK_LAST'].includes(rule.day_rule)) errors.push('day_rule 오류');
  if ((rule.anchor_step === 'WEEK') !== (rule.day_rule === 'WEEK_LAST')) errors.push('매주 규칙의 날짜는 마지막 평일만 쓸 수 있습니다.');
  if (!['FIXED', 'OFFSET'].includes(rule.time_mode)) errors.push('time_mode 오류');
}

function validateSimpleRuleFields(rule, errors) {
  validateSimpleRuleEnums(rule, errors);
  if (rule.time_mode === 'OFFSET') {
    if (rule.day_rule !== 'SAME') errors.push('기준 시각 ±분 규칙은 당일(SAME)만 쓸 수 있습니다.');
    if (!Number.isInteger(rule.offset_minutes) || Math.abs(rule.offset_minutes) > 24 * 60) {
      errors.push('앞뒤 시간은 24시간 이내로 입력해 주세요.');
    }
  } else if (!isValidTimeFormat(rule.target_time)) {
    errors.push('시각을 입력해 주세요.');
  }
}

function validateRuleMeta(rule, errors) {
  if (typeof rule.rule_id !== 'string' || !rule.rule_id.trim()) errors.push('rule_id는 필수 문자열입니다.');
  if (rule.kind !== 'SIMPLE') errors.push('kind는 SIMPLE이어야 합니다.');
  if (typeof rule.enabled !== 'boolean') errors.push('enabled는 불리언이어야 합니다.');
  if (typeof rule.sort_order !== 'number' || !Number.isFinite(rule.sort_order)) {
    errors.push('sort_order는 유효한 숫자여야 합니다.');
  }
}

function validateBasicRuleFields(rule, errors) {
  validateRuleMeta(rule, errors);
  if (typeof rule.title !== 'string') {
    errors.push('title은 문자열이어야 합니다.');
    return;
  }
  const len = rule.title.trim().length;
  if (len < 1 || len > 60) errors.push('할 일 이름을 1~60자로 입력해 주세요.');
}

export function validateRule(rule) {
  const errors = [];
  if (!rule || typeof rule !== 'object') return { ok: false, errors: ['규칙 객체가 필요합니다.'] };

  validateBasicRuleFields(rule, errors);
  validateRuleRoles(rule.roles, errors);

  validateSimpleRuleFields(rule, errors);

  return { ok: errors.length === 0, errors };
}

export function normalizeRules(rules) {
  const warnings = [];
  if (!Array.isArray(rules)) {
    warnings.push({ code: 'INVALID_RULES_INPUT', message: 'rules가 배열이 아닙니다. 기본 규칙을 사용합니다.' });
    return { rules: DEFAULT_RULES.map(r => ({ ...r, roles: [...r.roles] })), warnings };
  }

  const validRules = [];
  const seenIds = new Set();

  rules.forEach(rule => {
    const v = validateRule(rule);
    if (!v.ok) {
      warnings.push({ code: 'INVALID_RULE', rule_id: rule && rule.rule_id, message: `검증 실패: ${(rule && rule.rule_id) || 'unknown'}`, errors: v.errors });
      return;
    }
    if (seenIds.has(rule.rule_id)) {
      warnings.push({ code: 'DUPLICATE_RULE_ID', rule_id: rule.rule_id, message: `중복 rule_id: ${rule.rule_id}` });
      return;
    }
    seenIds.add(rule.rule_id);
    validRules.push({ ...rule, roles: [...rule.roles] });
  });

  validRules.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  return { rules: validRules, warnings };
}

// ====================================================================
// 5. 투두 생성 헬퍼 함수들
// ====================================================================
function filterActiveBatches(rawBatches) {
  return rawBatches.filter(b => {
    if (!b) return false;
    return !(b.manualZone === 'logistics' ||
             b.assignedZone === 'logistics' ||
             Boolean(b.enteredLogisticsAt) ||
             Boolean(b.completed_at));
  });
}

function normalizeBatchList(activeBatches, today) {
  return activeBatches.map(b => {
    const normSch = normalizeScheduleYears(b.schedule || {}, { baseYear: today.getFullYear() });
    return {
      raw: b,
      lotNumber: b.lotNumber || 'UNKNOWN',
      schedule: normSch,
      postE: isPostEBatch(b, normSch, today)
    };
  });
}

function resolveRuleDay(rule, anchorDate, holidaySet) {
  if (rule.day_rule === 'PREV_BIZ') return getPreviousBusinessDay(anchorDate, holidaySet);
  if (rule.day_rule === 'NEXT_BIZ') return getNextBusinessDay(anchorDate, holidaySet);
  if (rule.day_rule === 'WEEK_LAST') return getLastBusinessDayOfWeek(anchorDate, holidaySet);
  if (rule.day_rule === 'PREV_WEEK_LAST') {
    const mon = getWeekStart(anchorDate);
    return getLastBusinessDayOfWeek(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() - 1), holidaySet);
  }
  return anchorDate;
}

function resolveRuleSlot(rule, anchorDate, holidaySet) {
  if (rule.time_mode === 'OFFSET') {
    // 기준 시각 ±N분. 근무시간·평일 밖이면 다음 근무 시작(09:00)으로 미룬다
    const shifted = new Date(anchorDate.getTime() + rule.offset_minutes * 60000);
    return resolveFollowUpSlot(shifted, holidaySet);
  }
  return { targetDate: toDateKey(resolveRuleDay(rule, anchorDate, holidaySet)), targetTime: rule.target_time };
}

function getRuleAnchorDate(rule, b) {
  const stepKey = rule.anchor_step === 'PKG' ? 'packaging' : rule.anchor_step;
  const date = b.schedule[stepKey] && b.schedule[stepKey][rule.anchor_point];
  if (date || rule.anchor_step !== 'PKG') return date;
  const raw = rule.anchor_point === 'start' ? b.raw.packagingStartDate : b.raw.packagingEndDate;
  const parsed = raw ? new Date(raw) : null;
  return parsed && !isNaN(parsed.getTime()) ? parsed : null;
}

function applyRuleToBatch(rule, b, holidaySet) {
  // 포장은 공정5 이후에 있으므로 공정이 끝난 로트에도 적용한다
  if (b.postE && rule.anchor_step !== 'PKG') return null;
  const anchorDate = getRuleAnchorDate(rule, b);
  if (!anchorDate) return null;
  const slot = resolveRuleSlot(rule, anchorDate, holidaySet);
  return {
    rule_id: rule.rule_id,
    target_date: slot.targetDate,
    target_time: slot.targetTime,
    process_code: rule.process_code,
    title: rule.title,
    lot_id: b.lotNumber,
    lot_ids: [b.lotNumber],
    roles: rule.roles
  };
}

// 매주 규칙은 이번 주와 다음 주 몫을 만들어, 그 주에 일정 반영을 누르지 않아도 할 일이 있게 한다
function buildWeeklyTasks(rule, today, holidaySet) {
  const mon = getWeekStart(today);
  return [0, 7].map(days => {
    const anchorDate = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + days);
    const slot = resolveRuleSlot(rule, anchorDate, holidaySet);
    return {
      rule_id: rule.rule_id,
      target_date: slot.targetDate,
      target_time: slot.targetTime,
      process_code: rule.process_code,
      title: rule.title,
      lot_id: '공통',
      lot_ids: [],
      roles: rule.roles
    };
  });
}

function consolidateTasks(rawTasks) {
  const mergedTaskMap = new Map();
  const consolidated = [];

  rawTasks.forEach(task => {
    if (!task.lot_ids || task.lot_ids.length !== 1 || !task.lot_ids[0]) {
      consolidated.push(task);
      return;
    }
    const singleLot = task.lot_ids[0];
    const mergeKey = `${task.rule_id}|${task.target_date}|${task.target_time}`;

    if (mergedTaskMap.has(mergeKey)) {
      const existing = mergedTaskMap.get(mergeKey);
      if (!existing.lot_ids.includes(singleLot)) {
        existing.lot_ids.push(singleLot);
        existing.lot_ids.sort();
      }
      existing.lot_id = existing.lot_ids.join(', ');
    } else {
      mergedTaskMap.set(mergeKey, task);
      consolidated.push(task);
    }
  });
  return consolidated;
}

function sortTasks(tasks) {
  return tasks.slice().sort((a, b) => {
    if (a.target_date !== b.target_date) return a.target_date.localeCompare(b.target_date);
    if (a.target_time !== b.target_time) return a.target_time.localeCompare(b.target_time);
    const pA = PROCESS_ORDER[a.process_code] || 99;
    const pB = PROCESS_ORDER[b.process_code] || 99;
    if (pA !== pB) return pA - pB;
    return (a.lot_id || '').localeCompare(b.lot_id || '');
  });
}

function expandTaskRows(filteredTasks, managers, warnings) {
  const rows = [];
  filteredTasks.forEach(task => {
    const taskKey = `${task.rule_id}|${task.target_date}|${task.target_time}|${(task.lot_ids || []).sort().join(',')}`;
    task.task_key = taskKey;

    task.roles.forEach(roleKey => {
      // 한 칸에 여러 명(쉼표 구분, 예: 신입 동행)이면 사람마다 같은 할 일 행을 만든다
      const names = splitManagerNames(managers[roleKey]);
      if (!names.length) {
        warnings.push({
          code: 'UNASSIGNED_ROLE',
          role_key: roleKey,
          role_label: (ROLE_MAP[roleKey] && ROLE_MAP[roleKey].label) || roleKey,
          date: task.target_date,
          time: task.target_time,
          title: task.title,
          message: `역할 [${(ROLE_MAP[roleKey] && ROLE_MAP[roleKey].label) || roleKey}]에 배정된 작업자가 없습니다.`
        });
      }
      (names.length ? names : [null]).forEach(workerName => rows.push({
        target_date: task.target_date,
        target_time: task.target_time,
        role_key: roleKey,
        worker_name: workerName,
        lot_id: task.lot_id,
        lot_ids: task.lot_ids,
        process_code: task.process_code,
        rule_id: task.rule_id,
        task_key: taskKey,
        title: task.title
      }));
    });
  });
  return rows;
}

export function splitManagerNames(value) {
  return [...new Set(String(value || '').split(',').map(s => s.trim()).filter(Boolean))];
}

// ====================================================================
// 6. 투두리스트 생성 코어 엔진
// ====================================================================
export function generateDailyTodos(params) {
  params = params || {};
  const rawBatches = params.batches || [];
  const managers = params.managers || {};
  const holidaySet = params.holidaySet || new Set();
  const today = params.today ? new Date(params.today) : new Date();
  const warnings = [];

  if (holidaySet.size === 0) {
    warnings.push({ code: 'NO_HOLIDAYS', message: '공휴일 데이터가 없어 주말만 휴무로 계산됩니다.' });
  }

  const { rules, warnings: ruleWarnings } = normalizeRules(params.rules || DEFAULT_RULES);
  warnings.push(...ruleWarnings);
  const ruleMap = new Map(rules.map(r => [r.rule_id, r]));

  const normalizedBatches = normalizeBatchList(filterActiveBatches(rawBatches), today);
  const rawTasks = [];

  rules.filter(r => r.enabled).forEach(rule => {
    if (rule.anchor_step === 'WEEK') {
      rawTasks.push(...buildWeeklyTasks(rule, today, holidaySet));
      return;
    }
    normalizedBatches.forEach(b => {
      const task = applyRuleToBatch(rule, b, holidaySet);
      if (task) rawTasks.push(task);
    });
  });

  const consolidatedTasks = consolidateTasks(rawTasks);
  const filterFromKey = toDateKey(getWeekStart(today));
  const filteredTasks = sortTasks(consolidatedTasks.filter(t => t.target_date >= filterFromKey));

  const rows = expandTaskRows(filteredTasks, managers, warnings);
  return { tasks: filteredTasks, rows, warnings };
}
