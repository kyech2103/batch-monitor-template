// PC 메인 화면 본문: 요약 띠, 평면도/타임라인 탭, 오른쪽 패널, 머리줄 로트 검색. 배치 선택·검색어·탭은 여기 한 곳에 둔다
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyEvent } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Batch } from '../batch/core';
import { MACHINE_ZONES, inWarehouse, stepTime } from '../batch/zone';
import { readBatches, refreshBatches, useBatches, zoneInfo } from './batches';
import { computeSummary } from './summary';
import { Floorplan } from './Floorplan';
import { SidePanel } from './SidePanel';
import { Timeline, timelineRows } from './Timeline';
import { toDateKey } from '../todo/core';

declare global {
  interface Window {
    openBatchScheduleModal?(b?: Batch | string | null): void;
    openDailyTodoModal?(): void;
    showToast?(msg: string, ms?: number): void;
    selectBatch?(b: Batch | null): void;
    fetchMyTodayTodoCount?(): Promise<void>;
    renderBatchIcons?(): void;
  }
}

const saved = (key: string, ok: string[], dflt: string) => { try { const v = localStorage.getItem(key); return v && ok.includes(v) ? v : dflt; } catch { return dflt; } };
const save = (key: string, v: string) => { try { localStorage.setItem(key, v); } catch { /* 사생활 보호 모드 */ } };
const openSchedule = (b: Batch) => window.openBatchScheduleModal?.(b);

