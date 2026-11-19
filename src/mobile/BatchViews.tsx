// 모바일 배치 탭: 목록(공정별 묶음·검색)과 상세(공정 타임라인·수량). 수량·위치는 PC와 같은 계산을 bridge로 받는다
import { useState } from 'react';
import { mount } from './mount';
import { groupByProcess } from './processGroups';
import type { Batch } from '../batch/core';
import { openBatchEditSheet } from './BatchEditSheet';
import { handleApplySchedule, openScheduleConfirmSheet } from './TodoTab';
import { buildBatchCardModel, type CardModel } from './card';
import { formatDateTime } from '../equipment/core';
import { formatRemaining } from '../main/summary';
import { normalizeScheduleYears } from '../todo/core';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Bridge = MobileBridgeLike & {
  getBatchQtyForZone?(b: Batch, zoneId?: string): number | null;
  calcBatchQuantities?(b: Batch): { actualB: number | null; losses?: Record<string, number> } | null;
};
// 탭을 다시 그려도(실시간 갱신) 검색어와 시각 변경 안내는 유지한다
let searchQuery = '';
let timeChangedLot: string | null = null;
function shortZoneLabel(zoneLabel: string, processName?: string): string {
  if (!zoneLabel) return '';
  let str = String(zoneLabel).trim();
  if (processName) str = str.replace(new RegExp(`^${processName}\\s*`), '').trim();
  for (const k of ['공정1', '공정2', '공정3', '공정4', '공정5']) str = str.replace(new RegExp(`^${k}\\s*`), '').trim();
  str = str.replace(/^\((.+)\)$/, '$1').trim();
  return str || zoneLabel;
}

function SlimCard({ c, colorVar, onSelect }: { c: CardModel; colorVar: string; onSelect(lot: string): void }) {
  const fillW = c.progressPct != null ? Math.max(10, Math.min(100, c.progressPct)) : 100;
  return (
    <div className="m-card m-slim-card" data-lot={c.lot} onClick={() => onSelect(c.lot)}>
      <div className="m-slim-line-1">
        <span className="m-slim-lot">{c.lot}</span>
        <span className="m-slim-chip">{shortZoneLabel(c.zoneLabel)}</span>
      </div>
      <div className="m-slim-line-2">
        <span className="m-slim-status">{c.statusText || ''}</span>
        <span className="m-slim-qty">{c.qtyText || ''}</span>
      </div>
      {c.group === 'progress' && <div className="m-slim-progress" style={{ width: `${fillW}%`, background: `var(${colorVar})` }} />}
    </div>
  );
}

