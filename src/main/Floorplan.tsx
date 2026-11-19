// 메인 평면도: 방 9개, 구역 칸의 배치 칩, 끌어서 옮기기, 설비 게이지, 칩 툴팁
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, DragEvent, ReactNode } from 'react';
import type { Batch } from '../batch/core';
import { MACHINE_ZONES, ZONES, inWarehouse, stepTime } from '../batch/zone';
import { batchQuantities, qtyForZone } from '../batch/quantity';
import { compareLots, productLine } from '../batch/lot';
import { zoneInfo } from './batches';
import { moveBatch } from './moves';
import { PM_LABELS, useManagers } from '../pm/managers';

type Badge = { text: string; short?: string; style: CSSProperties };
type Cell = { zone: string; kind: 'waiting' | 'process' | 'machine' | 'full'; title: string; desc?: string; badge?: Badge };
type Room = { id: string; name: string; pm?: string[]; tag?: [string, string, string]; cells: (Cell | Cell[])[] };

const proc = (p: string): CSSProperties => ({ background: `var(--proc-${p}-bg)`, color: `var(--proc-${p}-text)` });
const wait = (zone: string, desc = '이전 공정 종료 시 인계', title = '배치 대기 구역'): Cell => ({ zone, kind: 'waiting', title, desc });
const machines = (base: string, name: string, p: string): Cell[] => [1, 2].map(n =>
  ({ zone: `${base}-${n}`, kind: 'machine', title: '진행 구역', badge: { text: `${name} ${n}호기`, short: `${n}호기`, style: proc(p) } }));
const running = (zone: string, text: string, short: string | undefined, style: CSSProperties, title = '공정 진행 구역'): Cell =>
  ({ zone, kind: 'process', title, badge: { text, short, style } });

const ROOMS: Room[] = [
  { id: 'stage1', name: '공정1실', pm: ['p1_a', 'p1_b'], cells: [wait('stage1-wait', '공정 진행 전'), machines('stage1', '공정1 설비', 'a')] },
  { id: 'stage2', name: '공정2실', pm: ['p2_a', 'p2_b', 'p2_c'], cells: [wait('stage2-wait'), running('stage2', '공정2 라인', '라인', proc('b'))] },
  { id: 'stage3', name: '공정3실', pm: ['p3_a', 'p3_b'], cells: [wait('stage3-wait'), machines('stage3', '공정3 설비', 'c')] },
  { id: 'stage4', name: '공정4실', pm: ['p4_a', 'p4_b'], cells: [wait('stage4-wait'), machines('stage4', '공정4 설비', 'd')] },
  { id: 'stage5', name: '공정5실', pm: ['stage5'], cells: [wait('stage5-wait'), running('stage5', '공정5 머신', '설비', proc('e'))] },
  { id: 'semi-storage-pre', name: '반제품 보관실 (검사 전)', tag: ['보관 구역', '#0284c7', 'rgba(2, 132, 199, 0.4)'], cells: [{ zone: 'semi-storage-pre', kind: 'full', title: '보관 구역 (검사 전)', desc: '공정5 종료 시 자동 인계' }] },
  { id: 'inspection', name: '검사실', tag: ['전수 검사', '#34d399', 'rgba(16, 185, 129, 0.4)'], cells: [{ zone: 'inspection', kind: 'full', title: '이물 검사 구역', desc: '육안 및 자동 검사 진행' }] },
  { id: 'semi-storage-post', name: '반제품 보관실 (검사 후)', tag: ['포장 대기군', '#94a3b8', '#475569'], cells: [{ zone: 'semi-storage-post', kind: 'full', title: '보관 구역 (검사 합격품)', desc: '포장 공정 인계 전 대기' }] },
  { id: 'packaging', name: '포장실', pm: ['pk_a', 'pk_b'], cells: [wait('packaging-wait', '자재 준비 및 입고 대기', '포장 대기 구역'), running('packaging', '포장-A/포장-B', undefined, { background: 'rgba(5, 150, 105, 0.2)', color: '#34d399' }, '포장 진행 구역')] }
];

const openPm = (e: { stopPropagation(): void }) => { e.stopPropagation(); window.PmModal?.open(); };

