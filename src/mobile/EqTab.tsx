// 모바일 장비 탭: 상태 카드, 예약 목록, 예약 등록·수정·취소. 검사·저장값은 PC와 같은 src/equipment/core.ts
import { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { mount } from './mount';
import { flushSync } from 'react-dom';
import type { SupabaseLike } from '../supabase';
import { showToast } from './toast';
import { equipmentState, buildEquipmentJob, formatDateTime, parseDDHHMM, type Job } from '../equipment/core';

interface Template { id: number | string; name: string; duration_minutes: number; notify_worker_ids?: number[] }
const core = { equipmentState, parseDDHHMM, formatDateTime, buildEquipmentJob };

const FAIL = '저장 실패: 인터넷 연결을 확인해 주세요';
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

async function readAll(sb: SupabaseLike): Promise<[Job[], Template[]]> {
  const safe = async <T,>(q: PromiseLike<{ data: T[] | null; error: unknown }>) => {
    try { const { data, error } = await q; return !error && data ? data : []; } catch { return []; }
  };
  return Promise.all([
    safe<Job>(sb.from('equipment_jobs').select('*').order('start_code', { ascending: true })),
    // 템플릿(품목·소요 시간·알림 받을 사람)은 PC [장비 → 템플릿 관리]에서 관리한다
    safe<Template>(sb.from('equipment_templates').select('*').order('id'))
  ]);
}

/** 바닥에서 올라오는 시트를 따로 띄운다 */
function openSheet(render: (close: () => void) => ReactNode) {
  const el = document.createElement('div');
  el.className = 'm-sheet-backdrop';
  document.body.appendChild(el);
  const root = createRoot(el);
  const close = () => { root.unmount(); el.remove(); };
  flushSync(() => root.render(render(close)));
}

function EditSheet({ job, jobs, templates, sb, close, onSaved }: {
  job: Job | null; jobs: Job[]; templates: Template[]; sb: SupabaseLike; close(): void; onSaved(): void;
}) {
  const now = new Date();
  const s0 = job ? core.parseDDHHMM(job.start_code, now) : null;
  // 새 예약은 지금 시각을 10분 단위로 올린 값
  const t0 = s0 ? hm(s0) : (() => { const t = `${pad(now.getHours())}:${pad(Math.ceil(now.getMinutes() / 10) * 10)}`; return t.endsWith(':60') ? (now.getHours() === 23 ? '23:50' : `${pad(now.getHours() + 1)}:00`) : t; })();
  const first = templates[0];
  const [date, setDate] = useState(ymd(s0 || now));
  const [time, setTime] = useState(t0);
  const [type, setType] = useState(job?.setting_type || first?.name || '');
  const [notify, setNotify] = useState<number[]>(job ? (job.notify_worker_ids || []) : (first?.notify_worker_ids || []));
  const [dur, setDur] = useState(String(job?.duration_minutes || first?.duration_minutes || 90));
  const [err, setErr] = useState('');

  const minutes = parseInt(dur, 10) || 0;
  const end = date && time && minutes > 0 ? core.formatDateTime(new Date(new Date(`${date}T${time}:00`).getTime() + minutes * 60000)) : '-';

  const save = async () => {
    setErr('');
    if (!date || !time) return setErr('날짜와 시각을 입력해 주세요');
    // 시각을 바꾸면 알림 발송 여부도 새 시각 기준으로 다시 정한다
    const { error, row } = core.buildEquipmentJob({ start: new Date(`${date}T${time}:00`), durationMinutes: parseInt(dur, 10), type, notifyWorkerIds: notify, id: job?.id }, jobs, new Date());
    if (error) return setErr(error);
    try {
      const res = job ? await sb.from('equipment_jobs').update(row!).eq('id', job.id) : await sb.from('equipment_jobs').insert(row!);
      if (res.error) throw res.error;
      close();
      onSaved();
    } catch {
      showToast(FAIL);
    }
  };

  return (
    <div className="m-sheet-container">
      <div className="m-sheet-header">
        <span className="m-sheet-title">{job ? '예약 수정' : '새 예약 등록'}</span>
        <button className="m-btn" id="m-sheet-close" style={{ padding: '6px 12px' }} onClick={close}>닫기</button>
      </div>
      <div id="m-sheet-err" style={{ color: 'var(--pt-danger)', fontSize: 14, marginBottom: 10, display: err ? 'block' : 'none' }}>{err}</div>
      <div className="m-form-group"><label className="m-form-label">시작 날짜 &amp; 시각</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="date" className="m-input" id="m-inp-date" value={date} onChange={e => setDate(e.target.value)} />
          <input type="time" className="m-input" id="m-inp-time" value={time} onChange={e => setTime(e.target.value)} />
        </div>
      </div>
      <div className="m-form-group"><label className="m-form-label">종류 선택</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {templates.length ? templates.map(t => (
            <button key={t.id} className={`m-btn m-ac-type-btn ${type === t.name ? 'm-btn-primary' : ''}`} data-tpl-id={t.id} style={{ flex: '1 1 40%' }} type="button"
              onClick={() => { setType(t.name); setNotify(t.notify_worker_ids || []); setDur(String(t.duration_minutes)); }}>
              {t.name} ({t.duration_minutes}분)
            </button>
          )) : <span style={{ color: 'var(--pt-muted)', fontSize: 14 }}>템플릿이 없습니다. PC에서 추가해 주세요</span>}
        </div>
      </div>
      <div className="m-form-group"><label className="m-form-label">소요 시간 (분)</label>
        <input type="number" inputMode="numeric" className="m-input" id="m-inp-dur" min={1} max={1440} value={dur} onChange={e => setDur(e.target.value)} />
      </div>
      <div className="m-form-group"><label className="m-form-label">종료 예정 (자동 계산)</label>
        <input type="text" className="m-input" id="m-inp-end" readOnly value={end} style={{ color: 'var(--pt-muted)', background: 'var(--pt-page)' }} />
      </div>
      <div style={{ marginTop: 18 }}><button className="m-btn m-btn-primary" id="m-sheet-save" style={{ width: '100%', height: 48 }} onClick={save}>저장하기</button></div>
    </div>
  );
}

function DeleteSheet({ id, sb, close, onSaved }: { id: Job['id']; sb: SupabaseLike; close(): void; onSaved(): void }) {
  const confirm = async () => {
    try {
      const { error } = await sb.from('equipment_jobs').delete().eq('id', id);
      if (error) throw error;
      close();
      onSaved();
    } catch {
      showToast(FAIL);
    }
  };
  return (
    <div className="m-sheet-container">
      <div className="m-sheet-header"><span className="m-sheet-title">예약 취소 확인</span><button className="m-btn" id="m-del-close" style={{ padding: '6px 12px' }} onClick={close}>닫기</button></div>
      <div style={{ fontSize: 15, color: 'var(--pt-text)', marginBottom: 20 }}>이 예약을 취소할까요?</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="m-btn" id="m-del-cancel" style={{ flex: 1 }} onClick={close}>닫기</button>
        <button className="m-btn m-btn-danger" id="m-del-confirm" style={{ flex: 1 }} onClick={confirm}>취소하기</button>
      </div>
    </div>
  );
}

function StatusCard({ jobs }: { jobs: Job[] }) {
  // 진행률·남은 시간은 10초마다 다시 계산한다
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 10000); return () => clearInterval(t); }, []);
  const st = core.equipmentState(jobs, new Date());
  return (
    <div className="m-card" style={{ borderLeft: `4px solid ${st.dotColor}` }}>
      <div className="m-card-header">
        <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--pt-text)' }}>장비 상태</span>
        <span className="m-chip" style={{ background: st.typeBgColor, color: '#ffffff' }}>{st.typeText}</span>
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, color: st.statusColor, marginBottom: 6 }}>
        {st.statusText} {st.remainMinutes > 0 ? `(${st.remainMinutes}분 남음)` : (st.waitMinutes > 0 ? `(${st.waitMinutes}분 전)` : '')}
      </div>
      {st.pct > 0 && <div className="m-progress-bar"><div className="m-progress-fill" style={{ width: `${st.pct}%`, background: st.dotColor }} /></div>}
      <div className="m-sub-line">
        <span>시작 {st.s ? core.formatDateTime(st.s) : '-'} ~ 종료 {st.e ? core.formatDateTime(st.e) : '-'}</span>
        <span>{st.gaugeText}</span>
      </div>
    </div>
  );
}

