// 선반 랙 그림: 단 → 열 → 적재함(1단·4구, 2단 적층은 위아래 두 개) → 칸 → 품목 카드. 편집은 ShelfApp이 넘겨 준 ctx로
import type { DragEvent, MouseEvent } from 'react';
import * as S from './model';
import type { ShelfRoom } from '../rooms';

export type Drag = { type: 'item'; ref: S.ItemRef } | { type: 'col'; t: number; c: number } | { type: 'unit'; t: number; c: number; pos: S.UnitPos };
export type UnitSel = { t: number; c: number; pos: S.UnitPos; label: string };
export interface RackCtx {
  room: ShelfRoom; m: S.ShelfModel; sel: S.ItemRef | null; unitSel: UnitSel | null;
  drag: { current: Drag | null };
  run(fn: (d: S.ShelfModel) => S.Log | void): void;
  clickItem(ref: S.SlotRef): void;
  clickSlot(e: MouseEvent, t: number, c: number, s: number): void;
  setUnitSel(u: UnitSel | null): void;
  openColor(e: MouseEvent, ref: S.ItemRef): void;
  openMenu(e: MouseEvent, t: number, c: number): void;
  renameItem(ref: S.ItemRef, withLog: boolean): void;
  transfer(e: MouseEvent, ref: S.ItemRef): void;
  addColumn(t: number): void;
  addTier(): void;
}

const sameRef = (a: S.ItemRef | null, t: number, c: number, s: number, i: number) => !!a && !('uid' in a) && a.t === t && a.c === c && a.s === s && a.i === i;
const on = (e: DragEvent, cls: string) => (e.currentTarget as HTMLElement).classList.add(cls);
const off = (e: DragEvent, ...cls: string[]) => (e.currentTarget as HTMLElement).classList.remove(...cls);
const startDrag = (ctx: RackCtx, e: DragEvent, d: Drag) => { e.stopPropagation(); ctx.drag.current = d; e.dataTransfer.setData('text/plain', d.type); };

function Card({ ctx, it, t, c, s, i }: { ctx: RackCtx; it: S.Item; t: number; c: number; s: number; i: number }) {
  const ref = { t, c, s, i };
  const stop = (f: () => void) => (e: MouseEvent) => { e.stopPropagation(); f(); };
  return (
    <div className={`block-card cat-${it.cat || 'translucent'}${it.customColor ? ` color-${it.customColor}` : ''}${sameRef(ctx.sel, t, c, s, i) ? ' is-selected' : ''}`}
      draggable onDragStart={e => startDrag(ctx, e, { type: 'item', ref })} onClick={stop(() => ctx.clickItem(ref))}>
      <div className="block-main-row">
        <div className="block-title-text" title={`${it.text} (${it.containerType || '장비'})\n더블클릭하여 이름을 수정할 수 있습니다`}
          onDoubleClick={stop(() => ctx.renameItem(ref, false))}>{it.text}</div>
        <div className="block-actions" data-export="hide">
          <button type="button" className="block-btn-color" title="색상 변경 (빨, 파, 노, 초, 흰, 기본)" onClick={e => { e.stopPropagation(); ctx.openColor(e, ref); }}>🎨</button>
          <button type="button" className="block-btn-edit" title="이름 수정" onClick={stop(() => ctx.renameItem(ref, true))}>✏️</button>
          <button type="button" className="block-btn-transfer" title="다른 구역으로 품목 이동" onClick={e => { e.stopPropagation(); ctx.transfer(e, ref); }}>🚚</button>
          <button type="button" className="block-btn-del" title="이 블럭 삭제" onClick={stop(() => ctx.run(d => {
            const tier = d.toBe[t], col = tier.columns[c], slot = col.slots[s];
            const [gone] = slot.items.splice(i, 1);
            return ['물건 삭제', gone.text, S.slotLoc(tier, col, slot), '-', `[${gone.text}] 보관 품목 삭제`];
          }))}>×</button>
        </div>
      </div>
    </div>
  );
}

