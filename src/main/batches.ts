// 이 탭의 배치 사본(localStorage APP_BATCH_RECORDS)을 화면에 알리는 곳. 쓰기는 batchSync(src/batch/sync.ts)만 한다
import { useSyncExternalStore } from 'react';
import type { Batch } from '../batch/core';
import { ZONES, getBatchZoneInfo, type ZoneInfo } from '../batch/zone';
import { createBatchSync } from '../batch/sync';
import { sb } from '../sb';
import { normalizeScheduleYears } from '../todo/core';

const KEY = 'APP_BATCH_RECORDS';
let raw: string | null = null, list: Batch[] = [], version = 0;
const listeners = new Set<() => void>();

export function readBatches(): Batch[] {
  const r = localStorage.getItem(KEY);
  if (r !== raw) {
    raw = r;
    try { const v = r ? JSON.parse(r) : []; list = Array.isArray(v) ? v : []; } catch { list = []; }
  }
  return list;
}

/** 사본이 바뀌었거나 시각이 흘러 위치가 바뀔 수 있을 때 부른다 (1초마다, 저장 뒤, 다른 탭 변경 뒤) */
export function refreshBatches(): void {
  version++;
  listeners.forEach(f => f());
}

const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
/** 배치 목록과 이번 그리기 시각. 시각은 refreshBatches 때만 바뀐다 */
export function useBatches(): { batches: Batch[]; now: Date } {
  const v = useSyncExternalStore(subscribe, () => version);
  return { batches: readBatches(), now: nowAt(v) };
}
let nowCache = { v: -1, now: new Date() };
const nowAt = (v: number) => (nowCache.v === v ? nowCache.now : (nowCache = { v, now: new Date() }).now);

/** PC 평면도와 모바일이 쓰는 위치 계산  */
export const zoneInfo = (b: Batch, now = new Date()): ZoneInfo =>
  getBatchZoneInfo(b, ZONES, now, normalizeScheduleYears);

// 사본이 바뀌면 다시 그린다 (메인 화면은 모바일 화면일 때 모바일이 그린다)
const redraw = () => (window.renderBatchIcons ? window.renderBatchIcons() : refreshBatches());
/** 배치 저장 창구 (메인 화면, 새 창 배치 등록 화면) */
export const batchSync = createBatchSync(sb, redraw);
// 다른 탭이 사본을 바꿨을 때
addEventListener('storage', e => { if (e.key === KEY) redraw(); });
