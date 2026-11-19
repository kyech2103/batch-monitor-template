// 배치 목록(batches 표 id=current_batches)의 유일한 저장 창구와 실시간 동기화 (옛 js/app/10_batch_sync.js).
// 서버에 쓰는 곳도, 이 탭의 사본(localStorage APP_BATCH_RECORDS)에 쓰는 곳도 여기뿐이다
import { validateEdit, type Batch } from './core.ts';
import type { Channel, SupabaseLike } from '../supabase.ts';

export const BATCH_STORAGE_KEY = 'APP_BATCH_RECORDS';
export const SAVE_FAILED = '저장 실패: 인터넷 연결을 확인해 주세요';
const LOT_CHARS = /[^a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ_\-.\s()/#]/g;
export type SaveResult = { success: boolean; message?: string; count?: number };
type Change = (b: Batch | null) => Batch | null;

/** 목록에서 로트 하나만 바꾼다. lot이 null이면 새 배치를 맨 앞에, change가 null을 돌려주면 지운다.
 *  change가 던지면(예: 다른 곳에서 먼저 수정함) 아무것도 바꾸지 않고 그 문장을 돌려준다 */
export function applyBatchChange(list: Batch[], lot: string | null, change: Change): { list?: Batch[]; message?: string } {
  const idx = lot == null ? -1 : list.findIndex(b => b.lotNumber === lot);
  if (lot != null && idx < 0) return { message: `[${lot}] 배치가 서버에 없습니다. 다른 곳에서 지웠을 수 있습니다.` };
  const prev = idx < 0 ? null : list[idx];
  let next: Batch | null;
  try { next = change(prev && JSON.parse(JSON.stringify(prev))); } catch (e) { return { message: (e as Error).message }; }
  // 새 로트 이름은 모바일 수정과 같은 규칙(글자, 다른 배치와 겹침)으로 검사한다
  if (next && next.lotNumber !== prev?.lotNumber) {
    const [error] = validateEdit({ lotNumber: next.lotNumber }, prev, list);
    if (error) return { message: error };
  }
  const out = list.slice();
  if (idx < 0) out.unshift(next!);
  else if (next) out[idx] = next;
  else out.splice(idx, 1);
  return { list: out };
}

/** onChange: 이 탭의 사본이 바뀌었을 때 (화면 다시 그리기) */
export function createBatchSync(sb: SupabaseLike, onChange: () => void, store: Pick<Storage, 'getItem' | 'setItem'> = localStorage) {
  // 한 탭의 쓰기는 앞의 쓰기가 끝난 뒤 차례로 나간다. 너무 잦다고 버리면 화면만 바뀌고 서버엔 안 남는다.
  // 한 번 실패해도 줄이 막히지 않게 다음 쓰기는 앞의 성공 여부와 상관없이 이어진다
  let queue: Promise<unknown> = Promise.resolve();
  let channel: Channel | null = null;
  let signalTimer: ReturnType<typeof setTimeout> | undefined;
  const enqueue = <T,>(task: () => Promise<T>): Promise<T> => { const run = queue.then(task); queue = run.catch(() => {}); return run; };

  const read = (): Batch[] => { try { return JSON.parse(store.getItem(BATCH_STORAGE_KEY) || '[]'); } catch { return []; } };

  function apply(list: unknown) {
    if (!Array.isArray(list)) return;
    const json = JSON.stringify(list);
    if (json === JSON.stringify(read())) return;
    store.setItem(BATCH_STORAGE_KEY, json);
    onChange();
  }

  async function fetchLatest(): Promise<{ data?: Batch[]; error?: unknown }> {
    try {
      const { data, error } = await sb.from('batches').select('data').eq('id', 'current_batches').single();
      return error || !Array.isArray(data?.data) ? { error: error || new Error('invalid_data') } : { data: data.data };
    } catch (e) {
      return { error: e };
    }
  }

  async function upsert(list: Batch[]): Promise<SaveResult> {
    if (!Array.isArray(list)) return { success: false, message: SAVE_FAILED };
    if (list.length > 50) return { success: false, message: '배치는 50개까지만 저장할 수 있습니다. 끝난 배치를 지운 뒤 다시 해 주세요.' };
    // 받은 목록은 고치지 않는다 (부른 쪽이 그 객체를 계속 쓴다): 허용 안 된 글자를 뺀 사본만 보낸다
    const clean = list.flatMap(b => {
      if (!b || typeof b !== 'object') return [];
      const raw = String(b.lotNumber || '').trim();
      const lotNumber = raw.replace(LOT_CHARS, '').slice(0, 50);
      if (lotNumber !== raw) console.warn('[보안 경고] 로트넘버 특수문자 정제 적용:', raw);
      const { _activeZoneInfo, ...copy } = b as Batch & { _activeZoneInfo?: unknown };
      return lotNumber ? [JSON.parse(JSON.stringify({ ...copy, lotNumber }))] : [];
    });
    try {
      const { error } = await sb.from('batches').upsert({ id: 'current_batches', data: clean });
      if (error) { console.warn('[Supabase] batches upsert 실패:', error); return { success: false, message: SAVE_FAILED }; }
      apply(clean);
      // 다른 화면에 '바뀌었다'는 신호만 보낸다 (내용은 각자 서버에서 다시 읽는다)
      channel?.send({ type: 'broadcast', event: 'BATCH_DATA_UPDATED', payload: {} }).catch(e => console.warn('[Supabase Realtime] broadcast 전송 실패:', e));
      return { success: true, count: clean.length };
    } catch (e) {
      console.warn('[Supabase] batches upsert 예외:', e);
      return { success: false, message: SAVE_FAILED };
    }
  }

  async function refresh() {
    const { data } = await fetchLatest();
    if (data) apply(data);
  }

  return {
    read,
    refresh,
    /** 서버 최신 목록 (사본은 바꾸지 않는다) */
    fetchLatest,
    /** 서버에서 받은 목록을 이 탭의 사본으로 */
    apply,
    /** 목록 통째로 저장 */
    save: (list: Batch[]) => enqueue(() => upsert(list)),
    /** 배치 하나 바꾸기. 화면은 바로 바꾸고, 차례가 오면 서버 최신 목록을 다시 읽어 그 로트만 바꿔 쓴다.
     *  오래된 이 탭의 목록을 통째로 쓰면 그사이 다른 PC가 만든 배치가 사라진다 */
    commit(lot: string | null, change: Change): Promise<SaveResult> {
      const before = read();
      const local = applyBatchChange(before, lot, change);
      if (local.message) return Promise.resolve({ success: false, message: local.message });
      apply(local.list);
      return enqueue(async () => {
        const { data: latest, error } = await fetchLatest();
        const next = error ? { message: SAVE_FAILED } : applyBatchChange(latest!, lot, change);
        const res = next.message ? { success: false, message: next.message } : await upsert(next.list!);
        if (!res.success) apply(latest || before);
        return res;
      });
    },
    /** 시작할 때 한 번: 처음 읽기, 실시간 구독, 탭으로 돌아올 때 다시 읽기 */
    start() {
      refresh();
      channel = sb.channel('batches-realtime', { config: { broadcast: { self: false } } })
        // 실시간 방송 채널은 공개 키만 있으면 누구나 보낼 수 있다: 내용은 쓰지 않고 신호로만 받아 서버에서 다시 읽는다. 연달아 오면 마지막 한 번만
        .on('broadcast', { event: 'BATCH_DATA_UPDATED' }, () => { clearTimeout(signalTimer); signalTimer = setTimeout(refresh, 300); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'batches', filter: 'id=eq.current_batches' }, p => apply(p.new?.data))
        // 끊긴 동안 놓친 변경은 신호가 다시 오지 않으므로, 다시 연결될 때마다 서버에서 새로 읽는다
        .subscribe(status => { if (status === 'SUBSCRIBED') refresh(); });
      document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    }
  };
}
export type BatchSync = ReturnType<typeof createBatchSync>;