function Board({ searchBox }: { searchBox: Element | null }) {
  const { batches, now } = useBatches();
  const [selLot, setSelLot] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [tab, setTabState] = useState(() => saved('APP_MAIN_VIEW_TAB', ['floorplan', 'timeline'], 'floorplan'));
  const [range, setRangeState] = useState(() => saved('APP_TIMELINE_RANGE', ['1w', '2w'], '2w'));
  const [myTodo, setMyTodo] = useState({ text: '-', title: '작업자 인증 필요' });
  const input = useRef<HTMLInputElement>(null);
  const tabs = useRef<HTMLElement>(null);

  const setTab = (t: string) => { setTabState(t); save('APP_MAIN_VIEW_TAB', t); };
  const setRange = (r: string) => { setRangeState(r); save('APP_TIMELINE_RANGE', r); };
  const select = (b: Batch | null) => setSelLot(b?.lotNumber || null);
  window.selectBatch = select;
  window.fetchMyTodayTodoCount = () => fetchMyTodo().then(setMyTodo);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.current?.focus(); input.current?.select(); }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const selected = selLot ? batches.find(b => b.lotNumber === selLot) || null : null;
  const q = query.trim().toLowerCase();
  const matches = (lot: string) => Boolean(q) && String(lot || '').toLowerCase().includes(q);
  const floorLots = batches.filter(b => !inWarehouse(b, zoneInfo(b, now).zoneId));
  const finished = batches.length - floorLots.length;
  const shownLots = !q ? [] : tab === 'timeline' ? timelineRows(batches, range, now).rows.map(r => r.lotNumber) : floorLots.map(b => b.lotNumber);
  const counts = computeSummary(batches, now, b => zoneInfo(b, now).zoneId,
    (b, z) => stepTime((b.schedule as Record<string, never> | undefined)?.[MACHINE_ZONES[z].step], false, now));

  // Enter: 지금 화면에서 첫 번째로 강조된 로트를 고른다
  const pickFirst = () => {
    const el = document.querySelector<HTMLElement>(tab === 'timeline' ? '.timeline-row.is-search-match' : '.batch-chip.is-search-match');
    if (!el) return;
    const lot = el.dataset.lot!;
    select(readBatches().find(b => b.lotNumber === lot) || { lotNumber: lot } as Batch);
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const tabBtn = (id: string, icon: string, label: string, controls: string) => (
    <button type="button" id={`tab-${id}`} className={`view-tab${tab === id ? ' is-active' : ''}`} role="tab" aria-selected={tab === id}
      aria-controls={controls} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)}>
      <span className="view-tab-icon">{icon}</span><span className="view-tab-text">{label}</span>
    </button>
  );
  const card = (id: string, label: string, title: string, val: string | number, extra = {}) => (
    <div className="summary-card" id={`summary-card-${id}`} title={title} {...extra}>
      <span className="summary-label">{label}</span><span className="summary-val" id={`summary-count-${id}`}>{val}</span>
    </div>
  );

  return (
    <>
      {searchBox && createPortal(<>
        <input type="search" id="lot-search-input" className="lot-search-input" placeholder="로트 검색 (Ctrl+K)" autoComplete="off" ref={input}
          value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); pickFirst(); } }} />
        <span id="lot-search-feedback" className="lot-search-feedback" style={{ display: q && !shownLots.some(matches) ? 'block' : 'none' }}>일치하는 로트 없음</span>
      </>, searchBox)}
      <div id="dashboard-summary" className="dashboard-summary" role="region" aria-label="공정 요약 현황">
        {card('in-progress', '진행 중', '설비 가동 진행 중인 배치 수', counts.inProgress)}
        {card('ending-soon', '48시간 내 종료', '진행 중 배치 중 48시간 내 종료 예정 배치 수', counts.endingSoon48h)}
        {card('waiting', '대기', '공정 대기 구역 배치 수', counts.waiting)}
        {card('storage', '보관 중', '반제품 보관실 및 검사 구역 보관 배치 수', counts.storage)}
        {card('my-todo', '내 오늘 할 일', myTodo.title, myTodo.text, {
          className: 'summary-card is-interactive', role: 'button', tabIndex: 0,
          onClick: () => window.openDailyTodoModal?.(),
          onKeyDown: (e: ReactKeyEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.openDailyTodoModal?.(); } }
        })}
      </div>
      <nav id="main-view-tabs" className="main-view-tabs" role="tablist" aria-label="메인 뷰 선택" ref={tabs}
        onKeyDown={e => {
          if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
          e.preventDefault();
          const next = tab === 'floorplan' ? 'timeline' : 'floorplan';
          setTab(next);
          tabs.current?.querySelector<HTMLElement>(`#tab-${next}`)?.focus();
        }}>
        {tabBtn('floorplan', '🗺️', '평면도', 'process-grid')}
        {tabBtn('timeline', '📅', '타임라인', 'timeline-view')}
      </nav>
      <div id="dashboard-body" className="dashboard-body">
        <main id="process-grid" role="tabpanel" aria-labelledby="tab-floorplan" className={tab === 'floorplan' ? '' : 'is-hidden'}>
          <Floorplan batches={batches} now={now} selected={selLot} matches={matches} onSelect={select} onOpen={openSchedule} />
        </main>
        <Timeline hidden={tab !== 'timeline'} batches={batches} now={now} range={range} setRange={setRange} selected={selLot} matches={matches} onSelect={select} />
        <SidePanel batches={batches} now={now} selected={selected} info={selected && zoneInfo(selected, now)} finished={finished} onOpen={openSchedule} />
      </div>
    </>
  );
}

/** 오늘 내 할 일 수 (요약 띠). 일정 반영 전이거나 조회에 실패하면 '-' */
async function fetchMyTodo(): Promise<{ text: string; title: string }> {
  const bridge = window.MobileBridge!;
  const worker = bridge.getWorker?.();
  if (!worker?.name) return { text: '-', title: '작업자 인증 필요' };
  try {
    const { data, error } = await bridge.getSupabase().from('todo_schedules').select('id, target_date, worker_name').eq('record_type', 'TODO');
    if (error || !data) return { text: '-', title: '조회 실패' };
    const rows = data as { target_date: string; worker_name: string }[];
    if (!rows.length) return { text: '-', title: '일정 반영 전' };
    const today = toDateKey(new Date());
    const n = rows.filter(r => r.target_date === today && r.worker_name === worker.name).length;
    return { text: String(n), title: `오늘 할 일 ${n}건` };
  } catch {
    return { text: '-', title: '조회 실패' };
  }
}

export function setupBoard(): void {
  const el = document.getElementById('main-board');
  if (!el) return;
  flushSync(() => createRoot(el).render(<Board searchBox={document.querySelector('.lot-search-box')} />));
  // 모바일 화면일 때는 모바일이 다시 그린다
  window.renderBatchIcons = () => { if (!window.MobileApp?.onRenderBatch?.()) refreshBatches(); };
}
