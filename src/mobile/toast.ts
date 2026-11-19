/** 모바일 화면 아래 3초 알림. 옛 mobile_*.js의 showToast와 같은 모양(.m-toast) */
export function showToast(msg: string, isSuccess = false): void {
  document.querySelector('.m-toast')?.remove();
  const t = document.createElement('div');
  t.className = 'm-toast' + (isSuccess ? ' is-success' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}
