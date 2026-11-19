// AI 입력: 메신저 공정 보고 → batch-assist 함수 → 미리보기 체크리스트 → 기존 저장 경로(saveBatchesToServer).
// 기존 코드는 이 기능을 모른다: 버튼·창·스타일을 이 파일이 직접 붙이고, 기존 전역은 누를 때만 읽는다.
// 이 파일은 배치 목록을 직접 만들지 않는다: 저장할 목록은 BatchAssistCore.apply만 만든다 (배치 삭제 불가).

let assistChanges = null;   // 마지막 해석 결과 (Change[]): 충돌 때 다시 계산하는 재료
let assistNotes = '';
let assistLogId = null;     // 서버 해석 기록 id: [오류 보고]로 표시할 때 쓴다
let assistPlan = null;      // 지금 화면에 보이는 미리보기
let assistBusy = false;     // 해석·적용 중 잠금 (두 번 눌러도 한 번만)

const ASSIST_REASON_TEXT = {
  auth: '다시 로그인해 주세요',
  rate: '잠시 뒤에 다시 해 주세요',
  too_long: '보고는 2000자까지 넣을 수 있어요',
  bad_request: '보낼 수 없는 내용이에요. 다시 확인해 주세요',
  model: 'AI가 답하지 못했어요. 다시 변환해 주세요',
  network: '인터넷 연결을 확인해 주세요',
  disabled: 'AI 기능이 꺼져 있어요',
  too_many_lots: '한 번에 배치 4개까지만 바꿀 수 있어요. 나눠서 넣어 주세요'
};

const assistEl = id => document.getElementById(id);
const assistCtx = batches => ({ batches, zones: window.ALLOWED_ZONES || {}, now: new Date(), zoneOf: b => (MobileBridge.getBatchZoneInfo(b) || {}).zoneId || null });

/** 열기. 인증 안 된 작업자면 인증 창을 먼저 띄운다 (PC에는 수정 전 작업자 확인이 따로 없으므로). */
function openBatchAssist() {
  if (!currentWorker || !currentWorker.id) return openOperatorModal(true);
  assistChanges = null;
  assistPlan = null;
  assistEl('batch-assist-preview').innerHTML = '';
  showAssistStatus('');
  refreshAssistApply();
  assistEl('batch-assist-modal').showModal();
  assistEl('batch-assist-text').focus();
}

