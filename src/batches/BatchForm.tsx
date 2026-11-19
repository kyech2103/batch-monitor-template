// PC 배치 등록·수정 화면. 메인 화면의 배치 창 안과 새 창(sub_batches)에 같은 것을 띄운다. 저장은 batchSync.commit
// 계산은 src/batch/form.ts, 템플릿 서버 행은 batches 표 id=batch_templates
import { Fragment, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { LOT_REGEX, unsanitizeInput } from '../batch/core';
import type { Batch, LossKey } from '../batch/core';
import { productLine } from '../batch/lot';
import {
  DEFAULT_DURS, DEFAULT_MACHINES, LOSS_KEYS, PROCS, REMARK_KEYS, buildRecord, defaultTemplates, defaultTimes, fmtDur, fmtFriendly,
  fmtMMDDHHMM, formQuantities, lossesFromBatch, machinesFromBatch, parseMMDDHHMM, readableLabel, scheduleFromForm,
  syncTimeFields, templateFromForm, timesFromBatch, timesFromTemplate
} from '../batch/form';
import type { FormLosses, FormRemarks, FormTimes, Machines, Template, TimeFields, TimeStep } from '../batch/form';
import type { Channel } from '../supabase';
import { sb } from '../sb';
import { batchSync, readBatches, useBatches } from '../main/batches';
import { pushAudit, type AuditEntry } from '../main/audit';

const TPL_STORAGE_KEY = 'APP_BATCH_TEMPLATES';
const EDIT_LOT_KEY = 'APP_CURRENT_EDIT_LOT';
type Modal = 'history' | 'preview' | 'tpl-save' | 'tpl-load' | null;

let toastTimer: ReturnType<typeof setTimeout>;
export function toast(msg: string, type: 'info' | 'error' | 'success' = 'info') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3500);
}

const readJson = <T,>(key: string, fallback: T): T => { try { return JSON.parse(localStorage.getItem(key) || '') ?? fallback; } catch { return fallback; } };
const localBatches = readBatches;
const focus = (id: string) => setTimeout(() => document.getElementById(id)?.focus(), 0);
const emptyLosses = (): FormLosses => Object.fromEntries(LOSS_KEYS.map(k => [k, ''])) as FormLosses;
const emptyRemarks = (): FormRemarks => Object.fromEntries(REMARK_KEYS.map(k => [k, ''])) as FormRemarks;
const blankTimes = (): FormTimes => Object.fromEntries(PROCS.map(p => [p.id, { start: '', dur: DEFAULT_DURS[p.id], end: '' }])) as FormTimes;
const qtyText = (v: number | null) => (v != null ? Number(v).toLocaleString() + '개' : '-');
const hm = (m?: number) => (m ? `${Math.floor(m / 60)}h${m % 60 ? (m % 60) + 'm' : ''}` : '');

function currentAuthor(userEmail: string): string {
  if (userEmail) return userEmail;
  const op = readJson<{ name?: string; display?: string } | null>('APP_VERIFIED_OPERATOR', null);
  return op?.name || op?.display || '작업자';
}

/** 서버 템플릿이 오기 전에는 이 기기에 남긴 목록, 그것도 없으면 기본 템플릿 */
function cachedTemplates(): Template[] {
  const saved = readJson<Template[] | null>(TPL_STORAGE_KEY, null);
  if (Array.isArray(saved) && saved.length) return saved;
  const defs = defaultTemplates();
  try { localStorage.setItem(TPL_STORAGE_KEY, JSON.stringify(defs)); } catch { /* 저장 실패해도 화면은 쓴다 */ }
  return defs;
}

const CHIPS: Record<TimeStep, [string, string][]> = {
  A: [['0030', '+30m'], ['0100', '+1h'], ['0200', '+2h'], ['0400', '+4h'], ['0800', '+8h']],
  B: [['0100', '+1h'], ['0200', '+2h'], ['0300', '+3h'], ['0400', '+4h'], ['0600', '+6h']],
  C: [['1200', '+12h'], ['1800', '+18h'], ['2400', '+24h'], ['3600', '+36h'], ['4800', '+48h']],
  D: [['0100', '+1h'], ['0130', '+1.5h'], ['0200', '+2h'], ['0300', '+3h'], ['0400', '+4h']],
  E: [['0030', '+30m'], ['0100', '+1h'], ['0130', '+1.5h'], ['0200', '+2h'], ['0300', '+3h']],
  packaging: [['0100', '+1h'], ['0200', '+2h'], ['0400', '+4h'], ['0800', '+8h']]
};
const CARDS: { id: Exclude<TimeStep, 'packaging'>; cls: string; icon: string; ph: [string, string, string] }[] = [
  { id: 'A', cls: 'pa', icon: '🏢', ph: ['09171400', '0200', '09171600'] },
  { id: 'B', cls: 'pb', icon: '🏢', ph: ['09171700', '0300', '09172000'] },
  { id: 'C', cls: 'pc', icon: '🔧', ph: ['09172030', '2400', '09182030'] },
  { id: 'D', cls: 'pd', icon: '🏢', ph: ['09182100', '0200', '09182300'] },
  { id: 'E', cls: 'pe', icon: '🏢', ph: ['09182330', '0130', '09190100'] }
];
// 차감 칸 → 인계 실수량 칸 (옛 화면 id 그대로)
const QTY_ITEMS: { key: LossKey; badge: string; badgeCls: string; title: string; ph: string; netId: string; netLabel: string; aria: string; net: 'BNet' | 'C' | 'D' | 'E' | 'inspection' | 'packaging'; prev: 'B' | 'BNet' | 'C' | 'D' | 'E' | 'inspection' }[] = [
  { key: 'B', badge: '공정2 차감', badgeCls: 'qb-b-loss', title: '공정2실', ph: '차감(Loss)', netId: 'disp-actual-B-net', netLabel: '인계 실수량:', aria: '공정2 실수량', net: 'BNet', prev: 'B' },
  { key: 'C', badge: '공정3 차감', badgeCls: 'qb-c', title: '공정3실', ph: '차감(Loss)', netId: 'disp-actual-C', netLabel: '인계 실수량:', aria: '공정3 실수량', net: 'C', prev: 'BNet' },
  { key: 'D', badge: '공정4 차감', badgeCls: 'qb-d', title: '공정4실', ph: '차감(Loss)', netId: 'disp-actual-D', netLabel: '인계 실수량:', aria: '공정4 실수량', net: 'D', prev: 'C' },
  { key: 'E', badge: '공정5 차감', badgeCls: 'qb-e', title: '공정5실', ph: '차감(Loss)', netId: 'disp-actual-E', netLabel: '인계 실수량:', aria: '공정5 실수량', net: 'E', prev: 'D' },
  { key: 'inspection', badge: '검사 차감', badgeCls: 'qb-inspect', title: '검사실', ph: '불량 차감', netId: 'disp-actual-inspection', netLabel: '검사합격:', aria: '검사 합격 수량', net: 'inspection', prev: 'E' },
  { key: 'packaging', badge: '포장 공정 차감', badgeCls: 'qb-pkg', title: '포장실', ph: '포장 차감', netId: 'disp-actual-packaging', netLabel: '최종완제품:', aria: '최종 완제품 수량', net: 'packaging', prev: 'inspection' }
];

