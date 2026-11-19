// 선반 3종·자재 창고 방 목록, 방마다 저장소 하나, 방 사이 품목 보내기, 작업 기록
import { sb } from '../sb';
import { pushAudit } from '../main/audit';
import { createRoomStore, drag, type RoomKind, type RoomStore, type TransferItem } from './store';
import * as S from './shelf/model';
import * as W from './warehouse/model';
import toolroom from './shelf/defaults/toolroom.json';
import supplies from './shelf/defaults/supplies.json';
import packaging from './shelf/defaults/packaging.json';

interface Base { id: string; name: string; icon: string; dbId: string; storageKey: string; channel: string; immediate: boolean }
export interface ShelfRoom extends Base {
  kind: 'shelf';
  /** 없앤 단 이름 (품목이 없으면 화면에서 뺀다) */
  removedTier: string | null;
  /** 품목·칸 밖을 누르면 선택을 푼다 */
  outsideClickClears: boolean;
  /** 앞 3단은 좌측, 나머지는 우측 선반으로 나눠 그린다 */
  split: boolean;
  emptyHint: string | null;
  exportNames: { png: string; html: string; csv: string };
  title: string; sub: string; boards: { title: string; sub: string; pill: string }[];
  /** 처음 연 기기의 기본 배치 */
  defaults: S.ShelfModel;
}
export interface WarehouseRoom extends Base { kind: 'warehouse' }
export type Room = ShelfRoom | WarehouseRoom;

const WORKSHOP_SUB = '작업장 선반 구역별 적재함 및 보관 품목 현황입니다. 필요 시 장비 블럭을 드래그하여 위치를 조정하거나 신규 블럭을 추가할 수 있습니다.';
export const ROOMS: Room[] = [
  {
    kind: 'shelf', id: 'toolroom', name: '부품 보관실 선반', icon: '🔧', dbId: 'toolroom', storageKey: 'SHELF_MAINTENANCE_DATA_V1', channel: 'shelf-toolroom',
    immediate: true, removedTier: '방출', outsideClickClears: false, split: false, emptyHint: null,
    exportNames: { png: '선반_정리_유지본_배치도_{date}.png', html: '선반_정리_유지본_{date}.html', csv: '선반_정리_유지관리_목록_{date}.csv' },
    title: '📋 작업장 선반 정리 현황 및 유지 관리표', sub: '완료된 재배치 배치를 상시 점검하고, 신규 부품 수용 및 위치 변동을 실시간 관리',
    boards: [{ title: '📦 작업장 선반 보관 배치도', sub: WORKSHOP_SUB, pill: '현재 배치' }],
    defaults: toolroom as S.ShelfModel
  },
  {
    kind: 'shelf', id: 'supplies', name: '비품실', icon: '🧰', dbId: 'supplies', storageKey: 'SHELF_SUPPLIES_MAINTENANCE_DATA_V1', channel: 'shelf-supplies',
    immediate: false, removedTier: null, outsideClickClears: true, split: false, emptyHint: '📦 비품을 드래그하여 배치하세요',
    exportNames: { png: '비품실_선반_배치도_{date}.png', html: '비품실_선반_유지본_{date}.html', csv: '비품실_선반_보관_목록_{date}.csv' },
    title: '📦 비품실 선반 정리 현황 및 유지 관리표', sub: '비품실 선반 보관 배치를 상시 점검하고, 신규 비품 수용 및 위치 변동을 실시간 관리',
    boards: [{ title: '📦 비품실 선반 보관 배치표', sub: '비품실 선반 구역별 적재함 및 보관 품목 현황입니다. 비품 블록을 드래그하여 위치를 조정하거나 상단에서 신규 비품을 추가할 수 있습니다.', pill: '현재 배치' }],
    defaults: supplies as S.ShelfModel
  },
  {
    kind: 'shelf', id: 'pack-supplies', name: '포장 비품실', icon: '📦', dbId: 'packaging', storageKey: 'SHELF_PACK_SUPPLIES_DATA_V1', channel: 'shelf-packaging',
    immediate: false, removedTier: null, outsideClickClears: false, split: true, emptyHint: null,
    exportNames: { png: '선반_정리_유지본_배치도_{date}.png', html: '포장비품실_선반_유지본_{date}.html', csv: '선반_정리_유지관리_목록_{date}.csv' },
    title: '📦 포장 비품실 선반 보관 배치 현황 및 유지 관리표', sub: '포장 비품실 좌/우 선반(각 3단)의 보관 현황을 실시간 관리하고 비품 위치 변동 및 재고를 관리합니다.',
    boards: [
      { title: '📦 좌측 선반 (선반 1)', sub: '포장 비품실 좌측 3단 보관 선반 (상단 / 중단 / 하단)', pill: '1호 선반 (좌측)' },
      { title: '📦 우측 선반 (선반 2)', sub: '포장 비품실 우측 3단 보관 선반 (상단 / 중단 / 하단)', pill: '2호 선반 (우측)' }
    ],
    defaults: packaging as S.ShelfModel
  },
  { kind: 'warehouse', id: 'warehouse-main', name: '자재 창고', icon: '🏢', dbId: 'warehouse_main', storageKey: 'SHELF_MAIN_WAREHOUSE_DATA_V4', channel: 'shelf-warehouse', immediate: true }
];
export const roomById = (id: string) => ROOMS.find(r => r.id === id)!;

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const shelfKind = (r: ShelfRoom): RoomKind<S.ShelfModel> => ({
  initial: () => ({ toBe: S.dropRemovedTiers(clone(r.defaults.toBe), r.removedTier), custom: clone(r.defaults.custom) }),
  fromLocal: v => {
    const d = v as Partial<S.ShelfModel> | null;
    return Array.isArray(d?.toBe) && d.toBe.length ? { toBe: S.dropRemovedTiers(d.toBe, r.removedTier), custom: Array.isArray(d.custom) ? d.custom : [] } : null;
  },
  fromServer: (v, cur) => S.fromServer(v, cur, r.removedTier),
  has: S.hasUid,
  arrive: S.arrive
});
const warehouseKind: RoomKind<W.WarehouseModel> = { initial: () => clone(W.DEFAULT_MODEL), fromLocal: W.parse, fromServer: W.parse, has: W.hasUid, arrive: W.arrive };

