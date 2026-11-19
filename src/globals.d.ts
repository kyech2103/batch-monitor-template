// 여러 화면이 window로 주고받는 것 (src/main/main.ts가 붙인다)
import type { Batch } from './batch/core';
import type { ZoneInfo } from './batch/zone';
import type { SupabaseLike } from './supabase';

declare global {
  interface Window {
    /** 배치 등록 화면: 지금 작업자 (템플릿 작성자로 남긴다) */
    currentUserEmail?: string;
    MobileBridge?: MobileBridgeLike;
    /** src/admin/WorkerAdmin.tsx: 머리띠 직원 관리 버튼이 연다 */
    WorkerAdmin?: { open(): void };
  }

  /** window.MobileBridge: 모바일 화면이 PC 쪽 상태를 읽는 창구 */
  interface MobileBridgeLike {
    getBatches(): Batch[];
    getSupabase(): SupabaseLike;
    getWorker?(): { id?: number; name?: string; display?: string } | null;
    getZones?(): Record<string, { name?: string }>;
    getBatchZoneInfo?(b: Batch): ZoneInfo | null;
  }
}
export {};
