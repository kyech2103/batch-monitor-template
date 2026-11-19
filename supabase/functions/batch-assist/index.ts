// Supabase Edge Function: batch-assist
// 메신저 공정 보고 원문 → 코드 추출 + Gemini Decision 1(보기 고르기) → 변경 사실(Change) 목록. 배치 데이터는 읽지도 쓰지도 않는다.
// 배포: supabase functions deploy batch-assist (로그인한 직원만 + 호출 제한)
// 비밀: GEMINI_API_KEY (없으면 503 disabled: 키를 해지하면 기능이 꺼진다).
//       회사 자료를 보내므로 학습에 쓰이지 않는 유료 등급 키를 쓴다. 키는 이 서버 비밀에만 두고 화면 코드에 넣지 않는다.
// SUPABASE_URL·SUPABASE_ANON_KEY·SUPABASE_SERVICE_ROLE_KEY는 Supabase가 넣어 준다.

import * as assist from './rules.mjs';
import * as decide from './decide.mjs';

/** 함수가 바깥 세계와 닿는 곳 전부. 테스트는 이것만 바꿔 끼운다. */
export type Deps = {
  now: () => number;
  geminiKey: string;
  /** 요청에 붙은 로그인 토큰(Authorization)의 주인이 등록된 직원이면 그 id */
  findWorker: (authorization: string) => Promise<{ id: number } | null>;
  /** Decisions API 요청 본문 → answers 객체 (질문 키 → 답) */
  callModel: (body: object) => Promise<unknown>;
  /** assist_log에 한 줄 쓰고 id를 돌려준다 (supabase/schema.sql) */
  saveLog: (row: object) => Promise<number | null>;
};

/** 실패 reason은 화면 문구와 1:1 (js/ai_input/ui.js ASSIST_REASON_TEXT). */
type Reason = 'bad_request' | 'too_long' | 'auth' | 'rate' | 'model' | 'disabled' | 'too_many_lots';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

// 인스턴스 메모리 호출 기록. 비용 방어용이라 재시작 때 비워지는 것은 받아들인다 (값은 사용량에 맞게 조정)
const calls = new Map<string, number[]>();
export const GLOBAL_PER_MIN = 20;
export const WORKER_PER_MIN = 5;

function json(data: object, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}

const fail = (reason: Reason, status: number) => json({ ok: false, reason }, status);

/** 1분 창에 자리가 있으면 기록하고 true. */
function takeToken(key: string, limitPerMin: number, nowMs: number): boolean {
  const recent = (calls.get(key) || []).filter(t => t > nowMs - 60000);
  if (recent.length >= limitPerMin) {
    calls.set(key, recent);
    return false;
  }
  recent.push(nowMs);
  calls.set(key, recent);
  return true;
}

/** 테스트용: 호출 기록 비우기. */
export function resetRateLimits() {
  calls.clear();
}

/**
 * 순서: 키 → 형식 → 입력 검사 → 로그인 직원 확인 → 호출 제한(전체, 작업자) → 모델. 보고 원문은 로그에 남기지 않는다.
 */
