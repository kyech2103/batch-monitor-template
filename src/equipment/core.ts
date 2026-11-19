// 장비 계산: 예약 코드(DDHHMM)↔시각, 겹침 검사, 지금 상태, 저장값. PC 창·평면도 카드·모바일 탭이 같이 쓴다
export interface Job { id: number | string; start_code: string; end_code: string; setting_type?: string; duration_minutes?: number; status?: string; notify_worker_ids?: number[] }

const pad = (n: number) => String(n).padStart(2, '0');

/** DDHHMM → 기준 시각에 가까운 달의 그 날짜·시각 (15일 넘게 떨어지면 앞·뒤 달) */
export function parseDDHHMM(code: string | null | undefined, ref: Date = new Date()): Date | null {
  if (code == null) return null;
  const s = String(code).trim().padStart(6, '0');
  if (!/^\d{6}$/.test(s)) return null;
  const [d, h, m] = [0, 2, 4].map(i => Number(s.slice(i, i + 2)));
  if (h > 23 || m > 59 || d < 1 || d > 31) return null;
  const t = new Date(ref.getFullYear(), ref.getMonth(), d, h, m);
  if (d < ref.getDate() - 15) t.setMonth(t.getMonth() + 1);
  else if (d > ref.getDate() + 15) t.setMonth(t.getMonth() - 1);
  return t;
}

export const formatDDHHMM = (d: Date | null) => (!d || isNaN(+d) ? '------' : `${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`);

export function addMinutesToDDHHMM(code: string, minutes: number, ref?: Date): string {
  const d = parseDDHHMM(code, ref);
  return d ? formatDDHHMM(new Date(+d + minutes * 60000)) : '';
}

/** MM/DD HH:mm. 6자리 숫자면 예약 코드로 읽는다 */
export function formatDateTime(v: Date | string | null | undefined, ref?: Date): string {
  if (!v) return '-';
  const d = v instanceof Date ? v : /^\d{6}$/.test(v.trim()) ? parseDDHHMM(v.trim(), ref) : new Date(v);
  return !d || isNaN(+d) ? '-' : `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 끝과 시작이 맞닿은 것은 겹침이 아니다. 같은 id(수정 중인 자기 자신)는 빼고 본다 */
export function isJobOverlapping(job: Pick<Job, 'start_code' | 'end_code'> & { id?: Job['id'] }, jobs: Job[], ref?: Date): boolean {
  const s1 = parseDDHHMM(job.start_code, ref), e1 = parseDDHHMM(job.end_code, ref);
  if (!s1 || !e1 || e1 <= s1) return false;
  return jobs.some(x => {
    if (job.id && x.id && String(job.id) === String(x.id)) return false;
    const s2 = parseDDHHMM(x.start_code, ref), e2 = parseDDHHMM(x.end_code, ref);
    return Boolean(s2 && e2 && e2 > s2 && s1 < e2 && s2 < e1);
  });
}

export interface EqState {
  mode: 'none' | 'running' | 'scheduled' | 'completed'; job: Job | null; s: Date | null; e: Date | null;
  pct: number; remainMinutes: number; waitMinutes: number;
  typeText: string; typeBgColor: string; statusText: string; dotColor: string; statusColor: string; gaugeText: string; hintText: string;
}

/** 지금 보여 줄 작업: 가동 중 > 가장 가까운 예약 > 가장 최근에 끝난 것 */
export function equipmentState(jobs: Job[], now: Date): EqState {
  const all = jobs.map(job => ({ job, s: parseDDHHMM(job.start_code, now), e: parseDDHHMM(job.end_code, now) })).filter(x => x.s && x.e) as { job: Job; s: Date; e: Date }[];
  const running = all.filter(x => now >= x.s && now < x.e).sort((a, b) => +a.s - +b.s)[0];
  const next = all.filter(x => now < x.s).sort((a, b) => +a.s - +b.s)[0];
  const done = all.filter(x => now >= x.e).sort((a, b) => +b.e - +a.e)[0];
  const sel = running || next || done;
  if (!sel) return { mode: 'none', job: null, s: null, e: null, pct: 0, remainMinutes: 0, waitMinutes: 0, typeText: '대기', typeBgColor: '#475569', statusText: '대기 중', dotColor: '#64748b', statusColor: '#94a3b8', gaugeText: '작업 없음', hintText: '클릭하여 작업 예약' };
  const base = { job: sel.job, s: sel.s, e: sel.e, typeText: sel.job.setting_type || '설정', typeBgColor: sel.job.setting_type === '예시 품목 A' ? '#0284c7' : '#d97706', remainMinutes: 0, waitMinutes: 0 };
  if (running) {
    const pct = Math.min(100, Math.max(0, Math.round((+now - +sel.s) / Math.max(1, +sel.e - +sel.s) * 100))), remain = Math.ceil((+sel.e - +now) / 60000);
    return { ...base, mode: 'running', pct, remainMinutes: remain, statusText: '가동 중', dotColor: '#10b981', statusColor: '#34d399', gaugeText: `${pct}% (${remain}분 남음)`, hintText: '클릭 시 스케줄 목록' };
  }
  if (next) {
    const wait = Math.ceil((+sel.s - +now) / 60000);
    return { ...base, mode: 'scheduled', pct: 0, waitMinutes: wait, statusText: '예약 대기', dotColor: '#f59e0b', statusColor: '#fbbf24', gaugeText: `시작 ${wait}분 전`, hintText: '클릭 시 스케줄 목록' };
  }
  return { ...base, mode: 'completed', pct: 100, statusText: '가동 완료', dotColor: '#3b82f6', statusColor: '#60a5fa', gaugeText: '100% 완료됨', hintText: '확인 클릭 시 정리' };
}

/** 작업 행의 실제 시각·알림 칸. 이미 지난 시작·종료는 알림을 보내지 않는다(등록한 사람이 이미 앎) */
export function equipmentJobTimes(start: Date, durationMinutes: number, notifyWorkerIds: number[] | null | undefined, now = new Date()) {
  const end = new Date(+start + durationMinutes * 60000);
  return {
    start_at: start.toISOString(), end_at: end.toISOString(), notify_worker_ids: Array.isArray(notifyWorkerIds) ? notifyWorkerIds : [],
    start_push_done: start <= now, end_push_done: end <= now
  };
}

/** PC·모바일 예약 저장값. 틀리면 { error }만 돌려준다 */
export function buildEquipmentJob(o: { start: Date | null; durationMinutes: number; type: string; notifyWorkerIds?: number[]; id?: Job['id'] }, jobs: Job[], now: Date) {
  if (!(o.start instanceof Date) || isNaN(+o.start)) return { error: '시작 시각을 확인해 주세요' };
  if (!Number.isInteger(o.durationMinutes) || o.durationMinutes < 1 || o.durationMinutes > 1440) return { error: '소요 시간은 1~1440분 사이여야 합니다' };
  if (!o.type) return { error: '종류를 선택해 주세요' };
  const start_code = formatDDHHMM(o.start), end_code = addMinutesToDDHHMM(start_code, o.durationMinutes, o.start);
  if (isJobOverlapping({ id: o.id, start_code, end_code }, jobs, o.start)) return { error: '다른 예약과 시간이 겹칩니다' };
  return { row: { start_code, end_code, setting_type: o.type, duration_minutes: o.durationMinutes, status: '예약', ...equipmentJobTimes(o.start, o.durationMinutes, o.notifyWorkerIds, now) } };
}
