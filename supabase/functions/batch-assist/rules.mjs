// batch-assist가 화면으로 내보내는 말(어휘)의 유일한 주인: 입력 검사, 변경 사실(Change) 형식, 출력 검사.
// 배치 목록은 이 모듈에 들어오지도 나가지도 않는다: 들어오는 것은 보고 원문·로트 이름·구역 이름, 나가는 것은 변경 사실(Change) 목록뿐.
// 나가는 글자는 전부 보고 원문에서 그대로 가져온 조각이어야 한다(quote·memo·notes). 모델이 지어낸 글은 화면에 닿지 못한다.

export const UNKNOWN = '?'; // 로트 형식이 '?'를 허용하지 않으므로 실제 로트와 겹칠 수 없다

export const LIMITS = {
  bodyBytes: 32 * 1024, textChars: 2000, authChars: 4096,
  lots: 50, lotChars: 50, zones: 40, zoneNameChars: 30,
  changes: 60, memoChars: 200, quoteChars: 200, notesChars: 500, qtyMax: 1000000,
  maxLots: 4 // 한 번에 바꿀 수 있는 배치 수 (js/ai_input/core.js MAX_LOTS와 같아야 함)
};

export const STEP_NAMES = { A: '공정1', B: '공정2', C: '공정3', D: '공정4', E: '공정5', inspection: '검사', packaging: '포장' };
export const STEPS = Object.keys(STEP_NAMES);
const SCHEDULE_STEPS = ['A', 'B', 'C', 'D', 'E', 'packaging'];
const LOSS_STEPS = ['B', 'C', 'D', 'E', 'inspection', 'packaging'];

/**
 * 어휘 표. 출력 검사가 여기서 나온다 (desc는 각 op의 뜻).
 * 삭제·생성·로트 번호 변경 op는 없다. 키 목록은 js/ai_input/core.js OPS와 같아야 한다 (테스트가 강제).
 * @type {Record<string, { steps: string[] | null, field: 'at' | 'qty' | 'zone' | 'text', optional?: true, stepOptional?: true, desc: string }>}
 */
export const OPS = {
  end: { steps: SCHEDULE_STEPS, field: 'at', optional: true, desc: '"OO 완료했습니다", "OO 공정 이후 적재 완료". at은 보고에 적힌 날짜·시각, 없으면 null' },
  start: { steps: SCHEDULE_STEPS, field: 'at', optional: true, desc: '"OO 시작했습니다" 또는 예정("내일 3번 배치 포장"). 날짜·시각이 없으면 null(화면은 일정을 바꾸지 않는다)' },
  loss: { steps: LOSS_STEPS, field: 'qty', desc: '그 공정의 차감 수량 전체를 이 값으로 고칠 때만("공정3 차감 5개로 정정"). 보통의 보고에는 쓰지 않는다' },
  deduct: { steps: LOSS_STEPS, stepOptional: true, field: 'qty', desc: '기존 차감에 더해 빼는 수량. 공정 도중 차감("공정5 중 용기 파손 3개"는 step E, 줄마다 하나씩)과 샘플 반출("시험용 샘플 5개"), "OO개 빼". 공정이 적혀 있지 않으면 step은 "?"(지금 있는 공정에서 뺀다)' },
  net: { steps: LOSS_STEPS, field: 'qty', desc: '그 공정을 마친 뒤 수량: 검사 보고의 "적합수량"(step inspection), "OO 후 실수량". 검사의 불량 종류별 개수 줄은 차감으로 넣지 말고 줄마다 memo로만 남긴다(적합수량에 이미 들어 있다)' },
  step2_qty: { steps: null, field: 'qty', desc: '공정2 완료 보고에서 로트 옆에 적힌 수량("PA260401: 1,000개"), 또는 공정2 수량 정정' },
  zone: { steps: null, field: 'zone', desc: '특정 구역으로 옮겼다는 명시적 말이 있을 때만' },
  memo: { steps: STEPS, field: 'text', desc: '차감 사유, 특이 사항. text는 report의 한 줄을 글자 그대로(고치거나 줄이지 않는다)' }
};

/**
 * @typedef {{ text: string, lots: string[], zones: Array<[string, string]> }} AssistInput
 *   text: 보고 원문, lots: 현재 로트 이름, zones: [구역 id, 이름]. 작업자는 Authorization 헤더(로그인 토큰)로 확인한다
 *
 * @typedef {{ op: 'end' | 'start', lot: string | null, step: string, at: string | null, quote: string }
 *         | { op: 'loss' | 'net', lot: string | null, step: string, qty: number, quote: string }
 *         | { op: 'deduct', lot: string | null, step: string | null, qty: number, quote: string }  step null = 지금 있는 공정 (화면이 정한다)
 *         | { op: 'step2_qty', lot: string | null, qty: number, quote: string }
 *         | { op: 'zone', lot: string | null, zone: string, quote: string }
 *         | { op: 'memo', lot: string | null, step: string, text: string, quote: string }} Change
 *   at: 'YYYY-MM-DDTHH:mm' 또는 'YYYY-MM-DD' (한국 시각). lot null = 보고가 가리키는 로트를 못 정함.
 */

