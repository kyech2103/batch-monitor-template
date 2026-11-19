// 모바일 할 일 탭: 날짜 이동(PC와 같은 영업일·공휴일), 내 할 일/전체, 일정 반영
import { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { mount } from './mount';
import { flushSync } from 'react-dom';
import type { SupabaseLike } from '../supabase';
import { showToast } from './toast';
import { assignees, groupByTask, groupByTime, type TodoRow } from './todo';
import * as D from '../todo/core';
import { getHolidays, regenerateTodos } from '../todo/TodoModal';

type Bridge = MobileBridgeLike & {
  openOperatorModal?(forceNew?: boolean): void;
};
declare global {
  interface Window {
    MobileTodo?: { openScheduleConfirmSheet: typeof openScheduleConfirmSheet; handleApplySchedule: typeof handleApplySchedule };
  }
}

// 탭을 다시 열어도 고른 날짜와 보기는 유지한다
let selectedDate: Date | null = null;
let viewFilter: 'mine' | 'all' = 'mine';
// 탭을 다시 그릴 때마다(실시간 갱신 포함) 서버에서 새로 읽는다
let renders = 0;

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const displayDate = (d: Date) => `${d.getMonth() + 1}월 ${d.getDate()}일 (${'일월화수목금토'[d.getDay()]})`;
const roleLabel = (k: string) => D.ROLE_MAP[k]?.label;

async function fetchTodos(sb: SupabaseLike, dateStr: string): Promise<{ data: TodoRow[] | null; error: unknown }> {
  try {
    return await sb.from('todo_schedules').select('*').eq('record_type', 'TODO').eq('target_date', dateStr).order('target_time', { ascending: true });
  } catch (e) {
    return { data: null, error: e };
  }
}

/** 일정 반영 확인 시트. 배치 상세의 '일정 반영' 안내도 이것을 쓴다 */
export function openScheduleConfirmSheet(onConfirm: () => void): void {
  const el = document.createElement('div');
  el.className = 'm-sheet-backdrop';
  document.body.appendChild(el);
  const root = createRoot(el);
  const close = () => { root.unmount(); el.remove(); };
  flushSync(() => root.render(
    <div className="m-sheet-container">
      <div className="m-sheet-header">
        <span className="m-sheet-title">일정 반영 확인</span>
        <button className="m-btn" id="m-sched-close" style={{ padding: '6px 12px', minHeight: 44 }} onClick={close}>닫기</button>
      </div>
      <div style={{ fontSize: 15, color: 'var(--pt-text)', marginBottom: 20 }}>배치 일정과 담당자 기준으로 할 일을 다시 계산해 저장할까요?</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="m-btn" id="m-sched-cancel" style={{ flex: 1, minHeight: 44 }} onClick={close}>취소</button>
        <button className="m-btn m-btn-primary" id="m-sched-confirm" style={{ flex: 1, minHeight: 44 }} onClick={() => { close(); onConfirm(); }}>반영</button>
      </div>
    </div>
  ));
}

/** PC와 같은 일정 반영(regenerateTodos)을 부르고 결과를 알린다 */
export async function handleApplySchedule(btn: HTMLButtonElement | null, bridge: Bridge, onSuccess?: () => void | Promise<void>): Promise<void> {
  if (!btn || !bridge) return;
  const orig = btn.textContent;
  btn.textContent = '반영 중…';
  btn.disabled = true;
  try {
    const res: { success: boolean; taskCount?: number } | undefined = await regenerateTodos('모바일 일정 반영');
    if (res?.success) {
      showToast(`할 일 ${res.taskCount ?? 0}건을 반영했어요`, true);
      await onSuccess?.();
    } else {
      showToast('반영 실패: 인터넷 연결을 확인해 주세요');
    }
  } catch {
    showToast('반영 실패: 인터넷 연결을 확인해 주세요');
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
}

const NowDivider = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, margin: '12px 0', color: 'var(--pt-accent)', fontSize: 13, fontWeight: 600 }}>
    <span style={{ flex: 1, height: 1, background: 'var(--pt-border)' }} />─ 지금 ─<span style={{ flex: 1, height: 1, background: 'var(--pt-border)' }} />
  </div>
);

