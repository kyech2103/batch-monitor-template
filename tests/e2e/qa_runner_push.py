"""qa_runner_push.py - 작업 5분 전 웹 푸시 알림 E2E 검증 러너
AC-3 ~ AC-7, AC-R3 검증 및 증거 스크린샷 수집
"""
import json
import os
import tempfile
import threading
import time
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import sync_playwright

import qa_runner_common

PORT = qa_runner_common.free_port()
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))  # 저장소 맨 위 폴더
RUN_DIR = os.path.join(tempfile.gettempdir(), "qa-runner-local")
SHOT_DIR = os.path.join(RUN_DIR, "screenshots")
os.makedirs(SHOT_DIR, exist_ok=True)

class QuietHandler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=qa_runner_common.SITE_ROOT, **k)
    def log_message(self, fmt, *a): pass

def start_server():
    s = ThreadingHTTPServer(('127.0.0.1', PORT), QuietHandler)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s

def handle_api_route(route, state):
    try:
        req, u, m = route.request, route.request.url, route.request.method
        state.setdefault("writes", [])
        state.setdefault("register_rpc_calls", [])
        state.setdefault("unregister_rpc_calls", [])
        state.setdefault("edge_func_calls", [])
        state.setdefault("wrong_host_calls", [])
        if m in ["POST", "PUT", "PATCH", "DELETE"]:
            state["writes"].append({"method": m, "url": u, "post_data": req.post_data})
            print(f"  [PRODUCTION ISOLATION] Intercepted {m} {u}")
            if "rpc/register_push_subscription" in u:
                state["register_rpc_calls"].append(req.post_data)
                st, bd = (403, {"message": "Forbidden"}) if state.get("mock_register_fail") else (200, {"subscription_id": 999})
                return route.fulfill(status=st, content_type="application/json", body=json.dumps(bd))
            if "rpc/unregister_push_subscription" in u:
                state["unregister_rpc_calls"].append(req.post_data)
                return route.fulfill(status=200, content_type="application/json", body='{"ok":true}')
            if u.startswith("https://your-project-ref.supabase.co/functions/v1/todo-push"):
                state["edge_func_calls"].append({"headers": dict(req.headers), "body": req.post_data})
                st = state.get("edge_status", 200)
                if "edge_raw_body" in state:
                    ct = state.get("edge_content_type", "text/html")
                    return route.fulfill(status=st, content_type=ct, body=state["edge_raw_body"])
                else:
                    reply = state.get("edge_reply", {"ok": True})
                    return route.fulfill(status=st, content_type="application/json", body=json.dumps(reply))
            if "/functions/v1/" in u:
                state["wrong_host_calls"].append({"url": u, "headers": dict(req.headers), "body": req.post_data})
                return route.fulfill(status=404, content_type="text/html", body="<html>not found</html>")
            return route.fulfill(status=200, content_type="application/json", body="{}")
    except PlaywrightError as err:
        print(f"route fulfill ignored: {err}")
    return None

# 연결 설정의 VAPID 공개 키는 자리표시 글자라, 구독 흐름을 보려면 형식이 맞는 가짜 키로 바꿔 준다
TEST_CONFIG_JS = ("const SUPABASE_URL = 'https://your-project-ref.supabase.co';\n"
                  "const SUPABASE_KEY = 'YOUR-PUBLISHABLE-KEY';\n"
                  "const VAPID_PUBLIC_KEY = 'B" + "A" * 86 + "';\n")


def get_mock_response(u):
    if u.split("?")[0].endswith("/js/config.js"): return (200, "application/javascript", TEST_CONFIG_JS)
    if "/rest/v1/workers" in u:
        names = ["홍길동", "김철수", "이영희", "박민수", "정다은", "최진우"]
        return (200, "application/json", json.dumps([{"name": n} for n in names]))
    if "/rest/v1/process_managers" in u: return (200, "application/json", '[{"id":1}]')
    # DB 요청만 가짜로 답한다 (이름에 표 이름이 들어간 화면 파일 08_floorplan_batches.js 등은 그대로 받아야 한다)
    if "/rest/v1/" in u and any(k in u for k in ["equipment_jobs", "todo_schedules", "todo_rules", "batches"]):
        return (200, "application/json", "[]")
    return None

