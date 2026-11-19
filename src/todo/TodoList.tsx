// PC 할 일 창의 목록(시간대별·작업자별 보기, 보기 권한 필터, 휴무일·미인증 안내).
// 날짜 이동·일정 반영은 TodoModal.tsx
import type { ReactNode } from 'react';

export interface TodoItem {
  task_key?: string | null; rule_id?: string; target_time?: string; lot_id?: string | null; lot_ids?: string[] | null;
  worker_name?: string | null; role_key?: string | null; process_code?: string; title?: string;
}
export interface Viewer { authenticated: boolean; name: string; canViewAll: boolean }
export interface TodoListInput {
  todos: TodoItem[]; viewer: Viewer; date: string; isHoliday: boolean;
  view: 'TIME' | 'WORKER'; workerFilter: string; roleLabel(key: string): string | undefined;
}

const keyOf = (t: TodoItem) => t.task_key || `${t.rule_id}|${t.target_time}|${t.lot_id}`;
export const PROC: Record<string, string> = { PREP: '사전준비', CLEAN: '대청소', PKG: '포장', A: '공정1', B: '공정2', C: '공정3', D: '공정4', E: '공정5' };
const PROC_ORDER: Record<string, number> = { PREP: 1, CLEAN: 1.5, A: 2, B: 3, C: 4, D: 5, E: 6, PKG: 7 };
const UNASSIGNED = '__UNASSIGNED__';
const isUnassigned = (t: TodoItem) => !t.worker_name || t.worker_name === '미배정';

/** 보기 권한에 맞는 행만: 일반 직원은 본인, 관리자·대리 이상은 고른 담당자(전체·미배정·이름) */
export function visibleTodos({ todos, viewer, workerFilter }: Pick<TodoListInput, 'todos' | 'viewer' | 'workerFilter'>): TodoItem[] {
  const mine = (t: TodoItem) => String(t.worker_name || '').trim();
  if (!viewer.canViewAll) return todos.filter(t => mine(t) === viewer.name);
  if (workerFilter === 'ALL') return todos;
  if (workerFilter === UNASSIGNED) return todos.filter(isUnassigned);
  return todos.filter(t => mine(t) === workerFilter);
}

/** 창 위쪽 요약 문구 */
export function todoSummary(input: TodoListInput): string {
  if (!input.viewer.authenticated) return '0개 과업 (미인증)';
  if (input.isHoliday) return '0개 과업 (휴무일)';
  const rows = visibleTodos(input);
  if (!rows.length) return '0개 과업';
  return `${new Set(rows.map(keyOf)).size}개 과업 (${rows.length}건 배정)`;
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) { const k = key(it); if (!m.has(k)) m.set(k, []); m.get(k)!.push(it); }
  return m;
}

function CardHead({ item, time }: { item: TodoItem; time?: string }) {
  const p = item.process_code || 'A';
  const lots = item.lot_ids?.length ? item.lot_ids : (item.lot_id ? [item.lot_id] : []);
  return (
    <div className="todo-card-main">
      <div className="todo-card-header">
        {time !== undefined && <span className="todo-time-badge">{time}</span>}
        <span className={`proc-chip proc-chip-${p}`}>{PROC[p] || '공정 ' + p}</span>
        {lots.map(l => <span key={l} className="lot-chip">{l}</span>)}
      </div>
      <span className="task-title">{item.title}</span>
    </div>
  );
}

function Empty({ icon, text, sub, children }: { icon: string; text: string; sub: string; children?: ReactNode }) {
  return (
    <div className="todo-empty-state">
      <div className="todo-empty-icon">{icon}</div>
      <div className="todo-empty-text">{text}</div>
      <div className="todo-empty-sub">{sub}</div>
      {children}
    </div>
  );
}

