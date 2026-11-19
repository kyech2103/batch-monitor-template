// 완제품 창고 입고 목록 창: 검색, 합계, 상세 보기, 평면도로 꺼내오기. 꺼내오기 저장은 src/main/moves.ts
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Batch } from '../batch/core';
import { batchQuantities } from '../batch/quantity';
import { readBatches } from '../main/batches';
import { restoreFromWarehouse } from '../main/moves';

declare global {
  interface Window {
    openBatchScheduleModal?(lot: string): void;
    FinishedWarehouse?: { open(): void; refresh(): void };
  }
}
type B = Batch & { completed_at?: string; updatedAt?: string; createdAt?: string; overallEndFriendly?: string };

const STEPS = ['A', 'B', 'C', 'D', 'E', 'inspection', 'packaging'] as const;
const time = (b: B) => new Date(b.completed_at || b.updatedAt || b.createdAt || 0).getTime();

/** 완제품 창고에 든 배치, 최근 완료순 */
export function finishedBatches(all: B[]): B[] {
  return all.filter(b => b.assignedZone === 'logistics' || b.manualZone === 'logistics' || b.completed_at).sort((a, b) => time(b) - time(a));
}

function ArchiveModal({ dialog, list }: { dialog: HTMLDialogElement; list: B[] }) {
  const [q, setQ] = useState('');
  const shown = q ? list.filter(b => String(b.lotNumber).toLowerCase().includes(q.toLowerCase())) : list;
  const total = list.reduce((n, b) => { const f = batchQuantities(b).finalQty; return typeof f === 'number' && f ? n + f : n; }, 0);
  return (
    <>
      <header className="pt-head">
        <div className="pt-head__title-group">
          <h2 id="finished-wh-modal-title" className="pt-head__title">📦 완제품 창고 입고 목록</h2>
          <span className="pt-head__sub">생산 및 포장이 완료된 배치 아카이브</span>
        </div>
        <div className="pt-head__actions">
          <button type="button" className="pt-icon-btn modal-close-btn" id="finished-wh-modal-btn-close" title="닫기 (Esc)" aria-label="닫기" onClick={() => dialog.close()}>×</button>
        </div>
      </header>
      <div className="pt-toolbar">
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--pt-text-sub)' }}>
          입고 배치 <span id="wh-stat-total-batches" style={{ color: 'var(--pt-accent)' }}>{list.length}건</span> · 총 실수량 <span id="wh-stat-total-qty" style={{ color: 'var(--pt-accent)' }}>{total.toLocaleString()}개</span>
        </div>
        <div>
          <input type="text" id="wh-search-input" className="pt-input wh-search-input" placeholder="🔍 로트번호 검색..." aria-label="완제품 로트번호 검색" style={{ width: 200 }} value={q} onChange={e => setQ(e.target.value)} />
        </div>
      </div>
      <div className="pt-body" style={{ padding: 0, display: 'flex', flexDirection: 'column', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ overflowY: 'auto', width: '100%', maxHeight: 520 }}>
          <table className="pt-table wh-table" style={{ width: '100%', border: 'none' }}>
            <thead><tr>
              <th style={{ width: 140 }}>로트번호</th><th style={{ width: 170 }}>완료/입고 일시</th>
              <th style={{ width: 130, textAlign: 'right' }}>최종 출고 실수량</th><th>공정별 특이사항(비고) 요약</th>
              <th style={{ width: 90, textAlign: 'center' }}>상세 보기</th><th style={{ width: 110, textAlign: 'center' }}>평면도 복원</th>
            </tr></thead>
            <tbody id="finished-wh-tbody">
              {!shown.length ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32, color: '#64748b' }}>{q ? '검색된 배치가 없습니다.' : '완제품 창고에 입고된 배치가 없습니다.'}</td></tr>
              ) : shown.map(b => {
                const f = batchQuantities(b).finalQty;
                // 비고는 저장된 글자 그대로 보인다 (React가 이스케이프)
                const remarks = STEPS.map(s => [s, b.remarks?.[s] || b.schedule?.[s as keyof typeof b.schedule]?.remarks] as const).filter(([, t]) => t);
                return (
                  <tr key={b.lotNumber}>
                    <td><span className="wh-lot-badge">{b.lotNumber}</span></td>
                    <td style={{ fontSize: 12, color: '#94a3b8' }}>{b.completed_at ? new Date(b.completed_at).toLocaleString('ko-KR') : (b.overallEndFriendly || '-')}</td>
                    <td><strong className="wh-qty-pill">{f != null ? `${f.toLocaleString()}개` : '-'}</strong></td>
                    <td><div className="wh-remarks-text">{remarks.length ? remarks.map(([s, t]) => `[${s}] ${t}`).join(' | ') : <span style={{ color: '#64748b' }}>-</span>}</div></td>
                    <td style={{ textAlign: 'center' }}><button type="button" className="wh-action-btn" data-lot={b.lotNumber} onClick={() => window.openBatchScheduleModal?.(b.lotNumber)}>상세 보기</button></td>
                    <td style={{ textAlign: 'center' }}><button type="button" className="wh-restore-btn" data-lot={b.lotNumber} title="해당 배치를 완제품 창고에서 꺼내어 평면도로 복원합니다" onClick={() => restoreFromWarehouse(b.lotNumber)}>↩️ 꺼내오기</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <footer className="pt-foot">
        <span style={{ fontSize: 12, color: 'var(--pt-muted)' }} />
        <button type="button" className="pt-btn pt-btn--secondary" id="finished-wh-modal-btn-close-foot" onClick={() => dialog.close()}>닫기</button>
      </footer>
    </>
  );
}

export function setupArchiveModal(): void {
  const dialog = document.getElementById('finished-warehouse-modal') as HTMLDialogElement | null;
  if (!dialog) return;
  const root = createRoot(dialog);
  // 배치 목록이 바뀌면(평면도 다시 그리기·꺼내오기) 검색어는 둔 채 목록만 새로 그린다
  const refresh = () => flushSync(() => root.render(<ArchiveModal dialog={dialog} list={finishedBatches(readBatches() as B[])} />));
  refresh();
  // 바깥(배경)을 누르면 닫는다
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
  window.FinishedWarehouse = {
    open() { refresh(); if (!dialog.open) dialog.showModal(); },
    refresh
  };
}
