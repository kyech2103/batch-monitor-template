// 자재 창고 화면 (옛 js/warehouse_app.js). 메인 창 안 창과 새 창이 같은 화면을 띄운다
import { useEffect, useRef, useState, useSyncExternalStore, type DragEvent } from 'react';
import * as W from './model';
import { ROOMS, audit, roomStore, sendToRoom, type WarehouseRoom } from '../rooms';
import { openTransferPopover } from '../../subapp/TransferPopover';
import { downloadCSV, downloadPNG, downloadSnapshotHTML, fileName } from '../export';
import { ExportMenu, SyncBadge, useToast } from '../ui';

export function WarehouseApp({ room }: { room: WarehouseRoom }) {
  const store = roomStore(room);
  const m = useSyncExternalStore(store.subscribe, store.get);
  const status = useSyncExternalStore(store.subscribe, store.status);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ uid: string; loc: W.Loc; name: string } | null>(null);
  const dragged = useRef<{ uid: string; from: W.Loc } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null), rootRef = useRef<HTMLDivElement>(null), editInput = useRef<HTMLInputElement>(null);
  const [toast, showToast] = useToast();

  useEffect(() => { store.start(); }, [store]);
  useEffect(() => { if (editing && !dialog.current?.open) dialog.current?.showModal(); }, [editing]);
  const run = (fn: (d: W.WarehouseModel) => W.Log | void) => store.edit(d => { audit(room, fn(d)); });
  const closeEdit = () => { dialog.current?.close(); setEditing(null); };

  const dropZone = (loc: W.Loc) => ({
    'data-location': loc,
    onDragOver: (e: DragEvent) => { e.preventDefault(); (e.currentTarget as HTMLElement).classList.add('drag-over'); },
    onDragLeave: (e: DragEvent) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) (e.currentTarget as HTMLElement).classList.remove('drag-over'); },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).classList.remove('drag-over');
      const d = dragged.current;
      dragged.current = null;
      if (d && d.from !== loc) run(x => W.moveItem(x, d.uid, d.from, loc));
    }
  });

  const card = (it: W.WItem, loc: W.Loc) => (
    <div key={it.uid} className="item-card" draggable data-uid={it.uid}
      onDragStart={e => { e.stopPropagation(); dragged.current = { uid: it.uid, from: loc }; e.currentTarget.classList.add('is-dragging'); e.dataTransfer.setData('text/plain', it.uid); }}
      onDragEnd={e => { e.currentTarget.classList.remove('is-dragging'); dragged.current = null; rootRef.current?.querySelectorAll('.drag-over').forEach(x => x.classList.remove('drag-over')); }}
      onClick={() => setEditing({ uid: it.uid, loc, name: it.name })}>
      <span className="item-icon">📦</span>
      <span className="item-text">{it.name}</span>
      <div className="item-card-actions" data-export="hide">
        <button type="button" className="item-transfer-btn" title="다른 구역으로 품목 이동" onClick={e => {
          e.stopPropagation();
          openTransferPopover(e.currentTarget, it.name, ROOMS.filter(r => r.id !== room.id), target => {
            store.edit(d => { W.removeItem(d, it.uid, loc); });
            sendToRoom(room, target.id, { uid: it.uid || 'item_' + Date.now(), text: it.name, desc: it.desc || `${room.name} 전송`, color: it.color }, W.locName(loc));
            showToast(`✅ [${it.name}]을(를) ${target.name}(으)로 전송했습니다.`);
          });
        }}>🚚</button>
        <button type="button" className="item-del-btn" title="삭제" onClick={e => { e.stopPropagation(); run(d => W.deleteItem(d, it.uid, loc)); }}>✕</button>
      </div>
    </div>
  );

  const addNew = () => {
    const v = name.trim();
    if (!v) { alert('보관할 품목명을 입력해 주세요.'); return; }
    run(d => W.addItem(d, v, 'tray'));
    setName('');
  };
  const rows = W.BAY_IDS.flatMap(id => (m.bays[id] || []).map(it => ({ id, it })));

  return (
    <div className="wh-app" data-room-app={room.id} ref={rootRef}>
      <header>
        <div className="header-title-group">
          <h1>🏢 자재 창고 선반 보관 배치 현황 (와이드 랙)</h1>
          <div className="header-sub">가로형 4단 × 2열(좌/우 총 8구역) 보관 랙 실시간 적재 및 재고 관리 시스템</div>
        </div>
        <div className="shelf-unified-toolbar" data-export="hide">
          <div className="toolbar-group">
            <span className="add-label">➕ 보관 품목 등록:</span>
            <input type="text" className="pt-input new-item-name" placeholder="보관 품목명 입력..." value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addNew(); }} />
            <button type="button" className="pt-btn pt-btn--primary btn-add-new-item" onClick={addNew}>등록</button>
          </div>
          <div className="toolbar-group">
            <SyncBadge status={status} />
            <button type="button" className="pt-btn pt-btn--secondary btn-manual-sync" title="서버에 지금 저장" onClick={() => store.save()}>🔄 동기화</button>
          </div>
          <div className="toolbar-group">
            <ExportMenu items={[
              ['💾 HTML 저장', () => downloadSnapshotHTML(rootRef.current!, fileName('자재 창고_선반_배치표_{date}.html'), '자재 창고 선반 보관 배치 현황')],
              ['📷 PNG 저장', () => downloadPNG(rootRef.current!.querySelector('.warehouse-container')!, fileName('자재 창고_선반_배치도_{date}.png')).catch(err => alert('이미지 생성 중 오류가 발생했습니다: ' + err.message))],
              ['📥 CSV 다운로드', () => downloadCSV(fileName('자재 창고_보관현황_{date}.csv'), W.toCSV(m))]
            ]} />
            <button type="button" className="pt-btn pt-btn--secondary btn-reset-default" title="기본 보관 품목으로 복원" onClick={() => { if (confirm('기본 보관 배치 데이터로 복원하시겠습니까?')) run(W.resetDefault); }}>기본값 복원</button>
            <button type="button" className="pt-btn pt-btn--danger btn-clear-all" title="전체 선반 비우기" onClick={() => { if (confirm('모든 선반 구역의 품목을 비우시겠습니까?')) run(W.clearBays); }}>전체 비우기</button>
          </div>
        </div>
      </header>

      <div className="controls-panel">
        <div className="tray-row">
          <span className="tray-title">📥 대기 품목함 (선반으로 드래그):</span>
          <div className="tray-items" {...dropZone('tray')}>{m.tray.map(it => card(it, 'tray'))}</div>
        </div>
      </div>

      <div className="warehouse-container">
        <div className="rack-column-headers">
          <div className="col-header-box col-header-left"><span>⬅️ 좌측 선반 (1열)</span><span className="col-header-badge">4단 수직 랙</span></div>
          <div className="col-header-box col-header-right"><span>➡️ 우측 선반 (2열)</span><span className="col-header-badge">4단 수직 랙</span></div>
        </div>
        <div className="wide-shelf-rack">
          {['4', '3', '2', '1'].map(n => (
            <div key={n} className="tier-row" data-tier={n}>
              {['left', 'right'].map(side => {
                const id = `${n}-${side}`, items = m.bays[id] || [];
                return (
                  <div key={id} className={`shelf-bay bay-${side}`} data-bay-id={id} {...dropZone(id)}>
                    <div className="bay-header">
                      <span className="bay-tag">📍 {n}단 - {side === 'left' ? '좌측' : '우측'} 선반</span>
                      <span className="bay-capacity">{items.length}개 품목</span>
                    </div>
                    <div className="bay-items-container">
                      {items.length ? items.map(it => card(it, id)) : (
                        <div className="bay-empty-hint" onClick={() => {
                          const v = prompt('해당 선반 구역에 등록할 품목명을 입력하세요:')?.trim();
                          if (v) run(d => W.addItem(d, v, id));
                        }}>+ 빈 선반 구역 (클릭하여 등록 또는 품목 드래그)</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="wh-summary-card">
        <div className="summary-header">
          <span className="summary-title">📋 자재 창고 선반 보관 품목 일람표</span>
          <span className="summary-count">총 {rows.length}개 품목 보관 중</span>
        </div>
        <table className="summary-table">
          <thead><tr><th style={{ width: 60, textAlign: 'center' }}>No</th><th style={{ width: 240 }}>보관 위치</th><th>보관 품목명</th><th style={{ width: 100, textAlign: 'center' }}>관리</th></tr></thead>
          <tbody>
            {rows.map(({ id, it }, i) => (
              <tr key={it.uid}>
                <td className="cell-no">{i + 1}</td>
                <td><strong className="cell-loc">{W.locName(id)}</strong></td>
                <td><strong className="cell-name">{it.name}</strong></td>
                <td style={{ textAlign: 'center' }}><button type="button" className="btn-table-del" title="삭제" onClick={() => run(d => W.deleteItem(d, it.uid, id))}>🗑️ 삭제</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dialog ref={dialog} className="detail-modal" onClose={() => setEditing(null)}>
        {editing && (
          <div className="detail-container" key={editing.uid}>
            <div className="detail-header">
              <h3>📦 품목 정보 수정 ({editing.name})</h3>
              <button type="button" className="item-del-btn detail-close" onClick={closeEdit}>✕</button>
            </div>
            <div className="form-group">
              <label>품목명
                <input type="text" className="form-control" placeholder="품목명 입력" defaultValue={editing.name} ref={editInput} />
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-detail-delete" onClick={() => {
                if (!confirm('이 품목을 삭제하시겠습니까?')) return;
                run(d => W.deleteItem(d, editing.uid, editing.loc));
                closeEdit();
              }}>🗑️ 삭제</button>
              <button type="button" className="btn-primary" onClick={() => {
                const v = editInput.current!.value.trim();
                if (!v) { alert('품목명을 입력해 주세요.'); return; }
                run(d => W.renameItem(d, editing.uid, editing.loc, v));
                closeEdit();
              }}>💾 저장</button>
            </div>
          </div>
        )}
      </dialog>
      {toast}
    </div>
  );
}
