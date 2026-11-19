// 선반·창고 내보내기: 파일 내려받기, 화면 그대로의 HTML·PNG (지금 페이지의 스타일을 모두 넣어 따로 열어도 같게 보인다)
const today = () => { const d = new Date(), p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
export const fileName = (pattern: string) => pattern.replace('{date}', today());

export function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const downloadCSV = (name: string, csv: string) => download(name, new Blob([csv], { type: 'text/csv;charset=utf-8;' }));

function pageCss(): string {
  let css = '';
  for (const sheet of Array.from(document.styleSheets)) {
    try { for (const r of Array.from(sheet.cssRules)) css += r.cssText + '\n'; } catch { /* 다른 주소의 스타일 */ }
  }
  return css;
}

/** 편집 단추를 뺀 화면 사본 (입력칸은 글자로) */
function cleanClone(node: Element): Element {
  const clone = node.cloneNode(true) as Element;
  clone.querySelectorAll('[data-export="hide"]').forEach(el => el.remove());
  clone.querySelectorAll('textarea, input').forEach(inp => {
    const div = document.createElement('div');
    div.className = inp.className;
    div.textContent = (inp as HTMLInputElement).value;
    inp.replaceWith(div);
  });
  return clone;
}

/** 지금 보이는 화면을 혼자 열리는 HTML 파일로 */
export function downloadSnapshotHTML(node: Element, name: string, title: string): void {
  const html = `<!DOCTYPE html>\n<html lang="ko"><head><meta charset="UTF-8"><title>${title.replace(/</g, '&lt;')}</title><style>${pageCss()}</style></head><body>${cleanClone(node).outerHTML}</body></html>`;
  download(name, new Blob([html], { type: 'text/html;charset=utf-8' }));
}

/** 선반 영역을 두 배 해상도 PNG로 */
export async function downloadPNG(node: HTMLElement, name: string): Promise<void> {
  const w = node.scrollWidth || node.offsetWidth || 1600, h = node.scrollHeight || node.offsetHeight || 900;
  // 화면에서는 바깥 범위(.shelf-app 등) 아래에서만 스타일이 맞으므로 같은 바깥 틀로 감싼다
  const wrap = node.closest('[data-room-app]');
  const inner = new XMLSerializer().serializeToString(cleanClone(node));
  const body = wrap ? `<div class="${wrap.className}" style="padding:0">${inner}</div>` : inner;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml"><style><![CDATA[${pageCss()} body{margin:0;background:white}]]></style>${body}</div></foreignObject></svg>`;
  const canvas = document.createElement('canvas');
  canvas.width = w * 2;
  canvas.height = h * 2;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(2, 2);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => { try { ctx.drawImage(img, 0, 0); resolve(); } catch (e) { reject(e); } };
    img.onerror = () => reject(new Error('이미지 렌더링에 실패했습니다.'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'));
  if (blob) download(name, blob);
}
