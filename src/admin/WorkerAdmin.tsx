// 직원 관리 창: 직원 등록·삭제·관리자 지정. 권한 확인은 DB 함수(assert_admin)가 한다
import { useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';

interface WorkerRow { id: number; name: string; department?: string | null; email?: string | null; is_admin: boolean; is_owner: boolean }
type Msg = { text: string; isError?: boolean };

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await window.MobileBridge!.getSupabase().rpc(fn, args);
  if (error) throw new Error(error.message || '요청에 실패했습니다');
  return data as T;
}

function WorkerAdmin({ openCount }: { openCount: number }) {
  const [rows, setRows] = useState<WorkerRow[] | null>(null);
  const [msg, setMsg] = useState<Msg>({ text: '' });
  const [name, setName] = useState('');
  const [dept, setDept] = useState('');
  const [email, setEmail] = useState('');

  const refresh = async () => {
    try {
      setRows((await call<WorkerRow[]>('admin_list_workers', {})) || []);
    } catch (e) {
      setRows([]);
      setMsg({ text: (e as Error).message, isError: true });
    }
  };

  // 창을 열 때마다 안내를 지우고 목록을 새로 읽는다
  useEffect(() => {
    if (!openCount) return;
    setMsg({ text: '' });
    setRows(null);
    refresh();
  }, [openCount]);

  const run = async (work: () => Promise<string>) => {
    try {
      setMsg({ text: await work() });
      refresh();
    } catch (e) {
      setMsg({ text: (e as Error).message, isError: true });
    }
  };

  const onAdd = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim(), d = dept.trim(), m = email.trim();
    if (!n || !m) return;
    run(async () => {
      await call('admin_add_worker', { p_name: n, p_department: d, p_email: m });
      setName(''); setDept(''); setEmail('');
      return `${n} 님 등록 완료 · Supabase 대시보드(Authentication)에서 ${m} 계정을 만들어 주세요`;
    });
  };

  const onRetire = (w: WorkerRow) => {
    if (!window.confirm(`${w.name} 님을 삭제할까요?\n직원 목록에서 지워져 더 이상 데이터를 볼 수 없고, 알림 구독과 공정 담당자 칸에서도 빠집니다. 되돌릴 수 없습니다.
(로그인 계정은 Supabase 대시보드에서 따로 지우세요)`)) return;
    run(async () => { await call('admin_retire_worker', { p_worker_id: w.id }); return `${w.name} 님 삭제 완료`; });
  };

  const onSetAdmin = (w: WorkerRow) =>
    run(async () => { await call('admin_set_admin', { p_worker_id: w.id, p_is_admin: !w.is_admin }); return `${w.name} 님 관리자 설정 변경 완료`; });

  // 실제 권한은 DB 함수가 다시 확인한다
  const myId = window.MobileBridge?.getWorker?.()?.id;
  const iAmOwner = (rows || []).some(w => w.is_owner && w.id === myId);

  return (
    <>
      <form id="wa-add-form" onSubmit={onAdd} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <input id="wa-name" className="pt-input" placeholder="이름" maxLength={30} required aria-label="이름" style={{ flex: 1, minWidth: 100 }} value={name} onChange={e => setName(e.target.value)} />
        <input id="wa-dept" className="pt-input" placeholder="부서 (예: 생산팀)" maxLength={40} aria-label="부서" style={{ flex: 1, minWidth: 100 }} value={dept} onChange={e => setDept(e.target.value)} />
        <input id="wa-email" className="pt-input" type="email" placeholder="로그인 이메일" maxLength={120} required aria-label="로그인 이메일" style={{ flex: 2, minWidth: 150 }} value={email} onChange={e => setEmail(e.target.value)} />
        <button type="submit" className="pt-btn pt-btn--primary">직원 등록</button>
      </form>
      <div id="wa-msg" role="status" style={{ fontSize: 13, minHeight: 18, marginBottom: 6, color: msg.isError ? 'var(--pt-danger)' : 'var(--pt-text)' }}>{msg.text}</div>
      <div id="wa-list">
        {rows === null ? '불러오는 중…'
          : rows.length === 0 ? <div style={{ color: 'var(--pt-muted)' }}>등록된 직원이 없습니다</div>
          : rows.map(w => {
            // 관리자 지정·해제는 1차 관리자만, 관리자 삭제도 1차 관리자만 (DB 함수가 다시 막는다)
            const canAdmin = iAmOwner && !w.is_owner;
            const canDelete = !w.is_owner && (iAmOwner || !w.is_admin);
            const role = w.is_owner ? ' · 1차 관리자' : (w.is_admin ? ' · 관리자' : '');
            return (
              <div key={w.id} className="wa-row" data-id={w.id} data-name={w.name} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 0', borderBottom: '1px solid var(--pt-border)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{w.name}{role}</div>
                  <div style={{ fontSize: 12, color: 'var(--pt-muted)' }}>{w.department || ''}{w.email ? ` · ${w.email}` : ''}</div>
                </div>
                {canAdmin && <button type="button" className="pt-btn pt-btn--secondary" data-act="admin" onClick={() => onSetAdmin(w)}>{w.is_admin ? '관리자 해제' : '관리자 지정'}</button>}
                {canDelete && <button type="button" className="pt-btn pt-btn--secondary" data-act="retire" onClick={() => onRetire(w)}>삭제</button>}
              </div>
            );
          })}
      </div>
    </>
  );
}

export function setupWorkerAdmin(): void {
  const modal = document.getElementById('worker-admin-modal') as HTMLDialogElement | null;
  const host = modal?.querySelector('.pt-body');
  if (!modal || !host) return;
  const root = createRoot(host);
  let openCount = 0;
  root.render(<WorkerAdmin openCount={0} />);
  modal.querySelector('[data-wa-close]')?.addEventListener('click', () => modal.close());
  window.WorkerAdmin = {
    open() {
      root.render(<WorkerAdmin openCount={++openCount} />);
      if (!modal.open) modal.showModal();
    }
  };
}