export async function handleRequest(req: any, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return fail('bad_request', 405);
  if (!deps.geminiKey) return fail('disabled', 503);

  const text = await req.text();
  if (new TextEncoder().encode(text).length > assist.LIMITS.bodyBytes) return fail('too_long', 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (_e) {
    return fail('bad_request', 400);
  }

  const parsed = assist.parseAssistInput(body);
  if (!parsed.ok) return fail(parsed.reason, parsed.reason === 'too_long' ? 413 : 400);
  const input = parsed.value;

  const authorization = req.headers.get('authorization') || '';
  const worker = authorization.length <= assist.LIMITS.authChars ? await deps.findWorker(authorization) : null;
  if (!worker) return fail('auth', 401);

  const nowMs = deps.now();
  if (!takeToken('*', GLOBAL_PER_MIN, nowMs) || !takeToken('w' + worker.id, WORKER_PER_MIN, nowMs)) return fail('rate', 429);

  let out: any = null;
  let answers: any = null;
  try {
    const { ex, body: request } = decide.buildDecisionRequest(input, nowMs);
    answers = await deps.callModel(request);
    if (answers && typeof answers === 'object' && !Array.isArray(answers)) out = decide.assemble(ex, answers, input);
  } catch (e) {
    // 원인 파악용. Google 오류 문구만 남고 보고 원문은 남지 않는다
    console.error('[batch-assist] model failed', String((e as Error)?.message || e).slice(0, 500));
    out = null;
  }
  if (!out) return fail('model', 502);
  if (out.tooManyLots) return fail('too_many_lots', 422);
  console.log(JSON.stringify({ worker: worker.id, chars: input.text.length, changes: out.changes.length, dropped: out.dropped, unsure: out.unsure.length, ms: deps.now() - nowMs }));
  // 나중에 잘못 읽은 보고를 모아 고치기 위한 기록. 실패해도 결과는 그대로 돌려준다
  const logId = await deps.saveLog({
    worker_id: worker.id,
    report: input.text,
    result: { changes: out.changes, notes: out.notes, unsure: out.unsure },
    answers,
    doubt: out.changes.length === 0 || out.unsure.length > 0 || out.notes !== ''
  }).catch(() => null);
  return json({ ok: true, changes: out.changes, notes: out.notes, logId });
}

/**
 * Deno 실행 때의 실제 의존성. 기록 저장은 서비스 키로, 직원 확인은 요청자의 토큰으로 부른다.
 */
export function createDeps(fetchFn: typeof fetch, env: { url: string; anonKey: string; serviceKey: string; geminiKey: string }): Deps {
  const base = env.url.replace(/\/+$/, '');
  return {
    now: Date.now,
    geminiKey: env.geminiKey,
    // DB의 current_worker_id()가 토큰의 이메일로 등록된 직원을 찾는다 (토큰 검증은 Supabase가 한다)
    async findWorker(authorization: string) {
      if (!/^Bearer \S+$/.test(authorization)) return null;
      const res = await fetchFn(`${base}/rest/v1/rpc/current_worker_id`, {
        method: 'POST',
        headers: { apikey: env.anonKey, Authorization: authorization, 'Content-Type': 'application/json' },
        body: '{}'
      });
      if (!res.ok) return null;
      const id = await res.json();
      return typeof id === 'number' ? { id } : null;
    },
    async saveLog(row: object) {
      const res = await fetchFn(`${base}/rest/v1/assist_log?select=id`, {
        method: 'POST',
        headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify(row),
        signal: AbortSignal.timeout(3000)
      });
      if (!res.ok) return null;
      return (await res.json())[0]?.id ?? null;
    },
    async callModel(body: object) {
      const url = 'https://generativelanguage.googleapis.com/v1beta/decisions';
      const res = await fetchFn(url, {
        method: 'POST',
        headers: { 'x-goog-api-key': env.geminiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000) // 보통 1초 안에 끝난다
      });
      if (!res.ok) throw new Error(`model ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`);
      const data: any = await res.json();
      return data?.answers;
    }
  };
}

// Deno 실행 입구 (Node 테스트에서 불러올 때는 실행하지 않음)
// @ts-ignore
if (typeof Deno !== 'undefined') {
  // @ts-ignore
  const env = { url: Deno.env.get('SUPABASE_URL') || '', anonKey: Deno.env.get('SUPABASE_ANON_KEY') || '', serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '', geminiKey: Deno.env.get('GEMINI_API_KEY') || '' };
  const deps = createDeps(fetch, env);
  // @ts-ignore
  Deno.serve(async (req: Request) => {
    try {
      return await handleRequest(req, deps);
    } catch (_err) {
      return fail('model', 500);
    }
  });
}
