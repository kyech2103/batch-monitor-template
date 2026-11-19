// 할 일 규칙 창의 계산: 목록 문구·정렬·변경 감지, 편집 패널 값 ↔ 규칙. 화면은 RulesModal.tsx
export interface Rule {
  rule_id: string; kind: 'SIMPLE'; enabled: boolean; title: string; process_code: string;
  anchor_step: string; anchor_point: 'start' | 'end'; day_rule: string; time_mode: 'OFFSET' | 'FIXED';
  offset_minutes?: number; target_time?: string | null; roles: string[]; sort_order?: number;
}
/** 편집 패널 입력값 (모두 입력칸의 문자열) */
export interface RuleForm {
  rule_id: string; title: string; anchor_step: string; anchor_point: string; day_rule: string;
  off_h: string; off_m: string; off_dir: string; target_time: string; roles: string[];
}

const STEP: Record<string, string> = { A: '공정1', B: '공정2', C: '공정3', D: '공정4', E: '공정5', PKG: '포장' };
const DAY: Record<string, string> = { SAME: '당일', PREV_BIZ: '직전 평일', NEXT_BIZ: '다음 평일', PREV_WEEK_LAST: '전주 마지막 평일' };
const PROC_ORDER: Record<string, number> = { PREP: 1, CLEAN: 1.5, A: 2, B: 3, C: 4, D: 5, E: 6, PKG: 7 };

export function offsetText(minutes: number): string {
  const abs = Math.abs(minutes), h = Math.floor(abs / 60), m = abs % 60;
  return `${(h ? `${h}시간` : '') + (h && m ? ' ' : '') + (m ? `${m}분` : '')} ${minutes > 0 ? '후' : '전'}`;
}

/** 목록의 '언제' 한 칸: 공정1 시작 20분 후 / 공정2 시작 직전 평일 09:00 / 매주 마지막 평일 09:00 */
export function ruleWhenText(r: Rule): string {
  if (r.anchor_step === 'WEEK') return `매주 마지막 평일 ${r.target_time}`;
  const base = `${STEP[r.anchor_step] || r.anchor_step} ${r.anchor_point === 'start' ? '시작' : '종료'}`;
  if (r.time_mode === 'OFFSET') return r.offset_minutes ? `${base} ${offsetText(r.offset_minutes)}` : `${base} 시`;
  return `${base} ${DAY[r.day_rule] || r.day_rule} ${r.target_time}`;
}

export const sortRules = (rules: Rule[]) =>
  rules.slice().sort((a, b) => (PROC_ORDER[a.process_code] || 99) - (PROC_ORDER[b.process_code] || 99) || (a.sort_order || 0) - (b.sort_order || 0));

/** 저장할 내용만 비교하는 열쇠 (정렬 순서·역할 순서 무시) */
export function rulesKey(rules: Rule[]): string {
  return JSON.stringify(rules.map(r => [
    r.rule_id, r.enabled, r.title, r.process_code, r.anchor_step, r.anchor_point, r.day_rule, r.time_mode,
    r.time_mode === 'OFFSET' ? r.offset_minutes : r.target_time, [...r.roles].sort()
  ]).sort());
}

export function newRule(): Rule {
  return { rule_id: 'U-' + Date.now().toString(36), kind: 'SIMPLE', enabled: true, title: '', process_code: 'A', anchor_step: 'A', anchor_point: 'start', day_rule: 'SAME', time_mode: 'OFFSET', offset_minutes: 0, target_time: '09:00', roles: [] };
}

export function formFromRule(r: Rule): RuleForm {
  const off = r.time_mode === 'OFFSET' ? (r.offset_minutes || 0) : 0;
  return {
    rule_id: r.rule_id, title: r.title || '', anchor_step: r.anchor_step || 'A', anchor_point: r.anchor_point || 'start',
    day_rule: r.day_rule === 'WEEK_LAST' ? 'SAME' : (r.day_rule || 'SAME'),
    off_h: String(Math.floor(Math.abs(off) / 60)), off_m: String(Math.abs(off) % 60), off_dir: off < 0 ? '-1' : '1',
    target_time: r.target_time || '09:00', roles: [...(r.roles || [])]
  };
}

/** 당일 규칙은 '기준 시각 ±', 그 외 날짜는 '시각 고정'. 매주 규칙은 기준 시점·날짜를 고르지 않는다 */
export function formShape(f: Pick<RuleForm, 'anchor_step' | 'day_rule'>) {
  const weekly = f.anchor_step === 'WEEK';
  return { weekly, offset: !weekly && f.day_rule === 'SAME' };
}

export function ruleFromForm(f: RuleForm, existing: Rule | undefined): Rule {
  const { weekly, offset } = formShape(f);
  const dayRule = weekly ? 'WEEK_LAST' : f.day_rule;
  const defaultProcess = ({ PKG: 'PKG', WEEK: 'CLEAN' } as Record<string, string>)[f.anchor_step] || f.anchor_step;
  const minutes = (Number(f.off_dir) || 1) * ((parseInt(f.off_h, 10) || 0) * 60 + (parseInt(f.off_m, 10) || 0));
  return {
    rule_id: f.rule_id, kind: 'SIMPLE', enabled: existing ? existing.enabled : true, title: f.title,
    // 기준이 그대로면 사전준비처럼 따로 정한 공정 칩을 유지한다
    process_code: existing?.anchor_step === f.anchor_step ? existing.process_code : defaultProcess,
    anchor_step: f.anchor_step, anchor_point: weekly ? 'start' : (f.anchor_point as Rule['anchor_point']),
    day_rule: dayRule, time_mode: offset ? 'OFFSET' : 'FIXED',
    offset_minutes: offset ? minutes : 0, target_time: offset ? null : f.target_time.trim(),
    roles: f.roles,
    // 화면에서 뺀 정렬 순서는 기존 값을 유지한다 (목록 표시는 공정·시각 순)
    sort_order: existing?.sort_order ?? 100
  };
}
