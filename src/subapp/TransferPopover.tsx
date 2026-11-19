// 선반 3종·자재 창고 공용 "다른 구역으로 보내기" 팝오버. 무엇을 보내고 보낸 뒤 무엇을 할지는 각 화면(onSend)이 정한다
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';

export interface Room { id: string; name: string; icon: string }

let active: { el: HTMLElement; root: Root } | null = null;

function close() {
  if (!active) return;
  const { el, root } = active;
  active = null;
  root.unmount();
  el.remove();
}

// 팝오버 밖을 누르면 닫는다
window.addEventListener('click', e => { if (active && !active.el.contains(e.target as Node)) close(); });

function Popover({ itemName, rooms, onSend }: { itemName: string; rooms: Room[]; onSend(room: Room): void }) {
  const [sel, setSel] = useState(rooms[0]?.id);
  return (
    <>
      <div className="popover-header">
        <span className="popover-title">🚚 구역 간 물건 이동</span>
        <button type="button" className="popover-close-btn" title="닫기" onClick={close}>✕</button>
      </div>
      <div className="popover-item-name" title={itemName}>📦 {itemName}</div>
      <div className="popover-label">도착 대상 구역 선택:</div>
      <div className="popover-target-buttons">
        {rooms.map(r => (
          <button key={r.id} type="button" className={`popover-target-btn ${r.id === sel ? 'is-selected' : ''}`} onClick={() => setSel(r.id)}>
            <span>{r.icon}</span> <span>{r.name}</span>
          </button>
        ))}
      </div>
      <div className="popover-hint">선택한 구역의 <b>대기 품목함</b>으로 안전하게 이동됩니다.</div>
      <button type="button" className="popover-submit-btn" onClick={() => { const r = rooms.find(x => x.id === sel); close(); if (r) onSend(r); }}>🚀 지금 이동하기</button>
    </>
  );
}

/** anchor(누른 버튼) 아래에 화면 안에 맞춰 띄운다. 메인 창의 모달 창 안에서 눌렀으면 그 창 안에 둔다 (창 밖은 가려지고 눌리지 않는다) */
export function openTransferPopover(anchor: Element, itemName: string, rooms: Room[], onSend: (room: Room) => void): void {
  close();
  const el = document.createElement('div');
  el.className = 'floating-transfer-popover';
  // 이 클릭이 창의 "밖 클릭 닫기"로 번지지 않게
  el.addEventListener('click', e => e.stopPropagation());
  (anchor.closest('dialog') || document.body).appendChild(el);
  const root = createRoot(el);
  active = { el, root };
  flushSync(() => root.render(<Popover itemName={itemName} rooms={rooms} onSend={onSend} />));
  const rect = anchor.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  const left = Math.max(10, Math.min(rect.left, innerWidth - w - 10));
  let top = rect.bottom + 6;
  if (top + h > innerHeight - 10) top = Math.max(10, rect.top - h - 6);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}
