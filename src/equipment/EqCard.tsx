// 오른쪽 패널의 장비 상태 카드. 누르면 예약 목록 창을 연다
import { useBatches } from '../main/batches';
import { equipmentState } from './core';
import { useJobs } from './jobs';

export function EqCard() {
  const jobs = useJobs();
  const { now } = useBatches(); // 1초마다 다시 그린다
  const st = equipmentState(jobs, now);
  return (
    <div className="equipment-quick-card" id="equipment-display-card" data-room-id="equipment" title="클릭하여 장비 상세 모달 열기"
      onClick={e => { e.stopPropagation(); window.EquipmentModal?.open('list'); }}>
      <span className="ac-type-pill" id="ac-card-type-bg">장비</span>
      <span className="ac-status-dot-el" id="ac-card-status-dot" style={{ backgroundColor: st.dotColor }} />
      <span className="ac-status-text-el" id="ac-card-status-text" style={{ color: st.statusColor }}>{st.statusText}</span>
      <div className="ac-gauge-container"><div className="ac-gauge-fill" id="ac-card-gauge-bar" style={{ width: `${st.pct}%`, backgroundColor: st.dotColor }} /></div>
      <span className="ac-time-label" id="ac-card-gauge-text">{st.gaugeText}</span>
    </div>
  );
}
