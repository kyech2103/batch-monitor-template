// 모바일 탭 영역(#m-content-root)에 React 화면을 그린다. 같은 탭이 다시 그리면(실시간 갱신) 제자리로 그려 스크롤·입력 포커스를 지키고,
// 다른 탭이나 옛 코드가 영역을 innerHTML로 덮어써도 되도록 영역 안의 우리 칸(host)에만 그린다
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';

const slots = new WeakMap<HTMLElement, { root: Root; host: HTMLElement; owner: string }>();

export function mount(container: HTMLElement, owner: string, node: ReactNode): void {
  let slot = slots.get(container);
  if (!slot || slot.owner !== owner || slot.host.parentElement !== container) {
    try { slot?.root.unmount(); } catch { /* 이미 떨어져 나간 칸 */ }
    container.innerHTML = '';
    const host = document.createElement('div');
    host.style.display = 'contents'; // 부모의 배치(flex·grid)를 그대로 받게
    container.appendChild(host);
    slot = { root: createRoot(host), host, owner };
    slots.set(container, slot);
  }
  const { root } = slot;
  flushSync(() => root.render(node));
}
