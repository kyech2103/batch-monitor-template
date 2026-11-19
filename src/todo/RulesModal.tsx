// 할 일 규칙 창: 규칙 목록(사용 켜기·끄기), 오른쪽 편집 패널, 기본값 복원, 저장(저장하면 할 일을 다시 계산).
// 지금 규칙과 읽기·일정 반영은 TodoModal.tsx
import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import * as C from './core';
import { fetchTodoRules, getRulesState, regenerateTodos, setRules, viewerContext } from './TodoModal';
import { PROC } from './TodoList';
import { formFromRule, formShape, newRule, ruleFromForm, rulesKey, ruleWhenText, sortRules, type Rule, type RuleForm } from './rules';
import { pushAudit } from '../main/audit';

declare global {
  interface Window {
    TodoRulesModal?: { open(): Promise<void> };
    collectRuleFormData?(): Rule | null;
    hasUnsavedRuleChanges?(): boolean;
  }
}
declare function showToast(msg: string): void;

const core = () => C as unknown as Core;
interface Core {
  ALL_ROLES: string[]; ALL_EXCEPT_D: string[]; ROLE_MAP: Record<string, { label: string }>; DEFAULT_RULES: Rule[];
  validateRule(r: Rule): { ok: boolean; errors: string[] };
  normalizeRules(r: Rule[]): { rules: Rule[]; warnings: { message?: string; code?: string }[] };
}
const copy = (rules: Rule[]) => rules.map(r => ({ ...r, roles: [...r.roles] }));
const label = { fontSize: 11, fontWeight: 700, color: 'var(--pt-text)' } as const;
const col = { display: 'flex', flexDirection: 'column', gap: 3 } as const;

/** 전원·공정4 제외 전원은 한 칩으로 줄이고, 나머지는 역할별 칩 */
function RoleChips({ roles }: { roles: string[] }) {
  const C = core();
  const labels = roles.map(r => C.ROLE_MAP[r]?.label || r);
  const all = labels.join(', ');
  const is = (set: string[]) => set.length === roles.length && set.every(r => roles.includes(r));
  if (is(C.ALL_ROLES)) return <span className="rule-role-chip is-all" title={all}>전원 {roles.length}명</span>;
  if (is(C.ALL_EXCEPT_D)) return <span className="rule-role-chip is-all" title={all}>전원 (공정4 제외) {roles.length}명</span>;
  const shown = labels.length > 4 ? labels.slice(0, 3) : labels;
  return <>{shown.map(l => <span key={l} className="rule-role-chip">{l}</span>)}{labels.length > shown.length && <span className="rule-role-chip" title={all}>외 {labels.length - shown.length}개</span>}</>;
}

