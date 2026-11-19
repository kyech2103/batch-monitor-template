// 메인 화면의 배치 등록·수정 창. 새 창(sub_batches)과 같은 BatchForm을 띄운다
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Batch } from '../batch/core';
import { bindDialogButtons } from '../main/dialog';
import { BatchForm } from './BatchForm';

const URL = './sub_batches/Index.html';

export function setupBatchDialog(): void {
  const dialog = document.getElementById('batch-schedule-modal') as HTMLDialogElement | null;
  const el = document.getElementById('batch-form-root');
  if (!dialog || !el) return;
  const root = createRoot(el);
  let open = { lot: null as string | null, n: 0 };
  const render = () => flushSync(() => root.render(<BatchForm allowed open={open} onSaved={() => dialog.close()} />));
  render();
  bindDialogButtons(dialog, { close: 'batch-modal-btn-close', external: 'batch-modal-btn-external', maximize: 'batch-modal-btn-maximize' },
    () => (open.lot ? `${URL}?editLot=${encodeURIComponent(open.lot)}` : `${URL}?mode=new`));
  /** 로트(또는 배치)를 주면 수정, 없으면 새로 등록 */
  window.openBatchScheduleModal = (b?: Batch | string | null) => {
    open = { lot: (typeof b === 'string' ? b : b?.lotNumber) || null, n: open.n + 1 };
    render();
    if (!dialog.open) dialog.showModal();
  };
  window.closeBatchScheduleModal = () => dialog.close();
  document.getElementById('btn-batch-modal-trigger')?.addEventListener('click', e => { e.stopPropagation(); window.openBatchScheduleModal?.(null); });
}
declare global { interface Window { closeBatchScheduleModal?(): void } }