interface Props {
  allowed: boolean;
  /** 메인 화면 창 안에 띄울 때: 열 때마다 바뀌는 값(n)과 불러올 로트(null이면 새로 쓰기) */
  open?: { lot: string | null; n: number };
  /** 저장·삭제가 되면 (메인 화면은 창을 닫는다) */
  onSaved?(): void;
}

export function BatchForm(props: Props) {
  const { allowed } = props;
  const { batches } = useBatches();
  const [isEdit, setIsEdit] = useState(false);
  const [editLot, setEditLot] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [lot, setLot] = useState('');
  const [machines, setMachines] = useState<Machines>({ ...DEFAULT_MACHINES });
  const [times, setTimes] = useState<FormTimes>(() => defaultTimes(new Date()));
  const [qtyB, setQtyB] = useState('');
  const [losses, setLosses] = useState<FormLosses>(emptyLosses);
  const [remarks, setRemarks] = useState<FormRemarks>(emptyRemarks);
  const [typingNet, setTypingNet] = useState<{ key: LossKey; text: string } | null>(null);
  const [activeTpl, setActiveTpl] = useState<Template | null>(null);
  const [templates, setTemplates] = useState<Template[]>(cachedTemplates);
  const [modal, setModal] = useState<Modal>(null);
  const [tplName, setTplName] = useState('');
  const historyCount = batches.length;
  const saving = useRef(false);
  const channelRef = useRef<Channel | null>(null);

  const form = scheduleFromForm(times, machines, remarks);
  const q = formQuantities(qtyB, losses);

  function resetForm() {
    setLot('');
    setTimes(blankTimes());
    setQtyB('');
    setLosses(emptyLosses());
    setRemarks(emptyRemarks());
    setMachines({ ...DEFAULT_MACHINES });
    setActiveTpl(null);
  }

  function setCreateMode() {
    try { localStorage.removeItem(EDIT_LOT_KEY); } catch { /* 없어도 된다 */ }
    setIsEdit(false);
    setEditLot(null);
    setCreatedAt(null);
    resetForm();
    setTimes(defaultTimes(new Date()));
  }

  function loadForEdit(arg: Batch | string) {
    let batch = typeof arg === 'string' ? (localBatches().find(b => b.lotNumber === arg) || { lotNumber: arg }) : arg;
    if (typeof arg !== 'string' && batch.lotNumber && !batch.schedule) {
      const found = localBatches().find(b => b.lotNumber === batch.lotNumber);
      if (found) batch = { ...found, ...batch };
    }
    setIsEdit(true);
    setEditLot(batch.lotNumber);
    try { localStorage.setItem(EDIT_LOT_KEY, batch.lotNumber); } catch { /* 없어도 된다 */ }
    setCreatedAt(typeof batch.createdAt === 'string' ? batch.createdAt : null);
    setLot(batch.lotNumber);
    setTimes(timesFromBatch(batch));
    setMachines(machinesFromBatch(batch));
    setQtyB(String(batch.quantities?.B ?? batch.qtyB ?? ''));
    setLosses(lossesFromBatch(batch));
    setRemarks(Object.fromEntries(REMARK_KEYS.map(k => [k, unsanitizeInput(batch.remarks?.[k])])) as FormRemarks);
    toast(`로트 [${batch.lotNumber}] 정보를 불러왔습니다. 수정 후 저장하세요.`, 'info');
  }

  /** 저장: 서버 최신 목록에서 이 로트만 바꿔 쓰고, 되면 작업 이력을 남긴다 */
  async function saveBatch(lot: string | null, change: (b: Batch | null) => Batch | null, audit: AuditEntry, onSaved: () => void) {
    if (saving.current) return;
    saving.current = true;
    const res = await batchSync.commit(lot, change).finally(() => { saving.current = false; });
    if (!res.success) return toast(`⚠️ ${res.message}`, 'error');
    pushAudit(audit);
    onSaved();
    props.onSaved?.();
  }

  // 메인 화면이 창을 열 때마다(open.n) 그 로트를 불러오거나 새로 쓰기
  const handlers = useRef({ loadForEdit, setCreateMode });
  handlers.current = { loadForEdit, setCreateMode };
  useEffect(() => {
    if (!props.open) return;
    if (props.open.lot) handlers.current.loadForEdit(props.open.lot);
    else handlers.current.setCreateMode();
  }, [props.open]);

  async function fetchTemplates() {
    try {
      const { data, error } = await sb.from('batches').select('data').eq('id', 'batch_templates').single();
      if (error && error.code !== 'PGRST116') console.warn('[Supabase] fetchTemplatesData warning:', error);
      if (Array.isArray(data?.data) && data.data.length) {
        setTemplates(data.data);
        localStorage.setItem(TPL_STORAGE_KEY, JSON.stringify(data.data));
      } else if (Array.isArray(data?.data)) {
        // 서버에 행은 있는데 비었으면 기본 템플릿을 넣는다
        const defs = defaultTemplates();
        setTemplates(defs);
        localStorage.setItem(TPL_STORAGE_KEY, JSON.stringify(defs));
        upsertTemplates(defs, '시스템').then(null, () => {});
      }
    } catch (e) {
      console.warn('[Templates] fetch error, using cache:', e);
    }
  }
  const fetchRef = useRef(fetchTemplates);
  fetchRef.current = fetchTemplates;

  // 로그인 확인 뒤: (새 창이면) 주소나 지난번에 고친 로트 불러오기, 템플릿 읽기·실시간 신호
  useEffect(() => {
    if (!allowed) return;
    if (!props.open) {
      let stored: string | null = null;
      try { stored = localStorage.getItem(EDIT_LOT_KEY); } catch { /* 없어도 된다 */ }
      const target = new URLSearchParams(location.search).get('editLot') || stored;
      if (target) handlers.current.loadForEdit(target);
      else handlers.current.setCreateMode();
    }

    let timer: ReturnType<typeof setTimeout>;
    // 실시간 방송 채널은 공개 키만 있으면 누구나 보낼 수 있다: 내용은 쓰지 않고 신호로만 받아 서버에서 다시 읽는다
    channelRef.current = sb.channel('batch-templates-realtime', { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'BATCH_TEMPLATES_UPDATED' }, () => { clearTimeout(timer); timer = setTimeout(() => fetchRef.current(), 300); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'batches', filter: 'id=eq.batch_templates' }, payload => {
        if (Array.isArray(payload.new?.data)) {
          setTemplates(payload.new.data);
          localStorage.setItem(TPL_STORAGE_KEY, JSON.stringify(payload.new.data));
        }
      })
      .subscribe();
    fetchRef.current();
    const onVisible = () => { if (!document.hidden) fetchRef.current(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [allowed]);

  function upsertTemplates(list: Template[], author: string) {
    return sb.from('batches').upsert({ id: 'batch_templates', data: list, updated_at: new Date().toISOString(), updated_by: author });
  }
  function broadcastTemplates() {
    channelRef.current?.send({ type: 'broadcast', event: 'BATCH_TEMPLATES_UPDATED', payload: {} }).catch(() => {});
  }

  // ── 시각 칸 ──
  function applyTemplateStart(startA: string, next: FormTimes): boolean {
    if (!activeTpl) return false;
    const t = timesFromTemplate(activeTpl, next, startA);
    if (!t) return false;
    setTimes(t);
    toast(`✨ [${activeTpl.name}] 기준 공정1~공정5 전체 일정이 자동 완성되었습니다!`, 'info');
    return true;
  }
  function editTime(step: TimeStep, field: keyof TimeFields, value: string) {
    const next = { ...times, [step]: { ...times[step], [field]: value } };
    if (step === 'A' && field === 'start' && value.trim().length === 8 && parseMMDDHHMM(value.trim()) && applyTemplateStart(value, next)) return;
    setTimes({ ...next, [step]: syncTimeFields(next[step], field) });
  }

  function onNetInput(item: typeof QTY_ITEMS[number], raw: string) {
    setTypingNet({ key: item.key, text: raw });
    setLosses({ ...losses, [item.key]: raw.trim() === '' ? '' : String((q[item.prev] ?? 0) - Number(raw)) });
  }

  function chooseMachine(step: keyof Machines, m: string) {
    setMachines({ ...machines, [step]: m });
    toast(`${PROCS.find(p => p.id === step)?.name || step} 설비: [${m}] 선택`, 'info');
  }

  // ── 저장·삭제 ──
  function submit() {
    const rawLot = lot.trim();
    if (!rawLot) { toast('로트 넘버를 입력해주세요.', 'error'); return focus('inp-lot'); }
    if (!LOT_REGEX.test(rawLot)) { toast('보안 경고: 로트 넘버에 유효하지 않은 특수문자가 포함되어 있습니다.', 'error'); return focus('inp-lot'); }
    const startA = times.A.start.trim();
    if (!startA) { toast('공정1 시작 시점(MMDDHHMM)을 입력해주세요.', 'error'); return focus('start-A'); }
    const record = buildRecord({ lot: rawLot, startA, isEdit, originalCreatedAt: createdAt, now: new Date(), form, machines, qtyB, losses, remarks });
    const wasEdit = isEdit;
    const audit = wasEdit
      ? { zone: '배치 공정', action: '배치 정보 수정', item: record.lotNumber, from: '-', to: '-', detail: `배치 공정/설비 정보 수정: ${record.lotNumber}` }
      : { zone: '배치 공정', action: '배치 등록', item: record.lotNumber, from: '-', to: '공정1 (시작)', detail: `신규 제조 배치 등록: ${record.lotNumber}` };
    saveBatch(wasEdit ? editLot : null, old => ({ ...old, ...record } as Batch), audit, () => {
      toast(`✅ [${wasEdit ? '수정 완료' : '등록 완료'}] 로트 [${rawLot}] 배치가 성공적으로 ${wasEdit ? '수정' : '등록'}되었습니다!`, 'success');
      if (!wasEdit) resetForm();
      else setCreateMode();
    });
  }

  function deleteBatch() {
    if (!isEdit || !editLot) return;
    if (!confirm(`정말로 로트 [${editLot}] 배치를 삭제하시겠습니까?\n평면도에서도 제거됩니다.`)) return;
    const target = editLot;
    saveBatch(target, () => null, { zone: '배치 공정', action: '배치 삭제', item: target, from: '-', to: '-', detail: `[${target}] 배치 삭제됨` }, () => {
      toast(`로트 [${target}] 배치가 삭제되었습니다.`, 'info');
      setCreateMode();
    });
  }

  function autoLot() {
    const d = new Date();
    const v = `LOT-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${Math.floor(Math.random() * 90) + 10}`;
    setLot(v);
    toast(`로트 넘버 [${v}] 자동 생성됨`, 'info');
  }

  // ── 템플릿 ──
  function openTemplateSave() {
    if (!parseMMDDHHMM(times.A.start.trim())) {
      toast('템플릿 저장을 위해 기준이 되는 공정1 시작 시점(MMDDHHMM)을 먼저 입력해주세요.', 'error');
      return focus('start-A');
    }
    setTplName('');
    setModal('tpl-save');
    setTimeout(() => document.getElementById('inp-tpl-name')?.focus(), 100);
  }

  async function saveTemplate() {
    const name = tplName.trim();
    if (!name) { toast('템플릿 이름을 입력해주세요.', 'error'); return focus('inp-tpl-name'); }
    const t0 = parseMMDDHHMM(times.A.start.trim());
    if (!t0) {
      toast('템플릿 저장을 위해 기준이 되는 공정1 시작 시점(MMDDHHMM)을 먼저 입력해주세요.', 'error');
      setModal(null);
      return focus('start-A');
    }
    const author = currentAuthor(window.currentUserEmail || '');
    const tpl = templateFromForm({ name, author, t0, times, form, machines, losses, remarks, now: new Date() });
    const list = [tpl, ...templates];
    setTemplates(list);
    try { localStorage.setItem(TPL_STORAGE_KEY, JSON.stringify(list)); } catch (e) { console.warn('LocalStorage save failed:', e); }
    setModal(null);
    setTplName('');
    try {
      const { error } = await upsertTemplates(list, author);
      if (error) throw error;
      broadcastTemplates();
      toast(`💾 템플릿 [${tpl.name}]이(가) DB에 저장되었습니다! 타인과 공유됩니다.`, 'success');
    } catch (err) {
      console.error('[Template] DB save error:', err);
      toast(`⚠️ DB 저장 실패 (로컬 임시 보관됨): ${(err as Error)?.message || ''}`, 'error');
    }
  }

  function applyTemplate(tpl: Template) {
    if (tpl.machines) setMachines({ A: tpl.machines.A || '기계 1', C: tpl.machines.C || '기계 1', D: tpl.machines.D || '기계 1' });
    // 소요·차감·비고를 넣고, 시작·종료는 비운다. 공정1 시작을 넣으면 전체 일정이 채워진다
    const t = blankTimes();
    for (const p of PROCS) {
      const dur = p.id !== 'packaging' ? tpl.offsets?.[p.id]?.dur : undefined;
      t[p.id].dur = dur != null ? String(Math.floor(dur / 60)).padStart(2, '0') + String(dur % 60).padStart(2, '0') : times[p.id].dur;
    }
    setTimes(t);
    if (tpl.losses) setLosses(Object.fromEntries(LOSS_KEYS.map(k => [k, tpl.losses?.[k] != null && tpl.losses[k] !== '' ? String(tpl.losses[k]) : ''])) as FormLosses);
    if (tpl.remarks) setRemarks(Object.fromEntries(REMARK_KEYS.map(k => [k, unsanitizeInput(tpl.remarks?.[k])])) as FormRemarks);
    setActiveTpl(tpl);
    setModal(null);
    toast(`📂 [${tpl.name}] 적용됨! 공정1 시작 시점(MMDDHHMM)을 입력하면 공정1~공정5 전체 일정이 자동 완성됩니다.`, 'success');
    focus('start-A');
  }

  async function deleteTemplate(tpl: Template) {
    if (!confirm(`템플릿 [${tpl.name}]을(를) 삭제하시겠습니까?\n클라우드 DB에서 삭제되어 모든 작업자의 목록에서 제거됩니다.`)) return;
    const list = templates.filter(t => t.id !== tpl.id);
    setTemplates(list);
    try { localStorage.setItem(TPL_STORAGE_KEY, JSON.stringify(list)); } catch { /* 저장 실패해도 서버에는 쓴다 */ }
    toast(`템플릿 [${tpl.name}]이(가) 삭제되었습니다.`, 'info');
    try {
      const { error } = await upsertTemplates(list, currentAuthor(window.currentUserEmail || ''));
      if (error) throw error;
      broadcastTemplates();
    } catch (err) {
      console.error('[Template] DB delete error:', err);
      toast(`⚠️ DB 삭제 반영 실패: ${(err as Error)?.message || ''}`, 'error');
    }
  }

  // ── 화면 ──
  const line = productLine(lot);
  const sch = form.schedule;
  const sumEnd = form.maxEnd ? fmtFriendly(form.maxEnd) : (sch.E?.endDate ? sch.E.endFriendly : '-');

  const timeField = (step: TimeStep, kind: 'start' | 'end', ph: string, title: ReactNode, desc?: ReactNode) => {
    const lbl = readableLabel(times[step][kind]);
    return (
      <div className="field-box">
        <div className="field-hdr"><span className="field-title">{title}</span>{desc}</div>
        <div className="time-row">
          <input type="text" id={`${kind}-${step}`} className="code-input" placeholder={`예: ${ph}`} maxLength={8}
            value={times[step][kind]} onChange={e => editTime(step, kind, e.target.value)} />
          <button type="button" className="btn-now" onClick={() => {
            const now = fmtMMDDHHMM(new Date());
            editTime(step, kind, now);
          }}>Now</button>
        </div>
        <div className="readable-lbl" id={kind === 'start' ? `rlbl-${step}` : `prev-rdbl-${step}`}
          style={{ color: lbl.invalid ? '#f43f5e' : (lbl.text !== '-' ? (kind === 'start' ? '#38bdf8' : '#a7f3d0') : undefined) }}>{lbl.text}</div>
      </div>
    );
  };
  const durField = (step: TimeStep, ph: string) => (
    <div className="field-box">
      <div className="field-hdr"><span className="field-title">소요시간 (HHMM)</span><span className="field-desc">연동</span></div>
      <div className="time-row">
        <input type="text" id={`dur-${step}`} className="code-input" placeholder={`예: ${ph}`} maxLength={4}
          value={times[step].dur} onChange={e => editTime(step, 'dur', e.target.value)} />
      </div>
      <div className="chips">
        {CHIPS[step].map(([dur, label]) => <button key={dur} className="chip" onClick={() => editTime(step, 'dur', dur)}>{label}</button>)}
      </div>
    </div>
  );
  const remarkBox = (key: keyof FormRemarks, label: string, ph: string) => (
    <div className="proc-remarks-box">
      <span className="proc-remarks-label">{label}</span>
      <input type="text" id={`remarks-${key}`} className="proc-remarks-input" placeholder={ph}
        value={remarks[key]} onChange={e => setRemarks({ ...remarks, [key]: e.target.value })} />
    </div>
  );
  const machineSel = (step: keyof Machines) => (
    <div className="machine-sel" data-step={step}>
      {['기계 1', '기계 2'].map((m, i) => (
        <button key={m} type="button" className={`mach-btn${machines[step] === m ? ' active' : ''}`} data-machine={m} onClick={() => chooseMachine(step, m)}>⚙️ {i + 1}호기</button>
      ))}
    </div>
  );
  const procHead = (badge: ReactNode, name: string, sub: string, icon: string, room: string, extra?: ReactNode) => (
    <div className="proc-hdr">
      <div className="proc-hdr-top">
        <div className="proc-title">
          {badge}
          <div className="proc-title-text"><h3>{name}</h3><p>{sub}</p></div>
        </div>
        <div className="loc-tag"><span>{icon}</span><span>{room}</span></div>
      </div>
      {extra}
    </div>
  );
  const overlay = (id: Exclude<Modal, null>, body: ReactNode, cardStyle?: React.CSSProperties) => (
    <div className={`modal-overlay${modal === id ? ' open' : ''}`} id={`modal-${id}`} onClick={e => { if (e.target === e.currentTarget) setModal(null); }}>
      <div className="modal-card" style={cardStyle}>{body}</div>
    </div>
  );
  const modalHead = (id: Exclude<Modal, null>, title: string) => (
    <div className="modal-hdr"><h2>{title}</h2><button className="modal-close" data-close={`modal-${id}`} onClick={() => setModal(null)}>×</button></div>
  );

  return (
    <div className={`batches-app${props.open ? ' is-embedded' : ''}`}>
      <div className="app">
        <header className="app-header">
          <div className="hdr-title">
            <h1>
              <span id="hdr-title-text">{isEdit ? `✏️ 로트 [${editLot}] 배치 정보 수정` : '📦 신규 배치 추가 및 공정 일정 등록'}</span>
              <span className="hdr-badge" id="hdr-badge" style={isEdit ? { background: 'rgba(245,158,11,.25)', color: '#fbbf24', borderColor: 'rgba(245,158,11,.5)' } : undefined}>
                {isEdit ? 'EDIT MODE' : ' BATCH MANAGER'}
              </span>
            </h1>
            <p className="hdr-sub" id="hdr-sub">{isEdit ? '배치 정보를 수정하고 [저장]을 누르세요.' : '로트번호 지정, 공정1→공정5 독립 일정 양방향 연동, 차감 수량 관리'}</p>
          </div>
          <div className="hdr-actions">
            <button type="button" id="btn-tpl-save" className="pt-btn pt-btn--secondary" style={{ height: 32, fontSize: 12, padding: '0 10px' }} onClick={openTemplateSave}>💾 템플릿 저장</button>
            <button type="button" id="btn-tpl-load" className="pt-btn pt-btn--secondary" style={{ height: 32, fontSize: 12, padding: '0 10px' }} onClick={() => { setModal('tpl-load'); fetchTemplates(); }}>📂 템플릿 불러오기</button>
            <button type="button" id="btn-history" className="pt-btn pt-btn--secondary" style={{ height: 32, fontSize: 12, padding: '0 10px' }} onClick={() => setModal('history')}>
              📑 등록 배치 목록 (<span id="history-count">{historyCount}</span>)
            </button>
          </div>
        </header>

        <section className="meta-card">
          <div className="lot-group">
            <label htmlFor="inp-lot" className="lot-label">로트 넘버 <span className="req">*</span></label>
            <div className="lot-input-wrap">
              <input type="text" id="inp-lot" className="text-input" placeholder="예: LOT-260917-01" maxLength={20} autoComplete="off" required value={lot} onChange={e => setLot(e.target.value)} />
              <span id="lot-product-badge" className="lot-product-badge"
                style={lot.trim() ? { display: 'inline-flex', background: line.badgeBg, color: line.badgeText, border: line.badgeBorder } : { display: 'none' }}>
                {lot.trim() && <><span className="lot-badge-dot" style={{ background: line.color, border: line.strokeWidth !== '0' ? `1px solid ${line.stroke}` : undefined }}></span>{line.name}</>}
              </span>
              {!isEdit && <button type="button" className="btn-gen" id="btn-auto-lot" onClick={autoLot}>✨ 자동 생성</button>}
            </div>
          </div>
          <div className="summary-stats">
            <div className="stat"><span className="stat-label">총 소요시간</span><span className="stat-val hl" id="sum-dur">{fmtDur(form.totalMins)}</span></div>
            <div className="stat"><span className="stat-label">최종 완료 예정</span><span className="stat-val" id="sum-end">{sumEnd}</span></div>
          </div>
        </section>

        <section className="quantities-card">
          <div className="quantities-hdr">
            <div className="quantities-title">
              <span>📦 공정별 수량 및 차감(Loss) 관리 (개수)</span>
              <span className="quantities-sub">공정2 실적을 입력한 뒤 공정별 차감 수량이나 실수량 중 하나만 입력하면 다른 쪽이 자동 계산됩니다.</span>
            </div>
          </div>
          <div className="quantities-grid">
            <div className="qty-item" data-step="B">
              <div className="qty-item-hdr"><span className="qty-badge qb-b">공정2 기준</span><span className="qty-step-title">공정2실</span></div>
              <div className="qty-input-wrap">
                <input type="number" id="qty-B" className="qty-input" placeholder="실적 수량" step="1" value={qtyB} onChange={e => setQtyB(e.target.value)} />
                <span className="qty-unit">개</span>
              </div>
              <div className="qty-actual-badge"><span>기준 실적:</span><span className="val" id="disp-actual-B">{qtyText(q.B)}</span></div>
            </div>
            {QTY_ITEMS.map(it => (
              <div key={it.key} className="qty-item" data-step={it.key === 'B' ? 'B-loss' : it.key}>
                <div className="qty-item-hdr"><span className={`qty-badge ${it.badgeCls}`}>{it.badge}</span><span className="qty-step-title">{it.title}</span></div>
                <div className="qty-input-wrap">
                  <input type="number" id={`loss-${it.key}`} className="qty-input" placeholder={it.ph} step="1" value={losses[it.key]} onChange={e => setLosses({ ...losses, [it.key]: e.target.value })} />
                  <span className="qty-unit">개</span>
                </div>
                <div className="qty-actual-badge">
                  <span>{it.netLabel}</span>
                  <span className="qty-actual-wrap">
                    <input type="number" className="qty-actual-input" id={it.netId} step="1" aria-label={it.aria} disabled={q.B == null}
                      value={typingNet?.key === it.key ? typingNet.text : (q[it.net] != null ? String(q[it.net]) : '')}
                      onChange={e => onNetInput(it, e.target.value)} onBlur={() => setTypingNet(null)} />개
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="pipeline-card">
          <div className="pipeline-hdr">
            <span>📍 실시간 공정 진행 파이프라인</span>
            <span style={{ color: 'var(--cyan)', fontFamily: "'JetBrains Mono',monospace" }} id="pipe-range">
              {form.minStart && form.maxEnd ? `${fmtFriendly(form.minStart)} ~ ${fmtFriendly(form.maxEnd)}` : '-'}
            </span>
          </div>
          <div className="pipeline-steps" id="pipeline-bar">
            {PROCS.map(p => {
              const s = sch[p.id];
              return (
                <div key={p.id} className={`pipeline-step${s?.startDate ? ' active' : ''}`}>
                  <div className="step-code"><span>{p.name}</span>{p.hasMachine && <span style={{ color: '#fcd34d', fontSize: '.66rem' }}>[{machines[p.id as keyof Machines] || '기계 1'}]</span>}</div>
                  <div className="step-name">{p.room}</div>
                  <div className="step-time">{s?.startDate ? `${s.startCode} → ${s.endCode}` : '미정'}</div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="processes-section">
          <div className="proc-grid-main">
            {CARDS.map((c, i) => {
              const proc = PROCS.find(p => p.id === c.id)!;
              return (
                <article key={c.id} className={`proc-card ${c.cls}`} data-step={c.id}>
                  {procHead(<div className="proc-badge">{i + 1}</div>, proc.name, '독립 일정 & 시간 연동', c.icon, proc.room, proc.hasMachine ? machineSel(c.id as keyof Machines) : undefined)}
                  <div className="proc-body">
                    {timeField(c.id, 'start', c.ph[0], <>시작 시점 (MMDDHHMM) {c.id === 'A' && <span className="req">*</span>}</>)}
                    {durField(c.id, c.ph[1])}
                    {timeField(c.id, 'end', c.ph[2], '종료 시점 (MMDDHHMM)', <span className="field-desc">연동</span>)}
                  </div>
                  {remarkBox(c.id, '📝 비고:', `${proc.name} 특이사항`)}
                </article>
              );
            })}
          </div>

          <div className="proc-grid-sub">
            <article className="proc-card pi" data-step="inspection">
              {procHead(<div className="proc-badge">검</div>, '검사', '육안/광학 선별 검사 및 불량 차감', '🔍', '검사실')}
              <div className="proc-body">
                <div className="field-box">
                  <div className="field-hdr"><span className="field-title">진행 안내</span></div>
                  <p style={{ fontSize: '0.73rem', color: 'var(--text-sub)', lineHeight: 1.4 }}>공정5 완료 후 반제품 보관실 또는 검사실에서 육안/광학 선별 검사가 진행됩니다.</p>
                </div>
                <div className="field-box">
                  <div className="field-hdr"><span className="field-title">차감 수량 안내</span></div>
                  <p style={{ fontSize: '0.73rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>상단 <strong>검사 차감</strong> 항목에 불량 차감 수량을 입력하세요 (음수 가능).</p>
                </div>
                <div className="field-box" style={{ borderColor: 'rgba(16,185,129,.35)', background: 'rgba(16,185,129,.05)' }}>
                  <div className="field-hdr"><span className="field-title" style={{ color: '#059669' }}>검사 합격 실 수량</span></div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#059669', fontFamily: "'JetBrains Mono',monospace" }} id="prev-rdbl-inspection">
                    {q.inspection != null ? `${Number(q.inspection).toLocaleString()}개 (검사 합격)` : '-'}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-faint)', marginTop: 2 }}>공정5 실 수량 - 검사 차감</div>
                </div>
              </div>
              {remarkBox('inspection', '📝 검사 특이사항:', '불량 유형(파손, 이물, 기포 등) 및 특이사항 입력')}
            </article>

            <article className="proc-card pp" data-step="packaging">
              {procHead(<div className="proc-badge" style={{ borderColor: '#f97316', color: '#ea580c' }}>포</div>, '포장 공정', '일정 설정 & 시작 1일 전 대기 자동 이관', '📦', '포장실')}
              <div className="proc-body">
                {timeField('packaging', 'start', '10150900', '포장 시작 시점 (MMDDHHMM) *', <span className="field-desc" style={{ color: '#ea580c', fontWeight: 600 }}>시작 1일 전 대기 자동이관</span>)}
                {durField('packaging', '0400')}
                {timeField('packaging', 'end', '10151300', '포장 완료 시점 (MMDDHHMM)', <span className="field-desc">연동</span>)}
                <div className="field-box" style={{ borderColor: 'rgba(249,115,22,.35)', background: 'rgba(249,115,22,.05)' }}>
                  <div className="field-hdr"><span className="field-title" style={{ color: '#ea580c' }}>최종 완제품 수량</span></div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#ea580c', fontFamily: "'JetBrains Mono',monospace" }} id="disp-final-packaging-qty">
                    {q.packaging != null ? `${Number(q.packaging).toLocaleString()}개 (최종 완제품)` : '-'}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-faint)', marginTop: 2 }}>검사 합격 실 수량 - 포장 차감</div>
                </div>
              </div>
              {remarkBox('packaging', '📝 포장 특이사항:', '포장 관련 특이사항(라벨 불량, 포장 파손, 출고 비고 등) 입력')}
            </article>
          </div>
        </section>

        <footer className="app-footer">
          <div className="footer-left" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button type="button" className="pt-btn pt-btn--danger" id="btn-reset" onClick={() => { if (confirm('입력한 내용을 모두 초기화하시겠습니까?')) setCreateMode(); }}>🔄 초기화</button>
            <span className="footer-hint">💡 공정1 시작 시점과 각 공정 소요시간을 설정하면 전 공정이 자동 연쇄 계산됩니다.</span>
          </div>
          <div className="footer-actions">
            <button type="button" className="btn btn-ghost" id="btn-preview" onClick={() => setModal('preview')}>🔍 일정 상세 확인</button>
            {isEdit && <button type="button" className="btn btn-danger" id="btn-delete" style={{ display: 'inline-flex' }} onClick={deleteBatch}>🗑️ 배치 삭제</button>}
            <button type="button" className="pt-btn pt-btn--primary" id="btn-submit" onClick={submit}>{isEdit ? '💾 배치 정보 수정 저장' : '✅ 신규 배치 등록하기'}</button>
          </div>
        </footer>
      </div>

      {overlay('history', <>
        {modalHead('history', '📑 등록된 배치 현황 목록')}
        <div className="modal-body"><div style={{ overflowX: 'auto' }}>
          <table className="btable">
            <thead><tr><th>로트넘버</th><th>시작(공정1)</th><th>완료(공정5)</th><th>총소요</th><th>공정1 설비</th><th>공정3 설비</th><th>공정4 설비</th><th>공정별 수량</th><th>등록일시</th></tr></thead>
            <tbody id="history-tbody"><HistoryRows /></tbody>
          </table>
        </div></div>
      </>)}

      {overlay('preview', <>
        {modalHead('preview', '🔍 배치 공정 스케줄 세부 내역')}
        <div className="modal-body" id="preview-content">{modal === 'preview' && <Preview lot={lot} form={form} q={q} remarks={remarks} />}</div>
      </>)}

      {overlay('tpl-save', <>
        {modalHead('tpl-save', '💾 배치 공정 일정 템플릿 저장')}
        <div className="modal-body">
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            현재 입력된 <strong>공정1 시작 시점</strong>을 기준 시점($T_0$)으로 삼아, 각 공정의 상대적 시간 오프셋(+n분), 호기 선택, 차감 수량 및 비고를 템플릿으로 저장합니다.
          </p>
          <div className="field-box" style={{ marginTop: 4 }}>
            <label htmlFor="inp-tpl-name" className="field-title" style={{ fontSize: '0.85rem', fontWeight: 700 }}>템플릿 이름 <span className="req">*</span></label>
            <input type="text" id="inp-tpl-name" className="text-input" style={{ maxWidth: '100%', fontSize: '0.88rem', marginTop: 6 }} placeholder="예: 표준 제품 A 생산 템플릿 (공정11호기/건조1호기)" maxLength={40}
              value={tplName} onChange={e => setTplName(e.target.value)} />
          </div>
          <div id="tpl-save-summary" style={{ background: 'var(--bg-card-sub)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: '0.78rem', color: 'var(--text-sub)', display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>📌 저장될 상대 시간 및 설비 설정 요약:</div>
            {([['A', '공정1', `[${machines.A}] / `, ' (오프셋 기준점 T₀)'], ['B', '공정2', '', ''], ['C', '공정3', `[${machines.C}] / `, ''], ['D', '공정4', `[${machines.D}] / `, ''], ['E', '공정5', '', '']] as const).map(([k, n, m, tail]) => {
              const d = times[k].dur || '-';
              return <div key={k}>• <strong>{n}</strong>: {m}소요 {d.slice(0, 2)}h {d.slice(2)}m{tail}</div>;
            })}
            <div style={{ marginTop: 2, color: 'var(--text-muted)', fontSize: '0.73rem' }}>※ 차감 수량(Loss) 및 공정별 비고도 함께 저장되며, 클라우드 DB를 통해 전사 공유됩니다.</div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <button type="button" className="btn btn-ghost" data-close="modal-tpl-save" onClick={() => setModal(null)}>취소</button>
            <button type="button" className="btn btn-primary" id="btn-confirm-save-tpl" onClick={saveTemplate}>💾 템플릿 저장하기</button>
          </div>
        </div>
      </>, { maxWidth: 600 })}

      {overlay('tpl-load', <>
        {modalHead('tpl-load', '📂 배치 공정 일정 템플릿 불러오기')}
        <div className="modal-body">
          <div style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: '0.8rem', color: '#1e40af', lineHeight: 1.5 }}>
            💡 <strong>템플릿 적용 안내</strong>: 템플릿 선택 시 호기, 소요시간, 차감 수량, 비고가 자동 반영되며, <strong>공정1 시작 시점은 공백(Empty)</strong>으로 설정됩니다.<br />
            이후 공정1 시작 시점을 입력하면 공정1~공정5 전체 일정이 일괄 자동 계산 완성됩니다.
          </div>
          <div style={{ overflowX: 'auto', maxHeight: 420, border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', marginTop: 6 }}>
            <table className="btable" style={{ margin: 0 }}>
              <thead><tr><th>템플릿명</th><th>설비 할당 (공정1/공정3/공정4)</th><th>소요시간 요약</th><th>등록일자</th><th style={{ textAlign: 'center', width: 140 }}>작업</th></tr></thead>
              <tbody id="tpl-list-tbody">
                {templates.length === 0 ? (
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: 26, color: 'var(--text-faint)' }}>저장된 템플릿이 없습니다. 상단 [💾 템플릿 저장]으로 새 템플릿을 등록하세요.</td></tr>
                ) : templates.map(t => {
                  const o = t.offsets || {};
                  const durs = ([['A', '공정1'], ['B', '공정2'], ['C', '공정3'], ['D', '공정4'], ['E', '공정5']] as const).filter(([k]) => o[k]?.dur).map(([k, n]) => `${n}:${hm(o[k]?.dur)}`).join(' / ');
                  return (
                    <tr key={t.id}>
                      <td>
                        <strong style={{ color: '#2563eb', fontSize: '0.86rem' }}>{unsanitizeInput(t.name)}</strong>
                        {t.author && <div style={{ fontSize: '0.71rem', color: 'var(--text-muted)', marginTop: 2 }}>👤 {t.author}</div>}
                      </td>
                      <td style={{ fontSize: '0.75rem' }}>
                        <span className="pill pill-blue">공정1:{t.machines?.A || '기계 1'}</span> <span className="pill pill-green">공정3:{t.machines?.C || '기계 1'}</span> <span className="pill pill-amber">공정4:{t.machines?.D || '기계 1'}</span>
                      </td>
                      <td style={{ fontSize: '0.75rem', fontFamily: "'JetBrains Mono',monospace", color: 'var(--text-sub)' }}>{durs}</td>
                      <td style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>{t.createdAt ? String(t.createdAt).slice(0, 10) : '-'}</td>
                      <td style={{ textAlign: 'center' }}>
                        <button type="button" className="btn btn-primary btn-apply-tpl" data-tpl-id={t.id} style={{ padding: '4px 9px', fontSize: '0.74rem' }} onClick={() => applyTemplate(t)}>적용</button>
                        <button type="button" className="btn btn-danger btn-del-tpl" data-tpl-id={t.id} style={{ padding: '4px 8px', fontSize: '0.74rem', marginLeft: 3 }} onClick={() => deleteTemplate(t)}>삭제</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <button type="button" className="btn btn-ghost" id="btn-open-save-from-load" onClick={() => { setModal(null); openTemplateSave(); }}>➕ 현재 설정으로 새 템플릿 저장</button>
            <button type="button" className="btn btn-ghost" data-close="modal-tpl-load" onClick={() => setModal(null)}>닫기</button>
          </div>
        </div>
      </>, { maxWidth: 820 })}
      <div className="toast" id="toast"></div>
    </div>
  );
}

function HistoryRows() {
  const list = localBatches();
  if (!list.length) return <tr><td colSpan={8} style={{ textAlign: 'center', padding: 24, color: 'var(--text-faint)' }}>등록된 배치가 없습니다.</td></tr>;
  return <>{list.map(b => {
    const q = (b.quantities || {}) as Record<string, number | null | undefined>;
    const parts = ([['B', 'qtyB', '공정2'], ['C', 'qtyC', '공정3'], ['D', 'qtyD', '공정4'], ['E', 'qtyE', '공정5'], ['inspection', 'qtyInspection', '검사'], ['packaging', 'qtyPackaging', '완제품']] as const)
      .map(([k, old, n]) => [n, q[k] ?? (b[old] as number | null | undefined)] as const).filter(([, v]) => v != null).map(([n, v]) => `${n}:${Number(v).toLocaleString()}`);
    const p = productLine(b.lotNumber);
    const s = (v: unknown) => String(v ?? '');
    return (
      <tr key={b.lotNumber}>
        <td><strong style={{ color: '#60a5fa' }}>{b.lotNumber}</strong> <span style={{ display: 'inline-block', padding: '2px 6px', borderRadius: 4, fontSize: '0.7rem', fontWeight: 700, color: p.badgeText, background: p.badgeBg, border: p.strokeWidth !== '0' ? `1px solid ${p.stroke}` : undefined }}>[{p.name}]</span></td>
        <td>{s(b.overallStartFriendly || b.overallStartCode || '-')}</td>
        <td>{s(b.overallEndFriendly || b.overallEndCode || '-')}</td>
        <td><span className="pill pill-blue">{s(b.totalDurationText || '-')}</span></td>
        <td><span className="pill pill-blue">{s(b.stage1Machine || b.stage1MachineOld || b.schedule?.A?.machine || '기계 1')}</span></td>
        <td><span className="pill pill-green">{s(b.stage3Machine || '-')}</span></td>
        <td><span className="pill pill-amber">{s(b.stage4Machine || '-')}</span></td>
        <td style={{ fontSize: '.78rem', fontFamily: "'JetBrains Mono',monospace", color: '#38bdf8' }}>{parts.length ? parts.join(' / ') : <span style={{ color: 'var(--text-faint)' }}>-</span>}</td>
        <td style={{ fontSize: '.73rem', color: 'var(--text-faint)' }}>{b.createdAt ? s(b.createdAt).slice(0, 16).replace('T', ' ') : '-'}</td>
      </tr>
    );
  })}</>;
}

function Preview({ lot, form, q, remarks }: { lot: string; form: ReturnType<typeof scheduleFromForm>; q: ReturnType<typeof formQuantities>; remarks: FormRemarks }) {
  const sch = form.schedule;
  const sumEnd = form.maxEnd ? fmtFriendly(form.maxEnd) : (sch.E?.endDate ? sch.E.endFriendly : '-');
  const n = (v: number | null) => (v != null ? Number(v).toLocaleString() + '개' : '-');
  const strong = (color: string, v: ReactNode) => <strong style={{ color }}>{v}</strong>;
  const row = (name: string, room: string, s?: (typeof sch)[TimeStep], remark?: string) => (
    <tr>
      <td><strong>{name}</strong></td>
      <td>{room}{s?.machine ? ` (${s.machine})` : ''}</td>
      <td style={{ fontFamily: "'JetBrains Mono',monospace" }}>{s?.startCode || '-'}</td>
      <td style={{ fontFamily: "'JetBrains Mono',monospace", color: '#34d399' }}>{s?.endCode || '-'}</td>
      <td>{s ? <span className="pill pill-blue">{s.durationText || '-'}</span> : '-'}</td>
      <td style={{ color: '#cbd5e1', fontSize: '0.75rem' }}>{remark || '-'}</td>
    </tr>
  );
  return (
    <>
      <div style={{ background: 'var(--bg-input)', borderRadius: 8, padding: '13px 16px', marginBottom: 14, border: '1px solid var(--border)' }}>
        <div style={{ fontSize: '.88rem', fontWeight: 700 }}>로트: <span style={{ color: '#60a5fa' }}>{lot.trim() || '(미입력)'}</span></div>
        <div style={{ fontSize: '.8rem', color: 'var(--text-muted)', marginTop: 3 }}>
          총 소요: {strong('#38bdf8', fmtDur(form.totalMins))} | 완료: {strong('#34d399', sumEnd)}
        </div>
        <div style={{ fontSize: '.78rem', color: '#94a3b8', marginTop: 6, paddingTop: 6, borderTop: '1px dashed rgba(255,255,255,0.1)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {([['공정2', q.B, '#38bdf8'], ['공정3', q.C, '#38bdf8'], ['공정4', q.D, '#38bdf8'], ['공정5', q.E, '#38bdf8'], ['검사합격', q.inspection, '#34d399'], ['최종완제품', q.packaging, '#fb923c']] as const)
            .map(([label, v, c]) => <span key={label}>{label}: {strong(c, n(v))}</span>)}
        </div>
      </div>
      <table className="btable">
        <thead><tr><th>공정</th><th>위치/설비</th><th>시작</th><th>종료</th><th>소요</th><th>특이사항</th></tr></thead>
        <tbody>
          {PROCS.map(p => <Fragment key={p.id}>{row(p.name, p.room, sch[p.id], remarks[p.id].trim())}</Fragment>)}
          {row('검사', '검사실', undefined, remarks.inspection.trim())}
          {row('포장 공정', '포장실', undefined, remarks.packaging.trim())}
        </tbody>
      </table>
    </>
  );
}
