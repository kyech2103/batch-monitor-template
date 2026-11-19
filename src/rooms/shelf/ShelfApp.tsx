// 선반 화면 (부품 보관실·비품실·포장 비품실 공용, 옛 js/shelf_app.js). 메인 창 안 창과 새 창이 같은 화면을 띄운다
import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from 'react';
import * as S from './model';
import { Rack, type Drag, type RackCtx, type UnitSel } from './Rack';
import { ROOMS, audit, roomStore, sendToRoom, type ShelfRoom } from '../rooms';
import { openTransferPopover } from '../../subapp/TransferPopover';
import { downloadCSV, downloadPNG, downloadSnapshotHTML, fileName } from '../export';
import { SyncBadge, ExportMenu, useToast } from '../ui';

const CATS: [string, string][] = [['equip', '🏷️ 일반장비'], ['tool', '🔧 도구/기구'], ['parts', '⚙️ 부품류'], ['translucent', '📦 반투명용기'], ['transparent', '🧊 투명용기']];
const NEW_COLORS: [string | null, string, string][] = [[null, '기본 색상', '#e2e8f0'], ['blue', '파랑', '#38bdf8'], ['green', '초록', '#4ade80'], ['yellow', '노랑', '#facc15'], ['red', '빨강', '#f87171'], ['white', '흰색', '#ffffff']];
const PICK_COLORS: [string | null, string, string][] = [['blue', '파랑', '#38bdf8'], ['green', '초록', '#4ade80'], ['yellow', '노랑', '#facc15'], ['red', '빨강', '#f87171'], ['white', '흰색', '#ffffff'], [null, '기본(초기화)', '#f1f5f9']];
const dotStyle = (bg: string, border: boolean) => ({ background: bg, width: 22, height: 22, borderRadius: 3, border: border ? '1px solid #cbd5e1' : 'none', cursor: 'pointer' });

