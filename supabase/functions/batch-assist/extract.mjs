// 보고 원문에서 코드로 확정할 수 있는 것(로트, 날짜, 시각·수량·구역 후보)을 토큰 없이 뽑는다.
// AI(decide.mjs)는 여기서 나온 후보 중에서 고르기만 한다.

const MONTH_DAY = /(?<![\d./])(\d{1,2})\/(\d{1,2})(?![\d/])/; // 줄 안의 "11/10" = 올해 11월 10일
const RELATIVE = { 오늘: 0, 내일: 1, 모레: 2 };
const LOT_LIKE = /(?<![A-Za-z0-9])[A-Z]{2}-?\d{1,6}[A-Z]?(?![A-Za-z0-9])/g; // 목록에 없는 로트 모양 글자 찾기용
const CLOCK = /(\d{1,2}):(\d{2})/g;
const KOREAN_TIME = /(오전|오후)?\s*(\d{1,2})시(?:\s*(\d{1,2})분|\s*(반))?/g;
const NUMBER = /\d{1,3}(?:,\d{3})+|\d+/g;

const pad = n => String(n).padStart(2, '0');
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** @param {number} ms @returns {string} 한국 날짜 YYYY-MM-DD */
const kstDate = ms => new Date(ms + 9 * 3600000).toISOString().slice(0, 10);

/** 한 줄에서 목록에 있는 로트를 적힌 순서대로 찾고, 찾은 자리는 지운 글을 돌려준다. 대소문자는 가리지 않는다.
 * 회사 보고에서 로트를 줄여 쓰는 습관(끝자리만 쓰기 등)이 있으면 여기에 규칙을 더한다. */
function takeLots(line, lots) {
  const hits = [];
  let rest = line;
  // 긴 이름부터: PA260401A 안의 PA260401을 따로 잡지 않게
  for (const lot of [...lots].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`(?<![A-Za-z0-9])${escapeRe(lot)}(?![A-Za-z0-9])`, 'gi');
    rest = rest.replace(re, (m, at) => {
      hits.push({ at, lot });
      return ' '.repeat(m.length); // 자리를 지켜 다른 로트의 위치(at)가 어긋나지 않게
    });
  }
  hits.sort((a, b) => a.at - b.at);
  return { lots: hits.map(h => h.lot), at: hits.map(h => h.at), rest, ambiguous: [] };
}

/** "PA1 샘플 4개, PA2 샘플 2개 빼"처럼 한 줄에 로트+숫자 짝이 여럿이면 로트마다 조각으로 나눈다. 조각 하나라도 숫자가 없으면("PA1, PA2 각 5개") 나누지 않는다. */
function splitPairs(text, lots) {
  const { at } = takeLots(text, lots);
  if (at.length < 2) return [text];
  const cuts = [0, ...at.slice(1), text.length];
  const parts = cuts.slice(0, -1).map((c, i) => text.slice(c, cuts[i + 1]).trim());
  return parts.every(p => /\d/.test(takeLots(p, lots).rest)) ? parts : [text];
}

/** "무게 샘플 2개, 시험용 샘플 5개"처럼 쉼표·슬래시로 나열한 수량은 항목마다 나눈다(항목마다 규칙이 다르다). 숫자 없는 항목이 있으면 나누지 않는다. */
function splitList(text, lots) {
  const parts = text.split(/,(?!\d)|(?<!\d)\/(?!\d)/).map(s => s.trim()).filter(Boolean); // "1,000"·"11/10"은 나누지 않는다
  if (parts.length < 2) return [text];
  return parts.every(p => /\d/.test(takeLots(p, lots).rest)) ? parts : [text];
}

/** "13:30", "오후 2시 30분", "11시 반" → 'HH:mm' 목록. 찾은 자리는 지운 글도 돌려준다. */
function takeTimes(text) {
  const times = [];
  let rest = text.replace(CLOCK, (m, h, mi) => {
    if (Number(h) < 24 && Number(mi) < 60) times.push(`${pad(h)}:${mi}`);
    return ' ';
  });
  rest = rest.replace(KOREAN_TIME, (m, ampm, h, min, half) => {
    const mi = half ? '30' : min || '0';
    let hour = Number(h);
    if (ampm === '오후' && hour < 12) hour += 12;
    if (ampm === '오전' && hour === 12) hour = 0;
    if (hour < 24 && Number(mi) < 60) times.push(`${pad(hour)}:${pad(mi)}`);
    return ' ';
  });
  return { times, rest };
}