function GroupCard({ time, items, showWorker }: { time: string; items: TodoRow[]; showWorker: boolean }) {
  return (
    <div className="m-card" style={{ padding: '10px 14px', marginBottom: 8 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--pt-accent)', marginBottom: 6 }}>{time}</div>
      {groupByTask(items).map(rows => {
        const first = rows[0];
        const lots = first.lot_ids?.length ? first.lot_ids : (first.lot_id ? [first.lot_id] : []);
        return (
          <div key={first.task_key || first.id} className="m-todo-item">
            <div className="m-todo-main">
              <span className="m-todo-title">{first.title || '할 일'}</span>
              {lots.length > 0 && <span className="m-todo-lot">{lots.join(', ')}</span>}
            </div>
            <div className="m-todo-meta">
              {assignees(rows, showWorker, roleLabel).map(a => (
                <span key={a.name} className="m-todo-assignee">
                  {a.name && <span className="m-todo-worker">{a.name}</span>}
                  {a.labels.length > 0 && <span className="m-chip m-todo-chip">{a.labels.join(' · ')}</span>}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const card = { textAlign: 'center' as const, padding: '28px 16px' };

function TodoContent({ bridge, date, workerName, reload }: { bridge: Bridge; date: Date; workerName: string | null; reload(): void }) {
  const [res, setRes] = useState<{ data: TodoRow[] | null; error: unknown } | null>(null);
  useEffect(() => {
    let live = true;
    setRes(null);
    if (viewFilter === 'mine' && !workerName) return;
    fetchTodos(bridge.getSupabase(), ymd(date)).then(r => { if (live) setRes(r); });
    return () => { live = false; };
  }, [date, workerName]);

  if (viewFilter === 'mine' && !workerName) {
    return (
      <div className="m-card" style={card}>
        <div style={{ color: 'var(--pt-muted)', marginBottom: 14 }}>작업자 인증 후 볼 수 있습니다</div>
        <button className="m-btn m-btn-primary" id="m-todo-auth-btn" onClick={() => bridge.openOperatorModal?.(true)}>인증하기</button>
      </div>
    );
  }
  if (!res) return <div style={{ textAlign: 'center', color: 'var(--pt-muted)', padding: 30 }}>불러오는 중...</div>;
  if (res.error) {
    return (
      <div className="m-card" style={{ ...card, color: 'var(--pt-danger)' }}>
        <div style={{ marginBottom: 12 }}>할 일을 불러오지 못했습니다</div>
        <button className="m-btn" id="m-todo-retry-btn" onClick={reload}>다시 시도</button>
      </div>
    );
  }
  const rows = viewFilter === 'mine' ? (res.data || []).filter(t => t.worker_name === workerName) : (res.data || []);
  if (!rows.length) return <div className="m-card" style={{ textAlign: 'center', color: 'var(--pt-muted)', padding: '32px 16px' }}>오늘 배정된 할 일이 없습니다</div>;

  const now = new Date();
  const isToday = ymd(date) === ymd(now);
  const nowHHMM = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const out: ReactNode[] = [];
  let divided = false;
  for (const [time, items] of groupByTime(rows)) {
    if (isToday && !divided && time >= nowHHMM) { out.push(<NowDivider key="now" />); divided = true; }
    out.push(<GroupCard key={time} time={time} items={items} showWorker={viewFilter === 'all'} />);
  }
  if (isToday && !divided) out.push(<NowDivider key="now" />);
  return <>{out}</>;
}

function TodoTab({ bridge, date, rerender, renderNo }: { bridge: Bridge; date: Date; rerender(): void; renderNo: number }) {
  const worker = bridge.getWorker?.() as { name?: string; display?: string } | null | undefined;
  const workerName = worker?.name || worker?.display || null;
  const [tick, setTick] = useState(0);
  const move = async (dir: 1 | -1) => {
    const h = await getHolidays();
    selectedDate = dir > 0 ? D.getNextBusinessDay(date, h) : D.getPreviousBusinessDay(date, h);
    rerender();
  };
  const setView = (v: 'mine' | 'all') => { viewFilter = v; rerender(); };
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <button className="m-btn" id="m-todo-prev" style={{ width: 44, padding: 0 }} onClick={() => move(-1)}>◀</button>
        <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--pt-text)' }}>{displayDate(date)}</span>
        <button className="m-btn" id="m-todo-next" style={{ width: 44, padding: 0 }} onClick={() => move(1)}>▶</button>
      </div>
      <div style={{ marginBottom: 12 }}>
        <button className="m-btn" id="m-todo-apply-schedule" style={{ width: '100%', height: 44, minHeight: 44 }}
          onClick={e => { const btn = e.currentTarget; openScheduleConfirmSheet(() => handleApplySchedule(btn, bridge, () => setTick(t => t + 1))); }}>일정 반영</button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button className={`m-btn ${viewFilter === 'mine' ? 'm-btn-primary' : ''}`} id="m-todo-btn-mine" style={{ flex: 1 }} onClick={() => setView('mine')}>내 할 일</button>
        <button className={`m-btn ${viewFilter === 'all' ? 'm-btn-primary' : ''}`} id="m-todo-btn-all" style={{ flex: 1 }} onClick={() => setView('all')}>전체</button>
      </div>
      <div id="m-todo-content" style={{ minHeight: 200 }}>
        <TodoContent key={`${viewFilter}-${renderNo}-${tick}`} bridge={bridge} date={date} workerName={workerName} reload={() => setTick(t => t + 1)} />
      </div>
    </>
  );
}

export async function renderTodoTab(container: HTMLElement, bridge: Bridge): Promise<void> {
  if (!selectedDate) {
    const h = await getHolidays(), today = new Date();
    selectedDate = D.isBusinessDay(today, h) ? today : D.getNextBusinessDay(today, h)!;
  }
  const date = selectedDate;
  mount(container, 'todo', <TodoTab key={ymd(date)} bridge={bridge} date={date} renderNo={++renders} rerender={() => renderTodoTab(container, bridge)} />);
}
