// PC 할 일 창: 날짜 이동, 시간대별·작업자별 보기, 담당자 고르기, 일정 반영(다시 계산해 DB에), 규칙 창 열기.
// 공휴일·규칙과 일정 반영은 모바일 할 일 탭과 규칙 창(RulesModal)도 같이 쓴다 (옛 js/app/16·17)
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { sb } from '../sb';
import { pushAudit } from '../main/audit';
import { showToast } from '../main/toast';
import { getManagers, setManagers } from '../pm/managers';
import * as C from './core';
import type { Rule } from './rules';
import { TodoList, todoSummary, type TodoItem, type Viewer } from './TodoList';

declare global {
  interface Window { refreshTodoOnAuthChange(): void }
}

// DB에 공휴일이 없거나 못 읽을 때 쓰는 2026~2027 공휴일
const FALLBACK_HOLIDAYS = [
  '2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18', '2026-03-02', '2026-05-01', '2026-05-05', '2026-05-25', '2026-06-03', '2026-06-06',
  '2026-08-15', '2026-08-17', '2026-09-24', '2026-09-25', '2026-09-26', '2026-10-03', '2026-10-05', '2026-10-09', '2026-12-25',
  '2027-01-01', '2027-02-06', '2027-02-07', '2027-02-08', '2027-02-09', '2027-03-01', '2027-05-01', '2027-05-05', '2027-05-13', '2027-06-06',
  '2027-08-15', '2027-08-16', '2027-09-14', '2027-09-15', '2027-09-16', '2027-10-03', '2027-10-04', '2027-10-09', '2027-10-11', '2027-12-25',
  '2027-12-27'
];
const copyRules = (rs: Rule[]) => rs.map(r => ({ ...r, roles: [...r.roles] }));

let holidays = new Set<string>();
let rules: Rule[] = copyRules(C.DEFAULT_RULES as Rule[]);
let usingDefault = true;
// 창이 떠 있으면 일정 반영 뒤 경고를 보이고 목록을 다시 읽는다
let onRegenerated: ((warnings: string[]) => void) | null = null;

export async function loadHolidays(): Promise<boolean> {
  try {
    const { data, error } = await sb.from('todo_schedules').select('target_date, title').eq('record_type', 'HOLIDAY');
    const rows = data as { target_date: string }[] | null;
    holidays = new Set(!error && rows?.length ? rows.map(h => h.target_date) : FALLBACK_HOLIDAYS);
    return !error;
  } catch {
    holidays = new Set(FALLBACK_HOLIDAYS);
    return false;
  }
}

export async function getHolidays(): Promise<Set<string>> {
  if (!holidays.size) await loadHolidays();
  return holidays;
}

export async function fetchTodoRules(): Promise<boolean> {
  try {
    const { data, error } = await sb.from('todo_rules').select('*').order('sort_order', { ascending: true });
    const ok = !error && Array.isArray(data) && data.length > 0;
    rules = ok ? C.normalizeRules(data).rules as Rule[] : copyRules(C.DEFAULT_RULES as Rule[]);
    usingDefault = !ok;
    return !error;
  } catch {
    rules = copyRules(C.DEFAULT_RULES as Rule[]);
    usingDefault = true;
    return false;
  }
}

export const getRulesState = () => ({ rules, usingDefault });
export function setRules(next: Rule[]): void { rules = next; usingDefault = false; }

/** 지금 인증된 작업자. 대리 이상이거나 관리자면 모든 사람의 할 일을 본다 */
export function viewerContext(): Viewer & { dept: string } {
  const w = window.MobileBridge?.getWorker?.() as { name?: string; dept?: string; department?: string } | null | undefined;
  if (!w?.name) return { authenticated: false, name: '', canViewAll: false, dept: '' };
  const name = String(w.name).trim();
  const dept = String(w.dept || w.department || '').trim();
  const canViewAll = /(대리|과장|차장|부장|팀장)/i.test(dept) || /(관리자|admin)/i.test(dept) || /(관리자|admin)/i.test(name);
  return { authenticated: true, name, canViewAll, dept };
}

