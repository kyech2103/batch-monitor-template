// Pure ESM module for push due calculation, grouping and validation

const ALLOWED_EXACT_HOSTS = new Set([
  'fcm.googleapis.com',
  'web.push.apple.com',
  'updates.push.services.mozilla.com'
]);

export function getTaskStartMs(targetDate, targetTime) {
  if (!targetDate || !targetTime) return NaN;
  const iso = `${targetDate}T${targetTime}:00+09:00`;
  return Date.parse(iso);
}

export function getTaskDueAtMs(targetDate, targetTime) {
  const startMs = getTaskStartMs(targetDate, targetTime);
  if (isNaN(startMs)) return NaN;
  return startMs - 5 * 60 * 1000;
}

export function isDueInWindow(targetDate, targetTime, nowInput) {
  const nowMs = typeof nowInput === 'number' ? nowInput : Date.parse(nowInput);
  const taskStartMs = getTaskStartMs(targetDate, targetTime);
  if (isNaN(nowMs) || isNaN(taskStartMs)) return false;

  const dueAtMs = taskStartMs - 5 * 60 * 1000;
  const inWindow = dueAtMs <= nowMs && dueAtMs >= (nowMs - 10 * 60 * 1000);
  const notStarted = taskStartMs > nowMs;
  return inWindow && notStarted;
}

export function formatNotificationTitle(targetTime) {
  return `⏰ 5분 뒤 작업 · ${targetTime || ''}`;
}

export function getNotificationTag(targetDate, targetTime) {
  return `todo-${targetDate || ''}-${targetTime || ''}`;
}

export function sortTaskItems(a, b) {
  const orderA = typeof a.sort_order === 'number' ? a.sort_order : 100;
  const orderB = typeof b.sort_order === 'number' ? b.sort_order : 100;
  if (orderA !== orderB) return orderA - orderB;
  const titleA = a.title || a.task_name || '';
  const titleB = b.title || b.task_name || '';
  return titleA.localeCompare(titleB, 'ko');
}

export function formatNotificationBody(tasks) {
  if (!tasks || !tasks.length) return '';
  const sorted = [...tasks].sort(sortTaskItems);
  const titles = sorted.map((t) => t.title || t.task_name || '').filter(Boolean);
  const count = sorted.length;
  if (count === 1) return titles[0] || '';
  if (count === 2) return `${titles[0] || ''}, ${titles[1] || ''}`;
  return `${titles[0] || ''}, ${titles[1] || ''} 외 ${count - 2}건`;
}

export function makeBundle(group) {
  return {
    worker_id: group.worker_id,
    target_date: group.target_date,
    target_time: group.target_time,
    tasks: group.tasks,
    title: formatNotificationTitle(group.target_time),
    body: formatNotificationBody(group.tasks),
    tag: getNotificationTag(group.target_date, group.target_time)
  };
}

export function groupTasks(tasks) {
  if (!Array.isArray(tasks)) return [];
  const map = new Map();
  for (const t of tasks) {
    const wid = t.worker_id || null;
    const d = t.target_date || '';
    const tm = t.target_time || '';
    const key = `${wid}_${d}_${tm}`;
    if (!map.has(key)) {
      map.set(key, { worker_id: wid, target_date: d, target_time: tm, tasks: [] });
    }
    map.get(key).tasks.push(t);
  }
  return Array.from(map.values()).map(makeBundle);
}

export function isAllowedHost(host) {
  if (ALLOWED_EXACT_HOSTS.has(host)) return true;
  return host === 'notify.windows.com' || host.endsWith('.notify.windows.com');
}

export function isAllowedEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 1024 || !endpoint.startsWith('https://')) return false;

  try {
    const url = new URL(endpoint);
    const host = url.hostname.toLowerCase();
    const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[');
    return !isIp && isAllowedHost(host);
  } catch (e) {
    return false;
  }
}

export function detectPlatform(ua) {
  if (!ua || typeof ua !== 'string') return 'other';
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  return 'other';
}

// 장비 시작·종료 알림. 코드는 DDHHMM → '28일 14:30'
export function buildEquipmentPayload(job) {
  const fmt = (code) => {
    const s = String(code || '').padStart(6, '0');
    return `${Number(s.slice(0, 2))}일 ${s.slice(2, 4)}:${s.slice(4, 6)}`;
  };
  const isStart = job.kind === 'start';
  return {
    title: `${isStart ? '▶️ 장비 시작' : '✅ 장비 종료'} · ${job.setting_type || ''}`,
    body: `${fmt(job.start_code)} 시작 → ${fmt(job.end_code)} 종료`,
    tag: `equipment-${job.id}-${job.kind}`
  };
}

const pushDueModule = {
  getTaskStartMs,
  getTaskDueAtMs,
  isDueInWindow,
  formatNotificationTitle,
  getNotificationTag,
  formatNotificationBody,
  groupTasks,
  isAllowedEndpoint,
  detectPlatform,
  buildEquipmentPayload
};

export default pushDueModule;