def handle_get_mock(route, url):
    try:
        # 빌드된 화면 코드(src/config.ts)의 VAPID 자리표시도 같은 가짜 키로
        if "/assets/" in url and url.split("?")[0].endswith(".js"):
            body = route.fetch().text().replace("YOUR-VAPID-PUBLIC-KEY", "B" + "A" * 86)
            return route.fulfill(status=200, content_type="application/javascript", body=body)
        mock = get_mock_response(url)
        return route.fulfill(status=mock[0], content_type=mock[1], body=mock[2]) if mock else qa_runner_common.fallback(route)
    except PlaywrightError as err:
        print(f"route get ignored: {err}")
    return None

def setup_mocking(context, state):
    def handle_route(route):
        if route.request.method in ["POST", "PUT", "PATCH", "DELETE"]: handle_api_route(route, state)
        else: handle_get_mock(route, route.request.url)
    context.route("**/*", handle_route)
    qa_runner_common.block_realtime(context)

def inject_push_mocks(page, mode="default", worker=None, subscribed=False, last_reg=0, permission="default"):
    w_json = json.dumps(worker) if worker else "null"
    script = f"""
    if ({w_json}) localStorage.setItem('APP_VERIFIED_OPERATOR', JSON.stringify({w_json})); else localStorage.removeItem('APP_VERIFIED_OPERATOR');
    if ({str(subscribed).lower()}) {{ localStorage.setItem('APP_PUSH_SUBSCRIBED', 'true'); localStorage.setItem('APP_PUSH_LAST_REGISTERED', '{last_reg}'); }} else {{ localStorage.removeItem('APP_PUSH_SUBSCRIBED'); if ({last_reg}) localStorage.setItem('APP_PUSH_LAST_REGISTERED', '{last_reg}'); else localStorage.removeItem('APP_PUSH_LAST_REGISTERED'); }}
    window.__swRegisterCalls = 0;
    // 실제 아이폰 Safari(설치 전)도 PushManager가 없다
    if ('{mode}' === 'unsupported' || '{mode}' === 'ios_browser') {{ delete window.PushManager; }} else {{
        window.Notification = window.Notification || {{}};
        try {{ Object.defineProperty(window.Notification, 'permission', {{ get: () => '{permission}', configurable: true }}); }} catch(e) {{ window.Notification.permission = '{permission}'; }}
        window.__permRequested = 0; window.Notification.requestPermission = async () => {{ window.__permRequested++; return '{permission}' === 'denied' ? 'denied' : 'granted'; }};
        const mSub = {{ endpoint: 'https://fcm.googleapis.com/fcm/send/mock-token-xyz', getKey: (k) => (window.__customGetKey ? window.__customGetKey(k) : new Uint8Array([1, 2]).buffer), unsubscribe: async () => true }};
        const mReg = {{ pushManager: {{ getSubscription: async () => localStorage.getItem('APP_PUSH_SUBSCRIBED') === 'true' ? mSub : null, subscribe: async () => mSub }} }};
        if ('serviceWorker' in navigator) {{
            navigator.serviceWorker.register = async () => {{ window.__swRegisterCalls++; return mReg; }};
            navigator.serviceWorker.getRegistration = async () => mReg; Object.defineProperty(navigator.serviceWorker, 'ready', {{ get: async () => mReg }});
        }}
    }}
    """
    page.add_init_script(script)

