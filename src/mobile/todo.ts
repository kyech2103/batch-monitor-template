// 모바일 할 일 목록 묶기. 화면은 TodoTab.tsx
export interface TodoRow {
  id: string | number; title?: string; task_key?: string | null; lot_id?: string | null; lot_ids?: string[] | null;
  worker_name?: string | null; role_key?: string | null; role_badge?: string | null; target_time?: string | null; task_time?: string | null;
}

/** 시각(HH:MM)별로 묶는다. 서버가 시각 순으로 주므로 순서는 그대로 */
export function groupByTime(todos: TodoRow[]): Map<string, TodoRow[]> {
  const map = new Map<string, TodoRow[]>();
  for (const t of todos || []) {
    const raw = t.target_time || t.task_time;
    const time = raw ? String(raw).slice(0, 5) : '미지정';
    if (!map.has(time)) map.set(time, []);
    map.get(time)!.push(t);
  }
  return map;
}

/** PC 투두와 같이 같은 과업(task_key)은 한 줄로 묶는다 */
export function groupByTask(items: TodoRow[]): TodoRow[][] {
  const map = new Map<string | number, TodoRow[]>();
  for (const t of items || []) {
    const key = t.task_key || t.id;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(t);
  }
  return Array.from(map.values());
}

/** 같은 작업자가 맡은 역할은 칩 하나에 모은다. 내 할 일 보기(showWorker=false)는 이름 없이 한 칩 */
export function assignees(rows: TodoRow[], showWorker: boolean, roleLabel: (key: string) => string | undefined): { name: string; labels: string[] }[] {
  const byWorker = new Map<string, string[]>();
  for (const t of rows) {
    const name = (showWorker && t.worker_name) || '';
    if (!byWorker.has(name)) byWorker.set(name, []);
    const label = (t.role_key && (roleLabel(t.role_key) || t.role_key)) || t.role_badge;
    if (label) byWorker.get(name)!.push(label);
  }
  return Array.from(byWorker, ([name, labels]) => ({ name, labels }));
}
