// Supabase Edge Function: todo-push
// 배포 방법: supabase functions deploy todo-push --no-verify-jwt (verify_jwt=false, cron 비밀로만 인증)

import pushDue from '../_shared/push_due.mjs';
import { createDbDeps } from './db.ts';
import { createSender, hasVapidKeys, toBase64Url } from './sender.ts';

export { createDbDeps, createSender, toBase64Url };

const {
  isDueInWindow,
  formatNotificationTitle,
  formatNotificationBody,
  getNotificationTag,
  groupTasks,
  isAllowedEndpoint,
  buildEquipmentPayload
} = (pushDue && (pushDue.default || pushDue)) || {};

// Global memory rate limiting for 'test' action (endpoint: 1/min, global: 20/min)
const testCallHistory: Array<{ endpoint: string; timestamp: number }> = [];

function safeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const lenA = a.length;
  const lenB = b.length;
  let diff = lenA ^ lenB;
  for (let i = 0; i < lenA; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i % Math.max(1, lenB));
  }
  return diff === 0;
}

function checkTestRateLimit(endpoint: string, nowMs: number): boolean {
  const windowStart = nowMs - 60 * 1000;
  for (let i = testCallHistory.length - 1; i >= 0; i--) {
    if (testCallHistory[i].timestamp < windowStart) {
      testCallHistory.splice(i, 1);
    }
  }
  if (testCallHistory.length >= 20) return false;
  if (testCallHistory.some((h) => h.endpoint === endpoint)) return false;

  testCallHistory.push({ endpoint, timestamp: nowMs });
  return true;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret'
};

function createJsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}

// 한 구독에 보내고 결과를 돌려준다. 만료된 구독은 지우고, 실패는 횟수를 올린다.
async function deliver(deps: any, sub: any, payload: string): Promise<'sent' | 'gone' | 'failed'> {
  if (!isAllowedEndpoint(sub.endpoint)) return 'failed';
  try {
    const res = await deps.sender.sendNotification(sub, payload);
    if (res && (res.statusCode === 404 || res.statusCode === 410)) {
      await deps.db.deleteSubscription(sub.id);
      return 'gone';
    }
    return 'sent';
  } catch (err: any) {
    const statusCode = err && (err.statusCode || err.status);
    if (statusCode === 404 || statusCode === 410) {
      await deps.db.deleteSubscription(sub.id);
      return 'gone';
    }
    await deps.db.incrementFailCount(sub.id, err && (err.message || String(err)));
    return 'failed';
  }
}

// DB 예약 작업(cron)만 아는 비밀이 맞는 요청인가
function hasCronSecret(req: any, deps: any): boolean {
  const given = req.headers.get ? req.headers.get('x-cron-secret') : req.headers['x-cron-secret'];
  return Boolean(given) && safeCompare(given, deps.config?.cron_secret || '');
}

async function handleDispatch(body: any, req: any, deps: any, nowMs: number) {
  if (!hasCronSecret(req, deps)) return createJsonResponse({ ok: false }, 401);

  const rawTasks = await deps.db.getCandidateTasks(nowMs);
  const candidates = rawTasks.filter((t: any) => isDueInWindow(t.target_date, t.target_time, nowMs)).slice(0, 200);

  if (body.dry_run) {
    return createJsonResponse({ candidates: candidates.length, sent: 0, skipped_dup: 0, failed: 0, gone: 0 });
  }

  const bundles = groupTasks(candidates);
  let sent = 0;
  let skipped_dup = 0;
  let failed = 0;
  let gone = 0;

  // 한 작업자의 DB 오류가 이번 회차의 나머지 발송을 막지 않도록 작업자 묶음마다 따로 잡는다
  for (const b of bundles) try {
    const subs = await deps.db.getSubscriptionsByWorker(b.worker_id);
    for (const sub of subs) {
      if (!isAllowedEndpoint(sub.endpoint)) {
        failed++;
        continue;
      }
      const alreadySent = await deps.db.isAlreadySent(sub.id, b.target_date, b.target_time);
      if (alreadySent) {
        skipped_dup++;
        continue;
      }

      const payload = JSON.stringify({ title: b.title, body: b.body, tag: b.tag });
      const result = await deliver(deps, sub, payload);
      if (result === 'sent') {
        await deps.db.insertPushLog({ subscription_id: sub.id, worker_id: b.worker_id, target_date: b.target_date,
          target_time: b.target_time, task_count: b.tasks.length, status: 'sent' });
        sent++;
      } else if (result === 'gone') gone++;
      else failed++;
    }
  } catch (err) { failed++; console.error('[todo-push] dispatch bundle failed', b.worker_id, err); }

  let equipment_sent = 0;
  const acJobs = deps.db.claimEquipmentPushes ? await deps.db.claimEquipmentPushes(nowMs) : [];
  for (const job of acJobs) {
    const payload = JSON.stringify(buildEquipmentPayload(job));
    // 이미 가져간(claim) 작업은 다시 오지 않으므로, 한 직원의 오류로 나머지 직원 발송을 놓치지 않게 한다
    for (const workerId of job.notify_worker_ids || []) try {
      for (const sub of await deps.db.getSubscriptionsByWorker(workerId)) {
        const result = await deliver(deps, sub, payload);
        if (result === 'sent') equipment_sent++;
        else if (result === 'gone') gone++;
        else failed++;
      }
    } catch (err) { failed++; console.error('[todo-push] equipment push failed', job.id, workerId, err); }
  }

  return createJsonResponse({
    candidates: candidates.length,
    sent,
    skipped_dup,
    failed,
    gone,
    equipment_sent
  });
}

