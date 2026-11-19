"""qa_runner_worker_admin.py - 로그인(Supabase Auth 이메일), 관리자 버튼, 직원 등록·삭제, 1차/2차 관리자 E2E 러너
Auth와 DB 함수(current_worker_id, admin_*)는 모킹한다. 실제 권한 확인은 supabase/schema.sql의 정책과 함수가 한다.
"""
import json
import os
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import sync_playwright

import qa_runner_common

PORT = qa_runner_common.free_port()
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))  # 저장소 맨 위 폴더
PASSWORD = "test-password"  # 테스트 전용 가짜 비밀번호 (모킹된 Auth만 받는다)


class QuietHandler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=qa_runner_common.SITE_ROOT, **k)
    def log_message(self, fmt, *a): pass


def start_server():
    s = ThreadingHTTPServer(('127.0.0.1', PORT), QuietHandler)
    threading.Thread(target=s.serve_forever, daemon=True).start()


def make_state():
    return {
        "workers": [
            {"id": 1, "name": "김관리", "department": "생산팀", "email": "owner@example.com", "is_admin": True, "is_owner": True},
            {"id": 2, "name": "박사원", "department": "생산팀", "email": "staff@example.com", "is_admin": False, "is_owner": False},
            {"id": 3, "name": "이관리", "department": "생산팀", "email": "sub@example.com", "is_admin": True, "is_owner": False},
        ],
        "accounts": {"owner@example.com", "staff@example.com", "sub@example.com", "stranger@example.com"},
        "admin_calls": [],
        "auth_headers": [],
        "pm_saves": [],
    }


def fulfill(route, body, status=200):
    return route.fulfill(status=status, content_type="application/json", body=json.dumps(body, ensure_ascii=False))


def me_of(route, state):
    """요청의 로그인 토큰(tok-<이메일>)으로 등록된 직원을 찾는다 (DB의 current_worker_id 흉내)."""
    auth = route.request.headers.get("authorization") or ""
    email = auth[len("Bearer tok-"):] if auth.startswith("Bearer tok-") else None
    return next((w for w in state["workers"] if w["email"] == email), None)


def handle_auth(route, state):
    body = json.loads(route.request.post_data or "{}")
    email = body.get("email")
    if email not in state["accounts"] or body.get("password") != PASSWORD:
        return fulfill(route, {"code": 400, "error_code": "invalid_credentials", "msg": "Invalid login credentials"}, 400)
    now = int(time.time())
    user = {"id": f"u-{email}", "aud": "authenticated", "role": "authenticated", "email": email,
            "app_metadata": {}, "user_metadata": {}, "created_at": "2026-01-01T00:00:00Z"}
    return fulfill(route, {"access_token": f"tok-{email}", "token_type": "bearer", "expires_in": 3600,
                           "expires_at": now + 3600, "refresh_token": f"r-{email}", "user": user})


def handle_rpc(route, state):
    fn = route.request.url.split("/rpc/")[1].split("?")[0]
    body = json.loads(route.request.post_data or "{}")
    ws = state["workers"]
    me = me_of(route, state)
    if fn == "current_worker_id":
        return fulfill(route, me["id"] if me else None)
    if fn.startswith("admin_"):
        state["admin_calls"].append((fn, body))
        deny = lambda msg: fulfill(route, {"message": msg}, 400)
        if not me or not me["is_admin"]:
            return deny("관리자 권한이 없습니다")
        if fn == "admin_list_workers":
            return fulfill(route, ws)
        if fn == "admin_add_worker":
            ws.append({"id": len(ws) + 10, "name": body["p_name"], "department": body["p_department"], "email": body["p_email"],
                       "is_admin": False, "is_owner": False})
            return fulfill(route, ws[-1]["id"])
        target = next((w for w in ws if w["id"] == body.get("p_worker_id")), None)
        if fn == "admin_set_admin":
            if not me["is_owner"]:
                return deny("관리자 지정·해제는 1차 관리자만 할 수 있습니다")
            target["is_admin"] = body["p_is_admin"]
            return fulfill(route, None)
        if fn == "admin_retire_worker":
            if target["is_owner"] or (target["is_admin"] and not me["is_owner"]):
                return deny("관리자 삭제는 1차 관리자만 할 수 있습니다")
            ws.remove(target)
            return fulfill(route, None)
    return fulfill(route, None)