/**
 * 수량 후보. 쓰지 않는 숫자는 미리 버린다: 공정·설비 이름의 숫자("공정3", "공정2-B", "1호기"), 괄호 안("(1,200개)", "(95.5%)"), 퍼센트, 소수.
 * 그 밖의 숫자(합계 줄, 로트 옆 수량 등)는 남겨 두고, 쓸지 말지는 AI가 고른다.
 */
function takeNumbers(text) {
  const cleaned = text
    .split(/→|->|⇒/).pop() // "차감 3 → 5로 수정": 화살표 앞은 옛 값이라 뒤만 본다
    .replace(/공정\s*\d+(?:-[A-Z])?(?:실)?/g, ' ')
    .replace(/\d+\s*호기/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\d[\d,]*(?:\.\d+)?\s*%/g, ' ')
    .replace(/\d+\.\d+/g, ' ');
  return (cleaned.match(NUMBER) || []).map(s => Number(s.replace(/,/g, '')));
}

/**
 * @param {string} report 보고 원문
 * @param {string[]} lots 현재 로트 이름
 * @param {number} nowMs
 * @param {Array<[string, string]>} [zones] [구역 id, 이름]. 줄에 이름이 적힌 구역 id를 lines[].zones로
 * @returns {{
 *   date: string,
 *   lots: string[],
 *   unknownLots: string[],
 *   lines: Array<{ text: string, row: string, lots: string[], own: boolean, date: string, dated: boolean, nums: number[], times: string[], zones: string[] }>
 * }}
 *   date: 오늘(한국 날짜). 줄에 "11/10"·"내일"이 있으면 그 줄의 date가 바뀐다. lots: 보고에 나온 로트 전부(순서대로, 중복 없음).
 *   unknownLots: 로트처럼 생겼는데 목록에 없는 글자. lines[].lots: 그 줄의 로트, 없으면 바로 위 줄에서 물려받음(own=false),
 *   첫 로트보다 위 줄이면 처음 나오는 로트.
 */
export function extractReport(report, lots, nowMs, zones = []) {
  const rows = String(report).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const today = kstDate(nowMs);
  const date = today;

  const all = [];
  const unknown = [];
  const lines = [];
  let current = [];
  const pieces = rows.flatMap(row => splitPairs(row, lots).flatMap(r => splitList(r, lots)).map(text => ({ text, row })));
  for (const { text, row } of pieces) {
    const found = takeLots(text, lots);
    for (const u of [...found.ambiguous, ...[...found.rest.matchAll(LOT_LIKE)].map(m => m[0])]) if (!unknown.includes(u)) unknown.push(u);
    const withoutUnknown = found.rest.replace(LOT_LIKE, ' ');
    const { times, rest: noTimes } = takeTimes(withoutUnknown);
    const md = MONTH_DAY.exec(noTimes);
    const okMd = md && Number(md[1]) >= 1 && Number(md[1]) <= 12 && Number(md[2]) >= 1 && Number(md[2]) <= 31;
    const rest = okMd ? noTimes.replace(md[0], ' ') : noTimes;
    const rel = Object.keys(RELATIVE).find(w => text.includes(w));
    const own = found.lots.length > 0;
    if (own) current = found.lots;
    for (const l of found.lots) if (!all.includes(l)) all.push(l);
    lines.push({
      text,
      row, // 나누기 전 원래 줄 (나누지 않았으면 text와 같다)
      lots: current,
      own,
      // shortcut: 연말에 쓴 "1/3"도 올해 날짜로 읽는다, 해를 넘기는 예정 보고가 생기면 가까운 날짜로 고른다
      date: okMd ? `${today.slice(0, 4)}-${pad(md[1])}-${pad(md[2])}` : rel ? kstDate(Date.parse(`${today}T00:00:00Z`) - 9 * 3600000 + RELATIVE[rel] * 86400000) : date,
      dated: Boolean(okMd || rel), // 보고에 날짜가 실제로 적혀 있는가 (없으면 date는 오늘일 뿐이라 일정에 쓰지 않는다)
      nums: takeNumbers(rest),
      times,
      zones: zones.filter(([, name]) => text.includes(name)).map(([id]) => id)
    });
  }
  // 첫 로트보다 위에 있는 줄("공정 후 차감 2\nPA-1 공정3 완료")은 처음 나오는 로트를 받는다
  const first = lines.find(l => l.own);
  for (const l of lines) {
    if (l.own) break;
    if (first) l.lots = first.lots;
  }
  return { date, lots: all, unknownLots: unknown, lines };
}