async function handleResubscribe(body: any, deps: any) {
  const { old_endpoint, old_auth, subscription } = body;
  if (!old_endpoint || !subscription || !subscription.endpoint) {
    return createJsonResponse({ ok: false }, 400);
  }
  if (!isAllowedEndpoint(subscription.endpoint)) {
    return createJsonResponse({ ok: false }, 400);
  }

  // endpoint는 푸시 서비스·로그로 새어 나갈 수 있어, 옛 구독의 auth 비밀 키까지 맞아야 바꾼다
  const existing = await deps.db.getSubscriptionByEndpoint(old_endpoint);
  if (!existing || !old_auth || old_auth !== existing.auth) {
    return createJsonResponse({ ok: false });
  }

  await deps.db.updateSubscription(old_endpoint, subscription);
  return createJsonResponse({ ok: true });
}

async function handleTest(body: any, deps: any, nowMs: number) {
  const { endpoint } = body;
  if (!endpoint || !isAllowedEndpoint(endpoint)) {
    return createJsonResponse({ ok: false, reason: 'bad_endpoint' }, 400);
  }

  const existing = await deps.db.getSubscriptionByEndpoint(endpoint);
  if (!existing) {
    return createJsonResponse({ ok: false, reason: 'not_registered' });
  }

  if (!checkTestRateLimit(endpoint, nowMs)) {
    return createJsonResponse({ ok: false, reason: 'rate_limited' });
  }

  try {
    const payload = JSON.stringify({
      title: '⏰ 작업 알림',
      body: '알림이 정상 연결되었습니다',
      tag: 'test-push'
    });
    const res = await deps.sender.sendNotification(existing, payload);
    const code = res && (res.statusCode || res.status);
    if (code === 404 || code === 410) {
      await deps.db.deleteSubscription(existing.id);
      return createJsonResponse({ ok: false, reason: 'gone' });
    }
    return createJsonResponse({ ok: true });
  } catch (err: any) {
    const code = err && (err.statusCode || err.status);
    if (code === 404 || code === 410) {
      await deps.db.deleteSubscription(existing.id);
      return createJsonResponse({ ok: false, reason: 'gone' });
    }
    const msg = (err && (err.message || String(err))) || '';
    console.error('test push failed', code, msg.slice(0, 200));
    return createJsonResponse({ ok: false, reason: 'send_failed' });
  }
}

export async function handleRequest(req: any, deps: any) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  if (req.method !== 'POST') {
    return createJsonResponse({ ok: false }, 400);
  }

  let text = '';
  try {
    text = typeof req.text === 'function' ? await req.text() : JSON.stringify(req.body);
  } catch (e) {
    return createJsonResponse({ ok: false }, 400);
  }

  if (typeof text === 'string') {
    const textBytes = new TextEncoder().encode(text).length;
    if (textBytes > 4096) {
      return createJsonResponse({ ok: false }, 413);
    }
  }

  let body: any = {};
  try {
    body = JSON.parse(text);
  } catch (e) {
    return createJsonResponse({ ok: false }, 400);
  }

  const nowMs = deps.now ? deps.now() : Date.now();
  const action = body && body.action;

  if (action === 'dispatch') return handleDispatch(body, req, deps, nowMs);
  if (action === 'resubscribe') return handleResubscribe(body, deps);
  if (action === 'test') return handleTest(body, deps, nowMs);

  return createJsonResponse({ ok: false }, 400);
}

// 설정이 온전할 때만 캐시한다. 한 번 실패한 {}를 캐시하면 인스턴스가 다시 뜰 때까지 dispatch가 401로 멈춘다.
export function isUsableConfig(config: any): boolean {
  return Boolean(config && config.cron_secret && hasVapidKeys(config));
}

export function createRuntime(loadWebpush: () => Promise<any>, db: any) {
  let cached: { config: any; sender: any } | null = null;
  return async function getDeps() {
    if (cached) return { db, ...cached };
    const config = await db.getConfig().catch(() => ({}));
    const mod = await loadWebpush();
    const sender = createSender(mod.default || mod, config);
    if (isUsableConfig(config)) cached = { config, sender };
    return { db, config, sender };
  };
}

// Deno 실행 입구 (Node 테스트에서 불러올 때는 실행하지 않음)
// @ts-ignore
if (typeof Deno !== 'undefined') {
  // @ts-ignore
  const db = createDbDeps(fetch, Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '');
  const getDeps = createRuntime(() => import('npm:web-push@3.6.7'), db);
  // @ts-ignore
  Deno.serve(async (req: Request) => {
    try {
      return await handleRequest(req, await getDeps());
    } catch (_err) {
      return createJsonResponse({ ok: false }, 500);
    }
  });
}