def open_modal_safely(page, trigger_sel):
    page.wait_for_timeout(500)
    page.evaluate("""() => {
        window.openOperatorModal = () => {};
        const m = document.getElementById('operator-auth-modal');
        if (m) {
            try { m.close(); } catch(e){}
            m.removeAttribute('open');
            m.style.display = 'none';
            m.showModal = () => {};
        }
    }""")
    page.wait_for_timeout(200)

    vp_w = page.viewport_size["width"] if page.viewport_size else 1280
    if vp_w <= 680 and trigger_sel == "#btn-push-settings":
        page.wait_for_function("() => window.PushClient && typeof window.PushClient.openModal === 'function'", timeout=10000)
        page.evaluate("() => window.PushClient.openModal()")
    else:
        page.wait_for_selector(trigger_sel, state="visible", timeout=15000)
        page.click(trigger_sel, force=True)
        if trigger_sel == "#btn-push-settings":
            page.evaluate("() => { const m = document.getElementById('push-settings-modal'); if (m && !m.open && !m.hasAttribute('open')) { if (window.PushClient && window.PushClient.openModal) window.PushClient.openModal(); else m.showModal(); } }")
    if trigger_sel == "#btn-push-settings":
        page.wait_for_selector("#push-settings-modal[open]", timeout=5000)
    page.wait_for_timeout(200)

def check_btn_style(btn, v, d, name):
    if v and d:
        op, cur = btn.evaluate("el => window.getComputedStyle(el).opacity"), btn.evaluate("el => window.getComputedStyle(el).cursor")
        assert float(op) <= 0.6 and cur == "not-allowed", f"{name} 비활성 스타일 오류: op={op}, cur={cur}"

def assert_modal_state(page, state_name, status_text):
    btn_en, btn_dis, btn_test = page.locator("#btn-push-enable"), page.locator("#btn-push-disable"), page.locator("#btn-push-test")
    v_en, d_en, v_dis, d_dis, v_test, d_test = btn_en.is_visible(), btn_en.is_disabled(), btn_dis.is_visible(), btn_dis.is_disabled(), btn_test.is_visible(), btn_test.is_disabled()
    print(f"    버튼 상태:\n      - 켜기: visible={v_en}, disabled={d_en}\n      - 끄기: visible={v_dis}, disabled={d_dis}\n      - 테스트: visible={v_test}, disabled={d_test}")
    expected = {
        "unauth": ("작업자 인증 후", (True, True), (True, True), (True, True)),
        "unsupported": ("이 브라우저는 알림을 지원하지 않습니다", (True, True), (True, True), (True, True)),
        "ios_browser": ("아이폰은 홈 화면에 추가한 뒤", (False, None), (False, None), (False, None)),
        "denied": ("알림 권한이 차단됨", (True, True), (True, True), (True, True)),
        "off": ("알림 꺼짐", (True, False), (True, True), (True, True)),
        "on": ("알림 켜짐", (False, None), (True, False), (True, False)),
    }
    exp_text, (exp_v_en, exp_d_en), (exp_v_dis, exp_d_dis), (exp_v_test, exp_d_test) = expected[state_name]
    assert exp_text in status_text, f"{state_name} 문구 불일치: {status_text}"
    assert v_en == exp_v_en and (exp_d_en is None or d_en == exp_d_en), f"{state_name} btn_en 상태 오류"
    assert v_dis == exp_v_dis and (exp_d_dis is None or d_dis == exp_d_dis), f"{state_name} btn_dis 상태 오류"
    assert v_test == exp_v_test and (exp_d_test is None or d_test == exp_d_test), f"{state_name} btn_test 상태 오류"
    for btn, v, d, name in [(btn_en, v_en, d_en, "enable"), (btn_dis, v_dis, d_dis, "disable"), (btn_test, v_test, d_test, "test")]:
        check_btn_style(btn, v, d, name)
    if state_name == "ios_browser":
        assert page.locator("#push-ios-guide").is_visible(), "아이폰 3단계 안내 표시 필요"