export function ShelfApp({ room }: { room: ShelfRoom }) {
  const store = roomStore(room);
  const m = useSyncExternalStore(store.subscribe, store.get);
  const status = useSyncExternalStore(store.subscribe, store.status);
  const [sel, setSel] = useState<S.ItemRef | null>(null);
  const [unitSel, setUnitSel] = useState<UnitSel | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; t: number; c: number } | null>(null);
  const [picker, setPicker] = useState<{ ref: S.ItemRef; x: number; y: number } | null>(null);
  const [name, setName] = useState(''), [cat, setCat] = useState('equip'), [newColor, setNewColor] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [toast, showToast] = useToast();

  useEffect(() => { store.start(); }, [store]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setSel(null); setUnitSel(null); setMenu(null); } };
    const click = (e: Event) => {
      setMenu(null);
      const el = e.target as Element;
      if (!el.closest?.('.floating-color-popover')) setPicker(null);
      // 비품실: 품목·칸 밖을 누르면 선택을 푼다
      if (room.outsideClickClears && !el.closest?.('.block-card, .item-slot-bay, .floating-color-popover, .block-btn-color, .tab-item-chip')) setSel(null);
    };
    const end = () => { drag.current = null; rootRef.current?.querySelectorAll('.drag-over, .col-drag-over, .dragover-stack-top, .dragover-stack-bottom').forEach(x => x.classList.remove('drag-over', 'col-drag-over', 'dragover-stack-top', 'dragover-stack-bottom')); };
    addEventListener('keydown', esc);
    addEventListener('click', click);
    addEventListener('dragend', end);
    return () => { removeEventListener('keydown', esc); removeEventListener('click', click); removeEventListener('dragend', end); };
  }, [room]);

  /** 편집 한 번: 막힌 편집은 이유를 알리고, 된 편집은 작업 기록을 남긴다. 위치가 바뀌므로 선택은 푼다 */
  const run = (fn: (d: S.ShelfModel) => S.Log | void) => {
    setSel(null);
    setUnitSel(null);
    store.edit(d => {
      try { audit(room, fn(d)); } catch (e) { alert((e as Error).message); return false; }
    });
  };
  const loc = (ref: S.ItemRef) => S.refLoc(m, ref);

  const ctx: RackCtx = {
    room, m, sel, unitSel, drag, run, setUnitSel,
    clickItem: ref => (sel ? run(d => S.placeItem(d, sel, ref.t, ref.c, ref.s)) : setSel(ref)),
    clickSlot: (e, t, c, s) => { if (!sel) return; e.stopPropagation(); run(d => S.placeItem(d, sel, t, c, s)); },
    openColor: (e, ref) => {
      const r = (e.target as Element).getBoundingClientRect();
      let left = Math.max(10, r.left - 40), top = r.bottom + 6;
      if (left + 175 > innerWidth) left = innerWidth - 185;
      if (top + 50 > innerHeight && r.top > 50) top = r.top - 44;
      setPicker({ ref, x: left, y: top });
    },
    openMenu: (e, t, c) => setMenu({ x: Math.min(e.clientX, innerWidth - 220), y: Math.min(e.clientY, innerHeight - 220), t, c }),
    renameItem: (ref, withLog) => {
      const it = S.findItem(m, ref);
      const v = it && prompt('장비/블럭 명칭을 수정하세요:', it.text)?.trim();
      if (!it || !v) return;
      run(d => {
        const x = S.findItem(d, ref)!, old = x.text;
        x.text = v;
        if (withLog && old !== v) return ['정보 수정', v, loc(ref), loc(ref), `품목명 수정: '${old}' ➔ '${v}'`];
      });
    },
    transfer: (e, ref) => {
      const it = S.findItem(m, ref);
      if (!it) return;
      const fromLoc = loc(ref);
      openTransferPopover(e.currentTarget, it.text || '품목', ROOMS.filter(r => r.id !== room.id), target => {
        run(d => { S.removeItem(d, ref); });
        sendToRoom(room, target.id, { uid: it.uid || 'item_' + Date.now(), text: it.text || '품목', cat: it.cat || 'equip', customColor: it.customColor || null, containerType: it.containerType || '이송 품목' }, fromLoc);
        showToast(`✅ [${it.text}]을(를) ${target.name}(으)로 전송했습니다.`);
      });
    },
    addColumn: t => {
      const v = prompt('새로 추가할 열(구역)의 이름을 입력하세요:', `${m.toBe[t].columns.length + 1}열 (신규 구역)`)?.trim();
      if (v) run(d => S.addColumn(d, t, v));
    },
    addTier: () => {
      const v = prompt('새로 추가할 선반 단(레이어)의 이름을 입력하세요 (예: 4단, 상부 거치대, 측면 걸이 등):', `${m.toBe.length + 1}단 (신규 레이어)`)?.trim();
      if (v) run(d => S.addTier(d, v));
    }
  };

  const addNew = () => {
    const v = name.trim();
    if (!v) { alert('추가할 물건의 이름을 입력해주세요.'); return; }
    run(d => S.addTrayItem(d, v, cat, newColor));
    setName('');
  };

  const menuCol = menu && m.toBe[menu.t]?.columns[menu.c];
  const menuItem = (icon: string, text: string, f: () => void, danger = false) => (
    <div className={`col-context-menu-item${danger ? ' danger' : ''}`} onClick={e => { e.stopPropagation(); setMenu(null); f(); }}><span>{icon}</span><span>{text}</span></div>
  );
  const board = (b: ShelfRoom['boards'][number], kind: string, from: number, to?: number, cls = '') => (
    <div className={`board-card${cls}`} data-board={kind} key={b.title}>
      <div className="board-header">
        <div><h2>{b.title}</h2><div className="board-header-sub">{b.sub}</div></div>
        <span className="board-status-pill">{b.pill}</span>
      </div>
      <Rack ctx={ctx} from={from} to={to} />
    </div>
  );

  return (
    <div className="shelf-app" data-room-app={room.id} ref={rootRef}>
      <header>
        <div>
          <h1>{room.title}</h1>
          <div className="header-sub"><b>현행 보관 배치 유지 및 관리</b>: {room.sub}</div>
        </div>
        <div className="shelf-unified-toolbar" data-export="hide">
          <div className="toolbar-group">
            <input type="text" className="pt-input new-item-name" placeholder="품목명 입력..." value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addNew(); }} />
            <select className="pt-input new-item-cat" title="품목 카테고리" value={cat} onChange={e => setCat(e.target.value)}>
              {CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <div className="color-picker-mini-group">
              {NEW_COLORS.map(([k, label, bg]) => (
                <button key={label} type="button" className={`tab-color-dot${newColor === k ? ' is-selected' : ''}`} title={label} onClick={() => setNewColor(k)}
                  style={dotStyle(bg, !k || k === 'white')}>{k ? '' : '✕'}</button>
              ))}
            </div>
            <button type="button" className="pt-btn pt-btn--primary btn-add-new-item" onClick={addNew}>등록</button>
          </div>
          <div className="toolbar-group">
            <SyncBadge status={status} />
            <button type="button" className="pt-btn pt-btn--secondary btn-manual-sync" onClick={() => store.manualSync()} title="서버 최신 데이터 수동 동기화">🔄 동기화</button>
          </div>
          <div className="toolbar-group">
            <ExportMenu items={[
              ['💾 HTML 저장', () => { downloadSnapshotHTML(rootRef.current!, fileName(room.exportNames.html), room.title); alert('💾 [저장 완료 안내]\n\n선반 배치 구역이 HTML 파일로 다운로드되었습니다.'); }],
              ['📷 PNG 저장', () => downloadPNG(rootRef.current!.querySelector('.boards-container')!, fileName(room.exportNames.png)).catch(err => alert('이미지 생성 중 오류가 발생했습니다: ' + err.message))],
              ['📥 CSV 다운로드', () => downloadCSV(fileName(room.exportNames.csv), S.toCSV(m))]
            ]} />
            <button type="button" className="pt-btn pt-btn--danger btn-clear-shelf" onClick={() => { if (confirm('신규 배치(To-Be)의 모든 칸을 비우시겠습니까?')) run(S.clearShelf); }}>🗑️ 선반 비우기</button>
          </div>
        </div>
      </header>

      <div className="tab-waiting-chips" data-export="hide">
        {m.custom.length > 0 && <span className="waiting-label">대기 목록:</span>}
        {m.custom.map(b => (
          <div key={b.uid} className={`tab-item-chip${b.customColor ? ` color-${b.customColor}` : ''}`} draggable title="이 칩을 드래그하여 원하는 선반 적재함에 놓으세요"
            onDragStart={e => { e.stopPropagation(); drag.current = { type: 'item', ref: { uid: b.uid, fromLoc: '신규 등록 대기열' } }; e.dataTransfer.setData('text/plain', 'item'); }}
            onClick={e => { e.stopPropagation(); setSel({ uid: b.uid }); }}>
            <span>✨ {b.text}</span>
            <button type="button" className="tab-item-chip-del" title="색상 변경" onClick={e => { e.stopPropagation(); ctx.openColor(e, { uid: b.uid }); }}>🎨</button>
            <button type="button" className="tab-item-chip-del" title="다른 구역으로 품목 이동" onClick={e => { e.stopPropagation(); ctx.transfer(e, { uid: b.uid }); }}>🚚</button>
            <button type="button" className="tab-item-chip-del" title="대기 목록에서 삭제" onClick={e => { e.stopPropagation(); run(d => { S.removeItem(d, { uid: b.uid }); }); }}>×</button>
          </div>
        ))}
      </div>

      {room.split
        ? <div className="boards-container dual-shelf-container">{board(room.boards[0], 'rack-left', 0, 3, ' shelf-card')}{board(room.boards[1], 'rack-right', 3, undefined, ' shelf-card')}</div>
        : <div className="boards-container">{board(room.boards[0], 'tobe', 0)}</div>}

      {room.id === 'pack-supplies' && <ItemTable m={m} />}

      {menu && menuCol && (
        <div className="col-context-menu" style={{ left: menu.x, top: menu.y }} onClick={e => e.stopPropagation()}>
          {menuItem('✏️', `이름 변경 — ${menuCol.label}`, () => {
            const v = prompt('구역 이름을 변경하세요:', menuCol.label)?.trim();
            if (v) run(d => S.renameColumn(d, menu.t, menu.c, v));
          })}
          <div className="col-context-menu-separator" />
          {S.isStacked(menuCol) && <>{menuItem('✂️', '2단 분리 (각각 1단으로)', () => run(d => S.unstack(d, menu.t, menu.c)))}<div className="col-context-menu-separator" /></>}
          {menuItem('➕', '이 단에 새 구역 추가', () => ctx.addColumn(menu.t))}
          <div className="col-context-menu-separator" />
          {menuItem('🗑️', '이 구역 삭제', () => {
            const n = S.itemCount(menuCol);
            if (confirm(`[${menuCol.label}] 구역을 신규 선반에서 완전히 삭제하시겠습니까?${n ? `\n(주의: 이 구역 안에 배치된 ${n}개의 장비 블럭도 함께 미배치 상태로 돌아갑니다)` : ''}`)) run(d => S.deleteColumn(d, menu.t, menu.c));
          }, true)}
          {m.toBe.length > 1 && menuItem('🗑️', `"${m.toBe[menu.t].tierTitle}" 단 전체 삭제`, () => {
            if (confirm(`[${m.toBe[menu.t].tierTitle}] 선반 단 전체를 삭제하시겠습니까?`)) run(d => S.deleteTier(d, menu.t));
          }, true)}
        </div>
      )}

      {picker && (
        <div className="floating-color-popover" style={{ left: picker.x, top: picker.y }}>
          {PICK_COLORS.map(([k, label, bg]) => (
            <button key={label} type="button" title={label} className={`color-picker-dot${S.findItem(m, picker.ref)?.customColor === k ? ' is-active' : ''}`}
              style={{ background: bg, ...(k === 'white' && { border: '1px solid #cbd5e1' }) }}
              onClick={e => { e.stopPropagation(); const ref = picker.ref; setPicker(null); run(d => { const x = S.findItem(d, ref); if (x) x.customColor = k; }); }}>
              {!k && <span className="color-reset-mark">✕</span>}
            </button>
          ))}
        </div>
      )}
      {toast}
    </div>
  );
}

