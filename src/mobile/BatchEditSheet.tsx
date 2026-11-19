// 모바일 배치 정보 수정 시트. 계산·검사·저장 규칙은 PC와 같은 src/batch/core.ts와 batchSync만 쓴다
import { batchSync } from '../main/batches';
import { ZONES } from '../batch/zone';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { applyBatchEdit, calcQuantities, hasConflict, unsanitizeInput, validateEdit } from '../batch/core';
import type { Batch, BatchEdit, LossKey, RemarkKey, StepKey } from '../batch/core';
import { showToast } from './toast';
import { pushAudit } from '../main/audit';

const STEP_KEYS: StepKey[] = ['A', 'B', 'C', 'D', 'E', 'packaging'];
const REMARK_KEYS: RemarkKey[] = ['A', 'B', 'C', 'D', 'E', 'inspection', 'packaging'];
const STEP_LABELS: Record<StepKey, string> = { A: '공정1', B: '공정2', C: '공정3', D: '공정4', E: '공정5', packaging: '포장' };
const STEP_DOTS: Record<StepKey, string> = { A: '#0D9488', B: '#DC2626', C: '#7C3AED', D: '#F59E0B', E: '#2563EB', packaging: '#059669' };
type NetKey = 'B' | 'BNet' | 'C' | 'D' | 'E' | 'inspection' | 'packaging';
// 차감과 인계 실수량은 서로 연동된다. 저장되는 값은 차감이다
const QTY_ROWS: { id: LossKey; name: string; net: NetKey; prev: NetKey }[] = [
  { id: 'B', name: '공정2 후', net: 'BNet', prev: 'B' },
  { id: 'C', name: '공정3', net: 'C', prev: 'BNet' },
  { id: 'D', name: '공정4', net: 'D', prev: 'C' },
  { id: 'E', name: '공정5', net: 'E', prev: 'D' },
  { id: 'inspection', name: '검사', net: 'inspection', prev: 'E' },
  { id: 'packaging', name: '포장', net: 'packaging', prev: 'inspection' }
];

type Times = Record<StepKey, { start: string; end: string }>;
type Zones = Record<string, { name?: string }>;

/** datetime-local 입력칸 값(YYYY-MM-DDTHH:mm, 기기 시간대) */
function toLocalInput(val: unknown): string {
  if (!val) return '';
  const d = val instanceof Date ? val : new Date(val as string);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v));

function initialTimes(b: Batch): Times {
  const out = {} as Times;
  for (const k of STEP_KEYS) {
    const s = b.schedule?.[k] || {};
    out[k] = { start: toLocalInput(s.startDate || s.start), end: toLocalInput(s.endDate || s.end) };
  }
  return out;
}

function describeChanges(orig: Batch, edit: BatchEdit, times: Times): string {
  const diffs: string[] = [];
  if (edit.lotNumber !== orig.lotNumber) diffs.push('로트넘버');
  if (edit.zoneId && edit.zoneId !== edit.fromZoneId) diffs.push('위치');
  if (edit.qtyB !== (orig.quantities?.B ?? orig.qtyB)) diffs.push('수량');
  const before = initialTimes(orig);
  if (STEP_KEYS.some(k => before[k].start !== times[k].start || before[k].end !== times[k].end)) diffs.push('공정 시각');
  if (REMARK_KEYS.some(k => (edit.remarks?.[k] || '') !== unsanitizeInput(orig.remarks?.[k]))) diffs.push('비고');
  return diffs.join(', ') || '내용 수정';
}

interface Props { batch: Batch; zones: Zones; curZone: string; bridge: MobileBridgeLike; onSaved: (lot: string, timesChanged: boolean) => void; close: () => void }

