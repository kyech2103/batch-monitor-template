// 모바일 배치 목록의 공정별 묶음(공정1~공정5, 공정5 이후는 현장 흐름 순서대로 구역별)
export interface GroupItem { group: string; zoneId: string; sortKey?: number | null }
export interface ProcGroup<T extends GroupItem = GroupItem> { key: string; name: string; colorVar: string; after: boolean; items: T[] }

export const GROUP_DEFS = [
  { key: 'A', name: '공정1', colorVar: '--proc-a', zones: ['stage1-wait', 'stage1-1', 'stage1-2', 'stage1'] },
  { key: 'B', name: '공정2', colorVar: '--proc-b', zones: ['stage2-wait', 'stage2'] },
  { key: 'C', name: '공정3', colorVar: '--proc-c', zones: ['stage3-wait', 'stage3-1', 'stage3-2', 'stage3'] },
  { key: 'D', name: '공정4', colorVar: '--proc-d', zones: ['stage4-wait', 'stage4-1', 'stage4-2', 'stage4'] },
  { key: 'E', name: '공정5', colorVar: '--proc-e', zones: ['stage5-wait', 'stage5'] },
  // 반출실은 평면도처럼 검사 전 보관실로 본다
  { key: 'semi-pre', name: '반제품 보관실 (검사 전)', colorVar: '--pt-muted', after: true, zones: ['semi-discharge', 'semi-storage-pre'] },
  { key: 'inspection', name: '검사실', colorVar: '--pt-muted', after: true, zones: ['inspection'] },
  { key: 'semi-post', name: '반제품 보관실 (검사 후)', colorVar: '--pt-muted', after: true, zones: ['semi-storage-post'] },
  { key: 'packaging-wait', name: '포장 대기', colorVar: '--pt-muted', after: true, zones: ['packaging-wait'] },
  { key: 'packaging', name: '포장', colorVar: '--pt-muted', after: true, zones: ['packaging'] }
];

/** 구역을 모르면 공정5 직후 묶음으로 */
export function getZoneGroupKey(zoneId: string): string {
  return GROUP_DEFS.find(d => d.zones.includes(zoneId))?.key ?? 'semi-pre';
}

const priority = (g: string) => (g === 'progress' ? 1 : g === 'waiting' ? 2 : 3);
const sortKey = (m: GroupItem) => (m.sortKey != null && !isNaN(m.sortKey) ? m.sortKey : 0);

/** 완제품 창고는 빼고 묶는다. 묶음 안은 진행 → 대기 → 보관, 같은 종류는 sortKey 순 */
export function groupByProcess<T extends GroupItem>(models: T[]): ProcGroup<T>[] {
  const groups = GROUP_DEFS.map(d => ({ key: d.key, name: d.name, colorVar: d.colorVar, after: Boolean(d.after), items: [] as T[] }));
  const byKey = new Map(groups.map(g => [g.key, g]));
  for (const m of Array.isArray(models) ? models : []) {
    if (!m || m.group === 'logistics' || m.zoneId === 'logistics') continue;
    byKey.get(getZoneGroupKey(m.zoneId))!.items.push(m);
  }
  for (const g of groups) g.items.sort((a, b) => priority(a.group) - priority(b.group) || sortKey(a) - sortKey(b));
  return groups;
}