def test_ac3_modal_six_states(browser):
    print("\n--- [AC-3] 알림 팝업 6가지 상태 및 버튼 검증 ---")
    vw = {"id": 1, "name": "홍길동"}
    states = [
        ("unauth", None, False, "default", "AC-3_unauth.png"),
        ("unsupported", vw, False, "default", "AC-3_unsupported.png"),
        ("ios_browser", vw, False, "default", "AC-3_ios_browser.png"),
        ("denied", vw, False, "denied", "AC-3_denied.png"),
        ("off", vw, False, "default", "AC-3_off.png"),
        ("on", vw, True, "default", "AC-3_on.png")
    ]
    for st_name, worker, subbed, perm, shot_name in states:
        opts = {"user_agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X)"} if st_name == "ios_browser" else {}
        ctx = browser.new_context(**opts)
        st_log = {"writes": [], "register_rpc_calls": [], "unregister_rpc_calls": [], "edge_func_calls": []}
        setup_mocking(ctx, st_log)
        page = ctx.new_page()
        inject_push_mocks(page, mode=st_name, worker=worker, subscribed=subbed, last_reg=1729750000000, permission=perm)
        page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="domcontentloaded")
        open_modal_safely(page, "#btn-push-settings")
        txt = page.locator("#push-status-text").inner_text().strip()
        print(f"  [{st_name}] 문구: '{txt}'")
        assert_modal_state(page, st_name, txt)
        page.screenshot(path=os.path.join(SHOT_DIR, shot_name))
        print(f"  [스크린샷] {shot_name} 저장 완료")
        ctx.close()

def test_ac4_enable_disable_flow(browser):
    print("\n--- [AC-4] 알림 켜기 / 끄기 및 RPC 요청 검증 ---")
    vw = {"id": 1, "name": "홍길동"}
    ctx = browser.new_context()
    st = {"writes": [], "register_rpc_calls": [], "unregister_rpc_calls": [], "edge_func_calls": []}
    setup_mocking(ctx, st)
    page = ctx.new_page()
    inject_push_mocks(page, mode="default", worker=vw, subscribed=False, permission="default")
    page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="domcontentloaded")
    assert page.evaluate("window.__permRequested") == 0, "클릭 전 permission 0회"
    open_modal_safely(page, "#btn-push-settings")
    page.click("#btn-push-enable")
    page.wait_for_timeout(500)
    assert page.evaluate("window.__permRequested") == 1 and len(st["register_rpc_calls"]) == 1
    reg = json.loads(st["register_rpc_calls"][0])
    assert "p_code" not in reg and "p_endpoint" in reg and "p_p256dh" in reg
    assert "알림 켜짐" in page.locator("#push-status-text").inner_text()
    page.click("#btn-push-disable")
    page.wait_for_timeout(500)
    assert len(st["unregister_rpc_calls"]) == 1 and "알림 꺼짐" in page.locator("#push-status-text").inner_text()
    ctx.close()

    ctx2 = browser.new_context()
    st2 = {"writes": [], "register_rpc_calls": [], "unregister_rpc_calls": [], "edge_func_calls": [], "mock_register_fail": True}
    setup_mocking(ctx2, st2)
    p2 = ctx2.new_page()
    inject_push_mocks(p2, mode="default", worker=vw, subscribed=False)
    p2.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="domcontentloaded")
    open_modal_safely(p2, "#btn-push-settings")
    p2.click("#btn-push-enable")
    p2.wait_for_timeout(500)
    assert "알림 꺼짐" in p2.locator("#push-status-text").inner_text(), "실패 시 꺼짐 유지"
    ctx2.close()
    print("  [AC-4] 알림 켜기/끄기/실패 토스트 정상 통과")

def test_ac5_silent_resubscribe(browser):
    print("\n--- [AC-5] 조용한 재등록 및 메인화면 네트워크 부하 0 검증 ---")
    vw, now_ms = {"id": 1, "name": "홍길동"}, int(time.time() * 1000)
    ctx0 = browser.new_context()
    st0 = {"writes": [], "register_rpc_calls": [], "unregister_rpc_calls": [], "edge_func_calls": []}
    setup_mocking(ctx0, st0)
    p0 = ctx0.new_page()
    inject_push_mocks(p0, mode="default", worker=vw, subscribed=False)
    p0.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="networkidle")
    p0.wait_for_timeout(500)
    push_writes, sw_regs = len([w for w in st0["writes"] if "push" in w["url"]]), p0.evaluate("window.__swRegisterCalls || 0")
    print(f"  [메인 화면 첫 로드] 푸시 관련 네트워크 요청 수: {push_writes}, 서비스워커 등록 수: {sw_regs}")
    assert push_writes == 0 and sw_regs == 0, "첫 로드 시 푸시 관련 요청 및 SW 등록 0"
    ctx0.close()

    for cond, sub, lreg, exp in [("직접 끔(등록 기록 남음)", False, now_ms - 3600 * 1000, 0), ("사이트 데이터 삭제(기록 없음)", False, 0, 1), ("1시간 경과", True, now_ms - 3600 * 1000, 0), ("25시간 경과", True, now_ms - 25 * 3600 * 1000, 1)]:
        ctx = browser.new_context()
        st = {"writes": [], "register_rpc_calls": [], "unregister_rpc_calls": [], "edge_func_calls": []}
        setup_mocking(ctx, st)
        p = ctx.new_page()
        inject_push_mocks(p, mode="default", worker=vw, subscribed=sub, last_reg=lreg, permission="granted")
        p.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="networkidle")
        p.wait_for_timeout(500)
        calls = len(st["register_rpc_calls"])
        print(f"  [재등록 조건별] {cond}: RPC 호출 수={calls} (기대치: {exp})")
        assert calls == exp, f"RPC 호출수 {calls} != {exp}"
        ctx.close()
    print("  [AC-5] 조용한 재등록 조건 및 부하 0 통과")