def handle_rest(route, state):
    url, method = route.request.url, route.request.method
    if "/auth/v1/token" in url:
        return handle_auth(route, state)
    if "/auth/v1/logout" in url:
        return route.fulfill(status=204, body="")
    if "/rest/v1/" in url:
        state["auth_headers"].append(route.request.headers.get("authorization"))
    if state.get("strict") and "/rest/v1/" in url and "/rpc/" not in url:
        # schema.sql 정책 흉내: 등록된 직원의 토큰이 없으면 읽기는 0행, 쓰기는 거부. 있으면 서버 배치 행을 주고받는다
        if not me_of(route, state):
            if method != "GET":
                state["denied_writes"].append(url.split("/rest/v1/")[1].split("?")[0])
                return fulfill(route, {"code": "42501", "message": "new row violates row-level security policy"}, 403)
            return qa_runner_common.fallback(route)
        if "/rest/v1/batches" in url:
            if method != "GET":
                body = json.loads(route.request.post_data or "{}")
                if body.get("id") == "current_batches":
                    state["batch_writes"].append(body["data"])
                    state["server_batches"] = body["data"]
                return route.fulfill(status=201, content_type="application/json", body="{}")
            if "current_batches" in url:
                return fulfill(route, {"id": "current_batches", "data": state["server_batches"]})
    if "/rest/v1/workers" in url and method == "GET" and "id=eq." in url:
        wid = int(parse_qs(urlparse(url).query)["id"][0].split(".")[1])
        w = next((w for w in state["workers"] if w["id"] == wid), None)
        return fulfill(route, {k: w[k] for k in ("id", "name", "department", "is_admin")} if w else None)
    if "/rest/v1/process_managers" in url and method == "POST":
        state["pm_saves"].append(json.loads(route.request.post_data or "{}"))
        return route.fulfill(status=200, content_type="application/json", body=route.request.post_data)
    if "/rest/v1/rpc/" in url:
        return handle_rpc(route, state)
    return qa_runner_common.fallback(route)


def open_page(browser, state, viewport):
    ctx = browser.new_context(viewport=viewport, is_mobile=viewport["width"] < 768, has_touch=viewport["width"] < 768)
    ctx.route("**/*", lambda r: handle_rest(r, state))
    qa_runner_common.block_realtime(ctx)
    page = ctx.new_page()
    page.on("dialog", lambda d: d.accept())
    page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="domcontentloaded")
    page.wait_for_selector("#operator-auth-modal[open]", timeout=5000)
    return ctx, page


def login(page, email, password=PASSWORD):
    page.fill("#operator-email-input", email)
    page.fill("#operator-password-input", password)
    page.click("#btn-verify-code")
    page.wait_for_timeout(500)
    page.wait_for_load_state("domcontentloaded")  # 로그인하면 화면을 새로 고쳐 DB를 다시 읽는다
    page.wait_for_timeout(700)


def auth_open(page):
    return page.evaluate("() => document.getElementById('operator-auth-modal').open")


