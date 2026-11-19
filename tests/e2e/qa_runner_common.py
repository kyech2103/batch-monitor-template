"""E2E 러너 공용 도구: 겹치지 않는 포트, 실서버로 새는 요청 차단, 가짜 로그인.

- free_port(): OS가 비어 있는 포트를 골라 준다 (러너를 동시에 돌려도 충돌 없음).
- block_realtime(target): Supabase 실시간 WebSocket을 막는다. 모든 러너가 page/context를 만든 뒤 반드시 건다.
- install(target): block_realtime (예전 러너와 이름을 맞춘 입구).
- login_js(worker): 화면을 열기 전에 넣는 스크립트. 작업자 정보와 가짜 Supabase 로그인 세션을 저장소에 넣는다.
- fallback(route): 러너가 모킹하지 않은 요청을 처리한다.
  Supabase 요청은 실제 서버로 보내지 않는다. 1행 조회(.single())는 null(0행), 목록 조회는 200 [] 로 답한다.
  새 테이블이 생겨도 기존 러너가 깨지지 않는다. 그 밖의 요청(로컬 서버 파일, CDN)은 그대로 통과시킨다.
"""
import json
import os
import socket

# supabase-js가 세션을 두는 저장소 키: sb-<주소 첫 마디>-auth-token (src/config.ts의 SUPABASE_URL 기준)
AUTH_STORAGE_KEY = "sb-your-project-ref-auth-token"
_FAKE_SESSION = {
    "access_token": "qa-token", "refresh_token": "qa-refresh", "token_type": "bearer",
    "expires_in": 3600, "expires_at": 4102444800,  # 2100년: 테스트 중 만료되지 않는다
    "user": {"id": "00000000-0000-0000-0000-000000000000", "email": "qa@example.com", "aud": "authenticated", "role": "authenticated"},
}

# 러너가 띄우는 화면은 Vite 빌드 결과(dist)다. run-tests.js가 먼저 빌드한다. 러너를 따로 돌릴 때는 먼저 npm run build
SITE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "dist"))
_reported = set()


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def login_js(worker=None):
    """작업자 정보(있으면)와 가짜 로그인 세션을 localStorage에 넣는 스크립트."""
    js = f"localStorage.setItem({json.dumps(AUTH_STORAGE_KEY)}, {json.dumps(json.dumps(_FAKE_SESSION))});"
    if worker is not None:
        js += f"localStorage.setItem('APP_VERIFIED_OPERATOR', {json.dumps(json.dumps(worker, ensure_ascii=False))});"
    return js


def _drop_socket(ws):
    # 서버에 연결하지 않는다: 보낸 메시지는 버려지고 받는 메시지도 없다
    ws.on_message(lambda message: None)


def block_realtime(target):
    """Supabase 실시간(WebSocket) 연결을 막는다.
    막지 않으면 테스트 화면이 실제 실시간 채널에 접속해, 테스트의 배치 이동 신호가 다른 러너로 퍼진다."""
    target.route_web_socket(lambda url: "supabase.co" in url or "/realtime/" in url, _drop_socket)


def install(target):
    block_realtime(target)


def _report(route, note):
    key = route.request.url.split("?")[0]
    if key not in _reported:
        _reported.add(key)
        print(f"[UNMOCKED] {route.request.method} {key} -> {note}")


def fallback(route):
    req = route.request
    url = req.url
    if "/rest/v1/" not in url and "supabase.co" not in url:
        return route.continue_()
    if "vnd.pgrst.object" in (req.headers.get("accept") or ""):
        # 1행 조회(.single()/.maybeSingle()): 0행을 data=null로 답한다 (406은 브라우저 콘솔 오류를 남김)
        _report(route, "null (0행)")
        return route.fulfill(status=200, content_type="application/json", body="null")
    _report(route, "200 []")
    return route.fulfill(status=200, content_type="application/json", body="[]")
