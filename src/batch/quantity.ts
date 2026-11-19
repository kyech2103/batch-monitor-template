// 배치의 공정별 수량과 구역별로 보일 수량. PC 평면도·툴팁·창고와 모바일이 모두 이것만 쓴다
import { calcQuantities, type LossKey } from './core.ts';

type Num = number | null;
// shortcut: 옛 형식 칸(qtyB, lossB 등)까지 읽느라 느슨한 타입, 옛 데이터가 사라지면 Batch 타입으로
type RawBatch = Record<string, any> | null | undefined;

export interface BatchQuantities {
  actualB: Num; actualBNet: Num; actualC: Num; actualD: Num; actualE: Num;
  actualInspection: Num; actualPackaging: Num; finalQty: Num;
  losses: Record<LossKey, number>;
}

const parseNum = (v: unknown): Num => {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return isNaN(n) ? null : n;
};

export function batchQuantities(batch: RawBatch): BatchQuantities {
  if (!batch) return { actualB: null, actualBNet: null, actualC: null, actualD: null, actualE: null, actualInspection: null, actualPackaging: null, finalQty: null, losses: { B: 0, C: 0, D: 0, E: 0, inspection: 0, packaging: 0 } };
  const q = batch.quantities || {};
  const l = q.losses || batch.lossQuantities || {};
  const bVal = parseNum(q.actualB ?? q.B ?? batch.qtyB);
  const losses = {
    B: parseNum(l.B ?? q.lossB ?? batch.lossB) || 0,
    C: parseNum(l.C ?? q.lossC ?? batch.lossC) || 0,
    D: parseNum(l.D ?? q.lossD ?? batch.lossD) || 0,
    E: parseNum(l.E ?? q.lossE ?? batch.lossE) || 0,
    inspection: parseNum(l.inspection ?? q.lossInspection ?? batch.lossInspection) || 0,
    packaging: parseNum(l.packaging ?? q.lossPackaging ?? batch.lossPackaging) || 0
  };

  // 공정2 수량이 있으면 차감만으로 계산한다(저장 규칙과 같은 calcQuantities).
  // 공정2 수량이 없는 옛 배치는 저장된 실수량을 쓰고, 없으면 앞 공정에서 차감한다.
  const derived = calcQuantities(bVal, losses).quantities;
  const legacy = (stored: unknown, prev: Num, loss: number) => parseNum(stored) ?? (prev != null ? prev - loss : null);
  const hasB = bVal != null;
  const actualC = hasB ? derived.C : legacy(q.C ?? batch.qtyC, null, 0);
  const actualD = hasB ? derived.D : legacy(q.D ?? batch.qtyD, actualC, losses.D);
  const actualE = hasB ? derived.E : legacy(q.E ?? batch.qtyE, actualD, losses.E);
  const actualInspection = hasB ? derived.inspection : legacy(q.inspection ?? batch.qtyInspection, actualE, losses.inspection);
  const actualPackaging = hasB ? derived.packaging : legacy(q.packaging ?? batch.qtyPackaging, actualInspection, losses.packaging);
  const actualBNet = derived.BNet;
  const finalQty = actualPackaging ?? actualInspection ?? actualE ?? actualD ?? actualC ?? actualBNet ?? bVal;
  return { actualB: bVal, actualBNet, actualC, actualD, actualE, actualInspection, actualPackaging, finalQty, losses };
}

// 구역마다 그 구역에 들어오기 전 공정까지 차감한 수량을 보인다. 진행 구역은 그 공정 차감 전 수량.
// 포장 진행 구역은 완제품 창고가 그리드가 아니어서 포장 차감까지 반영한다.
const ZONE_STAGE: Record<string, number> = {
  'stage1-wait': 0, stage1: 0, 'stage1-1': 0, 'stage1-2': 0, 'stage2-wait': 0, stage2: 0,
  'stage3-wait': 1, 'stage3': 1, 'stage3-1': 1, 'stage3-2': 1,
  'stage4-wait': 2, stage4: 2, 'stage4-1': 2, 'stage4-2': 2,
  'stage5-wait': 3, stage5: 3,
  'semi-storage-pre': 4, 'semi-discharge': 4, inspection: 4,
  'semi-storage-post': 5, 'packaging-wait': 5,
  packaging: 6, logistics: 6
};

export function qtyForZone(batch: RawBatch, zoneId: string | null | undefined): Num {
  if (!batch) return null;
  const c = batchQuantities(batch);
  // 앞 공정부터 차례로: 비어 있으면 그 앞 단계 수량을 쓴다
  const chain: Num[] = [c.actualB, c.actualBNet, c.actualC, c.actualD, c.actualE, c.actualInspection, c.actualPackaging];
  const stage = ZONE_STAGE[zoneId ?? ''] ?? 6;
  if (stage === 0) return c.actualB;
  for (let i = stage; i >= 0; i--) if (chain[i] != null) return chain[i];
  return null;
}
