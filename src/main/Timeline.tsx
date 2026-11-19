// 메인 타임라인 탭: 로트별 공정 막대 (2주/1주), 지금 선
import type { Batch } from '../batch/core';
import { zoneInfo } from './batches';
import { buildDayColumns, buildTimelineRows, computeRange, nowLinePct } from './timelineBars';
import { batchTiming } from './SidePanel';
import { isPostEBatch, normalizeScheduleYears } from '../todo/core';

const LEGEND: [string, string][] = [['a', '#0D9488', '공정1'], ['b', '#DC2626', '공정2'], ['c', '#7C3AED', '공정3'], ['d', '#F59E0B', '공정4'], ['e', '#2563EB', '공정5']].map(([k, c, n]) => [`var(--proc-${k}, ${c})`, n]);

export function timelineRows(batches: Batch[], range: string, now: Date) {
  const { start, days } = computeRange(range, now);
  const rows = buildTimelineRows({
    batches, now, start, days,
    normalize: normalizeScheduleYears, isPostE: isPostEBatch,
    zoneOf: (b: Batch) => zoneInfo(b, now).zoneId
  });
  return { start, days, rows };
}

export function Timeline({ hidden, batches, now, range, setRange, selected, matches, onSelect }: {
  hidden: boolean; batches: Batch[]; now: Date; range: string; setRange(r: string): void;
  selected: string | null; matches(lot: string): boolean; onSelect(b: Batch): void;
}) {
  // 숨어 있을 때는 막대를 계산하지 않는다 (1초마다 다시 그린다)
  const { start, days, rows } = timelineRows(hidden ? [] : batches, range, now);
  const pct = nowLinePct(start, days, now);
  return (
    <section id="timeline-view" className={`timeline-view${hidden ? ' is-hidden' : ''}`} role="tabpanel" aria-labelledby="tab-timeline">
      <div className="timeline-toolbar">
        <div id="timeline-range" className="timeline-range" role="group" aria-label="기간 선택">
          {[['2w', '2주'], ['1w', '1주']].map(([r, label]) => (
            <button key={r} type="button" id={`btn-timeline-${r}`} className={`timeline-range-btn${range === r ? ' is-active' : ''}`} data-range={r} onClick={() => setRange(r)}>{label}</button>
          ))}
        </div>
        <div className="timeline-legend" aria-label="공정 범례">
          {LEGEND.map(([c, n]) => <span key={n} className="legend-item"><span className="legend-dot" style={{ background: c }} />{n}</span>)}
        </div>
      </div>
      <div className="timeline-scroll-box" id="timeline-scroll-box">
        <div className="timeline-board" id="timeline-board">
          <div className="timeline-header-line">
            <div className="timeline-info-col-header">로트 / 현재 상태</div>
            <div className="timeline-track-col-header" id="timeline-days-header">
              {buildDayColumns(start, days, now).map((c, i) => (
                <div key={i} className={['timeline-day-col', c.isWeekend && 'is-weekend', c.isToday && 'is-today'].filter(Boolean).join(' ')}>{c.label}</div>
              ))}
            </div>
          </div>
          <div className="timeline-body-area" id="timeline-body-area">
            <div id="timeline-rows" className="timeline-rows" role="list">
              {rows.map(r => {
                const info = zoneInfo(r.batch, now), t = batchTiming(r.batch, info, now);
                const name = info.processName || info.badgeText || '대기';
                return (
                  <button key={r.lotNumber} type="button" data-lot={r.lotNumber} onClick={() => onSelect(r.batch)}
                    className={`timeline-row${r.lotNumber === selected ? ' is-selected' : ''}${matches(r.lotNumber) ? ' is-search-match' : ''}`}>
                    <div className="timeline-row-info">
                      <span className="timeline-lot-badge">{r.lotNumber}</span>
                      <span className="timeline-status-text">{t.text && t.text !== '-' ? `${name} · ${t.text}` : name}</span>
                    </div>
                    <div className="timeline-row-track">
                      {r.segments.map((s, i) => (
                        <div key={i} className={`timeline-segment${s.past ? ' is-past' : ''}`} title={s.title} aria-label={s.title}
                          style={{ left: `${s.leftPct}%`, width: `${s.widthPct}%`, backgroundColor: s.color }} />
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="timeline-overlay-track" id="timeline-overlay-track">
              <div id="timeline-now-line" className="timeline-now-line" title="현재 시각"
                style={pct === null || pct < 0 || pct > 100 ? { display: 'none' } : { display: 'block', left: `${pct}%` }} />
            </div>
            <div id="timeline-empty-hint" className="timeline-empty-hint" style={{ display: rows.length ? 'none' : 'block' }}>표시할 진행·예정 배치가 없습니다</div>
          </div>
        </div>
      </div>
    </section>
  );
}