def test_pc_admin_flow(browser):
    print("\n--- [W-1] PC 1차 관리자: 이메일 로그인 → 직원 관리 → 직원 등록 → 삭제 ---")
    state = make_state()
    ctx, page = open_page(browser, state, {"width": 1440, "height": 900})
    login(page, "owner@example.com")
    assert not auth_open(page), "관리자 로그인 실패"
    btn = page.locator("#btn-worker-admin-trigger")
    print(f"  * 직원 관리 버튼 표시: {btn.is_visible()}")
    assert btn.is_visible(), "관리자에게 직원 관리 버튼이 안 보임"

    btn.click()
    page.wait_for_selector("#wa-list .wa-row")
    print(f"  * 목록 행 수: {page.locator('#wa-list .wa-row').count()}")
    assert page.locator("#wa-list .wa-row").count() == 3
    owner_btns = page.locator('#wa-list .wa-row[data-name="이관리"] button').all_text_contents()
    print(f"  * 1차 관리자가 보는 2차 관리자 행 버튼: {owner_btns}")
    assert owner_btns == ["관리자 해제", "삭제"], owner_btns
    assert page.locator('#wa-list .wa-row[data-name="김관리"] button').count() == 0, "1차 관리자 행에 버튼이 있음"

    page.fill("#wa-name", "신입사원")
    page.fill("#wa-dept", "생산팀")
    page.fill("#wa-email", "new@example.com")
    page.click("#wa-add-form button[type=submit]")
    page.wait_for_function("() => document.querySelectorAll('#wa-list .wa-row').length === 4")
    msg = page.locator("#wa-msg").text_content()
    add = [c for c in state["admin_calls"] if c[0] == "admin_add_worker"]
    print(f"  * 등록 안내: '{msg}', 호출 인자: {add[0][1]}")
    assert "new@example.com" in msg, "등록 후 계정 만들기 안내 없음"
    assert add[0][1] == {"p_name": "신입사원", "p_department": "생산팀", "p_email": "new@example.com"}, "등록 호출 인자 오류"

    page.locator('#wa-list .wa-row[data-name="박사원"] button[data-act="retire"]').click()
    page.wait_for_function("() => !document.querySelector('#wa-list .wa-row[data-name=\"박사원\"]')")
    retire = [c for c in state["admin_calls"] if c[0] == "admin_retire_worker"]
    print(f"  * 삭제 호출: {retire} → 목록에서 사라짐")
    assert retire and retire[0][1] == {"p_worker_id": 2}, "삭제 호출 인자 오류"
    ctx.close()


def test_staff_and_unregistered(browser):
    print("\n--- [W-2] 일반 직원은 버튼 없음 / 비밀번호가 틀리거나 직원 표에 없는 계정은 로그인 거부 ---")
    state = make_state()
    ctx, page = open_page(browser, state, {"width": 1440, "height": 900})
    login(page, "staff@example.com")
    hidden = not page.locator("#btn-worker-admin-trigger").is_visible()
    print(f"  * 일반 직원 직원관리 버튼 숨김: {hidden}")
    assert hidden, "일반 직원에게 직원 관리 버튼이 보임"
    ctx.close()

    ctx, page = open_page(browser, state, {"width": 1440, "height": 900})
    login(page, "staff@example.com", "wrong")
    err = page.locator("#auth-error-text").text_content()
    print(f"  * 틀린 비밀번호: 인증창 유지={auth_open(page)}, 안내='{err}'")
    assert auth_open(page) and "맞지 않습니다" in err, "틀린 비밀번호가 통과함"
    login(page, "stranger@example.com")
    err = page.locator("#auth-error-text").text_content()
    print(f"  * 직원 표에 없는 계정: 인증창 유지={auth_open(page)}, 안내='{err}'")
    assert auth_open(page) and "등록되지 않은" in err, "직원이 아닌 계정이 통과함"
    ctx.close()


def test_mobile_login_only(browser):
    print("\n--- [W-3] 모바일: 이메일 로그인이 되고, 직원 관리 진입점은 없음 (PC 전용) ---")
    state = make_state()
    ctx, page = open_page(browser, state, {"width": 390, "height": 844})
    login(page, "owner@example.com")
    page.click('.m-tab-btn[data-tab="more"]')
    more_text = page.locator("#m-content-root").text_content()
    print(f"  * 모바일 로그인 후 더보기에 직원 관리 없음: {'직원 관리' not in more_text}")
    assert "김관리" in more_text and "직원 관리" not in more_text, "모바일 로그인 실패 또는 직원 관리 노출"
    ctx.close()


