// 선반 3종·자재 창고 공용 저장과 실시간 동기화 (옛 js/shelf_app.js·warehouse_app.js에 따로 있던 것).
// 방 하나 = shelf_data 표 한 행. 이 기기에는 localStorage 사본을 두고, 편집은 서버에 쓴다
import type { Channel, SupabaseLike } from '../supabase.ts';

/** 다른 방으로 보내는 품목 (선반·창고 어느 쪽이든 받는 쪽이 자기 모양으로 바꾼다) */
export interface TransferItem { uid: string; text: string; cat?: string; customColor?: string | null; color?: string | null; containerType?: string; desc?: string }

export interface RoomKind<M> {
  /** 이 기기에 사본이 없을 때 */
  initial(): M;
  /** 이 기기 사본·서버 행의 data를 모델로. 쓸 수 없는 값이면 null (서버 값은 지금 모델을 바탕으로 고칠 수 있다) */
  fromLocal(v: unknown): M | null;
  fromServer(v: unknown, cur: M): M | null;
  has(m: M, uid: string): boolean;
  /** 다른 방에서 온 품목을 대기함 맨 앞에 넣는다 */
  arrive(m: M, item: TransferItem, fromName: string): void;
}
export interface RoomOpts<M> { dbId: string; name: string; storageKey: string; channel: string; immediate: boolean; kind: RoomKind<M> }
export interface SyncStatus { busy: boolean; text: string; error?: boolean }
type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** 끌기 중에는 서버 값으로 바꾸지 않는다 (놓을 때 옛 품목을 다시 넣어 같은 품목이 둘이 된다). 화면이 켜고 끈다 */
export const drag = { active: false };
export const SAVE_RETRY_MS = 5000;

export function createRoomStore<M>(sb: SupabaseLike, o: RoomOpts<M>, store: Store = localStorage) {
  const k = o.kind;
  let model: M = readLocal() ?? k.initial();
  let status: SyncStatus = { busy: false, text: '실시간 동기화 완료' };
  const listeners = new Set<() => void>();
  // 서버에 저장됐다고 확인되지 않은 편집이 있는 동안은 서버 데이터로 덮어쓰지 않고, 실패한 저장은 다시 보낸다
  let localRev = 0, savedRev = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined, debounceTimer: typeof retryTimer, signalTimer: typeof retryTimer;
  let channel: Channel | null = null;
  let loaded: Promise<void> | null = null;
  const unsaved = () => savedRev < localRev;
  const notify = () => listeners.forEach(f => f());
  const setStatus = (busy: boolean, text: string, error = false) => { status = { busy, text, error }; notify(); };

  function readLocal(): M | null {
    try { const raw = store.getItem(o.storageKey); return raw ? k.fromLocal(JSON.parse(raw)) : null; } catch { return null; }
  }
  const writeLocal = () => { try { store.setItem(o.storageKey, JSON.stringify(model)); } catch { /* 사생활 보호 모드 등 */ } };

  async function save() {
    clearTimeout(retryTimer);
    clearTimeout(debounceTimer);
    const rev = localRev;
    setStatus(true, '동기화 전송 중...');
    let error: unknown;
    try {
      ({ error } = await sb.from('shelf_data').upsert({ room_id: o.dbId, room_name: o.name, data: model }, { onConflict: 'room_id' }));
    } catch (e) { error = e; }
    if (!error) {
      savedRev = Math.max(savedRev, rev);
      // 다른 화면에 '바뀌었다'는 신호만 보낸다 (내용은 각자 서버에서 다시 읽는다)
      channel?.send({ type: 'broadcast', event: 'SHELF_DATA_UPDATED', payload: {} }).then(null, () => {});
    } else if (unsaved()) retryTimer = setTimeout(save, SAVE_RETRY_MS);
    setStatus(false, error ? '⚠️ 동기화 오류' : '실시간 동기화 완료', !!error);
  }

  /** 서버 값으로 바꿨으면 true */
  function applyServer(data: unknown): boolean {
    if (!data || unsaved() || drag.active) return false;
    const next = k.fromServer(data, model);
    if (!next || JSON.stringify(next) === JSON.stringify(model)) return false;
    model = next;
    writeLocal();
    notify();
    return true;
  }

  /** 서버 행의 data (행이 없으면 data 없이 오류도 없음) */
  async function fetchRow(): Promise<{ data?: unknown; error?: unknown }> {
    try {
      const { data, error } = await sb.from('shelf_data').select('data').eq('room_id', o.dbId).single();
      return error ? { error } : { data: data?.data };
    } catch (e) { return { error: e }; }
  }

  /** 처음, 탭으로 돌아올 때 */
  async function load() {
    setStatus(true, '데이터 불러오는 중...');
    const { data, error } = await fetchRow();
    if (data) applyServer(data);
    setStatus(false, error ? '로컬 데이터로 로드됨' : '실시간 동기화 완료');
  }

  /** 다른 화면이 바꿨다는 신호를 받았을 때 */
  function onRemote(data: unknown) {
    if (!applyServer(data)) return;
    setStatus(false, '타인 변경 실시간 반영됨');
    setTimeout(() => { if (status.text === '타인 변경 실시간 반영됨') setStatus(false, '실시간 동기화 완료'); }, 2000);
  }

  const api = {
    get: () => model,
    status: () => status,
    subscribe(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; },
    /** 모델 사본을 고친다. fn이 false를 돌려주면 아무것도 바꾸지 않는다 */
    edit(fn: (draft: M) => unknown) {
      const draft = JSON.parse(JSON.stringify(model)) as M;
      if (fn(draft) === false) return;
      model = draft;
      localRev++;
      writeLocal();
      notify();
      if (o.immediate) { save(); return; }
      setStatus(true, '동기화 대기 중...');
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(save, 300);
    },
    save,
    async manualSync() {
      setStatus(true, '최신 데이터 조회 중...');
      const { data, error } = await fetchRow();
      if (error) return setStatus(false, '⚠️ 동기화 실패', true);
      if (!data) return setStatus(false, '동기화 완료 (최신 상태)');
      applyServer(data);
      setStatus(false, '수동 동기화 완료');
    },
    /** 다른 방에서 보낸 품목을 받는다. 서버 최신 값을 읽은 뒤 넣어, 이 기기의 오래된 사본을 서버에 쓰지 않는다 */
    async receive(item: TransferItem, fromName: string) {
      await api.start();
      if (k.has(model, item.uid)) return;
      api.edit(m => k.arrive(m, item, fromName));
    },
    /** 처음 쓸 때 한 번: 서버에서 읽기, 실시간 구독, 탭으로 돌아올 때 다시 읽기 */
    start(): Promise<void> {
      if (loaded) return loaded;
      loaded = load();
      channel = sb.channel(o.channel, { config: { broadcast: { self: false } } })
        // 실시간 방송 채널은 공개 키만 있으면 누구나 보낼 수 있다: 내용은 쓰지 않고 신호로만 받아 서버에서 다시 읽는다. 연달아 오면 마지막 한 번만
        .on('broadcast', { event: 'SHELF_DATA_UPDATED' }, () => {
          clearTimeout(signalTimer);
          signalTimer = setTimeout(() => fetchRow().then(r => onRemote(r.data)), 300);
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'shelf_data', filter: `room_id=eq.${o.dbId}` }, p => onRemote(p.new?.data))
        .subscribe();
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (document.hidden || drag.active) return;
          if (unsaved()) save(); else load();
        });
      }
      return loaded;
    }
  };
  return api;
}
export type RoomStore<M> = ReturnType<typeof createRoomStore<M>>;
