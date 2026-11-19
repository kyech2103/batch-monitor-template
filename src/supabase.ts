// Supabase 연결. 라이브러리는 화면 HTML이 CDN(버전·무결성 고정)으로 불러온 전역 supabase를 쓴다.
// 연결 값은 config.ts 한 곳에 둔다
import { SUPABASE_KEY, SUPABASE_URL } from './config.ts';

export { SUPABASE_KEY, SUPABASE_URL };

/* eslint-disable @typescript-eslint/no-explicit-any */
// shortcut: 쓰는 모양만 느슨하게 적었다, 라이브러리를 npm으로 묶을 때 @supabase/supabase-js 타입으로 바꾼다
type Result = Promise<{ data: any; error: any }>;
interface Query extends PromiseLike<{ data: any; error: any }> {
  select(cols?: string): Query;
  eq(col: string, v: unknown): Query;
  neq(col: string, v: unknown): Query;
  order(col: string, opts?: { ascending?: boolean }): Query;
  limit(n: number): Query;
  single(): Result;
}
export interface Channel {
  on(type: string, filter: object, cb: (payload: any) => void): Channel;
  subscribe(cb?: (status: string) => void): Channel;
  send(msg: object): Promise<unknown>;
}
export interface SupabaseLike {
  from(table: string): Query & { upsert(row: object, opts?: object): Query; insert(row: object): Result; update(row: object): Query; delete(): Query };
  channel(name: string, opts?: object): Channel;
  rpc(fn: string, args?: object): Result;
  auth: {
    getSession(): Promise<{ data: { session: { access_token: string } | null } }>;
    signInWithPassword(c: { email: string; password: string }): Promise<{ error: any }>;
    signOut(): Promise<unknown>;
  };
}

declare const supabase: { createClient(url: string, key: string, opts: object): SupabaseLike };

export const createClient = (): SupabaseLike => supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {});