function RulesModal({ dialog, initial, usingDefault }: { dialog: HTMLDialogElement; initial: Rule[]; usingDefault: boolean }) {
  const [rules, setRules] = useState(() => copy(initial));
  const [snapshot, setSnapshot] = useState(() => rulesKey(initial));
  const [form, setForm] = useState<RuleForm | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const idRef = useRef<HTMLInputElement>(null);
  const C = core();
  const set = (patch: Partial<RuleForm>) => setForm(f => f && { ...f, ...patch });

  // 패널의 숨은 rule_id 칸은 입력칸 값을 그대로 읽는다
  const candidate = (): Rule | null => form && ruleFromForm({ ...form, rule_id: idRef.current?.value || form.rule_id }, rules.find(r => r.rule_id === (idRef.current?.value || form.rule_id)));
  // 패널에 입력만 하고 [적용]을 안 누른 내용이 있는지
  const unapplied = () => {
    const c = candidate();
    if (!c) return false;
    const ex = rules.find(r => r.rule_id === c.rule_id);
    return ex ? rulesKey([c]) !== rulesKey([ex]) : c.title.trim() !== '';
  };
  const dirty = rulesKey(rules) !== snapshot;
  const unsaved = () => dirty || unapplied();
  window.collectRuleFormData = candidate;
  window.hasUnsavedRuleChanges = unsaved;

  const openForm = (r: Rule | null) => { setErrors([]); setForm(formFromRule(r || newRule())); };
  const closeForm = () => { setErrors([]); setForm(null); };
  const apply = (): Rule[] | null => {
    const c = candidate()!;
    const v = C.validateRule(c);
    if (!v.ok) { setErrors(v.errors); return null; }
    const next = rules.some(r => r.rule_id === c.rule_id) ? rules.map(r => (r.rule_id === c.rule_id ? c : r)) : [...rules, c];
    setRules(next);
    closeForm();
    return next;
  };
  const close = () => { if (!unsaved() || confirm('저장하지 않은 변경이 있습니다. 저장하지 않고 닫을까요?')) { closeForm(); dialog.close(); } };
  // ESC·바깥 클릭으로 닫힐 때도 저장 안 한 변경을 확인한다
  dialog.oncancel = e => { if (unsaved() && !confirm('저장하지 않은 변경이 있습니다. 저장하지 않고 닫을까요?')) e.preventDefault(); };

  const save = async () => {
    // 패널에 입력해 둔 내용을 [적용] 없이 저장해도 잃지 않게 먼저 반영한다
    let list = rules;
    if (unapplied()) { const next = apply(); if (!next) return; list = next; }
    const norm = C.normalizeRules(list);
    if (norm.warnings.length && !confirm(`일부 규칙이 제외됩니다:\n${norm.warnings.map(w => w.message || w.code).join('\n')}\n계속 진행하시겠습니까?`)) return;
    setSaving(true);
    try {
      const { error } = await window.MobileBridge!.getSupabase().rpc('replace_todo_rules', { p_rules: norm.rules, p_updated_by: viewerContext().name || '관리자' });
      if (error) { console.error('[TodoRules] RPC error:', error); showToast(`⚠️ 규칙 저장 실패: ${error.message || 'RPC 오류'}`); return; }
      setRules(norm.rules);
      setSnapshot(rulesKey(list));
      try { pushAudit({ zone: '일일투두', action: 'MODIFY', item: '투두 규칙', from: '', to: '', detail: `<규칙 ${norm.rules.length}개 저장>` }); } catch { /* 기록 실패는 저장과 무관 */ }
      closeForm();
      dialog.close();
      // 저장한 규칙을 할 일에 바로 반영
      await regenerateTodos('투두 규칙 변경 반영');
    } catch (err) {
      console.error('[TodoRules] Save error:', err);
      showToast('⚠️ 규칙 저장 중 오류가 발생했습니다: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const shape = form ? formShape(form) : null;
  const editingExisting = form && rules.some(r => r.rule_id === form.rule_id);
  let lastProc: string | null = null;

  return (
    <>
      <header className="pt-head">
        <div className="pt-head__title-group">
          <h2 id="todo-rules-modal-title" className="pt-head__title">⚙️ 할 일 규칙</h2>
          {/* 저장된 규칙을 못 읽어 기본 규칙으로 돌 때만 알린다 */}
          <span id="todo-rules-status-badge" className="todo-status-badge" style={{ fontSize: 11, background: 'var(--pt-accent-soft)', color: 'var(--pt-accent)', padding: '2px 6px', borderRadius: 4, display: usingDefault ? '' : 'none' }}>기본 규칙 사용 중</span>
        </div>
        <button type="button" className="pt-icon-btn btn-dialog-close" id="btn-todo-rules-close" aria-label="닫기" onClick={close}>×</button>
      </header>
      <div className="pt-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button type="button" className="pt-btn pt-btn--secondary" id="btn-todo-rule-add" onClick={() => openForm(null)}>➕ 새 규칙</button>
        </div>
        <div><span id="todo-rules-count-pill" className="todo-count-pill" style={{ fontSize: 11, fontWeight: 700, background: 'var(--pt-bg)', border: '1px solid var(--pt-border)', color: 'var(--pt-text-sub)', padding: '2px 8px', borderRadius: 12 }}>{rules.length}개 규칙</span></div>
      </div>
      <div className="pt-body" style={{ padding: 0, display: 'flex', flexDirection: 'row', overflow: 'hidden', height: 'min(640px, calc(100vh - 220px))', position: 'relative' }}>
        <div className="todo-rules-table-container" style={{ flex: '1 1 auto', overflow: 'auto', minWidth: 0, height: '100%' }}>
          <table id="todo-rules-table" className="pt-table todo-rules-table">
            <thead><tr>
              <th style={{ width: 48, minWidth: 48, textAlign: 'center' }}>사용</th><th style={{ minWidth: 180 }}>할 일</th>
              <th style={{ width: 240, minWidth: 240 }}>언제</th><th style={{ width: 200, minWidth: 200 }}>담당</th>
            </tr></thead>
            <tbody id="todo-rules-table-body">
              {sortRules(rules).flatMap(rule => {
                const out = [];
                if (rule.process_code !== lastProc) {
                  lastProc = rule.process_code;
                  out.push(<tr key={'g-' + lastProc} className="rule-group-row"><td colSpan={4}>{PROC[lastProc] || '공정 ' + lastProc}</td></tr>);
                }
                out.push(
                  <tr key={rule.rule_id} className={`rule-row ${!rule.enabled ? 'is-off' : ''} ${form?.rule_id === rule.rule_id ? 'is-selected' : ''}`} data-id={rule.rule_id}
                    onClick={e => { if (!(e.target as Element).closest('.rule-enable-cell')) openForm(rule); }}>
                    <td className="rule-enable-cell" style={{ textAlign: 'center' }}>
                      <input type="checkbox" className="rule-enable-toggle" data-id={rule.rule_id} aria-label={`${rule.title} 사용`} checked={rule.enabled}
                        onChange={e => setRules(rules.map(r => (r.rule_id === rule.rule_id ? { ...r, enabled: e.target.checked } : r)))} />
                    </td>
                    <td className="rule-title-cell"><button type="button" className="rule-title-btn btn-rule-edit" data-id={rule.rule_id}>{rule.title}</button></td>
                    <td className="nowrap rule-when-cell">{ruleWhenText(rule)}</td>
                    <td><div className="rule-role-chips"><RoleChips roles={rule.roles} /></div></td>
                  </tr>
                );
                return out;
              })}
            </tbody>
          </table>
        </div>
        <div id="todo-rule-form-container" className="todo-rule-form-container todo-rules-side"
          ref={el => { if (el && form) el.scrollIntoView({ behavior: 'smooth' }); }}
          style={{ display: form ? 'block' : 'none', width: 360, minWidth: 360, maxWidth: 360, borderLeft: '1px solid var(--pt-border)', background: '#ffffff', overflowY: 'auto', padding: 16, boxSizing: 'border-box' }}>
          {form && shape && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, borderBottom: '1px solid var(--pt-border)', paddingBottom: 8 }}>
                <h3 id="todo-rule-form-title" style={{ fontSize: 14, fontWeight: 700, margin: 0, color: 'var(--pt-text)' }}>{editingExisting ? '규칙 수정' : '새 규칙'}</h3>
              </div>
              <form id="todo-rule-form" onSubmit={e => e.preventDefault()} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input type="hidden" id="form-rule-id" key={form.rule_id} ref={el => { idRef.current = el; if (el && !el.value) el.value = form.rule_id; }} />
                <div style={col}>
                  <label htmlFor="form-rule-title" style={label}>할 일 이름 <span style={{ color: 'var(--pt-danger)' }}>*</span></label>
                  <input type="text" id="form-rule-title" maxLength={60} className="pt-input" placeholder="예: 계량, 공정2-A 등" value={form.title} onChange={e => set({ title: e.target.value })} />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ ...col, flex: '1 1 auto', minWidth: 0 }}>
                    <label htmlFor="form-rule-anchor-step" style={label}>기준</label>
                    <select id="form-rule-anchor-step" className="pt-input" value={form.anchor_step} onChange={e => set({ anchor_step: e.target.value })}>
                      <option value="A">공정1</option><option value="B">공정2</option><option value="C">공정3</option><option value="D">공정4</option>
                      <option value="E">공정5</option><option value="PKG">포장</option><option value="WEEK">매주 (마지막 평일)</option>
                    </select>
                  </div>
                  <div style={{ ...col, flex: '0 0 96px', display: shape.weekly ? 'none' : 'flex' }}>
                    <label htmlFor="form-rule-anchor-point" style={label}>시점</label>
                    <select id="form-rule-anchor-point" className="pt-input" value={form.anchor_point} onChange={e => set({ anchor_point: e.target.value })}>
                      <option value="start">시작</option><option value="end">종료</option>
                    </select>
                  </div>
                </div>
                <div style={{ ...col, display: shape.weekly ? 'none' : 'flex' }}>
                  <label htmlFor="form-rule-day-rule" style={label}>날짜</label>
                  <select id="form-rule-day-rule" className="pt-input" value={form.day_rule} onChange={e => set({ day_rule: e.target.value })}>
                    <option value="SAME">당일 (기준 시각에서 앞뒤로)</option><option value="PREV_BIZ">직전 평일</option>
                    <option value="NEXT_BIZ">다음 평일</option><option value="PREV_WEEK_LAST">전주 마지막 평일</option>
                  </select>
                </div>
                <div style={{ ...col, display: shape.offset ? 'flex' : 'none' }} id="form-rule-offset-row">
                  <label style={label}>기준 시각에서</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input type="number" id="form-rule-offset-h" className="pt-input" min={0} max={24} style={{ width: 64 }} aria-label="시간" value={form.off_h} onChange={e => set({ off_h: e.target.value })} /><span style={{ fontSize: 12 }}>시간</span>
                    <input type="number" id="form-rule-offset-m" className="pt-input" min={0} max={59} style={{ width: 64 }} aria-label="분" value={form.off_m} onChange={e => set({ off_m: e.target.value })} /><span style={{ fontSize: 12 }}>분</span>
                    <select id="form-rule-offset-dir" className="pt-input" style={{ width: 'auto' }} aria-label="이전 또는 이후" value={form.off_dir} onChange={e => set({ off_dir: e.target.value })}>
                      <option value="1">이후</option><option value="-1">이전</option>
                    </select>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--pt-muted)' }}>근무시간(09~18시)·평일 밖이면 다음 근무 시작 09:00으로 옮겨집니다.</span>
                </div>
                <div style={{ ...col, display: shape.offset ? 'none' : 'flex' }} id="form-rule-time-row">
                  <label htmlFor="form-rule-target-time" style={label}>시각</label>
                  <input type="time" id="form-rule-target-time" className="pt-input" value={form.target_time} onChange={e => set({ target_time: e.target.value })} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={label}>담당 <span style={{ color: 'var(--pt-danger)' }}>*</span></label>
                    <button type="button" className="rule-link-btn" id="btn-rule-roles-all"
                      onClick={() => set({ roles: C.ALL_ROLES.every(r => form.roles.includes(r)) ? [] : [...C.ALL_ROLES] })}>전체 선택/해제</button>
                  </div>
                  <div id="form-rule-roles-grid" className="rule-roles-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, border: '1px solid var(--pt-border)', padding: 6, borderRadius: 4 }}>
                    {C.ALL_ROLES.map(k => (
                      <label key={k} className="rule-role-item">
                        <input type="checkbox" name="rule-role-chk" value={k} checked={form.roles.includes(k)}
                          onChange={e => set({ roles: e.target.checked ? [...form.roles, k] : form.roles.filter(x => x !== k) })} />
                        <span>{C.ROLE_MAP[k]?.label || k}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div id="todo-rule-form-errors" className="rule-form-errors" style={{ display: errors.length ? 'block' : 'none', color: 'var(--pt-danger)', fontSize: 12, background: '#fef2f2', padding: 6, borderRadius: 4 }}>
                  {errors.map((e, i) => <div key={i}>• {e}</div>)}
                </div>
                <div className="rule-form-actions">
                  <button type="button" className="pt-btn pt-btn--danger" id="btn-todo-rule-delete" style={{ marginRight: 'auto', display: editingExisting ? '' : 'none' }}
                    onClick={() => { const r = rules.find(x => x.rule_id === form.rule_id); if (r && confirm(`[${r.title}] 규칙을 삭제할까요?`)) { setRules(rules.filter(x => x !== r)); closeForm(); } }}>삭제</button>
                  <button type="button" className="pt-btn pt-btn--secondary" id="btn-todo-rule-form-cancel" onClick={closeForm}>취소</button>
                  <button type="button" className="pt-btn pt-btn--primary" id="btn-todo-rule-form-submit" onClick={apply}>적용</button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
      <footer className="pt-foot">
        <div className="todo-footer-left" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" className="rule-link-btn" id="btn-todo-rules-reset"
            onClick={() => { if (confirm('지금까지 바꾼 규칙을 모두 지우고 처음 기본 규칙으로 되돌릴까요?\n([저장]을 눌러야 실제로 적용됩니다)')) { setRules(copy(C.DEFAULT_RULES)); closeForm(); } }}>기본값 복원</button>
          <span id="todo-rules-footer-status" style={{ fontSize: 12, color: dirty ? 'var(--pt-danger)' : 'var(--pt-muted)' }}>{dirty ? '저장하지 않은 변경이 있습니다.' : '저장하면 할 일이 바로 다시 계산됩니다.'}</span>
        </div>
        <div className="todo-footer-right" style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="pt-btn pt-btn--secondary" id="btn-todo-rules-cancel" onClick={close}>닫기</button>
          <button type="button" className="pt-btn pt-btn--primary" id="btn-todo-rules-save" disabled={saving} onClick={save}>{saving ? '⏳ 저장 중...' : '저장'}</button>
        </div>
      </footer>
    </>
  );
}

export function setupRulesModal(): void {
  const dialog = document.getElementById('todo-rules-modal') as HTMLDialogElement | null;
  if (!dialog) return;
  const root = createRoot(dialog);
  let n = 0;
  window.TodoRulesModal = {
    // 열 때마다 지금 규칙으로 새로 채운다
    async open() {
      const st = getRulesState();
      flushSync(() => root.render(<RulesModal key={n++} dialog={dialog} initial={st.rules} usingDefault={st.usingDefault} />));
      if (!dialog.open) dialog.showModal();
    }
  };
}