/** 최신 배치·담당자·규칙으로 할 일을 다시 계산해 DB에 통째로 바꿔 넣는다 */
export async function regenerateTodos(auditLabel: string): Promise<{ success: boolean; taskCount?: number; rowCount?: number }> {
  try {
    const holidaysLoaded = await loadHolidays();
    // DB 함수가 기존 할 일을 전부 지우고 덮어쓰므로, 배치·담당자·규칙을 서버에서 못 읽었으면 예비값으로 계산하지 않고 중단
    const { data: bData, error: bErr } = await sb.from('batches').select('data').eq('id', 'current_batches').single();
    const batches = (bData as { data?: unknown } | null)?.data;
    if (bErr || !Array.isArray(batches)) throw new Error('배치 목록을 읽지 못해 반영을 중단했습니다.');
    const { data: managers, error: mErr } = await sb.from('process_managers').select('*').eq('id', 1).single();
    if (mErr || !managers) throw new Error('공정 담당자 편성을 읽지 못해 반영을 중단했습니다.');
    setManagers(managers as Parameters<typeof setManagers>[0]);
    if (!(await fetchTodoRules())) throw new Error('투두 규칙을 읽지 못해 반영을 중단했습니다.');

    const result = C.generateDailyTodos({ batches, managers, holidaySet: holidays, today: new Date(), rules });
    if (!holidaysLoaded) result.warnings.push({ code: 'HOLIDAY_FALLBACK', message: '공휴일 목록을 읽지 못해 기본 공휴일 목록으로 계산했습니다.' });

    let success = false;
    try {
      const { error } = await sb.rpc('replace_todo_schedules', { p_rows: result.rows, p_generated_at: new Date().toISOString() });
      if (!error) {
        success = true;
        showToast(`✅ 1일 투두리스트가 성공적으로 DB에 반영되었습니다! (총 ${result.tasks.length}개 과업, ${result.rows.length}건 배정)`);
      } else {
        console.warn('[DailyTodo] RPC error:', error);
        showToast(`⚠️ DB 반영 중 오류가 발생했습니다 (${(error as { message?: string }).message || 'RPC 누락'}). 로컬에 우선 반영되었습니다.`);
      }
    } catch (e) {
      console.warn('[DailyTodo] RPC exception:', e);
      showToast('⚠️ DB 연결 오류로 로컬 메모리에 우선 반영되었습니다.');
    }
    pushAudit({ zone: '일일투두', action: 'MODIFY', item: '전체 배치', from: '', to: auditLabel, detail: `${result.tasks.length}개 과업 생성됨` });
    onRegenerated?.(result.warnings.map((w: { message: string }) => w.message));
    window.fetchMyTodayTodoCount?.();
    return { success, taskCount: result.tasks.length, rowCount: result.rows.length };
  } catch (err) {
    console.error('[DailyTodo] handleApply error:', err);
    showToast('투두리스트 생성 중 치명적 오류가 발생했습니다: ' + (err as Error).message);
    return { success: false };
  }
}

const genLabel = (at: string) => { const d = new Date(at); return `마지막 반영: ${d.toLocaleDateString()} ${d.toLocaleTimeString()}`; };
const LOCAL_LABEL = '마지막 반영: 세션 로컬 계산됨 (DB 미반영)';

/** 그 날의 할 일: DB에 반영된 것, 한 번도 반영 안 됐거나 못 읽으면 이 PC의 배치로 계산한 것 */
async function readTodos(date: string): Promise<{ todos: TodoItem[]; label: string }> {
  await getHolidays();
  try {
    const { data, error } = await sb.from('todo_schedules').select('*').eq('record_type', 'TODO').eq('target_date', date).order('target_time', { ascending: true });
    if (!error && Array.isArray(data)) {
      let genAt = (data[0] as { generated_at?: string } | undefined)?.generated_at;
      if (!data.length) {
        const r = await sb.from('todo_schedules').select('generated_at').eq('record_type', 'TODO').order('generated_at', { ascending: false }).limit(1);
        genAt = (!r.error && (r.data as { generated_at?: string }[] | null)?.[0]?.generated_at) || undefined;
      }
      if (genAt) return { todos: data as TodoItem[], label: genLabel(genAt) };
    }
  } catch { /* 아래 로컬 계산 */ }
  try {
    const batches = JSON.parse(localStorage.getItem('APP_BATCH_RECORDS') || '[]');
    const result = C.generateDailyTodos({ batches, managers: getManagers(), holidaySet: holidays, today: new Date(), rules });
    return { todos: result.rows.filter((r: TodoItem & { target_date: string }) => r.target_date === date), label: LOCAL_LABEL };
  } catch {
    return { todos: [], label: LOCAL_LABEL };
  }
}