// 좁은 화면에서는 설비 이름을 줄인다 (1호기·라인·설비)
const narrowMq = typeof matchMedia === 'function' ? matchMedia('(max-width: 1180px)') : null;
const useNarrow = () => useSyncExternalStore(f => { narrowMq?.addEventListener('change', f); return () => narrowMq?.removeEventListener('change', f); }, () => Boolean(narrowMq?.matches));

export interface FloorProps {
  batches: Batch[]; now: Date; selected: string | null; matches: (lot: string) => boolean;
  onSelect(b: Batch): void; onOpen(b: Batch): void;
}

export function Floorplan(p: FloorProps) {
  const narrow = useNarrow();
  const managers = useManagers();
  const [tip, setTip] = useState<{ batch: Batch; zone: string; el: HTMLElement } | null>(null);
  const byZone = new Map<string, Batch[]>();
  for (const b of p.batches) {
    const z = zoneInfo(b, p.now).zoneId;
    if (inWarehouse(b, z)) continue;
    byZone.set(z, [...(byZone.get(z) || []), b]);
  }
  const cell = (c: Cell) => (
    <ZoneCell key={c.zone} cell={c} narrow={narrow} gauge={MACHINE_ZONES[c.zone] && <Gauge zone={c.zone} batches={byZone.get(c.zone) || []} now={p.now} />}>
      {(byZone.get(c.zone) || []).sort((a, b) => compareLots(a.lotNumber, b.lotNumber)).map(b => (
        <Chip key={b.lotNumber} batch={b} zone={c.zone} {...p} onTip={el => setTip(el ? { batch: b, zone: c.zone, el } : null)} />
      ))}
    </ZoneCell>
  );
  return (
    <>
      {ROOMS.map(r => (
        <section key={r.id} className="process-room" id={`room-${r.id}`} data-room-id={r.id}>
          <header className="room-header">
            <div className="room-title-group"><span className="room-name">{r.name}</span></div>
            {r.pm ? (
              <div className="room-pm-badges" title="클릭하여 공정 담당자 변경" onClick={openPm}>
                {r.pm.map(k => {
                  const name = (managers[k] || '').trim(), label = PM_LABELS[k];
                  return (
                    <span key={k} className={`pm-badge-chip${name ? '' : ' is-empty'}`} id={`pm-badge-${k}`} data-pm-key={k}
                      title={name ? `${label}: ${name} (클릭하여 변경)` : `${label} 미지정 (클릭하여 변경)`}><span className="pm-badge-text">{name || label}</span></span>
                  );
                })}
              </div>
            ) : (
              <div className="room-pm-badges" onClick={openPm}><span className="pm-badge-chip" style={{ color: r.tag![1], borderColor: r.tag![2] }}>{r.tag![0]}</span></div>
            )}
          </header>
          <div className="room-body">
            {r.cells.map(c => (Array.isArray(c) ? <div key={c[0].zone} className="zone-cell-split">{c.map(cell)}</div> : cell(c)))}
          </div>
        </section>
      ))}
      <Tooltip tip={tip} now={p.now} />
    </>
  );
}

/** 칸에 배치를 놓으면 그 구역으로 옮긴다 (제자리면 아무것도 하지 않는다) */
export function useDropTarget(zone: string) {
  const [over, setOver] = useState(false);
  return {
    over,
    onDragOver: (e: DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(true); },
    onDragLeave: (e: DragEvent) => { if (!(e.currentTarget as Node).contains(e.relatedTarget as Node)) setOver(false); },
    onDrop: (e: DragEvent) => { e.preventDefault(); setOver(false); const lot = e.dataTransfer.getData('text/plain'); if (lot) moveBatch(lot, zone); }
  };
}

function ZoneCell({ cell: c, narrow, gauge, children }: { cell: Cell; narrow: boolean; gauge: ReactNode; children: ReactNode[] }) {
  const { over, ...drop } = useDropTarget(c.zone);
  return (
    <div className={`zone-cell cell-${c.kind}${over ? ' drag-over' : ''}`} data-zone-id={c.zone} {...drop}>
      <div className="cell-header">
        <span>{c.title}</span>
        {c.desc && <span className="cell-header-desc">{c.desc}</span>}
        {c.badge && <span className="cell-header-badge" style={c.badge.style}>{narrow && c.badge.short || c.badge.text}</span>}
      </div>
      {gauge}
      <div className="cell-content" id={`zone-content-${c.zone}`}>
        {children.length ? children : <div className="cell-empty-hint">비어 있음</div>}
      </div>
    </div>
  );
}