def test_ac6_pm_unlinked_chip(browser):
    print("\n--- [AC-6] 공정 담당자 팝업 '알림 미연결' 칩 검증 ---")
    ctx = browser.new_context()
    st = {"writes": [], "register_rpc_calls": [], "unregister_rpc_calls": [], "edge_func_calls": []}
    setup_mocking(ctx, st)
    page = ctx.new_page()
    page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="domcontentloaded")
    open_modal_safely(page, "#btn-pm-modal-trigger")
    page.wait_for_selector("#pm-inp-p1_a", state="visible", timeout=10000)
    for sel, val in [("#pm-inp-p1_a", "홍길동"), ("#pm-inp-p1_b", "외주작업자"), ("#pm-inp-p2_a", "")]:
        page.fill(sel, val)
        page.dispatch_event(sel, "input")
    page.wait_for_timeout(300)
    assert not page.locator("#pm-chip-p1_a").is_visible() and page.locator("#pm-chip-p1_b").is_visible()
    assert "알림 미연결" in page.locator("#pm-chip-p1_b").inner_text() and not page.locator("#pm-chip-p2_a").is_visible()
    page.screenshot(path=os.path.join(SHOT_DIR, "AC-6_pm_chip.png"))
    print("  [스크린샷] AC-6_pm_chip.png 저장 완료")
    ctx.close()

def test_ac7_pwa_static_assets():
    print("\n--- [AC-7] PWA 정적 파일 200 응답 및 규격 검증 ---")
    for ep in ["/manifest.webmanifest", "/sw.js", "/icons/icon-180.png", "/icons/icon-192.png", "/icons/icon-512.png"]:
        with urllib.request.urlopen(f"http://127.0.0.1:{PORT}{ep}") as resp:
            assert resp.status == 200 and len(resp.read()) > 0, f"{ep} 200 응답 오류"
    with open(os.path.join(ROOT, "manifest.webmanifest"), encoding="utf-8") as f:
        mf = json.load(f)
        assert mf.get("display") == "standalone" and len(mf.get("icons", [])) >= 2
    with open(os.path.join(ROOT, "sw.js"), encoding="utf-8") as f:
        sw = f.read()
        assert "addEventListener('push'" in sw and "addEventListener('notificationclick'" in sw
        assert "addEventListener('fetch'" not in sw and "importScripts('/js/config.js')" in sw and "APP_URL = '/'" in sw
    with open(os.path.join(ROOT, "index.html"), encoding="utf-8") as f:
        assert 'rel="apple-touch-icon"' in f.read()
    print("  [AC-7] PWA 자산 및 규격 검증 완료")

