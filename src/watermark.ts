// 작업자 이름을 화면 전체에 옅게 깐다 (캡처·유출 억제). 열린 팝업(dialog)은 페이지 위에 떠서 가려지므로 팝업 위에도 같은 무늬를 깐다.
// 메인 화면은 인증할 때 이름을 넘기고, 새 창으로 연 화면은 이 기기에 마지막으로 인증한 이름을 쓴다 (옛 js/watermark.js)
const style = document.createElement('style');
style.textContent = `
  #user-watermark { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000; background-repeat: repeat; background-image: var(--user-wm, none); }
  dialog[open]::after { content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 2147483000; background-repeat: repeat; background-image: var(--user-wm, none); }
`;
document.head.appendChild(style);

export function applyUserWatermark(name: string | null | undefined): void {
  const safe = String(name || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="130"><text x="100" y="70" text-anchor="middle" transform="rotate(-25 100 65)" font-size="16" font-family="sans-serif" fill="rgba(128,128,128,0.16)">${safe}</text></svg>`;
  document.documentElement.style.setProperty('--user-wm', safe ? `url("data:image/svg+xml,${encodeURIComponent(svg)}")` : 'none');
  if (safe && !document.getElementById('user-watermark')) {
    const el = document.createElement('div');
    el.id = 'user-watermark';
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
  }
}

/** 새 창 화면: 이 기기에 마지막으로 인증한 작업자 이름 */
export function applyStoredWatermark(): void {
  try { applyUserWatermark((JSON.parse(localStorage.getItem('APP_VERIFIED_OPERATOR') || 'null') || {}).name); } catch { /* 저장값이 깨졌으면 무늬 없이 */ }
}
