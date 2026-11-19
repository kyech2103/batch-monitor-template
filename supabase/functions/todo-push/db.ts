// todo-push Edge Function의 DB 접근(PostgREST + service role).
// supabase-js 없이 fetch만 쓴다. todo_schedules에 없는 컬럼은 select하지 않는다(sort_order 없음).

export const CANDIDATE_TASK_COLUMNS = ['id', 'worker_id', 'target_date', 'target_time', 'title'];
const SUB_COLUMNS = 'id,worker_id,endpoint,p256dh,auth,platform,fail_count';

function seoulDate(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(ms));
}

export function createDbDeps(fetchImpl: any, supabaseUrl: string, serviceRoleKey: string) {
  const _fetch = fetchImpl || fetch;
  const baseUrl = (supabaseUrl || '').replace(/\/+$/, '');
  const baseHeaders: Record<string, string> = {
    'apikey': serviceRoleKey || '',
    'Authorization': `Bearer ${serviceRoleKey || ''}`,
    'Content-Type': 'application/json'
  };

  async function request(label: string, pathAndQuery: string, init: any = {}) {
    const res = await _fetch(`${baseUrl}/rest/v1/${pathAndQuery}`, {
      ...init,
      headers: { ...baseHeaders, ...(init.headers || {}) }
    });
    if (!res.ok) throw new Error(`${label} failed: ${res.status}`);
    return res;
  }

  async function getJson(label: string, pathAndQuery: string) {
    const res = await request(label, pathAndQuery, { method: 'GET' });
    return await res.json();
  }

  return {
    async getConfig() {
      const res = await request('getConfig', 'rpc/get_push_config', { method: 'POST', body: '{}' });
      return await res.json();
    },

    async getCandidateTasks(nowMs?: number) {
      const now = nowMs || Date.now();
      const today = seoulDate(now);
      const tomorrow = seoulDate(now + 24 * 60 * 60 * 1000);
      const select = `${CANDIDATE_TASK_COLUMNS.join(',')},workers!inner(status)`;
      const query = `todo_schedules?select=${select}&record_type=eq.TODO&worker_id=not.is.null`
        + `&target_date=gte.${today}&target_date=lte.${tomorrow}&workers.status=eq.${encodeURIComponent('사용')}`;
      return await getJson('getCandidateTasks', query);
    },

    async getSubscriptionsByWorker(workerId: number | string) {
      return await getJson('getSubscriptionsByWorker',
        `push_subscriptions?worker_id=eq.${workerId}&select=${SUB_COLUMNS}`);
    },

    async isAlreadySent(subscriptionId: number | string, targetDate: string, targetTime: string) {
      const rows = await getJson('isAlreadySent',
        `push_log?subscription_id=eq.${subscriptionId}&target_date=eq.${targetDate}&target_time=eq.${targetTime}&select=id`);
      return Array.isArray(rows) && rows.length > 0;
    },

    // 지난 10분 안에 시작·종료한 장비 작업을 먼저 '보냄'으로 바꾸고 바꾼 행만 돌려준다 (두 번 깨어나도 한 번만 발송)
    async claimEquipmentPushes(nowMs: number) {
      const since = new Date(nowMs - 10 * 60 * 1000).toISOString();
      const until = new Date(nowMs).toISOString();
      const out: any[] = [];
      for (const kind of ['start', 'end']) {
        const res = await request('claimEquipmentPushes',
          `equipment_jobs?${kind}_push_done=eq.false&${kind}_at=gte.${since}&${kind}_at=lte.${until}`
          + '&select=id,setting_type,start_code,end_code,notify_worker_ids', {
            method: 'PATCH',
            headers: { 'Prefer': 'return=representation' },
            body: JSON.stringify({ [`${kind}_push_done`]: true })
          });
        for (const j of await res.json()) out.push({ ...j, kind });
      }
      return out;
    },

    async insertPushLog(log: any) {
      await request('insertPushLog', 'push_log', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=ignore-duplicates' },
        body: JSON.stringify(log)
      });
      return true;
    },

    async deleteSubscription(subscriptionId: number | string) {
      await request('deleteSubscription', `push_subscriptions?id=eq.${subscriptionId}`, { method: 'DELETE' });
      return true;
    },

    async incrementFailCount(subscriptionId: number | string, errorMsg?: string) {
      await request('incrementFailCount', 'rpc/push_mark_failed', {
        method: 'POST',
        body: JSON.stringify({ p_id: subscriptionId, p_error: errorMsg ? String(errorMsg).slice(0, 200) : '' })
      });
      return true;
    },

    async getSubscriptionByEndpoint(endpoint: string) {
      const rows = await getJson('getSubscriptionByEndpoint',
        `push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}&select=${SUB_COLUMNS}`);
      return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    },

    async updateSubscription(oldEndpoint: string, subscription: any) {
      await request('updateSubscription', `push_subscriptions?endpoint=eq.${encodeURIComponent(oldEndpoint)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          endpoint: subscription.endpoint,
          p256dh: subscription.keys?.p256dh,
          auth: subscription.keys?.auth,
          last_seen_at: new Date().toISOString(),
          fail_count: 0
        })
      });
      return true;
    }
  };
}
