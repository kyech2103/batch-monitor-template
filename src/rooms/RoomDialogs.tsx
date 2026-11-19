// 메인 화면의 선반·창고 창. 새 창(sub_*)과 같은 화면을 창 안에 바로 띄운다 (처음 열 때 그린다)
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { bindDialogButtons } from '../main/dialog';
import { ShelfApp } from './shelf/ShelfApp';
import { WarehouseApp } from './warehouse/WarehouseApp';
import { roomById, roomStore, type Room, type ShelfRoom } from './rooms';
import type { TransferItem } from './store';

export const RoomApp = ({ room }: { room: Room }) => (room.kind === 'shelf' ? <ShelfApp room={room} /> : <WarehouseApp room={room} />);

// 방 id → 창 id, 머리 단추 id 앞부분, 새 창 주소
const DIALOGS: Record<string, [string, string, string]> = {
  toolroom: ['toolroom-shelf-modal', 'modal-btn', './sub_toolroom/Index.html'],
  supplies: ['supplies-modal', 'supplies-modal-btn', './sub_supplies/Index.html'],
  'pack-supplies': ['pack-supplies-modal', 'pack-supplies-modal-btn', './sub_packaging/Index.html'],
  'warehouse-main': ['warehouse-modal', 'warehouse-modal-btn', './sub_warehouse/Index.html']
};

declare global { interface Window { openRoom?(id: string): void } }

export function setupRoomDialogs(): void {
  const mounted = new Set<string>();
  for (const [id, [dialogId, btn, url]] of Object.entries(DIALOGS)) {
    const dialog = document.getElementById(dialogId) as HTMLDialogElement | null;
    if (dialog) bindDialogButtons(dialog, { close: `${btn}-close`, external: `${btn}-external`, maximize: `${btn}-maximize` }, () => url);
  }
  window.openRoom = id => {
    const [dialogId] = DIALOGS[id] || [];
    const dialog = dialogId && document.getElementById(dialogId) as HTMLDialogElement | null;
    if (!dialog) return;
    if (!mounted.has(id)) {
      mounted.add(id);
      flushSync(() => createRoot(dialog.querySelector('.room-root')!).render(<RoomApp room={roomById(id)} />));
    }
    if (!dialog.open) dialog.showModal();
  };
}

/** 옛 화면이 이 기기에 남긴 '보냈지만 아직 못 받은' 품목을 받는 방에 넣는다.
 *  shortcut: 옛 iframe 중계(APP_PENDING_CROSS_ROOM_ITEMS)에서 넘어올 때 한 번 필요한 것, 2027년쯤 지운다 */
export function drainOldPendingTransfers(): void {
  const KEY = 'APP_PENDING_CROSS_ROOM_ITEMS';
  let map: Record<string, { item?: TransferItem & { name?: string }; fromRoomName?: string }[]>;
  try { map = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return; }
  localStorage.removeItem(KEY);
  for (const [id, list] of Object.entries(map)) {
    const room = DIALOGS[id] && roomById(id);
    for (const p of Array.isArray(list) ? list : []) {
      if (room && p.item?.uid) roomStore(room as ShelfRoom).receive({ ...p.item, text: p.item.text || p.item.name || '품목' }, p.fromRoomName || '다른 구역');
    }
  }
}