const roleLabel = (k: string) => C.ROLE_MAP[k]?.label;
const dayKey = (d: Date | null) => (d ? C.toDateKey(d) : null);
// 다시 열어도 시간대별·작업자별 보기는 유지한다
let savedView: 'TIME' | 'WORKER' = 'TIME';
const btn28 = { height: 28, padding: '0 8px' };

function TodoModal({ dialog, auth }: { dialog: HTMLDialogElement; auth: number }) {
  const [date, setDate] = useState(() => C.toDateKey(new Date()));
  const [view, setView] = useState(savedView);
  const [filter, setFilter] = useState('ALL');
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [label, setLabel] = useState('마지막 반영: 대기 중');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const dateRef = useRef(date);
  const viewer = viewerContext();
  void auth;

  async function load(d: string) {
    dateRef.current = d;
    setDate(d);
    const n = ++seq.current;
    const r = await readTodos(d);
    if (n !== seq.current) return;
    setTodos(r.todos);
    setLabel(r.label);
  }

  useEffect(() => {
    // 다른 사용자가 바꾼 규칙도 반영되도록 열 때마다 규칙을 다시 읽는다
    fetchTodoRules().finally(() => load(dateRef.current));
    onRegenerated = w => { setWarnings(w); load(dateRef.current); };
    return () => { onRegenerated = null; };
  }, []);

  const step = (next: (d: Date, h: Set<string>) => Date | null) => {
    const d = dayKey(next(new Date(date + 'T00:00:00'), holidays));
    if (d) load(d);
  };
  const pickView = (v: 'TIME' | 'WORKER') => { savedView = v; setView(v); };
  async function apply() {
    if (!confirm('현재 등록된 모든 배치 스케줄과 공정 담당자 편성을 기반으로 1일 투두리스트를 새로 생성하여 DB에 반영하시겠습니까?')) return;
    setBusy(true);
    try { await regenerateTodos('일일투두 DB 갱신'); } finally { setBusy(false); }
  }

  // 담당자 고르기: 공정 담당자 편성과 그 날 할 일에 나오는 사람(맡은 역할 함께), 미배정 작업
  const roles = new Map<string, Set<string>>();
  const addRole = (name: string, key: string) => { if (!roles.has(name)) roles.set(name, new Set()); if (key) roles.get(name)!.add(roleLabel(key) || key); };
  const managers = getManagers() as Record<string, unknown>;
  C.ALL_ROLES.forEach((k: string) => { const n = managers[k] ? String(managers[k]).trim() : ''; if (n) addRole(n, k); });
  let hasUnassigned = false;
  todos.forEach(t => { const n = t.worker_name ? String(t.worker_name).trim() : ''; if (n && n !== '미배정') addRole(n, t.role_key || ''); else hasUnassigned = true; });
  const options = [...roles.keys()].sort((a, b) => a.localeCompare(b, 'ko'));
  const workerFilter = filter === 'ALL' || options.includes(filter) || (filter === '__UNASSIGNED__' && hasUnassigned) ? filter : 'ALL';

  const input = { todos, viewer, date, isHoliday: !C.isBusinessDay(new Date(date + 'T00:00:00'), holidays), view, workerFilter, roleLabel };
  return (
    <>
      <header className="pt-head">
        <div className="pt-head__title-group">
          <h2 id="todo-modal-title" className="pt-head__title">📋 작업자별 1일 투두리스트 (Daily To-Do)</h2>
          <span className="pt-head__sub">당일 일정 및 공정별 과업 자동 계산</span>
        </div>
        <button type="button" className="pt-icon-btn btn-dialog-close" id="btn-todo-modal-close" aria-label="닫기" onClick={() => dialog.close()}>×</button>
      </header>
      <div className="pt-toolbar">
        <div className="todo-date-nav" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button type="button" className="pt-btn pt-btn--secondary" id="btn-todo-prev-day" title="이전 평일" style={btn28} onClick={() => step(C.getPreviousBusinessDay)}>◀</button>
          <input type="date" id="todo-date-input" className="pt-input todo-date-input" style={{ height: 28, padding: '0 6px' }} value={date} onChange={e => { if (e.target.value) load(e.target.value); }} />
          <button type="button" className="pt-btn pt-btn--secondary" id="btn-todo-next-day" title="다음 평일" style={btn28} onClick={() => step(C.getNextBusinessDay)}>▶</button>
          <button type="button" className="pt-btn pt-btn--secondary" id="btn-todo-today" style={btn28} onClick={() => load(C.toDateKey(new Date()))}>오늘</button>
        </div>
        <div className="todo-controls" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="pt-segment">
            <button type="button" className={`pt-segment__item${view === 'TIME' ? ' is-active' : ''}`} id="btn-todo-view-time" onClick={() => pickView('TIME')}>시간대별</button>
            <button type="button" className={`pt-segment__item${view === 'WORKER' ? ' is-active' : ''}`} id="btn-todo-view-worker" onClick={() => pickView('WORKER')}>작업자별</button>
          </div>
          {/* 일반 직원은 본인 것만 보므로 담당자 고르기를 숨긴다 */}
          {viewer.canViewAll && (
            <div className="todo-filter-group" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <label htmlFor="todo-worker-filter" className="todo-filter-label" style={{ fontSize: 12, color: 'var(--pt-muted)' }}>담당자:</label>
              <select id="todo-worker-filter" className="pt-input todo-worker-select" style={{ height: 28, padding: '0 6px' }} value={workerFilter} onChange={e => setFilter(e.target.value)}>
                <option value="ALL">전체 담당자 보기</option>
                {options.map(n => { const r = [...roles.get(n)!]; return <option key={n} value={n}>{n}{r.length ? ` (${r.join(', ')})` : ''}</option>; })}
                {hasUnassigned && <option value="__UNASSIGNED__">미배정 작업</option>}
              </select>
            </div>
          )}
        </div>
      </div>
      <div className="pt-body" id="todo-list-body">
        <div id="todo-items-container" className="todo-items-container"><TodoList {...input} /></div>
      </div>
      {warnings.length > 0 && (
        <div id="todo-warnings-panel" className="todo-warnings-panel" style={{ background: '#fffbeb', borderTop: '1px solid #fef3c7', padding: '8px 16px', fontSize: 12 }}>
          <div className="todo-warn-title" style={{ fontWeight: 700, color: '#b45309' }}>⚠️ 생성 안내 및 주의사항</div>
          <ul id="todo-warnings-list" className="todo-warnings-list" style={{ margin: '4px 0 0 16px', padding: 0, color: '#92400e' }}>
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}
      <footer className="pt-foot">
        <div className="todo-footer-left" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="todo-status-indicator"></span>
          <span id="todo-last-generated" className="todo-last-time" style={{ fontSize: 12, color: 'var(--pt-muted)' }}>{label}</span>
          <span id="todo-summary-count" className="todo-count-pill" style={{ fontSize: 11, fontWeight: 700, background: 'var(--pt-accent-soft)', color: 'var(--pt-accent)', padding: '2px 8px', borderRadius: 12 }}>{todoSummary(input)}</span>
        </div>
        <div className="todo-footer-right" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" className="pt-btn pt-btn--secondary" id="btn-todo-modal-cancel" onClick={() => dialog.close()}>닫기</button>
          {viewer.canViewAll && <button type="button" className="pt-btn pt-btn--secondary" id="btn-todo-rules" title="일일 투두 규칙 관리" onClick={() => window.TodoRulesModal?.open()}>⚙️ 규칙 관리</button>}
          <button type="button" className="pt-btn pt-btn--primary" id="btn-todo-apply" title="현재 배치 및 담당자 기준으로 투두리스트를 재계산하여 DB에 갱신합니다" disabled={busy} onClick={apply}>
            {busy ? <><span className="btn-icon">⏳</span><span className="btn-text">계산 및 반영 중...</span></> : '일정 반영'}
          </button>
        </div>
      </footer>
    </>
  );
}

export function setupTodoModal(): void {
  const dialog = document.getElementById('daily-todo-modal') as HTMLDialogElement | null;
  if (!dialog) return;
  const root = createRoot(dialog);
  let opened = 0, auth = 0;
  const render = () => flushSync(() => root.render(<TodoModal key={opened} dialog={dialog} auth={auth} />));
  // 열 때마다 오늘 날짜·처음 상태로 새로 그린다
  const open = () => {
    opened++;
    render();
    if (!dialog.open) dialog.showModal();
  };
  // 작업자 인증이 바뀌면(옛 02_operator_auth.js) 보기 권한과 요약 띠를 다시
  window.refreshTodoOnAuthChange = () => {
    window.fetchMyTodayTodoCount?.();
    auth++;
    if (opened) render();
  };
  window.openDailyTodoModal = open;
  document.getElementById('btn-daily-todo')?.addEventListener('click', open);
}
