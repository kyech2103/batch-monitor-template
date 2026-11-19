// 화면마다 Supabase 연결 하나. js/ 스크립트는 전역 _sb로 같은 연결을 쓴다
import { createClient, type SupabaseLike } from './supabase';

declare global { interface Window { _sb: SupabaseLike } }
export const sb = createClient();
window._sb = sb;
