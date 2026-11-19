// 선반 배치 편집 (옛 js/shelf_app.js의 편집 함수들). 모델 사본을 고치고 작업 기록 한 줄을 돌려준다.
// 막아야 할 편집은 Error(화면에 보일 문장)를 던진다
import type { TransferItem } from '../store.ts';

export type ColType = 'single' | 'grid2x2' | 'split2' | 'split_1_4' | 'split_4_1' | 'grid2x4';
export interface Item { uid: string; text: string; cat?: string; customColor?: string | null; containerType?: string; origText?: string; origLoc?: string; fromLoc?: string }
export interface Slot { slotName: string; items: Item[] }
export interface Column { colId: string; label: string; colType?: ColType; slots: Slot[] }
export interface Tier { tierId?: string; tierTitle: string; columns: Column[] }
/** toBe: 선반, custom: 대기 품목함 */
export interface ShelfModel { toBe: Tier[]; custom: Item[] }
/** 작업 기록: 동작, 품목, 이전 위치, 새 위치, 내용 */
export type Log = [string, string, string, string, string];
export type UnitPos = 'single' | 'top' | 'bottom';
/** 옮길 품목: 대기 품목함의 것(uid) 또는 선반 칸의 것(위치) */
export type SlotRef = { t: number; c: number; s: number; i: number };
export type ItemRef = { uid: string; fromLoc?: string } | SlotRef;

const STACKED: ColType[] = ['split2', 'split_1_4', 'split_4_1', 'grid2x4'];
export const isStacked = (col: Column) => STACKED.includes(col.colType || 'single');
export const isTop4 = (col: Column) => col.colType === 'split_4_1' || col.colType === 'grid2x4';
export const isBot4 = (col: Column) => col.colType === 'split_1_4' || col.colType === 'grid2x4';
export const is4Wide = (col: Column) => col.colType === 'grid2x2' || isTop4(col) || isBot4(col);
/** 2단 적층에서 아래 적재함이 시작하는 칸 번호 */
export const botOffset = (col: Column) => (isTop4(col) ? 4 : 1);
export const slotLoc = (tier: Tier, col: Column, slot: Slot) => `${tier.tierTitle} ${col.label} [${slot.slotName}]`;
const copySlots = (slots: Slot[]) => slots.map(s => ({ slotName: s.slotName, items: [...s.items] }));
const GRID4 = ['1행-좌', '1행-우', '2행-좌', '2행-우'];
const stackType = (top: '1단' | '4구', bot: '1단' | '4구'): ColType =>
  top === '1단' ? (bot === '1단' ? 'split2' : 'split_1_4') : (bot === '1단' ? 'split_4_1' : 'grid2x4');

/** 열을 다른 자리(다른 단 포함)로. destC가 -1이면 그 단 맨 끝 */
export function moveColumn(m: ShelfModel, sT: number, sC: number, dT: number, dC: number): Log | void {
  if (sT === dT && sC === dC) return;
  const src = m.toBe[sT], dest = m.toBe[dT];
  if (!src || !dest) return;
  const [col] = src.columns.splice(sC, 1);
  if (!col) return;
  if (dC === -1 || dC >= dest.columns.length) dest.columns.push(col); else dest.columns.splice(dC, 0, col);
  const name = col.label || '선반 구역';
  return ['선반 이동', name, src.tierTitle, dest.tierTitle, `[${name}] 선반 위치 이동: ${src.tierTitle} ➔ ${dest.tierTitle}`];
}

/** 2단 적층을 1단 두 개로 나눠 나란히 둔다 */
export function unstack(m: ShelfModel, t: number, c: number): Log | void {
  const col = m.toBe[t]?.columns[c];
  if (!col || !isStacked(col)) return;
  const top4 = isTop4(col), bot4 = isBot4(col), off = botOffset(col);
  const [topLabel, botLabel] = col.label.includes(' + ')
    ? [col.label.split(' + ')[0].trim(), col.label.split(' + ').slice(1).join(' + ').trim()]
    : [`${col.label} (상단)`, `${col.label} (하단)`];
  const items = (i: number) => (col.slots[i] ? [...col.slots[i].items] : []);
  const half = (four: boolean, start: number, label: string, suffix: string): Column => ({
    colId: `col_unit_${Date.now()}_${suffix}`, label, colType: four ? 'grid2x2' : 'single',
    slots: four ? GRID4.map((slotName, i) => ({ slotName, items: items(start + i) }))
      : [{ slotName: col.slots[start] && col.slots[start].slotName !== '보관함' ? col.slots[start].slotName : '단일 구역', items: items(start) }]
  });
  m.toBe[t].columns.splice(c, 1, half(top4, 0, topLabel, 'top'), half(bot4, off, botLabel, 'bot'));
  return ['선반 적층해제', col.label, `2단 적층 (${m.toBe[t].tierTitle})`, `${topLabel} / ${botLabel} (1단 분리)`, `[${col.label}] 2단 적층 선반을 각각 1단으로 분리`];
}

