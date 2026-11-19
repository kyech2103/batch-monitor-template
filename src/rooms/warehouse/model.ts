// 자재 창고: 4단 × 좌/우 8칸과 대기 품목함 (옛 js/warehouse_app.js의 데이터)
import type { TransferItem } from '../store.ts';

export interface WItem { uid: string; name: string; desc?: string; color?: string }
export interface WarehouseModel { bays: Record<string, WItem[]>; tray: WItem[] }
export type Loc = string; // 칸 id 또는 'tray'
export type Log = [string, string, string, string, string];

export const BAY_IDS = ['4-left', '4-right', '3-left', '3-right', '2-left', '2-right', '1-left', '1-right'];
const TIER_NAMES: Record<string, string> = { 4: '4단 (상단)', 3: '3단 (중상단)', 2: '2단 (중하단)', 1: '1단 (하단)' };
export const locName = (loc: Loc) => {
  if (loc === 'tray') return '대기 품목함';
  const [n, side] = loc.split('-');
  return TIER_NAMES[n] ? `${TIER_NAMES[n]} - ${side === 'left' ? '좌측' : '우측'}` : loc || '-';
};

export const DEFAULT_MODEL: WarehouseModel = {
  bays: {
    '4-left': [{ uid: 'W-4L-1', name: '접이식 운반 카트 (핸드카트)' }],
    '4-right': [{ uid: 'W-4R-1', name: '완충 에어캡 롤 (뽁뽁이)' }],
    '3-left': [{ uid: 'W-3L-1', name: '포장용 OPP 박스 테이프' }],
    '3-right': [{ uid: 'W-3R-1', name: '스트레치 필름 롤' }],
    '2-left': [{ uid: 'W-2L-1', name: '골판지 아웃박스 (중형)' }],
    '2-right': [{ uid: 'W-2R-1', name: '골판지 아웃박스 (대형)' }],
    '1-left': [{ uid: 'W-1L-1', name: '플라스틱 파렛트 (예비)' }],
    '1-right': [{ uid: 'W-1R-1', name: '바코드 라벨 용지 롤' }]
  },
  tray: [{ uid: 'T-1', name: '디스펜서 테이프 커터기' }, { uid: 'T-2', name: '청결용 소독 분무기' }]
};

const list = (m: WarehouseModel, loc: Loc) => (loc === 'tray' ? m.tray : (m.bays[loc] ||= []));

/** 서버 행·이 기기 사본 → 모델 (칸이 없으면 쓸 수 없는 값) */
export function parse(v: unknown): WarehouseModel | null {
  const d = v as Partial<WarehouseModel> | null;
  return d?.bays && typeof d.bays === 'object' ? { bays: d.bays, tray: Array.isArray(d.tray) ? d.tray : [] } : null;
}

export function removeItem(m: WarehouseModel, uid: string, loc: Loc): WItem | undefined {
  const l = list(m, loc), i = l.findIndex(x => x.uid === uid);
  return i < 0 ? undefined : l.splice(i, 1)[0];
}

export function deleteItem(m: WarehouseModel, uid: string, loc: Loc): Log | void {
  const it = removeItem(m, uid, loc);
  if (it) return ['품목 삭제', it.name, locName(loc), '-', `[${it.name}] 보관 품목 삭제 (${locName(loc)})`];
}

export function moveItem(m: WarehouseModel, uid: string, from: Loc, to: Loc): Log | void {
  if (from === to) return;
  const it = removeItem(m, uid, from);
  if (!it) return;
  list(m, to).push(it);
  return ['위치 이동', it.name, locName(from), locName(to), `[${it.name}] 위치 이동: ${locName(from)} ➔ ${locName(to)}`];
}

/** 대기 품목함 맨 앞(상단 등록) 또는 칸 맨 끝(빈 칸 눌러 등록)에 새 품목 */
export function addItem(m: WarehouseModel, name: string, loc: Loc): Log {
  const it = { uid: 'ITEM-' + Date.now(), name };
  if (loc === 'tray') { m.tray.unshift(it); return ['신규 등록', name, '-', '대기 품목함', `[${name}] 신규 품목 등록 (대기 품목함)`]; }
  list(m, loc).push(it);
  return ['신규 등록', name, '-', locName(loc), `[${name}] 선반 직접 등록 (${locName(loc)})`];
}

export function renameItem(m: WarehouseModel, uid: string, loc: Loc, name: string): Log | void {
  const it = list(m, loc).find(x => x.uid === uid);
  if (!it || it.name === name) return;
  const old = it.name;
  it.name = name;
  return ['정보 수정', name, old, name, `품목명 수정: '${old}' ➔ '${name}'`];
}

export function clearBays(m: WarehouseModel): Log {
  BAY_IDS.forEach(id => { m.bays[id] = []; });
  return ['전체 비우기', '전체 품목', '선반 전체', '-', '모든 선반 구역 품목 일괄 비움'];
}

export function resetDefault(m: WarehouseModel): Log {
  const d = JSON.parse(JSON.stringify(DEFAULT_MODEL));
  m.bays = d.bays;
  m.tray = d.tray;
  return ['기본 복원', '기본 세트', '-', '선반 전체', '기본 보관 데이터로 복원'];
}

export const hasUid = (m: WarehouseModel, uid: string) => m.tray.some(i => i.uid === uid) || BAY_IDS.some(id => (m.bays[id] || []).some(i => i.uid === uid));

export function arrive(m: WarehouseModel, it: TransferItem, fromName: string): void {
  m.tray.unshift({ uid: it.uid, name: it.text || '품목', desc: `${fromName} 전송`, color: it.color || it.customColor || '#38bdf8' });
}

export function toCSV(m: WarehouseModel): string {
  let csv = '﻿No,구역,단,위치,보관품목,색상\n', n = 0;
  const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const row = (zone: string, tier: string, side: string, it: WItem) => { csv += [++n, zone, tier, side, it.name, it.color].map(cell).join(',') + '\n'; };
  BAY_IDS.forEach(id => { const [t, side] = id.split('-'); (m.bays[id] || []).forEach(it => row('선반', `${t}단`, side === 'left' ? '좌측' : '우측', it)); });
  m.tray.forEach(it => row('대기 품목함', '-', '-', it));
  return csv;
}
