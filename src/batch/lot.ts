// 로트 번호로 정하는 것: 제품(색)과 평면도 칸 안 정렬 순서. 평면도·툴팁·배치 등록이 같이 쓴다
/** 로트 앞 글자 → 제품. 툴팁·배치 등록의 배지는 어두운 바탕 기준 색 */
export interface ProductLine { name: string; color: string; stroke: string; strokeWidth: string; badgeBg: string; badgeText: string; badgeBorder: string }
const LINES: { prefixes: string[]; line: ProductLine }[] = [
  { prefixes: ['PA'], line: { name: '제품 A', color: '#0066cc', stroke: '#004c99', strokeWidth: '0', badgeBg: 'rgba(0, 102, 204, 0.22)', badgeText: '#60a5fa', badgeBorder: '1px solid rgba(0, 102, 204, 0.5)' } },
  { prefixes: ['PB', 'PE'], line: { name: '제품 B', color: '#111827', stroke: '#374151', strokeWidth: '1px', badgeBg: 'rgba(17, 24, 39, 0.75)', badgeText: '#f3f4f6', badgeBorder: '1px solid #4b5563' } },
  { prefixes: ['PC', 'PF'], line: { name: '제품 C', color: '#00c4b4', stroke: '#0d9488', strokeWidth: '0', badgeBg: 'rgba(0, 196, 180, 0.22)', badgeText: '#2dd4bf', badgeBorder: '1px solid rgba(0, 196, 180, 0.5)' } },
  { prefixes: ['PD'], line: { name: '제품 D', color: '#ea580c', stroke: '#c2410c', strokeWidth: '0', badgeBg: 'rgba(234, 88, 12, 0.22)', badgeText: '#fb923c', badgeBorder: '1px solid rgba(234, 88, 12, 0.5)' } }
];
const OTHER: ProductLine = { name: '기타 제품', color: '#ffffff', stroke: '#94a3b8', strokeWidth: '1px', badgeBg: 'rgba(255, 255, 255, 0.1)', badgeText: '#cbd5e1', badgeBorder: '1px solid rgba(255, 255, 255, 0.2)' };

export function productLine(lot: string): ProductLine {
  let c = String(lot || '').trim().toUpperCase();
  for (const p of ['LOT-', 'LOT ', 'LOT:', 'LOT']) if (c.startsWith(p)) { c = c.slice(p.length).trim(); break; }
  c = c.replace(/^[\[\(\{]/, '').trim();
  return LINES.find(l => l.prefixes.some(p => c.startsWith(p)))?.line || OTHER;
}

/** 칸 안 순서: 로트 번호가 큰(최신) 배치를 왼쪽에. 숫자는 자릿수가 아니라 값으로 비교한다 (A9 < A10).
 * 회사 로트 형식에 맞는 정렬이 필요하면 이 함수만 바꾼다 */
export function compareLots(a: string, b: string): number {
  const key = (x: string) => String(x || '').trim().toUpperCase().replace(/^LOT\s*[-:]?\s*/, '').replace(/\s+/g, '');
  return key(b).localeCompare(key(a), 'en', { numeric: true });
}
