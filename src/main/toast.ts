/** PC 화면 아래 알림 (.floorplan-toast). js/ 스크립트도 전역 showToast로 부른다 */
let timer: ReturnType<typeof setTimeout> | undefined;
export function showToast(message: string, duration = 3000): void {
  let el = document.getElementById('floorplan-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'floorplan-toast';
    el.className = 'floorplan-toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => el!.classList.remove('show'), duration);
}