def test_acr3_header_layout(browser):
    print("\n--- [AC-R3] 헤더 레이아웃 검증 (1440px / 1100px) ---")
    for w, shot in [(1440, "AC-R3_header_1440.png"), (1100, "AC-R3_header_1100.png")]:
        ctx = browser.new_context(viewport={"width": w, "height": 900})
        st = {"writes": [], "register_rpc_calls": [], "unregister_rpc_calls": [], "edge_func_calls": []}
        setup_mocking(ctx, st)
        page = ctx.new_page()
        page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="domcontentloaded")
        page.wait_for_timeout(600)
        # 모든 팝업 닫기
        page.evaluate("() => document.querySelectorAll('dialog[open]').forEach(d => { if (typeof d.close === 'function') d.close(); else d.removeAttribute('open'); })")
        page.wait_for_timeout(200)
        shot_h = 70
        page.screenshot(path=os.path.join(SHOT_DIR, shot), clip={"x": 0, "y": 0, "width": w, "height": shot_h})
        print(f"  [{w}px] 헤더 영역 캡처: {w}x{shot_h} (높이 >= 60px)")
        b1, b2 = page.locator("#btn-push-settings").bounding_box(), page.locator("#user-info-badge").bounding_box()
        ox = max(0.0, min(b1["x"] + b1["width"], b2["x"] + b2["width"]) - max(b1["x"], b2["x"]))
        oy = max(0.0, min(b1["y"] + b1["height"], b2["y"] + b2["height"]) - max(b1["y"], b2["y"]))
        area = ox * oy
        print(f"  [{w}px] 🔔: (x={b1['x']:.1f}, y={b1['y']:.1f}, w={b1['width']:.1f}, h={b1['height']:.1f})")
        print(f"  [{w}px] 배지: (x={b2['x']:.1f}, y={b2['y']:.1f}, w={b2['width']:.1f}, h={b2['height']:.1f}), 겹침: {area:.1f}px²")
        assert area == 0, f"{w}px 겹침: {area}"
        ctx.close()