function BatchList({ bridge, onSelect, scrollEl }: { bridge: Bridge; onSelect(lot: string): void; scrollEl: HTMLElement }) {
  const [q, setQ] = useState(searchQuery);
  const batches = bridge.getBatches?.() || [];
  const now = new Date();
  const models = batches.map(b => {
    const zInfo = bridge.getBatchZoneInfo?.(b) ?? null;
    const model = buildBatchCardModel(b, zInfo, now, normalizeScheduleYears);
    // 아직 거치지 않은 공정의 손실(예: 포장 전 로트의 포장 손실)은 빼지 않는다 — PC 평면도와 같은 계산
    const qty = bridge.getBatchQtyForZone?.(b, zInfo?.zoneId);
    if (qty != null) model.qtyText = `${qty.toLocaleString()}개`;
    return model;
  });
  const group = groupByProcess<CardModel>;
  const baseGroups = group(models);
  const logisticsCount = models.filter(m => m.group === 'logistics' || m.zoneId === 'logistics').length;
  const hasSearch = Boolean(q.trim());
  const groups = hasSearch ? group(models.filter(m => m.lot.toLowerCase().includes(q.trim().toLowerCase()))) : baseGroups;
  const visible = groups.reduce((n, g) => n + (g.items?.length || 0), 0);

  const jump = (key: string) => {
    const target = scrollEl.querySelector(`#m-group-${key}`);
    if (!target) return;
    const top = target.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop;
    scrollEl.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  };

  return (
    <>
      <div style={{ marginBottom: 8 }}>
        <input type="search" className="m-input m-search-input" id="m-batch-search" placeholder="로트 번호 검색..." value={q}
          onChange={e => { searchQuery = e.target.value; setQ(e.target.value); }} />
      </div>
      {!hasSearch && (
        <div className="m-proc-chips-row">
          {baseGroups.slice(0, 5).map(g => {
            const count = g.items?.length || 0;
            return (
              <button key={g.key} className={`m-proc-chip ${count === 0 ? 'is-disabled' : ''}`} data-group-key={g.key} type="button"
                onClick={() => count && jump(g.key)}>
                <span className="m-proc-chip-dot" style={{ background: `var(${g.colorVar})` }} />
                <span>{g.name} {count}</span>
              </button>
            );
          })}
        </div>
      )}
      <div id="m-batch-card-list">
        {!batches.length ? <div className="m-card" style={{ textAlign: 'center', color: 'var(--pt-muted)', padding: '32px 16px' }}>등록된 배치가 없습니다</div>
          : hasSearch && !visible ? <div className="m-card" style={{ textAlign: 'center', color: 'var(--pt-muted)', padding: '24px 16px' }}>일치하는 로트가 없습니다</div>
          : groups.filter(g => g.items?.length).map(g => (
            <div key={g.key} className="m-proc-group" id={`m-group-${g.key}`}>
              <div className={g.after ? 'm-proc-group-header is-after' : 'm-proc-group-header'}>
                {!g.after && <span className="m-proc-group-dot" style={{ background: `var(${g.colorVar})` }} />}
                <span className="m-proc-group-title">{g.name} · {g.items.length}</span>
              </div>
              {g.items.map(m => <SlimCard key={m.lot} c={m} colorVar={g.colorVar} onSelect={onSelect} />)}
            </div>
          ))}
      </div>
      <div className="m-sub-line" style={{ justifyContent: 'center', padding: '14px 0 20px', color: 'var(--pt-muted)' }}>완제품 창고 {logisticsCount}건</div>
    </>
  );
}

export function renderBatchList(container: HTMLElement, bridge: Bridge, onSelectLot: (lot: string) => void): void {
  const scrollEl = document.getElementById('m-content-root') || container;
  mount(container, 'batch', <BatchList bridge={bridge} onSelect={onSelectLot} scrollEl={scrollEl} />);
}

const STEPS = [
  { key: 'A', name: '공정1' }, { key: 'B', name: '공정2' }, { key: 'C', name: '공정3' },
  { key: 'D', name: '공정4' }, { key: 'E', name: '공정5' }, { key: 'packaging', name: '포장' }
] as const;

const toDate = (v: unknown) => { if (!v) return null; const d = new Date(v as string); return isNaN(d.getTime()) ? null : d; };

function TimelineStep({ name, info, now }: { name: string; info: Record<string, any>; now: Date }) {
  const s = toDate(info.startDate || info.start), e = toDate(info.endDate || info.end);
  const st = !s && !e ? { dot: '', label: '예정' }
    : e && now >= e ? { dot: 'is-done', label: '완료' }
    : s && now >= s ? { dot: 'is-active', label: '진행 중' }
    : { dot: '', label: '예정' };
  const remain = st.label === '진행 중' && e ? ` · ${formatRemaining(e.getTime() - now.getTime())} 남음` : '';
  const dur = s && e ? `${Math.round((e.getTime() - s.getTime()) / 3600000)}시간` : '-';
  const note = info.remarks || info.notes;
  return (
    <div className="m-timeline-item">
      <div className={`m-timeline-dot ${st.dot}`} />
      <div className="m-timeline-body">
        <div className="m-timeline-title">{name} <span className="m-chip" style={{ fontSize: 11, padding: '1px 6px' }}>{st.label}{remain}</span></div>
        <div className="m-timeline-sub">{formatDateTime(s)} ~ {formatDateTime(e)} ({dur})</div>
        {info.machine && <div className="m-timeline-sub">호기: {info.machine}</div>}
        {note && <div className="m-timeline-sub">비고: {note}</div>}
      </div>
    </div>
  );
}

