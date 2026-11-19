// 공정 담당자 편성 창. 현재 편성·실시간 갱신은 managers.ts
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { PM_LABELS, getManagers, setManagers, type Managers } from './managers';
import { sb } from '../sb';
import { showToast } from '../main/toast';
import { splitManagerNames } from '../todo/core';

declare global { interface Window { PmModal?: { open(): void } } }

const role = (k: string, placeholder?: string): [string, string, string?] => [k, PM_LABELS[k], placeholder];
const ROOMS: { room: string; color: string; roles: [key: string, label: string, placeholder?: string][] }[] = [
  { room: '공정1실', color: '--proc-a', roles: [role('p1_a', '이름 입력 (예: 홍길동)'), role('p1_b', '이름 입력 (예: 김철수)')] },
  { room: '공정2실', color: '--proc-b', roles: [role('p2_a'), role('p2_b'), role('p2_c')] },
  { room: '공정3실', color: '--proc-c', roles: [role('p3_a'), role('p3_b')] },
  { room: '공정4실', color: '--proc-d', roles: [role('p4_a'), role('p4_b')] },
  { room: '공정5실', color: '--proc-e', roles: [role('stage5')] },
  { room: '포장실', color: '--proc-pack', roles: [role('pk_a'), role('pk_b')] }
];
const KEYS = Object.keys(PM_LABELS);

function PmModal({ dialog, initial, workerNames }: { dialog: HTMLDialogElement; initial: Managers; workerNames: Set<string> | null }) {
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(KEYS.map(k => [k, initial[k] || ''])));
  const [busy, setBusy] = useState(false);
  // 적힌 이름 중 직원 목록에 없는 사람이 있으면 알림을 못 받는다
  const unlinked = (v: string) => {
    const names = splitManagerNames(v);
    return names.length > 0 && !(workerNames && names.every(n => workerNames.has(n)));
  };

  const save = async () => {
    const payload: Record<string, unknown> = { id: 1, updated_at: new Date().toISOString() };
    for (const k of KEYS) payload[k] = vals[k].trim();
    setBusy(true);
    try {
      const { data, error } = await sb.from('process_managers')
        .upsert(payload, { onConflict: 'id' }).select().single();
      if (error) throw error;
      showToast('✅ 공정 담당자 편성이 실시간 저장되었습니다.');
      setManagers((data || payload) as Managers);
      dialog.close();
    } catch (e) {
      console.error('saveProcessManagers error:', e);
      showToast('❌ 공정 담당자 저장에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="pt-head">
        <div className="pt-head__title-group">
          <h2 id="pm-modal-title" className="pt-head__title">👥 공정 담당자 편성</h2>
          <span className="pt-head__sub">당일 작업 담당자 편성 및 실시간 평면도 반영</span>
        </div>
        <button type="button" className="pt-icon-btn btn-dialog-close" id="btn-pm-modal-close" aria-label="닫기" onClick={() => dialog.close()}>×</button>
      </header>
      <div className="pt-body" style={{ padding: 12, overflowY: 'auto' }}>
        <p style={{ fontSize: 12, color: 'var(--pt-muted)', margin: '0 0 10px 0' }}>
          각 공정별 당일 작업 담당자를 입력 후 [저장]을 누르면 평면도에 실시간으로 반영됩니다.<br />
          한 칸에 여러 명은 쉼표로 적습니다 (예: <b>홍길동, 신입</b>). 적힌 사람 모두 그 칸의 할 일·알림을 받습니다.
        </p>
        <table className="pt-table" style={{ background: '#ffffff', border: '1px solid var(--pt-border)', borderRadius: 6, overflow: 'hidden' }}>
          <thead><tr><th style={{ width: 140 }}>공정</th><th style={{ width: 160 }}>역할</th><th>담당자 입력칸</th></tr></thead>
          <tbody>
            {ROOMS.flatMap(r => r.roles.map(([key, label, ph], i) => (
              <tr key={key} style={{ height: 40 }}>
                {i === 0 && (
                  <td rowSpan={r.roles.length} style={{ fontWeight: 700, background: 'var(--pt-bg)', borderRight: '1px solid var(--pt-border)' }}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: `var(${r.color})`, marginRight: 6 }} />{r.room}
                  </td>
                )}
                <td>{label}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="text" id={`pm-inp-${key}`} className="pt-input pm-input" placeholder={ph || '이름 입력'} style={{ flex: 1 }}
                      value={vals[key]} onChange={e => setVals({ ...vals, [key]: e.target.value })} />
                    <span className="pm-unlinked-chip" id={`pm-chip-${key}`} style={{ display: unlinked(vals[key]) ? 'inline-block' : 'none', fontSize: 11, padding: '2px 6px', background: '#f1f5f9', color: '#64748b', border: '1px solid #cbd5e1', borderRadius: 4, whiteSpace: 'nowrap' }}>알림 미연결</span>
                  </div>
                </td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>
      <footer className="pt-foot">
        <span style={{ fontSize: 12, color: 'var(--pt-muted)' }}>저장 시 평면도 오버레이에 즉시 반영됩니다.</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="pt-btn pt-btn--secondary" id="btn-pm-modal-cancel" onClick={() => dialog.close()}>닫기</button>
          <button type="button" className="pt-btn pt-btn--primary" id="btn-pm-save" disabled={busy} onClick={save}>{busy ? '저장 중...' : '💾 저장'}</button>
        </div>
      </footer>
    </>
  );
}

export function setupPmModal(): void {
  const dialog = document.getElementById('process-managers-modal') as HTMLDialogElement | null;
  if (!dialog) return;
  const root = createRoot(dialog);
  let n = 0;
  const render = (names: Set<string> | null) =>
    flushSync(() => root.render(<PmModal key={n++} dialog={dialog} initial={getManagers()} workerNames={names} />));
  render(null);
  document.getElementById('btn-pm-modal-trigger')?.addEventListener('click', e => { e.stopPropagation(); window.PmModal?.open(); });
  window.PmModal = {
    // 열 때마다 지금 편성과 직원 목록으로 새로 채운다
    async open() {
      let names: Set<string> | null = null;
      try {
        const { data } = await sb.from('workers').select('name').eq('status', '사용');
        if (data) names = new Set((data as { name: string }[]).map(w => w.name).filter(Boolean));
      } catch { /* 직원 목록 없이도 편성은 할 수 있다 */ }
      render(names);
      if (!dialog.open) dialog.showModal();
    }
  };
}