const BADGES: Record<string, [string, string, string, string]> = {
  red: ['#fee2e2', '#fca5a5', '#991b1b', '🔴 빨강'], blue: ['#e0f2fe', '#7dd3fc', '#0369a1', '🔵 파랑'], yellow: ['#fef9c3', '#fde047', '#854d0e', '🟡 노랑'],
  green: ['#dcfce7', '#86efac', '#166534', '🟢 초록'], white: ['#ffffff', '#cbd5e1', '#1e293b', '⚪ 흰색']
};

/** 포장 비품실 아래 보관 물품 목록 */
function ItemTable({ m }: { m: S.ShelfModel }) {
  const rows = m.toBe.flatMap(t => t.columns.flatMap(c => c.slots.flatMap(s => s.items.map(it => ({ t, c, s, it })))));
  return (
    <div className="table-section">
      <div className="table-header">
        <h3>📋 선반 보관 물품 목록 및 현황 점검표</h3>
        <span className="count-summary-pill">총 {rows.length}개 품목 보관 관리 중</span>
      </div>
      <div className="table-wrapper">
        <table className="log-table">
          <thead>
            <tr>
              <th style={{ width: 45, textAlign: 'center' }}>확인</th><th style={{ width: 50, textAlign: 'center' }}>No</th><th style={{ width: 120 }}>선반 단(위치)</th>
              <th style={{ width: 220 }}>구역 및 적재함</th><th style={{ width: 180 }}>보관 품목 / 장비명</th><th style={{ width: 120 }}>용기/적재 형태</th>
              <th style={{ width: 100, textAlign: 'center' }}>지정 색상</th><th style={{ width: 90, textAlign: 'center' }}>상태</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ t, c, s, it }, i) => {
              const b = it.customColor ? BADGES[it.customColor] : null;
              return (
                <tr key={i}>
                  <td style={{ textAlign: 'center' }}><input type="checkbox" /></td>
                  <td className="cell-no">{i + 1}</td>
                  <td><span className="cell-tier">{t.tierTitle}</span></td>
                  <td><span className="cell-loc">{c.label} [{s.slotName}]</span></td>
                  <td><b className="cell-name">{it.text}</b></td>
                  <td><span className="cell-type">{it.containerType || '보관함'}</span></td>
                  <td style={{ textAlign: 'center' }}>{b ? <span className="color-badge" style={{ background: b[0], border: `1px solid ${b[1]}`, color: b[2] }}>{b[3]}</span> : <span className="color-badge-none">기본</span>}</td>
                  <td style={{ textAlign: 'center' }}><span className="status-badge status-same" style={{ background: '#ecfdf5', color: '#065f46' }}>정상보관</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