/** 함수 호출. 키는 서버에만 있고 화면은 Google을 직접 부르지 않는다. */
async function requestBatchAssist(text) {
  try {
    const token = (await _sb.auth.getSession()).data.session?.access_token || '';
    const res = await fetch(`${SUPABASE_URL}/functions/v1/batch-assist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(90000),
      body: JSON.stringify({
        text,
        lots: MobileBridge.getBatches().map(b => b && b.lotNumber).filter(Boolean).slice(0, 50),
        zones: Object.entries(window.ALLOWED_ZONES || {}).map(([id, z]) => [id, String(z.name || id).slice(0, 30)]).slice(0, 40)
      })
    });
    const body = await res.json().catch(() => ({ ok: false, reason: 'model' }));
    return body && typeof body === 'object' ? body : { ok: false, reason: 'model' };
  } catch (e) {
    return { ok: false, reason: 'network' };
  }
}

async function runBatchAssistParse() {
  const text = assistEl('batch-assist-text').value.trim();
  if (assistBusy || !text) return;
  assistPlan = null;
  assistLogId = null;
  assistEl('batch-assist-preview').innerHTML = '';
  setAssistBusy(true);
  showAssistStatus('변환하는 중이에요…');
  try {
    const res = await requestBatchAssist(text);
    if (!res.ok) return showAssistStatus(ASSIST_REASON_TEXT[res.reason] || ASSIST_REASON_TEXT.rate);
    assistChanges = Array.isArray(res.changes) ? res.changes : [];
    assistNotes = typeof res.notes === 'string' ? res.notes : '';
    assistLogId = Number.isInteger(res.logId) ? res.logId : null;
    assistPlan = BatchAssistCore.plan(assistChanges, assistCtx(MobileBridge.getBatches()));
    showAssistStatus('');
    renderAssistPreview(assistPlan, '');
  } finally {
    setAssistBusy(false);
  }
}

function assistLineHtml(l, checked) {
  const on = checked.has(l.id) ? checked.get(l.id) : l.on;
  const note = l.error || l.warn;
  return `<label class="ba-line${l.error ? ' is-error' : ''}">
      <input type="checkbox" class="ba-check" data-id="${escapeHtml(l.id)}"${on && !l.error ? ' checked' : ''}${l.error ? ' disabled' : ''}>
      <span class="ba-line-main">
        <span class="ba-label">${escapeHtml(l.label)}</span>
        <span class="ba-change">${escapeHtml(l.before)} → <b>${escapeHtml(l.after)}</b></span>
        ${l.quotes.length ? `<small class="ba-quote">${escapeHtml(l.quotes.join(' / '))}</small>` : ''}
        ${note ? `<small class="ba-warn">${escapeHtml(note)}</small>` : ''}
      </span>
    </label>`;
}

/**
 * 미리보기: 로트를 크게, 그 아래 줄마다 체크박스 + '라벨: 전 → 후' + 근거 원문 + 경고.
 * 모델이 만든 글(quote·memo·notes)은 escapeHtml을 거쳐서만 넣는다. 다시 계산해도 사용자가 끈 줄은 꺼진 채로 둔다.
 */
function renderAssistPreview(plan, notice) {
  const box = assistEl('batch-assist-preview');
  const checked = new Map([...box.querySelectorAll('.ba-check')].map(c => [c.dataset.id, c.checked]));
  const groups = plan.groups.map(g => `<section class="ba-group">
      <h3 class="ba-lot">${escapeHtml(g.lot)}</h3>
      ${g.lines.map(l => assistLineHtml(l, checked)).join('')}
    </section>`).join('');
  const rest = plan.skipped.map(s => `<li>${escapeHtml(s.why)}${s.quote ? ` <small class="ba-quote">${escapeHtml(s.quote)}</small>` : ''}</li>`);
  if (assistNotes) rest.push(`<li>${escapeHtml(assistNotes)}</li>`);
  box.innerHTML = (notice ? `<p class="ba-notice">${escapeHtml(notice)}</p>` : '')
    + (groups || '<p class="ba-empty">적용할 변경을 찾지 못했어요</p>')
    + (rest.length ? `<section class="ba-skipped"><h4>적용하지 않는 내용</h4><ul>${rest.join('')}</ul></section>` : '')
    + (assistLogId ? '<button type="button" class="pt-btn pt-btn--secondary ba-flag" id="btn-assist-flag">오류 보고</button>' : '');
  refreshAssistApply();
}

/** @returns {Set<string>} 체크된 Line.id */
function readCheckedLineIds() {
  return new Set([...document.querySelectorAll('#batch-assist-preview .ba-check:checked')].map(c => c.dataset.id));
}

function refreshAssistApply() {
  assistEl('btn-assist-apply').disabled = assistBusy || !assistPlan || readCheckedLineIds().size === 0;
}

function setAssistBusy(busy) {
  assistBusy = busy;
  assistEl('btn-assist-parse').disabled = busy;
  refreshAssistApply();
}

/**
 * 적용: 서버 최신 목록 다시 읽기 → BatchAssistCore.apply → saveBatchesToServer → 화면 반영·감사 기록.
 * 충돌이면 최신 목록으로 다시 계산해 보여 주고 저장하지 않는다 (사용자가 확인하고 다시 적용).
 */
async function runBatchAssistApply() {
  if (assistBusy || !assistPlan) return;
  setAssistBusy(true);
  try {
    const { data: latest, error } = await fetchServerBatches(_sb);
    if (error) return showAssistStatus('저장 실패: 인터넷 연결을 확인해 주세요');
    const checked = readCheckedLineIds();
    const timesChanged = assistPlan.groups.some(g => g.lines.some(l => checked.has(l.id) && (l.op === 'start' || l.op === 'end')));
    const out = BatchAssistCore.apply(latest, assistPlan, checked, new Date());
    if (out.reason === 'conflict') {
      applyServerBatches(latest);
      assistPlan = BatchAssistCore.plan(assistChanges, assistCtx(latest));
      showAssistStatus('');
      return renderAssistPreview(assistPlan, '다른 곳에서 먼저 수정해서 최신 내용으로 다시 계산했어요. 확인하고 다시 적용해 주세요');
    }
    if (!out.ok) return showAssistStatus(out.message);
    const saved = await saveBatchesToServer(out.list, true);
    if (!saved || !saved.success) return showAssistStatus('저장 실패: 인터넷 연결을 확인해 주세요');
    applyServerBatches(out.list);
    out.audit.forEach(entry => pushToCentralAuditQueue(entry));
    assistPlan = null;
    assistEl('batch-assist-preview').innerHTML = '';
    assistEl('batch-assist-text').value = '';
    showAssistStatus(`${out.audit.length}개 배치에 적용했어요`, true);
    if (timesChanged) offerTodoSchedule();
  } finally {
    setAssistBusy(false);
  }
}

/** 공정 시각을 바꿨으면 모바일 배치 수정과 같은 [일정 반영] 버튼·확인 시트를 띄운다. */
function offerTodoSchedule() {
  if (!window.MobileTodo?.openScheduleConfirmSheet) return;
  const status = assistEl('batch-assist-status');
  status.append(' 공정 시각이 바뀌었어요. 할 일·알림에 반영하려면 ');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'm-btn m-btn-primary';
  btn.textContent = '일정 반영';
  // 모달 dialog가 최상위 층이라 닫아야 body에 붙는 확인 시트가 보인다
  btn.addEventListener('click', () => assistEl('batch-assist-modal').close() || MobileTodo.openScheduleConfirmSheet(() => MobileTodo.handleApplySchedule(btn, MobileBridge)));
  status.append(btn);
}

/** 잘못 읽은 결과를 기록에 표시해 두면, 나중에 그 보고를 모아 규칙을 고친다 (supabase/schema.sql의 assist_log). */
async function flagAssistLog(btn) {
  btn.disabled = true;
  const { data, error } = await _sb.rpc('flag_assist_log', { p_id: assistLogId });
  btn.textContent = !error && data ? '알려 주셔서 고마워요. 기록했어요' : '기록하지 못했어요';
}

function showAssistStatus(msg, ok) {
  const el = assistEl('batch-assist-status');
  el.textContent = msg;
  el.classList.toggle('is-ok', Boolean(ok));
}

const ASSIST_DIALOG_HTML = `<dialog id="batch-assist-modal" class="pt-dialog pt-dialog--m shelf-modal" aria-labelledby="batch-assist-title">
    <header class="pt-head">
      <div class="pt-head__title-group">
        <h2 id="batch-assist-title" class="pt-head__title">AI 입력</h2>
        <span class="pt-head__sub">공정 보고를 배치에 반영해요. 적용 전에 미리보기로 확인합니다</span>
      </div>
      <button type="button" class="pt-icon-btn btn-dialog-close" id="btn-assist-close" aria-label="닫기">×</button>
    </header>
    <div class="pt-body ba-body">
      <textarea id="batch-assist-text" rows="6" maxlength="2000" aria-label="공정 보고" placeholder="공정 보고 메시지를 그대로 붙여 넣으세요&#10;직접 쓸 땐: 로트 + 공정 + 할 일 (+ 날짜·시각)&#10;예) PA260101 공정4 완료 11/10 14:30&#10;예) PA260102 샘플 5개 빼"></textarea>
      <button type="button" class="pt-btn pt-btn--secondary ba-parse" id="btn-assist-parse">변환</button>
      <div id="batch-assist-status" class="ba-status" role="status" aria-live="polite"></div>
      <div id="batch-assist-preview" class="ba-preview"></div>
    </div>
    <footer class="pt-foot">
      <button type="button" class="pt-btn pt-btn--secondary" id="btn-assist-cancel">닫기</button>
      <button type="button" class="pt-btn pt-btn--primary" id="btn-assist-apply" disabled>적용</button>
    </footer>
  </dialog>`;

function makeAssistButton(id, className, html, title) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = id;
  btn.className = className;
  if (title) btn.title = title;
  btn.innerHTML = html;
  btn.addEventListener('click', openBatchAssist);
  return btn;
}

/** 모바일 배치 목록은 그릴 때마다 innerHTML을 갈아 끼우므로, 검색창 옆에 버튼이 없을 때만 다시 붙인다. */
function ensureMobileAssistButton() {
  const search = assistEl('m-batch-search');
  if (!search || search.nextElementSibling?.id === 'm-btn-ai-input') return;
  search.after(makeAssistButton('m-btn-ai-input', 'm-btn', 'AI 입력'));
}

function setupBatchAssist() {
  document.head.insertAdjacentHTML('beforeend', '<link rel="stylesheet" href="js/ai_input/ai_input.css">');
  document.body.insertAdjacentHTML('beforeend', ASSIST_DIALOG_HTML);
  assistEl('btn-batch-modal-trigger')?.after(makeAssistButton('btn-batch-assist', 'header-btn', '<span>AI 입력</span>', '메신저 공정 보고를 붙여 넣어 배치에 반영'));
  const mobileRoot = assistEl('m-app');
  if (mobileRoot) new MutationObserver(ensureMobileAssistButton).observe(mobileRoot, { childList: true, subtree: true });
  ensureMobileAssistButton();
  assistEl('btn-assist-parse').addEventListener('click', runBatchAssistParse);
  assistEl('btn-assist-apply').addEventListener('click', runBatchAssistApply);
  assistEl('btn-assist-close').addEventListener('click', () => assistEl('batch-assist-modal').close());
  assistEl('btn-assist-cancel').addEventListener('click', () => assistEl('batch-assist-modal').close());
  assistEl('batch-assist-preview').addEventListener('change', refreshAssistApply);
  assistEl('batch-assist-preview').addEventListener('click', e => e.target.id === 'btn-assist-flag' && flagAssistLog(e.target));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupBatchAssist);
else setupBatchAssist();