function Chip({ batch: b, zone, selected, matches, onSelect, onOpen, onTip }: FloorProps & { batch: Batch; zone: string; onTip(el: HTMLElement | null): void }) {
  const [dragging, setDragging] = useState(false);
  // 끌기를 마친 직후의 클릭은 선택으로 치지 않는다
  const dragEnded = useRef(0);
  const line = productLine(b.lotNumber);
  const qty = qtyForZone(b, zone);
  const show = (e: { currentTarget: HTMLElement }) => onTip(e.currentTarget);
  return (
    <div className={`batch-chip${b.lotNumber === selected ? ' is-selected' : ''}${matches(b.lotNumber) ? ' is-search-match' : ''}${dragging ? ' is-dragging' : ''}`}
      data-zone-id={zone} data-lot={b.lotNumber} draggable tabIndex={0} role="button" aria-label={`배치 ${b.lotNumber}`}
      onMouseEnter={show} onFocus={show} onMouseLeave={() => onTip(null)} onBlur={() => onTip(null)}
      onDoubleClick={e => { e.stopPropagation(); onOpen(b); }}
      onClick={e => { e.stopPropagation(); if (Date.now() - dragEnded.current > 200) onSelect(b); }}
      onDragStart={e => { e.dataTransfer.setData('text/plain', b.lotNumber); e.dataTransfer.effectAllowed = 'move'; setDragging(true); onTip(null); }}
      onDragEnd={() => { setDragging(false); dragEnded.current = Date.now(); }}>
      <div className="chip-accent-bar" style={{ backgroundColor: line.color, border: line.strokeWidth !== '0' ? `1px solid ${line.stroke}` : undefined }} />
      <div className="chip-inner">
        <div className="chip-header-line"><span className="chip-lot">{String(b.lotNumber || '').replace(/\s+/g, '') || '--'}</span></div>
        <span className="chip-qty">{qty != null && !isNaN(qty) ? `${Number(qty).toLocaleString()} EA` : '- EA'}</span>
      </div>
    </div>
  );
}

const hm = (d: Date) => d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });

/** 설비 가동 현황: 그 구역 첫 배치의 공정 시작~종료 대비 지금 */
export function gaugeState(zone: string, batches: Batch[], now: Date) {
  const conf = MACHINE_ZONES[zone];
  const b = batches[0];
  if (!b) return { lot: '-', text: '가동 대기', pct: 0, cls: 'is-idle', title: `${conf.name} 가동 대기 (진행 중인 배치 없음)` };
  const s = b.schedule?.[conf.step as keyof NonNullable<Batch['schedule']>];
  const start = stepTime(s, true, now), end = stepTime(s, false, now);
  const lot = `LOT ${b.lotNumber}`, head = `[${conf.name}] ${lot}`;
  if (!start || !end || end <= start) return { lot, text: '공정 진행 중', pct: 100, cls: 'is-running', title: `${head} 진행 중` };
  if (now < start) return { lot, text: `시작 ${Math.ceil((+start - +now) / 60000)}분 전`, pct: 0, cls: 'is-waiting', title: `${head} 시작 대기 (${hm(start)} 시작 예정)` };
  if (now >= end) return { lot, text: '100% (공정 완료)', pct: 100, cls: 'is-completed', title: `${head} 공정 완료 (${hm(end)} 완료)` };
  const pct = Math.round((+now - +start) / (+end - +start) * 100), left = Math.ceil((+end - +now) / 60000);
  return { lot, text: `${pct}% (${left}분 남음)`, pct, cls: 'is-running', title: `${head} 가동 중 (${pct}%, 잔여: ${left}분, 종료 예정: ${hm(end)})` };
}

