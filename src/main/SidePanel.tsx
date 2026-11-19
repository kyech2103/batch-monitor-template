// 오른쪽 패널: 선택한 배치, 다가오는 72시간 일정, 기타 구역 버튼(선반·창고·장비·완제품 창고)
import type { Batch, ScheduleStep } from '../batch/core';
import { MACHINE_ZONES, stepTime, type ZoneInfo } from '../batch/zone';
import { qtyForZone } from '../batch/quantity';
import { useDropTarget } from './Floorplan';
import { EqCard } from '../equipment/EqCard';
import { STEP_NAMES, formatRemaining, upcomingEvents } from './summary';
import { STEP_TEXT_COLORS } from './timelineBars';
import { isPostEBatch, normalizeScheduleYears } from '../todo/core';

const STEP_SEQ = ['A', 'B', 'C', 'D', 'E', 'packaging'];
const stepName = (s: string) => (s === 'packaging' ? '포장' : STEP_NAMES[s] || `공정 ${s}`);
const sched = (b: Batch, s: string): ScheduleStep | undefined => {
  const sch = b.schedule as Record<string, ScheduleStep | undefined> | undefined;
  return s === 'packaging' ? sch?.packaging || sch?.pkg : sch?.[s];
};
const hm = (d: Date) => d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
const md = (d: Date) => `${d.getMonth() + 1}/${d.getDate()} ${hm(d)}`;
const waitStep = (z: string) => ({ stage1: 'A', stage2: 'B', 'stage3': 'C', stage4: 'D', stage5: 'E', packaging: 'packaging' } as Record<string, string>)[z.replace(/-wait$/, '')] || 'A';

/** 진행 구역이면 종료 예정(남은 시간), 대기 구역이면 시작 예정 */
export function batchTiming(b: Batch, info: ZoneInfo, now: Date): { label: string; text: string } {
  const z = info.zoneId || '';
  if (MACHINE_ZONES[z]) {
    const end = stepTime(sched(b, MACHINE_ZONES[z].step), false, now);
    if (!end) return { label: '종료 예정', text: '-' };
    const rem = formatRemaining(end.getTime() - now.getTime());
    const remText = rem ? (rem.endsWith('지남') ? rem : `${rem} 남음`) : '';
    return { label: '종료 예정', text: remText ? `${hm(end)} (${remText})` : hm(end) };
  }
  if (z.endsWith('-wait')) {
    const start = stepTime(sched(b, waitStep(z)), true, now);
    return { label: '시작 예정', text: start ? md(start) : '-' };
  }
  return { label: '공정 일정', text: '-' };
}

function nextProcess(b: Batch, z: string, now: Date): string {
  const at = (s: string) => { const d = stepTime(sched(b, s), true, now); return d ? `${stepName(s)} (${md(d)})` : stepName(s); };
  if (z.endsWith('-wait')) return stepName(waitStep(z));
  const cur = MACHINE_ZONES[z]?.step;
  if (cur) { const i = STEP_SEQ.indexOf(cur); return i < 0 || i >= STEP_SEQ.length - 1 ? '-' : at(STEP_SEQ[i + 1]); }
  if (z === 'semi-storage-pre' || z === 'inspection') return at('packaging');
  return '-';
}

function qtyText(b: Batch & Record<string, unknown>, z: string): string {
  const n = qtyForZone(b, z);
  if (n != null && !isNaN(n)) return `${Number(n).toLocaleString()} EA`;
  const q = b.quantities as Record<string, unknown> | undefined;
  const alt = [q?.B, q?.actualB, b.qtyB, b.size, b.quantity, b.targetQuantity].find(v => v != null && !isNaN(Number(v)));
  return alt != null ? `${Number(alt).toLocaleString()} EA` : '- EA';
}