function TimeView({ rows, roleLabel }: { rows: TodoItem[]; roleLabel: TodoListInput['roleLabel'] }) {
  const byTime = groupBy(rows, t => t.target_time || '09:00');
  return (
    <>
      {[...byTime.keys()].sort().map(time => {
        const tasks = groupBy(byTime.get(time)!, keyOf);
        return (
          <div key={time} className="todo-time-group">
            <div className="todo-group-header">
              <div className="todo-group-title">⏰ {time}</div>
              <span className="todo-group-count">{tasks.size}개 과업</span>
            </div>
            <div className="todo-card-list">
              {[...tasks].map(([k, group]) => {
                // 같은 작업자가 여러 역할을 맡으면 칩 하나에 역할을 모아 표시
                const byWorker = groupBy(group.filter(r => r.worker_name), r => r.worker_name!);
                const unassigned = group.filter(r => !r.worker_name).map(r => roleLabel(r.role_key || '') || r.role_key);
                return (
                  <div key={k} className="todo-card">
                    <CardHead item={group[0]} />
                    <div className="todo-card-roles">
                      {[...byWorker].map(([name, rs]) => (
                        <span key={name} className="role-tag">👤 <span className="worker-name">{name}</span><span className="role-sub">{rs.map(r => roleLabel(r.role_key || '') || r.role_key).join(' · ')}</span></span>
                      ))}
                      {unassigned.length > 0 && (
                        <span className="role-tag is-unassigned">👤 <span className="worker-name" style={{ color: '#f87171' }}>(미배정)</span><span className="role-sub">{unassigned.join(' · ')}</span></span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}

function WorkerView({ rows, roleLabel }: { rows: TodoItem[]; roleLabel: TodoListInput['roleLabel'] }) {
  const byWorker = groupBy(rows, t => (isUnassigned(t) ? UNASSIGNED : String(t.worker_name).trim()));
  // 배정된 작업자는 이름 가나다순, 미배정은 맨 마지막
  const keys = [...byWorker.keys()].sort((a, b) => (a === UNASSIGNED ? 1 : b === UNASSIGNED ? -1 : a.localeCompare(b, 'ko')));
  return (
    <>
      {keys.map(wKey => {
        const items = byWorker.get(wKey)!;
        const roles = [...new Set(items.filter(i => i.role_key).map(i => roleLabel(i.role_key!) || i.role_key!))];
        // 같은 과업은 카드 1장으로, 카드는 시각 → 공정 → 로트 순
        const cards = [...groupBy(items, keyOf).values()].sort((a, b) =>
          (a[0].target_time || '').localeCompare(b[0].target_time || '')
          || (PROC_ORDER[a[0].process_code || ''] || 99) - (PROC_ORDER[b[0].process_code || ''] || 99)
          || (a[0].lot_id || '').localeCompare(b[0].lot_id || ''));
        const un = wKey === UNASSIGNED;
        return (
          <div key={wKey} className="todo-worker-group">
            <div className="todo-group-header">
              <div className="todo-group-title">
                👤 <span style={{ color: un ? '#f87171' : '#f8fafc', fontWeight: 700 }}>{un ? '미배정' : wKey}</span>
                {roles.length > 0 && <> · <span style={{ fontWeight: 'normal', fontSize: '0.85rem', color: '#94a3b8' }}>{roles.join(', ')}</span></>}
              </div>
              <span className="todo-group-count">{cards.length}개 작업</span>
            </div>
            <div className="todo-card-list">
              {cards.map(c => (
                <div key={keyOf(c[0])} className="todo-card">
                  <CardHead item={c[0]} time={c[0].target_time} />
                  <div className="todo-card-roles">
                    {c.filter(r => r.role_key).map((r, i) => <span key={i} className={`role-tag ${!r.worker_name ? 'is-unassigned' : ''}`}>{roleLabel(r.role_key!) || r.role_key}</span>)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

export function TodoList(input: TodoListInput) {
  if (!input.viewer.authenticated) {
    return <Empty icon="🔒" text="작업자 인증 후 본인 투두를 확인할 수 있습니다." sub="상단 작업자 배지를 클릭하여 작업자 코드를 입력해 주세요." />;
  }
  if (input.isHoliday) {
    const day = new Date(input.date + 'T00:00:00').getDay();
    return (
      <Empty icon="🏖️" text="휴무일입니다. 배정된 작업자 투두가 없습니다." sub="모든 작업자는 평일(공휴일 제외) 09:00 ~ 18:00에만 근무합니다.">
        <div className="todo-holiday-badge">{day === 0 || day === 6 ? '주말 휴무' : '법정 공휴일'} ({input.date})</div>
      </Empty>
    );
  }
  const rows = visibleTodos(input);
  if (!rows.length) {
    return <Empty icon="☕" text="해당 일자에 배정된 과업이 없습니다." sub="신규 배치를 등록했거나 일정이 변경되었다면 [일정 반영 (DB 갱신)] 버튼을 눌러주세요." />;
  }
  return input.view === 'TIME' ? <TimeView rows={rows} roleLabel={input.roleLabel} /> : <WorkerView rows={rows} roleLabel={input.roleLabel} />;
}