def test_ac_test_push(browser):
    print("\n--- [AC-2] 브라우저 테스트 알림 및 reason별 토스트 검증 ---")
    worker = {"id": 1, "name": "홍길동"}
    cases = [
        ("AC-2.url.desktop", [1280, 800], {"edge_reply": {"ok": True}}, "test", "qa_runner_push__AC-2_url_desktop.png"),
        ("AC-2.url.mobile", [390, 844], {"edge_reply": {"ok": True}}, "test", "qa_runner_push__AC-2_url_mobile.png"),
        ("AC-2.not_registered", [390, 844], {"edge_reply": {"ok": False, "reason": "not_registered"}}, "test", None),
        ("AC-2.rate_limited", [390, 844], {"edge_reply": {"ok": False, "reason": "rate_limited"}}, "test", None),
        ("AC-2.gone", [390, 844], {"edge_reply": {"ok": False, "reason": "gone"}}, "test", "qa_runner_push__AC-2_gone.png"),
        ("AC-2.server_error", [390, 844], {"edge_status": 500, "edge_reply": {"ok": False}}, "test", None),
        ("AC-2.html_reply", [390, 844], {"edge_raw_body": "<html></html>", "edge_content_type": "text/html", "edge_status": 200}, "test", None),
        ("AC-2.enable_base64url", [390, 844], {}, "enable", None)
    ]

    for case_id, vp, pre, btn_action, shot_name in cases:
        ctx = browser.new_context(viewport={"width": vp[0], "height": vp[1]})
        st = {"writes": [], "register_rpc_calls": [], "unregister_rpc_calls": [], "edge_func_calls": [], "wrong_host_calls": []}
        st.update(pre)
        setup_mocking(ctx, st)
        page = ctx.new_page()
        now_ms = int(time.time() * 1000)
        is_enable = (btn_action == "enable")

        inject_push_mocks(page, mode="default", worker=worker, subscribed=(not is_enable), last_reg=now_ms, permission="granted")
        if is_enable:
            page.add_init_script("window.__customGetKey = (k) => k === 'p256dh' ? new Uint8Array([251, 255, 254]).buffer : (k === 'auth' ? new Uint8Array([1, 2]).buffer : new Uint8Array([]).buffer);")

        page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="domcontentloaded")
        open_modal_safely(page, "#btn-push-settings")

        btn_sel = "#btn-push-enable" if is_enable else "#btn-push-test"
        page.wait_for_selector(btn_sel, state="visible", timeout=10000)
        page.click(btn_sel)
        page.wait_for_timeout(1500)

        edge_n = len(st["edge_func_calls"])
        wrong_n = len(st["wrong_host_calls"])
        first_call = st["edge_func_calls"][0] if st["edge_func_calls"] else None
        edge_body = json.loads(first_call["body"]) if first_call and first_call.get("body") else None
        edge_apikey = first_call["headers"].get("apikey") if first_call and "headers" in first_call else None
        edge_auth = first_call["headers"].get("authorization") if first_call and "headers" in first_call else ("NO_CALL" if not first_call else None)
        toast_last = page.locator("#push-action-msg").inner_text().strip()
        reg_body = json.loads(st["register_rpc_calls"][0]) if st["register_rpc_calls"] else {}
        subscribed_ls = page.evaluate("localStorage.getItem('APP_PUSH_SUBSCRIBED')")
        status_badge = page.locator("#push-status-badge").inner_text().strip()

        if case_id == "AC-2.url.desktop":
            pass_cond = (edge_n == 1 and wrong_n == 0 and edge_body == {'action': 'test', 'endpoint': 'https://fcm.googleapis.com/fcm/send/mock-token-xyz'} and edge_apikey == 'YOUR-PUBLISHABLE-KEY' and edge_auth is None and toast_last == '✅ 테스트 알림을 보냈습니다. 몇 초 안에 도착합니다.')
            measured = {"edge_n": edge_n, "wrong_n": wrong_n, "edge_body": edge_body, "edge_apikey": edge_apikey, "edge_auth": edge_auth, "toast_last": toast_last, "pass": pass_cond}
        elif case_id == "AC-2.url.mobile":
            pass_cond = (edge_n == 1 and wrong_n == 0 and toast_last == '✅ 테스트 알림을 보냈습니다. 몇 초 안에 도착합니다.')
            measured = {"edge_n": edge_n, "wrong_n": wrong_n, "toast_last": toast_last, "pass": pass_cond}
        elif case_id == "AC-2.not_registered":
            pass_cond = (toast_last == '등록 정보가 없습니다. 알림 끄기 후 다시 켜 주세요.')
            measured = {"toast_last": toast_last, "pass": pass_cond}
        elif case_id == "AC-2.rate_limited":
            pass_cond = (toast_last == '1분 뒤에 다시 눌러 주세요.')
            measured = {"toast_last": toast_last, "pass": pass_cond}
        elif case_id == "AC-2.gone":
            pass_cond = (toast_last == '알림 등록이 만료되었습니다. 알림을 다시 켜 주세요.' and subscribed_ls is None and status_badge == '꺼짐')
            measured = {"toast_last": toast_last, "subscribed_ls": subscribed_ls, "status_badge": status_badge, "pass": pass_cond}
        elif case_id == "AC-2.server_error" or case_id == "AC-2.html_reply":
            pass_cond = (toast_last == '테스트 알림 전송에 실패했습니다.')
            measured = {"toast_last": toast_last, "pass": pass_cond}
        elif case_id == "AC-2.enable_base64url":
            pass_cond = (reg_body.get('p_p256dh') == '-__-' and reg_body.get('p_auth') == 'AQI' and toast_last == '✅ 알림이 켜졌습니다.')
            measured = {"reg_body": reg_body, "toast_last": toast_last, "pass": pass_cond}
        else:
            pass_cond = False
            measured = {"pass": False}

        if shot_name:
            page.screenshot(path=os.path.join(SHOT_DIR, shot_name))
            print(f"  [스크린샷] {shot_name} 저장 완료")

        print(f"MEASURED {case_id} {json.dumps(measured, ensure_ascii=False)}")
        assert pass_cond, f"{case_id} 검증 실패: {measured}"
        ctx.close()

def main():
    server = start_server()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            test_ac_test_push(browser)
            test_ac7_pwa_static_assets()
            test_ac3_modal_six_states(browser)
            test_ac4_enable_disable_flow(browser)
            test_ac5_silent_resubscribe(browser)
            test_ac6_pm_unlinked_chip(browser)
            test_acr3_header_layout(browser)
            browser.close()
        print("\n=== [qa_runner_push.py] 모든 AC 검증 PASS ===")
    finally:
        server.shutdown()

if __name__ == "__main__":
    main()