export function SidePanel({ batches, now, selected, info, finished, onOpen }: {
  batches: Batch[]; now: Date; selected: Batch | null; info: ZoneInfo | null; finished: number; onOpen(b: Batch): void;
}) {
  const events = upcomingEvents(batches, now, normalizeScheduleYears, isPostEBatch);
  const timing = selected && batchTiming(selected, info!, now);
  const row = (label: string, val: string, cls = '') => (
    <div className="side-detail-row"><span className="side-detail-label">{label}:</span> {cls ? <strong className={`side-detail-val ${cls}`}>{val}</strong> : <span className="side-detail-val">{val}</span>}</div>
  );
  const { over: o1, ...d1 } = useDropTarget('logistics');
  return (
    <aside id="dashboard-side-panel" className="dashboard-side-panel">
      <section id="side-selected-batch" className="side-panel-section">
        <header className="side-section-header">
          <span className="side-section-title">선택한 배치</span>
          <button type="button" id="btn-side-edit-schedule" className="side-action-btn" style={{ display: selected ? 'inline-block' : 'none' }} onClick={() => selected && onOpen(selected)}>일정 수정</button>
        </header>
        <div id="side-selected-content" className="side-selected-content">
          {!selected ? <div className="side-empty-hint">배치를 클릭하면 상세가 표시됩니다</div> : <>
            {row('로트번호', selected.lotNumber, 'lot-val')}
            {row('현재 공정', info!.processName || info!.badgeText || '-')}
            {row(timing!.label, timing!.text)}
            {row('다음 공정', nextProcess(selected, info!.zoneId || '', now))}
            {row('현재 수량', qtyText(selected, info!.zoneId), 'qty-val')}
          </>}
        </div>
      </section>
      <section id="side-upcoming-events" className="side-panel-section">
        <header className="side-section-header"><span className="side-section-title">다가오는 일정 (72시간)</span></header>
        <div id="side-events-content" className="side-events-content">
          {!events.length ? <div className="side-empty-hint">72시간 안 예정된 공정 일정이 없습니다</div> : events.map(e => (
            <div key={`${e.lot}-${e.step}-${e.type}`} className="side-event-item">
              <span className="side-event-dot" />
              <span className="side-event-text">{e.timeText} · {e.lot} <span className="side-event-step" style={{ color: STEP_TEXT_COLORS[e.step] || 'inherit', fontWeight: 700 }}>{e.stepName}</span> {e.typeLabel}</span>
            </div>
          ))}
        </div>
      </section>
      {/* 선반·창고 창은 src/rooms/RoomDialogs.tsx, 완제품 창고 목록 창은 src/warehouse/ArchiveModal.tsx */}
      <section id="side-quick-areas" className="side-panel-section">
        <header className="side-section-header"><span className="side-section-title">기타 구역</span></header>
        <div className="side-quick-grid">
          <button type="button" className="quick-room-btn" id="btn-room-toolroom" data-room-id="toolroom" onClick={() => window.openRoom?.('toolroom')} title="부품 보관실 선반 관리 모달 열기"><span>🔧 부품 보관실</span></button>
          <button type="button" className="quick-room-btn" id="btn-room-pack-supplies" data-room-id="pack-supplies" onClick={() => window.openRoom?.('pack-supplies')} title="포장실 비품실 현황 열기"><span>📦 포장실 비품실</span></button>
          <button type="button" className="quick-room-btn" id="btn-room-supplies" data-room-id="supplies" onClick={() => window.openRoom?.('supplies')} title="작업장 비품실 현황 열기"><span>🧤 작업장 비품실</span></button>
          <button type="button" className="quick-room-btn" id="btn-room-warehouse-main" data-room-id="warehouse-main" onClick={() => window.openRoom?.('warehouse-main')} title="생산팀 창고(main) 관리 모달 열기"><span>🏭 생산팀 창고</span></button>
          <EqCard />
          <button type="button" id="btn-finished-wh-nav" className={`quick-room-btn finished-wh-nav-btn${o1 ? ' drag-over' : ''}`} title="완제품 창고 입고 목록 보기 (완료 배치 아카이브)" {...d1} onClick={() => window.FinishedWarehouse?.open()}>
            <span>📦 완제품 창고</span><span className="wh-count-pill" id="finished-wh-count">{finished}</span>
          </button>
        </div>
      </section>
    </aside>
  );
}
