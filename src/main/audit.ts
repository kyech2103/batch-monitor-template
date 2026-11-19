// 작업 이력(timeline_logs) 기록. 0.2초 안에 들어온 것은 한 번에 쓴다 (옛 js/app/13 pushToCentralAuditQueue)
import { sb } from '../sb';

export interface AuditEntry { zone: string; action: string; item: string; from: string; to: string; detail: string; userEmail?: string }

let queue: AuditEntry[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

export function pushAudit(e: AuditEntry): void {
  queue.push({ ...e, userEmail: e.userEmail || window.currentUserEmail || '' });
  clearTimeout(timer);
  timer = setTimeout(() => {
    const rows = queue.splice(0).map(x => ({
      work_zone: x.zone || '배치 공정', action_type: x.action || '작업', target_lot: x.item || '-', prev_location: x.from || '-',
      new_location: x.to || '-', details: x.detail || '-', worker_account: x.userEmail || window.currentUserEmail || ''
    }));
    sb.from('timeline_logs').insert(rows).then(null, err => console.warn('[Supabase] timeline_logs insert 오류:', err));
  }, 200);
}
