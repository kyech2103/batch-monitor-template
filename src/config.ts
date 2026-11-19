// 연결 설정: 자기 Supabase 프로젝트로 바꾸는 곳은 이 파일 한 곳뿐이다 (README "설치" 참고).
// 여기 값은 브라우저에 그대로 공개되는 값만 둔다. 서비스 키·AI 키 같은 비밀은 절대 넣지 않는다.
export const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
export const SUPABASE_KEY = 'YOUR-PUBLISHABLE-KEY'; // Supabase 대시보드 → Project Settings → API의 publishable(anon) 키
export const VAPID_PUBLIC_KEY = 'YOUR-VAPID-PUBLIC-KEY'; // 웹 푸시 공개 키 (npx web-push generate-vapid-keys)