function EqTab({ jobs, templates, sb, reload }: { jobs: Job[]; templates: Template[]; sb: SupabaseLike; reload(): void }) {
  const now = new Date();
  const edit = (job: Job | null) => openSheet(close => <EditSheet job={job} jobs={jobs} templates={templates} sb={sb} close={close} onSaved={reload} />);
  return (
    <>
      <div id="m-ac-status-box"><StatusCard jobs={jobs} /></div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '16px 0 10px' }}>
        <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--pt-text)' }}>예약 목록 ({jobs.length})</span>
        <button className="m-btn m-btn-primary" id="m-ac-new-btn" style={{ padding: '6px 14px' }} onClick={() => edit(null)}>+ 새 예약</button>
      </div>
      <div id="m-ac-job-list">
        {!jobs.length ? <div className="m-card" style={{ textAlign: 'center', color: 'var(--pt-muted)', padding: '24px 16px' }}>예약된 작업이 없습니다</div>
          : jobs.map(j => {
            const e = core.parseDDHHMM(j.end_code, now);
            const past = Boolean(e && now >= e);
            return (
              <div key={j.id} className="m-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', opacity: past ? 0.55 : undefined }}>
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--pt-text)', fontSize: 15, marginBottom: 4 }}>
                    {core.formatDateTime(j.start_code, now)} ~ {core.formatDateTime(j.end_code, now)}
                    <span className="m-chip" style={{ fontSize: 11, marginLeft: 6, background: j.setting_type === '예시 품목 A' ? '#0284c7' : '#d97706', color: '#ffffff' }}>{j.setting_type || '설정'}</span>
                  </div>
                  <div className="m-sub-line">소요: {j.duration_minutes ? `${j.duration_minutes}분` : '-'} · 상태: {j.status || '예약'}</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="m-btn m-ac-edit-btn" data-id={j.id} style={{ padding: '6px 12px', fontSize: 13 }} onClick={() => edit(j)}>수정</button>
                  <button className="m-btn m-btn-danger m-ac-del-btn" data-id={j.id} style={{ padding: '6px 12px', fontSize: 13 }}
                    onClick={() => openSheet(close => <DeleteSheet id={j.id} sb={sb} close={close} onSaved={reload} />)}>취소</button>
                </div>
              </div>
            );
          })}
      </div>
    </>
  );
}

export async function renderEqTab(container: HTMLElement, bridge: MobileBridgeLike): Promise<void> {
  const sb = bridge.getSupabase();
  const [jobs, templates] = await readAll(sb);
  mount(container, 'equipment', <EqTab jobs={jobs} templates={templates} sb={sb} reload={() => renderEqTab(container, bridge)} />);
}
