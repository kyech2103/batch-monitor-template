// PC 장비 창: 신규 예약, 예약 목록, 템플릿 관리. 검사·저장값은 모바일과 같은 core.ts.
// 작업 목록은 jobs.ts, 평면도 상태 카드는 EqCard.tsx
import { useEffect, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { addMinutesToDDHHMM, buildEquipmentJob, parseDDHHMM, type Job } from './core';
import { deleteJob, fetchJobs, useJobs } from './jobs';
import { sb } from '../sb';
import { showToast } from '../main/toast';

interface Template { id: number; name: string; duration_minutes: number; notify_worker_ids?: number[] }
interface Worker { id: number; name: string }
type Tab = 'new' | 'list' | 'tpl';
declare global {
  interface Window {
    EquipmentModal?: { open(tab?: Tab): void };
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
const nowCode = () => { const d = new Date(); return `${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`; };
const label = { fontSize: 12, fontWeight: 700, color: 'var(--pt-text)' } as const;
const col = { display: 'flex', flexDirection: 'column', gap: 6 } as const;

function names(ids: number[] | undefined, workers: Worker[]) {
  return (ids || []).map(id => workers.find(w => w.id === id)?.name).filter(Boolean).join(', ');
}

function NewTab({ templates, workers, start, setStart, tplId, setTplId, dur, setDur }: {
  templates: Template[]; workers: Worker[]; start: string; setStart(v: string): void; tplId: number | null; setTplId(v: number): void; dur: string; setDur(v: string): void;
}) {
  const tpl = templates.find(t => t.id === tplId);
  const end = start.trim().length === 6 && parseInt(dur, 10) > 0 ? addMinutesToDDHHMM(start.trim(), parseInt(dur, 10)) || '-' : '-';
  const who = names(tpl?.notify_worker_ids, workers);
  return (
    <div style={{ background: '#ffffff', border: '1px solid var(--pt-border)', borderRadius: 'var(--pt-radius)', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={col}>
        <label className="pm-field-label" htmlFor="ac-inp-start-code" style={label}>시작 시간 (DDHHMM 6자리)</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="text" id="ac-inp-start-code" className="pt-input ac-input" placeholder="예: 261430 (26일 14:30)" maxLength={6} style={{ flex: 1 }} value={start} onChange={e => setStart(e.target.value)} />
          <button type="button" className="pt-btn pt-btn--secondary" id="btn-ac-set-now" onClick={() => setStart(nowCode())}>🕒 현재시각</button>
        </div>
      </div>
      <div style={col}>
        <label className="pm-field-label" style={label}>세팅 품목 선택 (템플릿)</label>
        <div id="ac-template-options" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', alignItems: 'center', padding: '4px 0' }}>
          {templates.length ? templates.map(t => (
            <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--pt-accent)' }}>
              <input type="radio" name="ac-setting-type" value={t.name} data-id={t.id} checked={t.id === tplId} onChange={() => { setTplId(t.id); setDur(String(t.duration_minutes)); }} />
              <span>{t.name} ({t.duration_minutes}분)</span>
            </label>
          )) : '템플릿이 없습니다. [템플릿 관리] 탭에서 추가해 주세요.'}
        </div>
        <div id="ac-template-notify" style={{ fontSize: 12, color: 'var(--pt-muted)' }}>
          {who ? `🔔 시작·종료 알림: ${who}` : '🔕 이 템플릿은 알림 받을 사람이 없습니다 ([템플릿 관리]에서 지정)'}
        </div>
      </div>
      <div style={col}>
        <label className="pm-field-label" htmlFor="ac-inp-duration" style={label}>소요 시간 (분)</label>
        <input type="number" id="ac-inp-duration" className="pt-input ac-input" min={1} max={1440} style={{ width: 140 }} value={dur} onChange={e => setDur(e.target.value)} />
      </div>
      <div style={{ background: 'var(--pt-bg)', padding: 12, borderRadius: 'var(--pt-radius-sm)', border: '1px solid var(--pt-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, color: 'var(--pt-muted)', fontWeight: 600 }}>종료 예정 시간 (자동 계산):</span>
        <strong id="ac-val-end-code" style={{ fontFamily: 'monospace', fontSize: 16, color: 'var(--pt-accent)', fontWeight: 800 }}>{end}</strong>
      </div>
    </div>
  );
}

function ListTab({ jobs }: { jobs: Job[] }) {
  if (!jobs.length) {
    return <div style={{ textAlign: 'center', padding: '36px 16px', color: '#64748b', fontSize: 13 }}>등록된 장비 작업이 없습니다.<br />상단의 [신규 작업 예약] 탭에서 작업을 등록해 주세요.</div>;
  }
  const now = new Date();
  return (
    <>
      {jobs.map(job => {
        const s = parseDDHHMM(job.start_code), e = parseDDHHMM(job.end_code);
        const st = !s || !e ? { text: '대기중', color: '#f59e0b', cls: '' }
          : now >= e ? { text: '가동 완료', color: '#3b82f6', cls: 'is-completed' }
          : now >= s ? { text: '가동 중', color: '#10b981', cls: 'is-running' }
          : { text: '예약 대기', color: '#f59e0b', cls: '' };
        const done = st.cls === 'is-completed';
        return (
          <div key={job.id} className={`ac-job-card ${st.cls}`}>
            <div className="ac-job-main">
              <div className="ac-job-meta">
                <span style={{ color: job.setting_type === '예시 품목 A' ? '#38bdf8' : '#f59e0b', fontWeight: 800 }}>[{job.setting_type || '설정'}]</span>
                <span style={{ color: st.color, fontSize: 12, fontWeight: 700 }}>● {st.text}</span>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>({job.duration_minutes || '-'}분 소요)</span>
              </div>
              <div className="ac-job-times">
                <span>시작: <strong>{job.start_code ? String(job.start_code).padStart(6, '0') : '-'}</strong></span>
                <span style={{ margin: '0 4px', color: '#475569' }}>➔</span>
                <span>종료: <strong style={{ color: '#38bdf8' }}>{job.end_code ? String(job.end_code).padStart(6, '0') : '-'}</strong></span>
              </div>
            </div>
            <div>
              <button type="button" className={`ac-btn-del ${done ? 'btn-confirm-finish' : 'btn-cancel-job'}`} onClick={() => deleteJob(job.id)}>
                {done ? '✓ 확인 (정리)' : '취소'}
              </button>
            </div>
          </div>
        );
      })}
    </>
  );
}

function TplTab({ templates, workers, reload }: { templates: Template[]; workers: Worker[]; reload(): Promise<void> }) {
  const [editId, setEditId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [dur, setDur] = useState('');
  const [ids, setIds] = useState<number[]>([]);
  const reset = () => { setEditId(null); setName(''); setDur(''); setIds([]); };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim(), d = parseInt(dur, 10);
    if (!n || !(d >= 1 && d <= 1440)) return showToast('⚠️ 품목 이름과 소요 시간(1~1440분)을 입력해 주세요.');
    const row = { name: n, duration_minutes: d, notify_worker_ids: ids };
    const { error } = editId != null
      ? await sb.from('equipment_templates').update(row).eq('id', editId)
      : await sb.from('equipment_templates').insert([row]);
    if (error) return showToast(error.code === '23505' ? '⚠️ 같은 이름의 템플릿이 이미 있습니다.' : '❌ 템플릿 저장에 실패했습니다.');
    showToast(`✅ ${n} 템플릿을 저장했습니다.`);
    reset();
    await reload();
  };

  const remove = async (t: Template) => {
    // 이미 등록한 작업은 등록 때의 품목·알림 대상을 그대로 가지므로 템플릿을 지워도 영향 없음
    if (!window.confirm(`${t.name} 템플릿을 삭제할까요?`)) return;
    const { error } = await sb.from('equipment_templates').delete().eq('id', t.id);
    if (error) return showToast('❌ 템플릿 삭제에 실패했습니다.');
    if (editId === t.id) reset();
    await reload();
  };

  return (
    <>
      <div id="ac-tpl-list" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
        {templates.length ? templates.map(t => (
          <div key={t.id} className="ac-job-card" data-tpl-id={t.id}>
            <div className="ac-job-main">
              <div className="ac-job-meta"><strong>{t.name}</strong><span style={{ fontSize: 12, color: '#94a3b8' }}>{t.duration_minutes}분</span></div>
              <div style={{ fontSize: 12, color: 'var(--pt-muted)' }}>🔔 {names(t.notify_worker_ids, workers) || '알림 없음'}</div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="pt-btn pt-btn--secondary" data-tpl-act="edit"
                onClick={() => { setEditId(t.id); setName(t.name); setDur(String(t.duration_minutes)); setIds(t.notify_worker_ids || []); }}>수정</button>
              <button type="button" className="pt-btn pt-btn--secondary" data-tpl-act="delete" onClick={() => remove(t)}>삭제</button>
            </div>
          </div>
        )) : <div style={{ color: 'var(--pt-muted)', fontSize: 13 }}>등록된 템플릿이 없습니다</div>}
      </div>
      <form id="ac-tpl-form" onSubmit={save} style={{ background: '#ffffff', border: '1px solid var(--pt-border)', borderRadius: 'var(--pt-radius)', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <strong id="ac-tpl-form-title" style={{ fontSize: 13 }}>{editId != null ? `템플릿 수정: ${templates.find(t => t.id === editId)?.name ?? name}` : '새 템플릿 추가'}</strong>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="text" id="ac-tpl-name" className="pt-input ac-input" maxLength={20} placeholder="품목 이름 (예: 예시 품목 A)" required style={{ flex: 1 }} value={name} onChange={e => setName(e.target.value)} />
          <input type="number" id="ac-tpl-dur" className="pt-input ac-input" min={1} max={1440} placeholder="소요 시간(분)" required style={{ width: 140 }} value={dur} onChange={e => setDur(e.target.value)} />
        </div>
        <label className="pm-field-label" style={label}>시작·종료 알림 받을 사람 (알림을 켠 사람만 받음)</label>
        <div id="ac-tpl-workers" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
          {workers.length ? workers.map(w => (
            <label key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" value={w.id} checked={ids.includes(w.id)} onChange={e => setIds(e.target.checked ? [...ids, w.id] : ids.filter(x => x !== w.id))} /> {w.name}
            </label>
          )) : <span style={{ color: 'var(--pt-muted)', fontSize: 12 }}>직원 목록을 불러오지 못했습니다</span>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="pt-btn pt-btn--secondary" id="btn-ac-tpl-reset" onClick={reset}>새로 작성</button>
          <button type="submit" className="pt-btn pt-btn--primary" id="btn-ac-tpl-save">템플릿 저장</button>
        </div>
      </form>
    </>
  );
}

function EqModal({ dialog, tab, setTab, version }: { dialog: HTMLDialogElement; tab: Tab; setTab(t: Tab): void; version: number }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [start, setStart] = useState('');
  const [tplId, setTplId] = useState<number | null>(null);
  const [dur, setDur] = useState('90');
  const [busy, setBusy] = useState(false);
  const jobs = useJobs();

  const reload = async () => {
    try {
      const [t, w] = await Promise.all([
        sb.from('equipment_templates').select('*').order('id'),
        sb.from('workers').select('id,name').eq('status', '사용').order('name')
      ]);
      if (t.error) throw t.error;
      const list: Template[] = t.data || [];
      setTemplates(list);
      setWorkers(Array.isArray(w.data) ? w.data : []);
      // 고른 템플릿이 사라졌으면 첫 템플릿으로
      setTplId(prev => {
        if (list.some(x => x.id === prev)) return prev;
        if (list[0]) setDur(String(list[0].duration_minutes));
        return list[0]?.id ?? null;
      });
    } catch (e) {
      console.warn('fetchEquipmentTemplates error:', e);
    }
  };
  useEffect(() => { reload(); }, []);
  // 창을 열 때 시작 시간이 비어 있으면 지금 시각으로
  useEffect(() => { if (version) setStart(s => s || nowCode()); }, [version]);

  const submit = async () => {
    const code = start.trim();
    if (!/^\d{6}$/.test(code)) return showToast('⚠️ 시작 시간은 6자리 숫자(DDHHMM)로 입력해 주세요. (예: 261430)');
    const tpl = templates.find(t => t.id === tplId);
    if (!tpl) return showToast('⚠️ 세팅 품목(템플릿)을 선택해 주세요.');
    const { error, row } = buildEquipmentJob({
      start: parseDDHHMM(code), durationMinutes: Number(dur), type: tpl.name, notifyWorkerIds: tpl.notify_worker_ids
    }, jobs, new Date());
    if (error) return showToast(`⚠️ ${error}`);
    setBusy(true);
    try {
      const res = await sb.from('equipment_jobs').insert([row]);
      if (res.error) throw res.error;
      showToast('✅ 장비 작업이 성공적으로 등록되었습니다.');
      await fetchJobs();
      setTab('list');
    } catch (e) {
      console.error('insertEquipmentJob error:', e);
      const msg = (e as { message?: string; details?: string })?.message || (e as { details?: string })?.details || '';
      showToast('❌ 장비 작업 등록에 실패했습니다.' + (msg ? ` (${msg})` : ''));
    } finally {
      setBusy(false);
    }
  };

  const pane = (t: Tab) => ({ className: `ac-tab-pane ${tab === t ? 'is-active' : ''}`, id: `tab-pane-ac-${t}`, style: { display: tab === t ? 'block' : 'none' } });
  const seg = (t: Tab) => ({ type: 'button' as const, className: `pt-segment__item ${tab === t ? 'is-active' : ''}`, id: `tab-btn-ac-${t}`, onClick: () => setTab(t) });

  return (
    <>
      <header className="pt-head">
        <div className="pt-head__title-group">
          <h2 id="ac-modal-title" className="pt-head__title">🛠️ 장비 가동 및 예약 관리</h2>
          <span className="pt-head__sub">공정4 설비 가동 일정 및 작업 예약</span>
        </div>
        <button type="button" className="pt-icon-btn btn-dialog-close" id="btn-ac-modal-close" aria-label="닫기" onClick={() => dialog.close()}>×</button>
      </header>
      <div className="pt-toolbar">
        <div className="pt-segment">
          <button {...seg('new')}>신규 작업 예약</button>
          <button {...seg('list')}>작업 예약 목록 (<span id="ac-jobs-count">{jobs.length}</span>)</button>
          <button {...seg('tpl')}>템플릿 관리</button>
        </div>
      </div>
      <div className="pt-body">
        <div {...pane('new')}><NewTab templates={templates} workers={workers} start={start} setStart={setStart} tplId={tplId} setTplId={setTplId} dur={dur} setDur={setDur} /></div>
        <div {...pane('list')}><div id="ac-jobs-list-container"><ListTab jobs={jobs} /></div></div>
        <div {...pane('tpl')}><TplTab templates={templates} workers={workers} reload={reload} /></div>
      </div>
      <footer className="pt-foot" id="ac-modal-footer">
        <span style={{ fontSize: 12, color: 'var(--pt-muted)' }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="pt-btn pt-btn--secondary" id="btn-ac-modal-close-footer" onClick={() => dialog.close()}>닫기</button>
          <button type="button" className="pt-btn pt-btn--primary" id="btn-ac-submit-job" style={{ display: tab === 'new' ? '' : 'none' }} disabled={busy} onClick={submit}>
            {busy ? '등록 중...' : '예약 등록'}
          </button>
        </div>
      </footer>
    </>
  );
}

export function setupEquipmentModal(): void {
  const dialog = document.getElementById('equipment-modal') as HTMLDialogElement | null;
  if (!dialog) return;
  const root = createRoot(dialog);
  let tab: Tab = 'new', version = 0;
  const render = () => flushSync(() => root.render(<EqModal dialog={dialog} tab={tab} version={version} setTab={t => { tab = t; render(); }} />));
  render();
  window.EquipmentModal = {
    open(t: Tab = 'new') {
      tab = t; version++;
      render();
      if (!dialog.open) dialog.showModal();
    },
  };
}