function BatchEditSheet({ batch, zones, curZone, bridge, onSaved, close }: Props) {
  const q0 = batch.quantities || {}, l0 = q0.losses || batch.lossQuantities || {};
  const [lot, setLot] = useState(batch.lotNumber || '');
  const [zone, setZone] = useState(curZone);
  const [qtyB, setQtyB] = useState(String(q0.B ?? batch.qtyB ?? ''));
  const [losses, setLosses] = useState(() => Object.fromEntries(QTY_ROWS.map(r => [r.id, l0[r.id] != null ? String(l0[r.id]) : ''])) as Record<LossKey, string>);
  const [times, setTimes] = useState(() => initialTimes(batch));
  // 저장된 비고는 한 번 변환된 글자다: 입력칸에는 원래 글자로 넣어야 저장할 때 또 변환되지 않는다
  const [remarks, setRemarks] = useState(() => Object.fromEntries(REMARK_KEYS.map(k => [k, unsanitizeInput(batch.remarks?.[k] || (k !== 'inspection' ? batch.schedule?.[k as StepKey]?.remarks : ''))])) as Record<RemarkKey, string>);
  // 입력 중인 인계 실수량 칸은 계산값으로 덮어쓰지 않는다
  const [typingNet, setTypingNet] = useState<{ id: LossKey; text: string } | null>(null);
  const [error, setError] = useState('');
  const [snapshot] = useState(() => JSON.parse(JSON.stringify(batch)) as Batch);

  const q = calcQuantities(qtyB.trim(), Object.fromEntries(QTY_ROWS.map(r => [r.id, numOrNull(losses[r.id])]))).quantities;

  function onNetInput(row: typeof QTY_ROWS[number], raw: string) {
    setTypingNet({ id: row.id, text: raw });
    const prev = q[row.prev];
    setLosses({ ...losses, [row.id]: raw.trim() === '' || prev == null ? '' : String(prev - Number(raw)) });
  }

  async function save() {
    setError('');
    const edit: BatchEdit = {
      lotNumber: lot.trim(),
      zoneId: zone,
      fromZoneId: curZone,
      qtyB: numOrNull(qtyB),
      losses: Object.fromEntries(QTY_ROWS.map(r => [r.id, numOrNull(losses[r.id])])),
      times: Object.fromEntries(STEP_KEYS.map(k => [k, { start: times[k].start ? new Date(times[k].start) : null, end: times[k].end ? new Date(times[k].end) : null }])),
      remarks: Object.fromEntries(REMARK_KEYS.map(k => [k, remarks[k].trim()]))
    };
    const errors = validateEdit(edit, batch, bridge.getBatches());
    if (errors.length) { setError(errors[0]); return; }

    // PC와 같은 저장 창구: 차례가 오면 서버 최신 목록을 읽어 이 로트만 바꿔 쓴다
    const res = await batchSync.commit(batch.lotNumber, latest => {
      if (hasConflict(snapshot, latest)) throw new Error('다른 곳에서 먼저 수정했어요. 닫고 다시 열어 주세요');
      return applyBatchEdit(latest!, edit, new Date());
    });
    if (!res.success) {
      setError(res.message || '');
      showToast(res.message || '');
      return;
    }
    const before = initialTimes(batch);
    onSaved(edit.lotNumber!, STEP_KEYS.some(k => before[k].start !== times[k].start || before[k].end !== times[k].end));
    pushAudit({
      zone: '모바일', action: '배치 수정', item: edit.lotNumber!,
      from: zones[curZone]?.name || curZone || '공정 구역', to: zones[zone]?.name || zone || '공정 구역',
      detail: describeChanges(batch, edit, times)
    });
    close();
    showToast('저장했어요', true);
  }

  const stepCard = (key: RemarkKey, label: string, color: string, withTimes: boolean) => (
    <div key={key} className="m-card" style={{ padding: '10px 12px', marginBottom: 8, borderLeft: `4px solid ${color}` }}>
      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--pt-text)', marginBottom: 6 }}>{label}</div>
      {withTimes && (
        <div className="m-step-times">
          {(['start', 'end'] as const).map(type => (
            <div key={type} className="m-step-time-row">
              <span className="m-step-time-label">{type === 'start' ? '시작' : '종료'}</span>
              <input type="datetime-local" className="m-input m-edit-time" id={`m-edit-${type}-${key}`}
                value={times[key as StepKey][type]}
                onChange={e => setTimes({ ...times, [key]: { ...times[key as StepKey], [type]: e.target.value } })} />
            </div>
          ))}
        </div>
      )}
      <div>
        <input type="text" className="m-input m-edit-remark" id={`m-edit-remarks-${key}`}
          placeholder={key === 'inspection' ? '검사 비고 (최대 200자)' : '비고 (최대 200자)'}
          value={remarks[key]} onChange={e => setRemarks({ ...remarks, [key]: e.target.value })} />
      </div>
    </div>
  );

  return (
    <div className="m-sheet-container" style={{ maxHeight: '85vh', overflowY: 'auto' }}>
      <div className="m-sheet-header">
        <span className="m-sheet-title">배치 정보 수정</span>
        <button className="m-btn" id="m-edit-close" style={{ padding: '6px 12px' }} onClick={close}>닫기</button>
      </div>
      <div id="m-sheet-err" style={{ color: 'var(--pt-danger)', fontSize: 14, fontWeight: 600, marginBottom: 10, display: error ? 'block' : 'none' }}>{error}</div>
      <div className="m-form-group">
        <label className="m-form-label">로트넘버</label>
        <input type="text" className="m-input" id="m-edit-lot" value={lot} onChange={e => setLot(e.target.value)} />
      </div>
      <div className="m-form-group">
        <label className="m-form-label">위치</label>
        <select className="m-select" id="m-edit-zone" value={zone} onChange={e => setZone(e.target.value)}>
          {Object.entries(zones).map(([id, z]) => <option key={id} value={id}>{z.name || id}</option>)}
        </select>
      </div>
      <div className="m-form-group">
        <label className="m-form-label">수량</label>
        <div className="m-qty-table">
          <label className="m-qty-step" htmlFor="m-edit-qty-B">공정2 수량</label>
          <input type="number" inputMode="numeric" className="m-input m-qty-base" id="m-edit-qty-B" value={qtyB} onChange={e => setQtyB(e.target.value)} />
          <span className="m-qty-hint" id="m-qty-hint" hidden={q.B != null}>공정2 수량을 입력하면 인계 실수량을 입력할 수 있어요</span>
          <span></span><span className="m-qty-head">차감</span><span className="m-qty-head">인계 실수량</span>
          {QTY_ROWS.map(r => {
            const net = q[r.net];
            return [
              <span key={`${r.id}-n`} className="m-qty-step">{r.name}</span>,
              <input key={`${r.id}-l`} type="number" inputMode="numeric" className="m-input m-edit-loss" id={`m-edit-loss-${r.id}`} aria-label={`${r.name} 차감`}
                value={losses[r.id]} onChange={e => setLosses({ ...losses, [r.id]: e.target.value })} />,
              <input key={`${r.id}-v`} type="number" inputMode="numeric" className="m-input m-edit-net" id={`m-edit-net-${r.id}`} aria-label={`${r.name} 인계 실수량`}
                disabled={net == null}
                value={typingNet?.id === r.id ? typingNet.text : (net != null ? String(net) : '')}
                onChange={e => onNetInput(r, e.target.value)} onBlur={() => setTypingNet(null)} />
            ];
          })}
        </div>
      </div>
      <div className="m-form-group">
        <label className="m-form-label">공정 일정 및 비고</label>
        {STEP_KEYS.map(k => stepCard(k, STEP_LABELS[k], STEP_DOTS[k] || '#64748b', true))}
        {stepCard('inspection', '검사', '#10b981', false)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
        <button className="m-btn m-btn-primary" id="m-batch-edit-save" style={{ width: '100%', height: 48 }} onClick={save}>저장</button>
        <button className="m-btn" id="m-batch-edit-cancel" style={{ width: '100%', height: 44 }} onClick={close}>취소</button>
      </div>
    </div>
  );
}

/** 모바일 배치 상세의 [수정] 버튼이 부른다 */
export function openBatchEditSheet(lot: string, bridge: MobileBridgeLike, onSaved: (lot: string, timesChanged: boolean) => void): void {
  const batch = (bridge.getBatches() || []).find(b => b.lotNumber === lot);
  if (!batch) return;
  const zones: Zones = bridge.getZones?.() || ZONES;
  // 위치 칸은 화면에 보이는 위치(스케줄 자동 진행 반영)로 채운다. PC 평면도와 같은 값
  const curZone = bridge.getBatchZoneInfo?.(batch)?.zoneId || batch.manualZone || batch.assignedZone || 'packaging';
  const host = document.createElement('div');
  host.className = 'm-sheet-backdrop';
  document.body.appendChild(host);
  const root = createRoot(host);
  const close = () => { root.unmount(); host.remove(); };
  root.render(<BatchEditSheet batch={batch} zones={zones} curZone={curZone} bridge={bridge} onSaved={onSaved} close={close} />);
}