function SlotBay({ ctx, slot, t, c, s, meta }: { ctx: RackCtx; slot: S.Slot; t: number; c: number; s: number; meta: boolean }) {
  const isItem = () => ctx.drag.current?.type === 'item';
  return (
    <div className="item-slot-bay" data-slot={`${t}-${c}-${s}`}
      onDragOver={e => { if (!isItem()) return; e.preventDefault(); e.stopPropagation(); on(e, 'drag-over'); }}
      onDragLeave={e => off(e, 'drag-over')}
      onDrop={e => {
        const d = ctx.drag.current;
        if (d?.type !== 'item') return;
        e.preventDefault(); e.stopPropagation(); off(e, 'drag-over');
        ctx.drag.current = null;
        ctx.run(m => S.placeItem(m, d.ref, t, c, s));
      }}
      onClick={e => ctx.clickSlot(e, t, c, s)}>
      {meta && <div className="slot-meta-header"><span>{slot.slotName}</span><span>({slot.items.length})</span></div>}
      <div className="slot-items-list">
        {slot.items.map((it, i) => <Card key={`${it.uid}-${i}`} ctx={ctx} it={it} t={t} c={c} s={s} i={i} />)}
        {!slot.items.length && ctx.room.emptyHint && <div className="slot-empty-placeholder"><span>{ctx.room.emptyHint}</span></div>}
      </div>
    </div>
  );
}