function Gauge({ zone, batches, now }: { zone: string; batches: Batch[]; now: Date }) {
  const g = gaugeState(zone, batches, now);
  return (
    <div className="zone-gauge-bar-wrapper" id={`gauge-${zone}`} title={g.title}>
      <div className="zone-gauge-info"><span className="zone-gauge-lot">{g.lot}</span><span className="zone-gauge-text">{g.text}</span></div>
      <div className="zone-gauge-track"><div className={`zone-gauge-fill ${g.cls}`} style={{ width: `${g.pct}%` }} /></div>
    </div>
  );
}

// 툴팁의 '현재 수량': 구역마다 어느 공정 실적까지 반영된 수량인지 함께 적는다
const QTY_TEXT: [string[], [string, string?][], string][] = [
  [['stage2-wait'], [['actualB']], '시작 대기'],
  [['stage2'], [['actualB']], '미입력 (공정2 완료 후 실적 입력)'],
  [['stage3-wait'], [['actualBNet', ' (B완료)'], ['actualB']], '미입력'],
  [['stage3-1', 'stage3-2', 'stage3'], [['actualBNet', ' (진행 중, C차감 전)'], ['actualB', ' (진행 중, C차감 전)']], '미입력'],
  [['stage4-wait'], [['actualC', ' (C완료)'], ['actualBNet'], ['actualB']], '미입력'],
  [['stage4-1', 'stage4-2', 'stage4'], [['actualC', ' (진행 중, D차감 전)'], ['actualBNet'], ['actualB']], '미입력'],
  [['stage5-wait'], [['actualD', ' (D완료)'], ['actualC']], '미입력'],
  [['stage5'], [['actualD', ' (진행 중, E차감 전)'], ['actualC']], '미입력'],
  [['semi-discharge', 'semi-storage-pre'], [['actualE', ' (E완료)'], ['actualD']], '미입력'],
  [['inspection'], [['actualE', ' (검사 진행 중)'], ['actualD']], '미입력'],
  [['semi-storage-post', 'packaging-wait'], [['actualInspection', ' (검사 합격)'], ['actualE']], '미입력'],
  [['packaging'], [['actualPackaging', ' (완제품)'], ['actualInspection']], '미입력']
];

export function tooltipQty(b: Batch, zone: string): { text: string; pending: boolean } {
  if (zone.startsWith('stage1')) return { text: '공정1 진행 중', pending: false };
  const q = batchQuantities(b) as unknown as Record<string, number | null>;
  const fmt = (n: number) => `${n.toLocaleString()}개`;
  if (zone === 'logistics') {
    const n = q.actualPackaging ?? q.finalQty;
    return { text: n != null ? `완제품 ${fmt(n)}` : '완제품', pending: false };
  }
  const rule = QTY_TEXT.find(([zones]) => zones.includes(zone));
  if (!rule) return { text: q.finalQty != null ? fmt(q.finalQty) : '-', pending: false };
  const hit = rule[1].find(([k]) => q[k] != null);
  return hit ? { text: fmt(q[hit[0]]!) + (hit[1] || ''), pending: false } : { text: rule[2], pending: true };
}

const REMARK_STEP: Record<string, string> = { stage1: 'A', stage2: 'B', stage5: 'E', inspection: 'inspection', packaging: 'packaging' };
const remarkStep = (zone: string) => REMARK_STEP[zone] || (zone.includes('stage3') ? 'C' : zone.includes('stage4') ? 'D' : null);

