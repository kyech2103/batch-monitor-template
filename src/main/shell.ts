// 머리띠 시계, 창 너비에 맞춘 body 클래스·제목, 사용 설명서 창 (옛 js/app/07·13·15). 설명서 내용은 index.html
export function setupShell(): void {
  const clock = document.getElementById('dashboard-clock');
  if (clock) {
    const tick = () => { clock.textContent = new Date().toLocaleTimeString('ko-KR', { hour12: false }); };
    tick();
    setInterval(tick, 1000);
  }

  // 좁은 창(분할 화면)에서는 평면도 글자를 줄인다 (css/main.css body.view-*)
  const layout = () => {
    const w = window.innerWidth, b = document.body;
    b.classList.toggle('view-split', w <= 1180);
    b.classList.toggle('view-compact', w <= 960);
    b.classList.toggle('view-mobile', w <= 680);
    const title = document.querySelector('.dashboard-title');
    if (title) title.textContent = w <= 720 ? '공정 모니터링' : '공정 모니터링 공정 모니터링';
  };
  layout();
  window.addEventListener('resize', layout);

  const guide = document.getElementById('user-guide-modal') as HTMLDialogElement | null;
  if (!guide) return;
  document.getElementById('btn-user-guide')?.addEventListener('click', e => {
    e.stopPropagation();
    if (!guide.open) guide.showModal();
  });
  document.getElementById('guide-modal-btn-close')?.addEventListener('click', () => guide.close());
  const max = document.getElementById('guide-modal-btn-maximize');
  max?.addEventListener('click', () => {
    const full = guide.classList.toggle('is-fullscreen');
    max.title = full ? '원래 크기로 복원' : '전체화면으로 전환';
  });
}
