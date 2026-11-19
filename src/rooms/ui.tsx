// 선반·창고 화면 공용 조각: 동기화 상태 점, 내보내기 메뉴, 화면 아래 알림
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { SyncStatus } from './store';

export function SyncBadge({ status }: { status: SyncStatus }) {
  return (
    <div className="sync-status">
      <span className={`sync-dot${status.busy ? ' sync-indicator-pulse' : ''}${status.error ? ' is-error' : ''}`} />
      <span className="sync-text">{status.text}</span>
    </div>
  );
}

export function ExportMenu({ items }: { items: [string, () => unknown][] }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    addEventListener('click', close);
    addEventListener('keydown', esc);
    return () => { removeEventListener('click', close); removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className={`pt-dropdown${open ? ' is-open' : ''}`}>
      <button type="button" className="pt-btn pt-btn--secondary btn-export-menu" onClick={e => { e.stopPropagation(); setOpen(!open); }}>내보내기 ▾</button>
      {open && (
        <div className="pt-dropdown__menu" style={{ display: 'flex' }}>
          {items.map(([label, f]) => <button key={label} type="button" className="pt-dropdown__item" onClick={() => { setOpen(false); f(); }}>{label}</button>)}
        </div>
      )}
    </div>
  );
}

/** [알림 요소, 띄우기] */
export function useToast(): [ReactNode, (msg: string, ms?: number) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = (m: string, ms = 3000) => { setMsg(m); clearTimeout(timer.current); timer.current = setTimeout(() => setMsg(null), ms); };
  return [<div key="toast" className={`room-toast${msg ? ' is-visible' : ''}`} role="status">{msg}</div>, show];
}
