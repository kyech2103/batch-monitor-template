// 새 창 화면(배치 등록·선반·창고)의 로그인 확인. 가림막(#subapp-auth-gate)은 그 화면 HTML에 있다.
// 가림막은 화면만 가린다: 실제 권한은 DB(행 단위 권한)가 검사한다. 메인 화면은 src/main/appStart.ts
import type { SupabaseLike } from '../supabase';

const $ = (id: string) => document.getElementById(id);

/** 메인 화면에서 로그인한 세션(같은 사이트 저장소)이 있으면 가림막을 걷고 onAllowed를 부른다. 내 PC 주소(개발·QA)는 바로 연다 */
export async function checkSubAppLogin(sb: SupabaseLike, onAllowed: () => void): Promise<void> {
  const open = () => {
    const gate = $('subapp-auth-gate');
    if (gate) gate.style.display = 'none';
    document.body.classList.remove('auth-pending');
    onAllowed();
  };
  if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) return open();
  const { data } = await sb.auth.getSession().catch(() => ({ data: { session: null } }));
  if (data.session) return open();
  const title = $('subapp-gate-title'), desc = $('subapp-gate-desc');
  if (title) title.textContent = '로그인이 필요합니다';
  if (desc) desc.textContent = '메인 화면에서 로그인한 뒤 다시 열어 주세요.';
}