/** 적재함 하나를 열에서 떼어 낸다. 1단 열이면 열이 통째로 빠지고, 2단 적층이면 남은 쪽이 1단 열로 남는다 */
function extract(m: ShelfModel, t: number, c: number, pos: UnitPos) {
  const col = m.toBe[t]?.columns[c];
  if (!col) return null;
  if (!isStacked(col)) {
    m.toBe[t].columns.splice(c, 1);
    return { type: col.colType === 'grid2x2' ? '4구' : '1단', label: col.label, slots: copySlots(col.slots) } as const;
  }
  const top4 = isTop4(col), bot4 = isBot4(col), off = botOffset(col);
  const parts = col.label.includes(' + ') ? col.label.split(' + ') : null;
  const topL = parts ? parts[0].trim() : `${col.label} (상단)`;
  const botL = parts ? parts.slice(1).join(' + ').trim() : `${col.label} (하단)`;
  const topSlots = top4 ? col.slots.slice(0, 4) : [col.slots[0]];
  const botSlots = col.slots.slice(off, off + (bot4 ? 4 : 1));
  const named = (s: Slot | undefined, fallback: string) => (s?.slotName && !s.slotName.includes('적재함') ? s.slotName : fallback);
  if (pos === 'top') {
    const out = { type: top4 ? '4구' : '1단', label: named(col.slots[0], topL), slots: copySlots(topSlots) } as const;
    Object.assign(col, { label: botL, colType: bot4 ? 'grid2x2' : 'single', slots: botSlots });
    return out;
  }
  const out = { type: bot4 ? '4구' : '1단', label: named(col.slots[off], botL), slots: copySlots(botSlots) } as const;
  Object.assign(col, { label: topL, colType: top4 ? 'grid2x2' : 'single', slots: topSlots });
  return out;
}

/** 적재함을 떼어 다른 단의 새 열로 (destC가 -1이면 맨 끝) */
export function moveUnitToShelf(m: ShelfModel, sT: number, sC: number, pos: UnitPos, dT: number, dC: number): Log | void {
  const ex = extract(m, sT, sC, pos);
  if (!ex) return;
  const col: Column = { colId: `col_unit_${Date.now()}`, label: ex.label, colType: ex.type === '4구' ? 'grid2x2' : 'single', slots: ex.slots };
  const dest = m.toBe[dT];
  if (dC === -1 || dC >= dest.columns.length) dest.columns.push(col); else dest.columns.splice(dC, 0, col);
  return ['적재함 이동', col.label, m.toBe[sT].tierTitle, dest.tierTitle, `[${col.label}] 적재함 분리 선반 이동: ${m.toBe[sT].tierTitle} ➔ ${dest.tierTitle}`];
}

/** 적재함을 다른 1단 적재함 위(top)나 아래(bottom)에 쌓아 2단으로 */
export function stackUnit(m: ShelfModel, sT: number, sC: number, sPos: UnitPos, dT: number, dC: number, where: 'top' | 'bottom'): Log | void {
  if (sT === dT && sC === dC) return;
  const dest = m.toBe[dT]?.columns[dC];
  if (!dest) return;
  if (isStacked(dest)) throw new Error('이미 2단으로 적층된 구역에는 더 이상 적재함을 올릴 수 없습니다. 필요시 먼저 적재함을 다른 곳으로 옮겨 분리하세요.');
  const destLabel = dest.label, destType: '1단' | '4구' = dest.colType === 'grid2x2' ? '4구' : '1단', destSlots = copySlots(dest.slots);
  const ex = extract(m, sT, sC, sPos);
  if (!ex) return;
  const onTop = where === 'top';
  const [topType, botType] = onTop ? [ex.type, destType] : [destType, ex.type];
  const [topSlots, botSlots] = onTop ? [ex.slots, destSlots] : [destSlots, ex.slots];
  const colType = stackType(topType, botType);
  if (topType === '1단') topSlots[0].slotName = '상단 적재함';
  else topSlots.forEach((s, i) => { s.slotName = ['상-1행좌', '상-1행우', '상-2행좌', '상-2행우'][i] || s.slotName; });
  if (botType === '1단') botSlots[0].slotName = '하단 적재함';
  else {
    const names = colType === 'grid2x4' ? ['하-3행좌', '하-3행우', '하-4행좌', '하-4행우'] : ['하-1행좌', '하-1행우', '하-2행좌', '하-2행우'];
    botSlots.forEach((s, i) => { s.slotName = names[i] || s.slotName; });
  }
  const clean = (s: string) => s.replace(/ \[상단\]| \[하단\]/g, '');
  dest.colType = colType;
  dest.slots = [...topSlots, ...botSlots];
  dest.label = `${clean(onTop ? ex.label : destLabel)} + ${clean(onTop ? destLabel : ex.label)}`;
  return ['선반 적층', `${ex.label} + ${destLabel}`, m.toBe[sT].tierTitle, dest.label, `[${ex.label}] 적재함을 [${destLabel}] ${onTop ? '상단' : '하단'}에 2단 적층`];
}