const CONTROL = /[\u0000-\u001f\u007f]/;
const ZONE_ID = /^[a-z0-9-]{1,40}$/;
const isStr = (v, max) => typeof v === 'string' && v.length >= 1 && v.length <= max;

/**
 * 요청 본문 검사 (신뢰 경계).
 * @param {unknown} body
 * @returns {{ ok: true, value: AssistInput } | { ok: false, reason: 'bad_request' | 'too_long' }}
 */
export function parseAssistInput(body) {
  const b = body && typeof body === 'object' ? body : {};
  const text = typeof b.text === 'string' ? b.text.trim() : '';
  if (!text) return { ok: false, reason: 'bad_request' };
  if (text.length > LIMITS.textChars) return { ok: false, reason: 'too_long' };
  const { lots, zones } = b;
  if (!Array.isArray(lots) || lots.length > LIMITS.lots) return { ok: false, reason: 'bad_request' };
  if (!lots.every(l => isStr(l, LIMITS.lotChars) && !CONTROL.test(l) && l !== UNKNOWN)) return { ok: false, reason: 'bad_request' };
  if (!Array.isArray(zones) || zones.length > LIMITS.zones) return { ok: false, reason: 'bad_request' };
  const zoneOk = z => Array.isArray(z) && z.length === 2 && typeof z[0] === 'string' && ZONE_ID.test(z[0]) && isStr(z[1], LIMITS.zoneNameChars);
  if (!zones.every(zoneOk)) return { ok: false, reason: 'bad_request' };
  return { ok: true, value: { text, lots: [...lots], zones: zones.map(z => [z[0], z[1]]) } };
}

const AT_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;

/** 형식과 달력 둘 다 맞아야 한다 (2026-02-30, 25:00 같은 값은 버림). */
function isValidAt(v) {
  const m = typeof v === 'string' && AT_RE.exec(v);
  if (!m) return false;
  const [y, mo, d, h = 0, mi = 0] = m.slice(1).map(x => (x === undefined ? undefined : Number(x)));
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d && t.getUTCHours() === h && t.getUTCMinutes() === mi;
}

const squash = s => String(s).replace(/\s+/g, ' ').trim();
/** 모델이 준 글이 보고 원문의 한 조각인지 (공백 차이는 봐준다). 아니면 화면으로 내보내지 않는다. */
const inReport = (s, input) => typeof s === 'string' && squash(s) !== '' && squash(input.text).includes(squash(s));

/** 모델이 만든 한 항목을 새 Change로 다시 만든다. 맞지 않으면 null. 모델이 넣은 다른 키는 따라오지 않는다. */
function cleanChange(c, input) {
  if (!c || typeof c !== 'object' || !Object.hasOwn(OPS, c.op)) return null;
  const spec = OPS[c.op];
  const out = { op: c.op, lot: null };
  if (c.lot !== UNKNOWN && c.lot !== null) {
    if (!input.lots.includes(c.lot)) return null;
    out.lot = c.lot;
  }
  if (spec.steps) {
    if (spec.stepOptional && (c.step === UNKNOWN || c.step == null)) out.step = null;
    else if (!spec.steps.includes(c.step)) return null;
    else out.step = c.step;
  }
  const v = c[spec.field];
  if (spec.field === 'at') {
    if ((v == null || v === '') && spec.optional) out.at = null;
    else if (isValidAt(v)) out.at = v;
    else return null;
  } else if (spec.field === 'qty') {
    if (!Number.isInteger(v) || v < 0 || v > LIMITS.qtyMax) return null;
    out.qty = v;
  } else if (spec.field === 'zone') {
    if (!input.zones.some(z => z[0] === v)) return null;
    out.zone = v;
  } else {
    if (!inReport(v, input)) return null;
    out.text = squash(v).slice(0, LIMITS.memoChars);
  }
  out.quote = inReport(c.quote, input) ? squash(c.quote).slice(0, LIMITS.quoteChars) : '';
  return out;
}

/**
 * 조립한 변경 목록(decide.mjs assemble)을 Change[]로 좁힌다. 화면으로 나가기 전 마지막 관문.
 * @param {unknown} raw  응답 텍스트를 JSON.parse한 값
 * @param {AssistInput} input
 * @returns {{ changes: Change[], notes: string, dropped: number, tooManyLots?: true } | null}  null = 형식 자체가 깨짐
 */
export function parseModelOutput(raw, input) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.changes)) return null;
  const changes = raw.changes.slice(0, LIMITS.changes).map(c => cleanChange(c, input)).filter(Boolean);
  const dropped = raw.changes.length - changes.length;
  // 보고 하나가 배치를 많이 건드리면 잘못 읽었거나 악용이다. 일부만 적용하지 않고 통째로 거절한다
  if (new Set(changes.map(c => c.lot).filter(Boolean)).size > LIMITS.maxLots) return { changes: [], notes: '', dropped, tooManyLots: true };
  const notes = (Array.isArray(raw.notes) ? raw.notes : []).filter(n => inReport(n, input)).map(squash).join(' / ').slice(0, LIMITS.notesChars);
  return { changes, notes, dropped };
}