const stores = new Map<string, RoomStore<unknown>>();
export function roomStore(r: ShelfRoom): RoomStore<S.ShelfModel>;
export function roomStore(r: WarehouseRoom): RoomStore<W.WarehouseModel>;
export function roomStore(r: Room): RoomStore<unknown> {
  let s = stores.get(r.id);
  if (!s) {
    const kind = (r.kind === 'shelf' ? shelfKind(r) : warehouseKind) as RoomKind<unknown>;
    s = createRoomStore(sb, { dbId: r.dbId, name: r.name, storageKey: r.storageKey, channel: r.channel, immediate: r.immediate, kind });
    stores.set(r.id, s);
  }
  return s;
}

/** 작업 기록 한 줄 (방 이름을 구역으로) */
export const audit = (room: Room, log: S.Log | W.Log | void) => {
  if (log) pushAudit({ zone: room.name, action: log[0], item: log[1], from: log[2], to: log[3], detail: log[4] });
};

/** 다른 방의 대기 품목함으로 보낸다. 받는 방이 이 창에 안 열려 있어도 서버에서 읽어 넣고 저장한다 */
export function sendToRoom(from: Room, toId: string, item: TransferItem, fromLoc: string): void {
  const to = roomById(toId);
  audit(from, ['구역 간 물건 이동', item.text, `${from.name} (${fromLoc})`, `${to.name} (대기 품목함)`, `[${item.text}] ${from.name} ➔ ${to.name} 전송`]);
  (roomStore(to as ShelfRoom) as RoomStore<unknown>).receive(item, from.name);
}

// 끌기 중에는 서버 값으로 바꾸지 않는다 (store.ts drag)
addEventListener('dragstart', () => { drag.active = true; });
addEventListener('dragend', () => { drag.active = false; });
addEventListener('drop', () => { drag.active = false; });