/** 적재함 지우기: 1단 열이면 열째로, 2단 적층이면 그 칸만 */
export function deleteUnit(m: ShelfModel, t: number, c: number, pos: UnitPos): Log | void {
  const col = m.toBe[t]?.columns[c];
  if (!col) return;
  if (!isStacked(col) || pos === 'single') {
    m.toBe[t].columns.splice(c, 1);
    return ['적재함 삭제', col.label, m.toBe[t].tierTitle, '-', `[${col.label}] 선반 구역 삭제`];
  }
  const top4 = isTop4(col), bot4 = isBot4(col), off = botOffset(col);
  if (pos === 'top') Object.assign(col, { colType: bot4 ? 'grid2x2' : 'single', slots: col.slots.slice(off, off + (bot4 ? 4 : 1)) });
  else Object.assign(col, { colType: top4 ? 'grid2x2' : 'single', slots: top4 ? col.slots.slice(0, 4) : [col.slots[0]] });
  return ['적재함 삭제', col.label, m.toBe[t].tierTitle, '-', `[${col.label}] 적재함 단위 삭제 (${pos})`];
}

export function addColumn(m: ShelfModel, t: number, label: string): void {
  m.toBe[t].columns.push({ colId: 'c_custom_' + Date.now(), label, colType: 'single', slots: [{ slotName: '신규 적재함', items: [] }] });
}

export function addTier(m: ShelfModel, title: string): Log {
  const col = (n: number): Column => ({ colId: `c_new_${n}`, label: `${n}열`, colType: 'single', slots: [{ slotName: '신규 적재 구역', items: [] }] });
  m.toBe.push({ tierId: 'tier_custom_' + Date.now(), tierTitle: title, columns: [col(1), col(2)] });
  return ['선반 단 추가', title, '-', '선반 신규 단', `신규 선반 단 [${title}] 생성`];
}

export const itemCount = (col: Column) => col.slots.reduce((n, s) => n + s.items.length, 0);

export function deleteColumn(m: ShelfModel, t: number, c: number): Log {
  const [col] = m.toBe[t].columns.splice(c, 1);
  return ['선반 삭제', col.label, m.toBe[t].tierTitle, '-', `[${col.label}] 선반 열 구역 삭제 (포함 품목 ${itemCount(col)}개)`];
}

export function deleteTier(m: ShelfModel, t: number): Log {
  const [tier] = m.toBe.splice(t, 1);
  return ['선반 단 삭제', tier.tierTitle, tier.tierTitle, '-', `선반 단 [${tier.tierTitle}] 전체 삭제`];
}

export function renameColumn(m: ShelfModel, t: number, c: number, label: string): Log {
  const col = m.toBe[t].columns[c], old = col.label;
  col.label = label;
  return ['선반 이름 변경', label, old, label, `선반 구역 명칭 변경: '${old}' ➔ '${label}'`];
}

/** 적재함 머리 이름 바꾸기: 1단 적재함은 칸 이름, 쌓이지 않은 열은 열 이름도 */
export function renameUnit(m: ShelfModel, t: number, c: number, firstSlot: number, four: boolean, name: string): void {
  const col = m.toBe[t].columns[c];
  if (!four && col.slots[firstSlot]) col.slots[firstSlot].slotName = name;
  if (!isStacked(col)) col.label = name;
}

/** 품목을 칸에 넣는다. 대기 품목함에서 오면 새로 놓고, 선반 칸에서 오면 옮긴다 */
export function placeItem(m: ShelfModel, ref: ItemRef, t: number, c: number, s: number): Log | void {
  const tier = m.toBe[t], col = tier.columns[c], slot = col.slots[s];
  const toLoc = slotLoc(tier, col, slot);
  if ('uid' in ref) {
    const idx = m.custom.findIndex(b => b.uid === ref.uid);
    if (idx < 0) return;
    const it = m.custom[idx], fromLoc = ref.fromLoc || '대기함/미배치';
    m.custom.splice(idx, 1);
    slot.items.push({ uid: it.uid, containerType: it.containerType, text: it.text, origText: it.origText || it.text, cat: it.cat, customColor: it.customColor || null, origLoc: fromLoc });
    return ['물건 배치', it.text, fromLoc, toLoc, `[${it.text}] 선반 배치: ${fromLoc} ➔ ${toLoc}`];
  }
  const sTier = m.toBe[ref.t], sCol = sTier?.columns[ref.c], src = sCol?.slots[ref.s];
  if (!src || src === slot) return;
  const [it] = src.items.splice(ref.i, 1);
  if (!it) return;
  slot.items.push(it);
  const fromLoc = slotLoc(sTier, sCol, src);
  return ['물건 이동', it.text, fromLoc, toLoc, `[${it.text}] 선반 위치 이동: ${fromLoc} ➔ ${toLoc}`];
}