function BatchDetail({ lot, batch, bridge, onBack, onEdit, showBanner }: {
  lot: string; batch: Batch | undefined; bridge: Bridge; onBack(): void; onEdit(): void; showBanner: boolean;
}) {
  if (!batch) {
    return (
      <div className="m-card">배치를 찾을 수 없습니다: {lot}<br /><br />
        <button className="m-btn" id="m-detail-back" style={{ minHeight: 44 }} onClick={onBack}>목록으로</button>
      </div>
    );
  }
  const b = batch as Batch & Record<string, any>;
  const cq = bridge.calcBatchQuantities?.(batch);
  const qty = bridge.getBatchQtyForZone?.(batch, bridge.getBatchZoneInfo?.(batch)?.zoneId);
  const finalQty = qty != null ? qty.toLocaleString() + '개' : (b.quantity || '-');
  const bQty = cq?.actualB != null ? cq.actualB.toLocaleString() + '개' : '-';
  const lossSum = ['B', 'C', 'D', 'E', 'inspection', 'packaging'].reduce((n, k) => n + (cq?.losses?.[k] || 0), 0);
  const sch = (b.schedule || {}) as Record<string, Record<string, any> | undefined>;
  const hasSchedule = STEPS.some(s => { const o = sch[s.key]; return o && (o.startDate || o.start || o.endDate || o.end); });
  const note = b.remarks?.packaging || b.notes;
  const now = new Date();

  const applyTodo = (btn: HTMLButtonElement) => openScheduleConfirmSheet(() => handleApplySchedule(btn, bridge as Parameters<typeof handleApplySchedule>[1]));

  return (
    <>
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button className="m-btn" id="m-detail-back" style={{ padding: '6px 12px', minHeight: 44 }} onClick={onBack}>◀ 목록</button>
        <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--pt-text)' }}>{lot}</div>
        <button className="m-btn" id="m-batch-edit-btn" style={{ minHeight: 44, height: 44, color: 'var(--pt-accent)', border: '1px solid var(--pt-accent)', padding: '0 14px', fontWeight: 600 }} onClick={onEdit}>수정</button>
      </div>
      {showBanner && (
        <div id="m-time-change-banner" className="m-card" style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', marginBottom: 12, gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>공정 시각이 바뀌었어요. 할 일·알림에 반영하려면</span>
          <button className="m-btn m-btn-primary" id="m-banner-apply-todo" style={{ padding: '0 12px', fontSize: 13, minHeight: 44, height: 44, whiteSpace: 'nowrap', flexShrink: 0 }}
            onClick={e => applyTodo(e.currentTarget)}>일정 반영</button>
        </div>
      )}
      <div className="m-card">
        <div className="m-section-title" style={{ marginTop: 0 }}>공정 타임라인</div>
        <div className="m-timeline">
          {hasSchedule
            ? STEPS.map(s => <TimelineStep key={s.key} name={s.name} info={sch[s.key] || {}} now={now} />)
            : <div style={{ color: 'var(--pt-muted)', padding: '12px 0' }}>등록된 공정 일정이 없습니다</div>}
        </div>
      </div>
      <div className="m-card">
        <div className="m-section-title" style={{ marginTop: 0 }}>수량 요약</div>
        <div className="m-sub-line" style={{ marginBottom: 4 }}><span>공정2 기준 수량</span><span>{bQty}</span></div>
        <div className="m-sub-line" style={{ marginBottom: 4 }}><span>공정 차감 합계</span><span>{lossSum.toLocaleString()}개</span></div>
        <div className="m-sub-line" style={{ fontWeight: 700, color: 'var(--pt-accent)', fontSize: 15, marginTop: 6 }}><span>현재 수량</span><span>{finalQty}</span></div>
        {note && <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--pt-border)', fontSize: 13, color: 'var(--pt-muted)' }}>비고: {note}</div>}
      </div>
    </>
  );
}

export function renderBatchDetail(container: HTMLElement, lot: string, bridge: Bridge, onBack: () => void, showTimeBanner?: boolean): void {
  if (showTimeBanner !== undefined) timeChangedLot = showTimeBanner ? lot : null;
  const batch = (bridge.getBatches() || []).find(b => (b.lotNumber || (b as Record<string, any>).lot) === lot);
  const back = () => { timeChangedLot = null; onBack(); };
  const edit = () => openBatchEditSheet(lot, bridge, (newLot, timesChanged) => renderBatchDetail(container, newLot, bridge, onBack, timesChanged));
  mount(container, 'batch', <BatchDetail lot={lot} batch={batch} bridge={bridge} onBack={back} onEdit={edit} showBanner={timeChangedLot === lot} />);
}
