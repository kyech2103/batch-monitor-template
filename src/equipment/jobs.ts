// 장비 작업 목록: 서버에서 읽고, 바뀌면(실시간) 다시 읽고, 끝난 작업을 지운다. 평면도 카드·PC 창이 같이 본다
import { useSyncExternalStore } from 'react';
import { sb } from '../sb';
import { showToast } from '../main/toast';
import type { Job } from './core';

let jobs: Job[] = [];
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(f => f());

export const getJobs = () => jobs;
export const useJobs = () => useSyncExternalStore(f => { listeners.add(f); return () => { listeners.delete(f); }; }, getJobs);

export async function fetchJobs(): Promise<void> {
  try {
    const { data, error } = await sb.from('equipment_jobs').select('*').order('created_at', { ascending: true });
    if (!error && data) { jobs = data; notify(); }
  } catch (e) {
    console.warn('fetchEquipmentJobs error:', e);
  }
}

export async function deleteJob(id: Job['id']): Promise<void> {
  try {
    const { error } = await sb.from('equipment_jobs').delete().eq('id', id);
    if (error) throw error;
    showToast('🗑️ 장비 작업이 정리(삭제)되었습니다.');
    await fetchJobs();
  } catch (e) {
    console.error('deleteEquipmentJob error:', e);
    showToast('❌ 작업 삭제에 실패했습니다.');
  }
}

/** 시작할 때 한 번: 처음 읽기와 실시간 구독 */
export function startJobs(): void {
  fetchJobs();
  try {
    sb.channel('equipment_jobs_changes').on('postgres_changes', { event: '*', schema: 'public', table: 'equipment_jobs' }, () => fetchJobs()).subscribe();
  } catch (e) {
    console.warn('initEquipmentRealtime error:', e);
  }
}
