// 큰 창(배치 등록·선반·창고·가이드) 머리의 공용 버튼: 닫기, 새 탭에서 열기, 전체화면 토글
export function bindDialogButtons(dialog: HTMLDialogElement, ids: { close?: string; external?: string; maximize?: string }, url?: () => string): void {
  const btn = (id?: string) => (id ? document.getElementById(id) : null);
  btn(ids.close)?.addEventListener('click', () => dialog.close());
  btn(ids.external)?.addEventListener('click', () => url && window.open(url(), '_blank'));
  const max = btn(ids.maximize);
  max?.addEventListener('click', () => {
    const full = dialog.classList.toggle('is-fullscreen');
    max.title = full ? '원래 크기로 복원' : '전체화면으로 전환';
  });
}