function UnitBox({ ctx, col, t, c, four, slots, first, pos, label }: { ctx: RackCtx; col: S.Column; t: number; c: number; four: boolean; slots: S.Slot[]; first: number; pos: S.UnitPos; label: string }) {
  const stacked = S.isStacked(col);
  const u = ctx.unitSel;
  const selected = !!u && u.t === t && u.c === c && u.pos === pos;
  const name = four ? label || '4구 부품함' : slots[0]?.slotName || label || '적재함';
  const count = slots.reduce((n, sl) => n + (sl?.items.length || 0), 0);
  const stackDrag = () => { const d = ctx.drag.current; return d?.type === 'unit' && !(d.t === t && d.c === c) ? d : null; };
  const half = (e: DragEvent) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); return e.clientY - r.top < r.height / 2 ? 'top' : 'bottom'; };
  const stack = (where: 'top' | 'bottom', src: { t: number; c: number; pos: S.UnitPos }) => ctx.run(m => S.stackUnit(m, src.t, src.c, src.pos, t, c, where));
  return (
    <div className={`container-unit-box${selected ? ' is-selected-unit' : ''}`}
      {...(!stacked && {
        onDragOver: (e: DragEvent) => {
          if (!stackDrag()) return;
          e.preventDefault(); e.stopPropagation();
          const top = half(e) === 'top';
          on(e, top ? 'dragover-stack-top' : 'dragover-stack-bottom');
          off(e, top ? 'dragover-stack-bottom' : 'dragover-stack-top');
        },
        onDragLeave: (e: DragEvent) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          if (e.clientX < r.left || e.clientX >= r.right || e.clientY < r.top || e.clientY >= r.bottom) off(e, 'dragover-stack-top', 'dragover-stack-bottom');
        },
        onDrop: (e: DragEvent) => {
          const d = stackDrag();
          off(e, 'dragover-stack-top', 'dragover-stack-bottom');
          if (!d) return;
          e.preventDefault(); e.stopPropagation();
          ctx.drag.current = null;
          stack(half(e), d);
        }
      })}>
      <div className="container-unit-header">
        <span className="unit-drag-handle" draggable data-export="hide" title="드래그하거나 클릭하여 다른 적재함 위/아래에 쌓거나 선반 빈자리로 옮깁니다"
          onDragStart={e => startDrag(ctx, e, { type: 'unit', t, c, pos })}
          onClick={e => { e.stopPropagation(); ctx.setUnitSel(selected ? null : { t, c, pos, label: name }); }}>
          {selected ? <><span>✓</span> <span>선택됨</span></> : <><span>≡</span> <span>이동</span></>}
        </span>
        <span className="unit-title-text" title={`${name} (${count}개 품목 보관 중 - 더블클릭하여 명칭 수정)`}
          onDoubleClick={e => {
            e.stopPropagation();
            const v = prompt('적재함 명칭을 수정하세요:', name)?.trim();
            if (v) ctx.run(m => S.renameUnit(m, t, c, first, four, v));
          }}>
          <span>{four ? '🗄️' : '📦'} <b>{name}</b></span> <span className="unit-count-badge">({count})</span>
        </span>
        {four && <span className="unit-badge">4구</span>}
        {stacked && (
          <button type="button" className="btn-unit-unstack" data-export="hide" title="이 2단 적재함을 독립된 두 개의 1단 구역으로 분리하여 나란히 배치합니다"
            onClick={e => { e.stopPropagation(); ctx.run(m => S.unstack(m, t, c)); }}><span>⎘</span> <span>1단 분리</span></button>
        )}
        {u && !selected && !stacked && (['top', 'bottom'] as const).map(where => (
          <button key={where} type="button" data-export="hide" className={where === 'top' ? 'btn-click-merge-top' : 'btn-click-merge-bot'}
            title={`선택된 [${u.label}] 적재함을 이 적재함 ${where === 'top' ? '위에 쌓아' : '아래에 받쳐서'} 2단으로 만듭니다`}
            onClick={e => { e.stopPropagation(); stack(where, u); }}>{where === 'top' ? '⬆️ 위에 쌓기' : '⬇️ 아래에 쌓기'}</button>
        ))}
        <button type="button" className="btn-unit-del" data-export="hide" title="이 적재함 삭제" onClick={e => { e.stopPropagation(); ctx.run(m => S.deleteUnit(m, t, c, pos)); }}>🗑️</button>
      </div>
      {four ? (
        <div className="slots-container-grid2x2">
          {[0, 1, 2, 3].map(i => <SlotBay key={i} ctx={ctx} slot={slots[i] || { slotName: `${i + 1}구`, items: [] }} t={t} c={c} s={first + i} meta />)}
        </div>
      ) : <SlotBay ctx={ctx} slot={slots[0] || { slotName: '적재함', items: [] }} t={t} c={c} s={first} meta={false} />}
      {!stacked && <>
        <div className="unit-stack-overlay unit-stack-top" data-export="hide"><span>⬆️ 이 적재함 위에 올려서 적층 (상단)</span></div>
        <div className="unit-stack-overlay unit-stack-bottom" data-export="hide"><span>⬇️ 이 적재함 아래에 받쳐서 적층 (하단)</span></div>
      </>}
    </div>
  );
}

function ColBay({ ctx, col, t, c }: { ctx: RackCtx; col: S.Column; t: number; c: number }) {
  const stacked = S.isStacked(col);
  // 다른 열을 이 자리로, 또는 (2단 열 위에서는) 적재함을 떼어 이 자리 새 열로
  const accepts = () => {
    const d = ctx.drag.current;
    if (!d || d.type === 'item' || (d.t === t && d.c === c)) return null;
    return d.type === 'col' || stacked ? d : null;
  };
  const off_ = S.botOffset(col);
  return (
    <div className="col-bay" draggable
      onDragStart={e => { startDrag(ctx, e, { type: 'col', t, c }); on(e, 'is-dragging-column'); }}
      onDragEnd={e => off(e, 'is-dragging-column')}
      onDragOver={e => { if (!accepts()) return; e.preventDefault(); e.stopPropagation(); on(e, 'col-drag-over'); }}
      onDragLeave={e => off(e, 'col-drag-over')}
      onDrop={e => {
        off(e, 'col-drag-over');
        const d = accepts();
        if (!d) return;
        e.preventDefault(); e.stopPropagation();
        ctx.drag.current = null;
        ctx.run(m => (d.type === 'col' ? S.moveColumn(m, d.t, d.c, t, c) : S.moveUnitToShelf(m, d.t, d.c, (d as { pos: S.UnitPos }).pos, t, c)));
      }}
      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); ctx.openMenu(e, t, c); }}>
      {!stacked
        ? <UnitBox ctx={ctx} col={col} t={t} c={c} four={col.colType === 'grid2x2'} slots={col.slots} first={0} pos="single" label={col.label} />
        : <>
          <UnitBox ctx={ctx} col={col} t={t} c={c} four={S.isTop4(col)} slots={S.isTop4(col) ? col.slots.slice(0, 4) : [col.slots[0]]} first={0} pos="top" label={col.slots[0]?.slotName || '상단 적재함'} />
          <UnitBox ctx={ctx} col={col} t={t} c={c} four={S.isBot4(col)} slots={S.isBot4(col) ? col.slots.slice(off_, off_ + 4) : [col.slots[off_]]} first={off_} pos="bottom" label={col.slots[off_]?.slotName || '하단 적재함'} />
        </>}
    </div>
  );
}