def test_sub_admin(browser):
    print("\n--- [W-4] 2차 관리자: 관리자 지정·해제 버튼 없음, 관리자 삭제 불가 / 담당자 저장에 추가 역할 칸 없음 ---")
    state = make_state()
    ctx, page = open_page(browser, state, {"width": 1440, "height": 900})
    login(page, "sub@example.com")
    page.click("#btn-worker-admin-trigger")
    page.wait_for_selector("#wa-list .wa-row")
    admin_btns = page.locator('#wa-list button[data-act="admin"]').count()
    rows = {n: page.locator(f'#wa-list .wa-row[data-name="{n}"] button').all_text_contents() for n in ("김관리", "이관리", "박사원")}
    print(f"  * 관리자 지정 버튼 {admin_btns}개, 행별 버튼 {rows}")
    assert admin_btns == 0 and rows == {"김관리": [], "이관리": [], "박사원": ["삭제"]}, rows
    page.evaluate("() => document.getElementById('worker-admin-modal').close()")

    page.click("#btn-pm-modal-trigger")
    page.wait_for_selector("#pm-inp-p1_a")
    page.click("#btn-pm-save")
    page.wait_for_timeout(500)
    saved = state["pm_saves"][-1] if state["pm_saves"] else {}
    print(f"  * 담당자 저장 칸: managers 포함={'managers' in saved}")
    assert saved and "managers" not in saved, "없는 칸(managers)을 저장함"
    ctx.close()


def test_session(browser):
    print("\n--- [W-6] 로그인하면 DB 요청마다 로그인 토큰을 붙인다. 세션이 지워지면 다시 로그인 ---")
    state = make_state()
    ctx, page = open_page(browser, state, {"width": 1440, "height": 900})
    assert not any(h and h.startswith("Bearer tok-") for h in state["auth_headers"]), "로그인 전인데 직원 토큰을 보냄"
    login(page, "staff@example.com")
    after = state["auth_headers"][-5:]
    print(f"  * 로그인 뒤 DB 요청의 토큰: {set(after)}")
    assert after and all(v == "Bearer tok-staff@example.com" for v in after), after
    assert not auth_open(page), "새로 고친 뒤 로그인을 또 물음"
    page.evaluate(f"() => localStorage.removeItem('{qa_runner_common.AUTH_STORAGE_KEY}')")
    page.reload(wait_until="domcontentloaded")
    page.wait_for_selector("#operator-auth-modal[open]", timeout=5000)
    assert not page.locator("#btn-cancel-auth").is_visible(), "세션이 없는데 로그인을 건너뛸 수 있음"
    ctx.close()


def test_session_required(browser):
    print("\n--- [W-7] DB가 로그인을 요구해도: 로그인 전에는 배치가 안 보이고 서버 목록을 건드리지 않으며, 로그인하면 서버 배치가 보인다 ---")
    state = make_state()
    lot = {"lotNumber": "LOT-S1", "manualZone": "packaging", "assignedZone": "packaging", "createdAt": "2026-11-01T00:00:00.000Z"}
    state.update(strict=True, denied_writes=[], batch_writes=[], server_batches=[lot])
    ctx, page = open_page(browser, state, {"width": 1440, "height": 900})
    page.wait_for_timeout(1500)
    before = page.locator(".batch-chip").count()
    print(f"  * 로그인 전 배치 칩 {before}개, 거부된 쓰기 {state['denied_writes']}")
    assert before == 0, "로그인 전인데 배치가 보임"
    assert "batches" not in state["denied_writes"], "로그인 전에 배치 목록을 서버에 쓰려고 함"
    login(page, "staff@example.com")
    page.wait_for_selector(".batch-chip", timeout=5000)
    page.wait_for_timeout(1500)
    print(f"  * 로그인 뒤 배치 칩 {page.locator('.batch-chip').count()}개, 배치 쓰기 {len(state['batch_writes'])}번")
    assert [b["lotNumber"] for b in state["server_batches"]] == ["LOT-S1"], f"서버 배치 목록이 바뀜: {state['server_batches']}"
    assert all(any(b.get("lotNumber") == "LOT-S1" for b in w) for w in state["batch_writes"]), "서버 배치가 빠진 목록을 씀"
    ctx.close()


def main():
    start_server()
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        test_pc_admin_flow(browser)
        test_staff_and_unregistered(browser)
        test_mobile_login_only(browser)
        test_sub_admin(browser)
        test_session(browser)
        test_session_required(browser)
        browser.close()
    print("\n=== [qa_runner_worker_admin] ALL PASS ===")


if __name__ == "__main__":
    main()
