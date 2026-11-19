// 공정 담당자 편성(process_managers id=1): 읽기, 실시간 갱신. 평면도 방 머리의 배지와 편성 창이 같이 본다
import { useSyncExternalStore } from 'react';
import { sb } from '../sb';

export type Managers = Record<string, string | null | undefined>;
/** 담당 자리 → 비어 있을 때 보이는 이름 */
export const PM_LABELS: Record<string, string> = {
  p1_a: '공정1-1', p1_b: '공정1-2', p2_a: '공정2-A', p2_b: '공정2-B', p2_c: '공정2-C', p3_a: '공정3-1', p3_b: '공정3-2',
  p4_a: '공정4-1', p4_b: '공정4-2', stage5: '공정5', pk_a: '포장-A', pk_b: '포장-B'
};

let managers: Managers = {};
const listeners = new Set<() => void>();
export const getManagers = () => managers;
export const setManagers = (m: Managers) => { managers = m; listeners.forEach(f => f()); };
export const useManagers = () => useSyncExternalStore(f => { listeners.add(f); return () => { listeners.delete(f); }; }, getManagers);

async function fetchManagers() {
  try {
    const { data, error } = await sb.from('process_managers').select('*').eq('id', 1).single();
    if (!error && data) setManagers(data);
  } catch (e) {
    console.warn('fetchProcessManagers error:', e);
  }
}

/** 시작할 때 한 번: 처음 읽기와 실시간 구독 */
export function startManagers(): void {
  fetchManagers();
  try {
    sb.channel('process_managers_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'process_managers' }, p => (p.new ? setManagers(p.new) : fetchManagers()))
      .subscribe();
  } catch (e) {
    console.warn('initProcessManagersRealtime error:', e);
  }
}