/** 단 목록 하나 (포장 비품실은 좌측 0~2단, 우측 3단~ 두 개) */
export function Rack({ ctx, from, to }: { ctx: RackCtx; from: number; to?: number }) {
  const tiers = ctx.m.toBe.slice(from, to);
  const moveTo = (t: number) => (e: DragEvent) => {
    off(e, 'col-drag-over');
    const d = ctx.drag.current;
    if (!d || d.type === 'item') return;
    e.preventDefault();
    ctx.drag.current = null;
    ctx.run(m => (d.type === 'col' ? S.moveColumn(m, d.t, d.c, t, -1) : S.moveUnitToShelf(m, d.t, d.c, d.pos, t, -1)));
  };
  return (
    <div className="shelf-rack">
      {ctx.unitSel && (
        <div className="container-select-guide-banner" data-export="hide">
          <span>📌 <b>[{ctx.unitSel.label}]</b> 적재함이 선택되었습니다. 합칠 다른 적재함 헤더의 <b>[⬆️ 위에 쌓기]</b> 또는 <b>[⬇️ 아래에 쌓기]</b>를 클릭하세요.</span>
          <button type="button" onClick={() => ctx.setUnitSel(null)}>선택 취소 (ESC)</button>
        </div>
      )}
      {tiers.map((tier, k) => {
        const t = from + k;
        const shelf = /^(상단|중단|하단)/.test(tier.tierTitle);
        return (
          <div key={tier.tierId || t} className={`tier-block ${shelf ? 'tier-shelf' : 'tier-nonshelf'}`}>
            <div className="tier-header-row">
              <div className={`tier-label-bar${shelf ? '' : ' nonshelf-label'}`}>{`${tier.tierTitle}  (${tier.columns.length}개 구역)`}</div>
              <button type="button" className="btn-tier-add-col" data-export="hide" title="이 선반 단에 새로운 열을 추가하거나, 적재함을 여기로 드래그하여 분리/배치합니다"
                onClick={() => ctx.addColumn(t)}
                onDragOver={e => { const d = ctx.drag.current; if (d && d.type !== 'item') { e.preventDefault(); on(e, 'col-drag-over'); } }}
                onDragLeave={e => off(e, 'col-drag-over')} onDrop={moveTo(t)}>
                <span>＋</span> <span>새 열 추가</span>
              </button>
            </div>
            <div className="tobe-cols-flexible" style={{ gridTemplateColumns: tier.columns.map(col => (S.is4Wide(col) ? 'minmax(180px, 1.4fr)' : 'minmax(130px, 1fr)')).join(' ') }}>
              {tier.columns.map((col, c) => <ColBay key={`${col.colId}-${c}`} ctx={ctx} col={col} t={t} c={c} />)}
            </div>
          </div>
        );
      })}
      <div className="btn-add-tier-bar" data-export="hide" onClick={ctx.addTier}>➕ 새로운 선반 단(Tier/레이어) 추가하기</div>
    </div>
  );
}