/** 품목 찾기 (대기 품목함 또는 선반 칸) */
export function findItem(m: ShelfModel, ref: ItemRef): Item | undefined {
  return 'uid' in ref ? m.custom.find(b => b.uid === ref.uid) : m.toBe[ref.t]?.columns[ref.c]?.slots[ref.s]?.items[ref.i];
}

/** 품목 빼기 (지우기·다른 방으로 보내기) */
export function removeItem(m: ShelfModel, ref: ItemRef): Item | undefined {
  if ('uid' in ref) { const i = m.custom.findIndex(b => b.uid === ref.uid); return i < 0 ? undefined : m.custom.splice(i, 1)[0]; }
  return m.toBe[ref.t]?.columns[ref.c]?.slots[ref.s]?.items.splice(ref.i, 1)[0];
}

export const refLoc = (m: ShelfModel, ref: ItemRef) => {
  if ('uid' in ref) return '대기 품목함';
  const tier = m.toBe[ref.t], col = tier.columns[ref.c];
  return slotLoc(tier, col, col.slots[ref.s]);
};

export function addTrayItem(m: ShelfModel, text: string, cat: string, customColor: string | null): Log {
  m.custom.push({ uid: `CUSTOM-${Date.now()}`, containerType: '사용자 생성 블럭', text, cat, customColor, fromLoc: '신규 등록 품목' });
  return ['물건 등록', text, '-', '대기 품목함', `[${text}] 신규 품목 등록 (대기 품목함)`];
}

export function clearShelf(m: ShelfModel): Log {
  m.toBe.forEach(t => t.columns.forEach(c => c.slots.forEach(s => { s.items = []; })));
  return ['배치 전체 초기화', 'To-Be 전체 데이터', '신규 배치(To-Be)', '-', '신규 배치의 모든 보관 품목 비우기'];
}

export const hasUid = (m: ShelfModel, uid: string) =>
  m.custom.some(b => b.uid === uid) || m.toBe.some(t => t.columns.some(c => c.slots.some(s => s.items.some(i => i.uid === uid))));

export function arrive(m: ShelfModel, it: TransferItem, fromName: string): void {
  m.custom.unshift({ uid: it.uid, text: it.text || '품목', cat: it.cat || 'equip', customColor: it.customColor || it.color || null, containerType: it.containerType || '이송 품목', origLoc: `${fromName} 전송` });
}

/** 방에서 없앤 단(부품 보관실 '방출'). 품목이 남아 있으면 지우지 않는다(데이터 유실 방지) */
export const dropRemovedTiers = (tiers: Tier[], title: string | null) =>
  title ? tiers.filter(t => t.tierTitle !== title || t.columns.some(c => c.slots.some(s => s.items.length > 0))) : tiers;

/** 서버 행의 data: 예전에는 선반 배열만 저장했다 */
export function fromServer(v: unknown, cur: ShelfModel, removed: string | null): ShelfModel | null {
  const d = v as Partial<ShelfModel> | Tier[];
  const toBe = Array.isArray(d) ? d : Array.isArray(d?.toBe) ? d.toBe : null;
  if (!toBe) return null;
  const custom = !Array.isArray(d) && Array.isArray(d.custom) ? d.custom : cur.custom;
  return { toBe: dropRemovedTiers(toBe, removed), custom };
}

const COLOR_NAMES: Record<string, string> = { red: '연한 빨강', blue: '연한 파랑', yellow: '연한 노랑', green: '연한 초록', white: '연한 흰색' };
/** CSV 내보내기 (엑셀에서 한글이 깨지지 않게 BOM을 붙인다) */
export function toCSV(m: ShelfModel): string {
  let csv = '﻿No,선반 단(위치),구역 및 적재함,보관 품목/장비명,용기/적재 형태,지정 색상,보관 상태\n', n = 0;
  const flat = (s: string) => s.replace(/,/g, ' ');
  m.toBe.forEach(t => t.columns.forEach(c => c.slots.forEach(s => s.items.forEach(it => {
    n++;
    const color = (it.customColor && COLOR_NAMES[it.customColor]) || '기본';
    csv += `"${n}","${flat(t.tierTitle)}","${flat(`${c.label} [${s.slotName}]`)}","${flat(it.text)}","${flat(it.containerType || '보관함')}","${color}","정상보관"\n`;
  }))));
  return csv;
}