function Tooltip({ tip, now }: { tip: { batch: Batch; zone: string; el: HTMLElement } | null; now: Date }) {
  const ref = useRef<HTMLDivElement>(null);
  // 칩 위(자리가 없으면 아래)에, 화면 안으로
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !tip) return;
    const c = tip.el.getBoundingClientRect(), t = el.getBoundingClientRect(), pad = 8;
    const left = Math.min(Math.max(pad, c.left + c.width / 2 - t.width / 2), innerWidth - t.width - pad);
    let top = c.top - t.height - 8;
    if (top < pad) top = c.bottom + 8;
    if (top + t.height > innerHeight - pad) top = innerHeight - t.height - pad;
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  });
  const b = tip?.batch;
  const info = b && zoneInfo(b, now);
  const zone = b ? ZONES[info!.zoneId || tip!.zone] || ZONES.stage1 : null;
  const zid = info?.zoneId || tip?.zone || '';
  const line = b && productLine(b.lotNumber);
  const qty = b && tooltipQty(b, zid);
  const rs = remarkStep(zid);
  const remark = b && rs ? (b.remarks?.[rs as keyof NonNullable<Batch['remarks']>] || (b.schedule as Record<string, { remarks?: string }> | undefined)?.[rs]?.remarks || '') : '';
  const label = { color: '#94a3b8' };
  return (
    <div id="batch-tooltip" ref={ref} className={`batch-tooltip${b ? '' : ' is-hidden'}`} role="tooltip" aria-hidden={!b}>
      <div className="batch-tooltip-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #334155', paddingBottom: 4, marginBottom: 6 }}>
        <span className="batch-tooltip-lot" id="tooltip-lot" style={{ fontWeight: 800, color: '#38bdf8', fontSize: 12 }}>
          {line && <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: line.color, border: line.strokeWidth !== '0' ? `1px solid ${line.stroke}` : undefined, marginRight: 5, verticalAlign: 'middle' }} />}
          {b ? b.lotNumber : '-'}
          {line && <span style={{ fontSize: '0.75rem', fontWeight: 600, color: line.badgeText, marginLeft: 4 }}> [{line.name}]</span>}
        </span>
        <span className="batch-tooltip-badge" id="tooltip-badge" style={zone ? { color: zone.color, borderColor: `${zone.color}88`, background: `${zone.color}25`, fontSize: 9, padding: '1px 5px', borderRadius: 3 } : undefined}>{info?.badgeText || zone?.badge}</span>
      </div>
      <div className="batch-tooltip-body" style={{ fontSize: 11, color: '#cbd5e1', lineHeight: 1.4 }}>
        <div className="tooltip-row"><span className="tooltip-label" style={label}>진행 공정:</span> <strong id="tooltip-process" className="tooltip-val">{info?.statusDesc || zone?.name}</strong></div>
        <div className="tooltip-row"><span className="tooltip-label" style={label}>현재 수량:</span> <strong id="tooltip-qty" className="tooltip-val" style={{ color: qty?.pending ? '#94a3b8' : '#38bdf8', fontWeight: 700 }}>{qty?.text}</strong></div>
        <div className="tooltip-row"><span className="tooltip-label" style={label}>위치/설비:</span> <span id="tooltip-location" className="tooltip-val">{zone?.name}</span></div>
        <div className="tooltip-row"><span className="tooltip-label" style={label}>공정 일정:</span> <span id="tooltip-time" className="tooltip-val">{b && <TooltipTime b={b} zone={zid} />}</span></div>
        {remark && <div className="tooltip-row" id="tooltip-remarks-row" style={{ display: 'flex' }}><span className="tooltip-label" style={label}>특이사항:</span> <span id="tooltip-remarks" className="tooltip-val" style={{ color: '#fcd34d' }}>{remark}</span></div>}
      </div>
      <div className="batch-tooltip-footer" style={{ marginTop: 6, borderTop: '1px dashed #334155', paddingTop: 4, fontSize: 9, color: '#64748b' }}>
        <span className="tooltip-hint">🖱️ 더블클릭하여 배치 상세 스케줄 확인</span>
      </div>
    </div>
  );
}

function TooltipTime({ b, zone }: { b: Batch & { completed_at?: string; overallEndFriendly?: string; overallStartFriendly?: string; timeRange?: string }; zone: string }) {
  const note = (color: string, text: string) => <div style={{ fontSize: '0.75rem', color, padding: '2px 0' }}>{text}</div>;
  if (zone === 'logistics') return note('#34d399', `📦 완제품 출고 완료 (${b.completed_at ? new Date(b.completed_at).toLocaleString('ko-KR') : (b.overallEndFriendly || '-')})`);
  if (b.manualZone) return note('#94a3b8', '📍 사용자에 의해 수동 배치된 구역');
  return <>{b.timeRange || (b.overallStartFriendly ? `${b.overallStartFriendly} ~ ${b.overallEndFriendly}` : '-')}</>;
}
