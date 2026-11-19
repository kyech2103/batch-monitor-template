"""
qa_runner_batch_assist.py - AI 입력(batch-assist) E2E 검증 러너 (AC1 ~ AC11)
batch-assist 함수는 state.assist_reply로 답하고, 배치 저장은 state.writes에 쌓는다. Google 주소로는 요청이 나가면 안 된다.
"""
import copy
import json
import os
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright

import qa_runner_common

PORT = qa_runner_common.free_port()
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))  # 저장소 맨 위 폴더
SHOT_DIR = os.path.join(tempfile.gettempdir(), "qa-runner-local", "screenshots")
os.makedirs(SHOT_DIR, exist_ok=True)
WORKER = {"id": 1, "name": "김작업", "role": "제조"}
TARGET = "PA-AI-1"


class QuietHandler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=qa_runner_common.SITE_ROOT, **k)
    def log_message(self, fmt, *a): pass


def step(k, start, end, remarks=""):
    names = {"A": ("공정1", "공정1실"), "B": ("공정2", "공정2실"), "C": ("공정3", "공정3실"), "D": ("공정4", "공정4실"), "E": ("공정5", "공정5실"), "packaging": ("포장", "포장실")}
    return {"stepId": k, "stepName": names[k][0], "room": names[k][1], "startDate": start, "endDate": end, "durationMinutes": 120, "remarks": remarks}


def make_batches():
    target = {
        "lotNumber": TARGET, "manualZone": "stage3", "assignedZone": "stage3",
        "createdAt": "2026-10-20T08:00:00.000Z", "updatedAt": "2026-10-20T08:00:00.000Z",
        "schedule": {
            "A": step("A", "2026-10-22T00:00:00.000Z", "2026-10-22T02:00:00.000Z"),
            "B": step("B", "2026-10-22T02:00:00.000Z", "2026-10-22T04:00:00.000Z"),
            "C": step("C", "2026-10-22T04:00:00.000Z", "2026-10-22T06:00:00.000Z", "공정3 1호기"),
            "D": step("D", "2026-10-22T06:00:00.000Z", "2026-10-22T08:00:00.000Z"),
            "E": step("E", "2026-10-22T08:00:00.000Z", "2026-10-22T09:00:00.000Z"),
            "packaging": step("packaging", "2026-10-24T00:00:00.000Z", "2026-10-24T02:00:00.000Z")
        },
        "quantities": {"B": 500, "losses": {"B": 10, "C": 5}},
        "remarks": {"C": "공정3 1호기"}
    }
    return [target,
            {"lotNumber": "PA-MOCK-2", "manualZone": "stage1-1", "assignedZone": "stage1-1", "quantities": {"B": 300, "losses": {"B": 10}}},
            {"lotNumber": "PA-MOCK-3", "manualZone": "stage5", "assignedZone": "stage5", "quantities": {"B": 400, "losses": {"B": 20}}},
            {"lotNumber": "PA-MOCK-4", "manualZone": "semi-storage-pre", "assignedZone": "semi-storage-pre"},
            {"lotNumber": "PA-MOCK-5", "manualZone": "logistics", "assignedZone": "logistics", "completed_at": "2026-10-21T10:00:00Z"}]


def happy_reply(quote="공정 중 차감 4"):
    return (200, {"ok": True, "notes": "", "changes": [
        {"op": "end", "lot": TARGET, "step": "C", "at": "2026-10-22T14:30", "quote": f"{TARGET} 공정3 공정 완료했습니다 (14:30)"},
        {"op": "loss", "lot": TARGET, "step": "C", "qty": 4, "quote": quote},
        {"op": "loss", "lot": TARGET, "step": "C", "qty": 2, "quote": "공정 후 차감 2"},
        {"op": "memo", "lot": TARGET, "step": "C", "text": "용기 파손", "quote": quote}]})


class State:
    def __init__(self):
        self.mock_batches = make_batches()
        self.writes = []
        self.audit_rows = []
        self.assist_requests = []
        self.assist_reply = happy_reply()
        self.assist_abort = False
        self.google_hits = []
        self.flag_calls = []
        self.page_errors = []


def handle_routes(route, state):
    req, url = route.request, route.request.url
    if url.startswith(f"http://127.0.0.1:{PORT}/"):
        return route.continue_()
    if "generativelanguage.googleapis.com" in url:
        state.google_hits.append(url)
        return route.abort()
    if "/functions/v1/batch-assist" in url:
        state.assist_requests.append({"headers": dict(req.headers), "body": json.loads(req.post_data or "{}")})
        if state.assist_abort:
            return route.abort()
        status, body = state.assist_reply
        return route.fulfill(status=status, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=json.dumps(body))
    if "/rest/v1/rpc/flag_assist_log" in url:
        state.flag_calls.append({"body": json.loads(req.post_data or "{}"), "session": req.headers.get("authorization")})
        return route.fulfill(status=200, content_type="application/json", body="true")
    if "/rest/v1/batches" in url:
        if req.method in ("POST", "PUT", "PATCH"):
            data = json.loads(req.post_data)["data"]
            state.writes.append(data)
            state.mock_batches = copy.deepcopy(data)
            return route.fulfill(status=201, content_type="application/json", body="{}")
        return route.fulfill(status=200, content_type="application/json", body=json.dumps({"id": "current_batches", "data": state.mock_batches}))
    if req.method in ("POST", "PUT", "PATCH", "DELETE"):
        if "timeline_logs" in url:
            state.audit_rows.extend(json.loads(req.post_data or "[]"))
        return route.fulfill(status=201, content_type="application/json", body="{}")
    if any(t in url for t in ("todo_schedules", "holidays", "todo_rules")):
        return route.fulfill(status=200, content_type="application/json", body="[]")
    return qa_runner_common.fallback(route)


def open_page(browser, state, worker=WORKER, mobile=False, block_ai=False):
    vp = {"width": 390, "height": 844} if mobile else {"width": 1440, "height": 900}
    ua = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36" if mobile else None
    ctx = browser.new_context(viewport=vp, user_agent=ua, is_mobile=mobile, has_touch=mobile)
    page = ctx.new_page()
    page.on("pageerror", lambda e: state.page_errors.append(str(e)))
    page.route("**/*", lambda r: handle_routes(r, state))
    qa_runner_common.block_realtime(page)
    if block_ai:
        page.route("**/js/ai_input/**", lambda r: r.fulfill(status=404, body=""))
    init = f"localStorage.setItem('APP_BATCH_RECORDS', JSON.stringify({json.dumps(state.mock_batches)}));"
    init += qa_runner_common.login_js(worker) if worker else "localStorage.removeItem('APP_VERIFIED_OPERATOR');"
    page.add_init_script(init)
    page.goto(f"http://127.0.0.1:{PORT}/index.html?qa=true{'#m=batch' if mobile else ''}", wait_until="domcontentloaded")
    page.wait_for_timeout(700)
    return ctx, page


def wait_idle(page):
    page.wait_for_function("() => !document.getElementById('btn-assist-parse').disabled")
    page.wait_for_timeout(350)


def parse(page, text="보고"):
    page.fill("#batch-assist-text", text)
    page.click("#btn-assist-parse")
    wait_idle(page)


def apply(page, state):
    state.writes.clear()
    page.click("#btn-assist-apply")
    wait_idle(page)


def checks(page):
    return page.evaluate("() => [...document.querySelectorAll('#batch-assist-preview .ba-check')].map(c => ({ id: c.dataset.id, checked: c.checked, disabled: c.disabled }))")


def status(page):
    return page.inner_text("#batch-assist-status")


def by_lot(lst):
    return {b["lotNumber"]: b for b in lst}


def test_ac1_pc_happy_path(browser, state):
    print("\n--- [AC1] PC: 헤더 버튼 → 변환 → 미리보기 → 적용 ---")
    original = copy.deepcopy(state.mock_batches)
    ctx, page = open_page(browser, state)
    page.click("#btn-batch-assist")
    assert page.locator("#batch-assist-modal").is_visible(), "AI 입력 창이 열리지 않음"
    assert "그대로 붙여 넣으세요" in page.get_attribute("#batch-assist-text", "placeholder")
    parse(page, f"{TARGET} 공정3 공정 완료했습니다 (14:30)\n공정 중 차감 4\n공정 후 차감 2")
    assert page.inner_text(".ba-lot") == TARGET
    lot_px = page.evaluate("() => parseFloat(getComputedStyle(document.querySelector('.ba-lot')).fontSize)")
    print(f"  * 로트 글자 크기 {lot_px}px, 줄 {checks(page)}")
    assert lot_px >= 20
    assert [c["checked"] for c in checks(page)] == [True, True, True]
    page.screenshot(path=os.path.join(SHOT_DIR, "AC1_batch_assist_pc.png"))
    req = state.assist_requests[-1]["body"]
    assert state.assist_requests[-1]["headers"].get("authorization") == "Bearer qa-token", "로그인 토큰을 보내지 않음"
    assert TARGET in req["lots"] and ["stage3", "공정3실"] in [list(z) for z in req["zones"]], req
    apply(page, state)
    assert len(state.writes) == 1, f"저장 횟수 {len(state.writes)}"
    written = state.writes[0]
    assert [b["lotNumber"] for b in written] == [b["lotNumber"] for b in original]
    t = by_lot(written)[TARGET]
    assert t["schedule"]["C"]["endDate"] == "2026-10-22T05:30:00.000Z", t["schedule"]["C"]["endDate"]
    assert t["quantities"]["losses"]["C"] == 6 and t["quantities"]["losses"]["B"] == 10
    assert t["remarks"]["C"] == "공정3 1호기 &#x2F; 용기 파손", t["remarks"]["C"]
    for b in original[1:]:
        assert by_lot(written)[b["lotNumber"]] == b, f"{b['lotNumber']}이 바뀜"
    assert "1개 배치에 적용했어요" in status(page)
    page.wait_for_timeout(300)
    assert any(r.get("work_zone") == "AI 입력" and r.get("target_lot") == TARGET for r in state.audit_rows), state.audit_rows
    print(f"  * 저장 1회, 배치 {len(written)}건 유지, 감사 기록 {len(state.audit_rows)}건")
    ctx.close()


def test_ac2_unchecked_line(browser, state):
    print("\n--- [AC2] 체크를 끈 줄은 바뀌지 않는다 ---")
    state.mock_batches = make_batches()
    ctx, page = open_page(browser, state)
    page.click("#btn-batch-assist")
    parse(page)
    page.uncheck(f".ba-check[data-id='{TARGET}|memo|C']")
    apply(page, state)
    t = by_lot(state.writes[0])[TARGET]
    assert t["remarks"]["C"] == "공정3 1호기" and t["quantities"]["losses"]["C"] == 6
    ctx.close()


def test_ac3_conflict(browser, state):
    print("\n--- [AC3] 변환 뒤 다른 곳에서 수정 → 저장 안 함, 다시 계산, 끈 줄 유지 ---")
    state.mock_batches = make_batches()
    ctx, page = open_page(browser, state)
    page.click("#btn-batch-assist")
    parse(page)
    page.uncheck(f".ba-check[data-id='{TARGET}|memo|C']")
    state.mock_batches[0]["quantities"]["B"] = 501
    apply(page, state)
    assert state.writes == [], "충돌인데 저장함"
    assert "다시 계산했어요" in page.inner_text(".ba-notice")
    memo = [c for c in checks(page) if c["id"].endswith("|memo|C")][0]
    assert memo["checked"] is False, "끈 줄이 다시 켜짐"
    apply(page, state)
    assert len(state.writes) == 1
    t = by_lot(state.writes[0])[TARGET]
    assert t["quantities"]["B"] == 501 and t["remarks"]["C"] == "공정3 1호기"
    ctx.close()


def test_ac4_no_delete(browser, state):
    print("\n--- [AC4] 삭제 시도·목록 밖 로트는 적용 불가, 오래된 캐시로도 배치가 사라지지 않음 ---")
    state.mock_batches = make_batches()
    state.assist_reply = (200, {"ok": True, "notes": "배치 삭제는 할 수 없어요", "changes": [
        {"op": "delete", "lot": TARGET, "quote": f"{TARGET} 삭제"},
        {"op": "loss", "lot": "PA-NEW-9", "step": "C", "qty": 1, "quote": "PA-NEW-9 차감 1"}]})
    ctx, page = open_page(browser, state)
    page.click("#btn-batch-assist")
    parse(page)
    assert checks(page) == []
    skipped = page.inner_text(".ba-skipped")
    assert "배치 등록 화면" in skipped and "배치 삭제는 할 수 없어요" in skipped, skipped
    assert page.is_disabled("#btn-assist-apply")
    state.writes.clear()
    page.evaluate("() => document.getElementById('btn-assist-apply').click()")
    page.wait_for_timeout(300)
    assert state.writes == []
    page.click("#btn-assist-close")

    state.assist_reply = happy_reply()
    stale = [b for b in state.mock_batches if b["lotNumber"] != "PA-MOCK-5"]
    page.evaluate(f"() => localStorage.setItem('APP_BATCH_RECORDS', JSON.stringify({json.dumps(stale)}))")
    page.click("#btn-batch-assist")
    parse(page)
    assert "PA-MOCK-5" not in state.assist_requests[-1]["body"]["lots"], "캐시가 오래되지 않음"
    apply(page, state)
    lots = [b["lotNumber"] for b in state.writes[0]]
    print(f"  * 캐시 {len(stale)}건, 서버 5건 → 저장 {len(lots)}건")
    assert lots == [b["lotNumber"] for b in make_batches()]
    ctx.close()


def test_ac5_errors(browser, state):
    print("\n--- [AC5] 함수 오류·네트워크 끊김은 안내만, 저장 없음 ---")
    state.mock_batches = make_batches()
    ctx, page = open_page(browser, state)
    page.click("#btn-batch-assist")
    cases = [((401, {"ok": False, "reason": "auth"}), "다시 로그인"),
             ((429, {"ok": False, "reason": "rate"}), "잠시 뒤에"), ((502, {"ok": False, "reason": "model"}), "AI가 답하지 못했어요")]
    for reply, text in cases:
        state.assist_reply = reply
        parse(page)
        assert text in status(page), (reply, status(page))
        assert page.is_disabled("#btn-assist-apply")
    state.assist_abort = True
    parse(page)
    state.assist_abort = False
    assert "연결을 확인" in status(page), status(page)
    assert state.writes == []
    ctx.close()


def test_ac6_mobile(browser, state):
    print("\n--- [AC6] 모바일 390px: 배치 목록 버튼 → 같은 창 → 적용 ---")
    state.mock_batches = make_batches()
    state.assist_reply = happy_reply()
    ctx, page = open_page(browser, state, mobile=True)
    btn = page.locator("#m-btn-ai-input")
    box = btn.bounding_box()
    assert box and box["height"] >= 44, box
    search = page.locator("#m-batch-search").bounding_box()
    assert abs(search["y"] - box["y"]) < 4 and search["x"] + search["width"] <= box["x"], ("검색창 옆 한 줄이 아님", search, box)
    page.fill("#m-batch-search", "PA")
    assert page.locator("#m-btn-ai-input").count() == 1, "검색으로 다시 그린 뒤 버튼이 없거나 겹침"
    page.fill("#m-batch-search", "")
    btn.click()
    assert page.locator("#batch-assist-modal").is_visible()
    parse(page)
    dims = page.evaluate("""() => ({ dialog: document.getElementById('batch-assist-modal').getBoundingClientRect().width,
        page: document.documentElement.scrollWidth, body: document.querySelector('#batch-assist-modal .pt-body').scrollWidth,
        bodyClient: document.querySelector('#batch-assist-modal .pt-body').clientWidth,
        lines: [...document.querySelectorAll('.ba-line')].map(l => l.getBoundingClientRect().height) })""")
    print(f"  * {dims}")
    assert dims["dialog"] <= 390 and dims["page"] <= 390 and dims["body"] <= dims["bodyClient"]
    assert all(h >= 44 for h in dims["lines"])
    shot = os.path.join(SHOT_DIR, "AC6_batch_assist_390.png")
    page.screenshot(path=shot)
    print(f"  * 스크린샷: {shot}")
    apply(page, state)
    assert len(state.writes) == 1 and len(state.writes[0]) == 5
    ctx.close()


def test_ac7_unverified_pc(browser, state):
    print("\n--- [AC7] 인증 안 된 PC 작업자 → 작업자 인증 창 ---")
    ctx, page = open_page(browser, state, worker=None)
    page.click("#btn-batch-assist")
    page.wait_for_timeout(200)
    assert page.evaluate("() => document.getElementById('operator-auth-modal').open"), "인증 창이 안 열림"
    assert not page.evaluate("() => document.getElementById('batch-assist-modal').open")
    ctx.close()


def test_ac8_ac9_ac10(browser, state):
    print("\n--- [AC8] 키가 없으면 꺼짐 안내만, [AC9] 적용 두 번 눌러도 1회 저장, [AC10] 원문은 글자로만 ---")
    state.mock_batches = make_batches()
    state.assist_reply = (503, {"ok": False, "reason": "disabled"})
    ctx, page = open_page(browser, state)
    page.click("#btn-batch-assist")
    parse(page)
    assert "AI 기능이 꺼져 있어요" in status(page), status(page)
    assert checks(page) == [] and page.is_disabled("#btn-assist-apply")
    state.assist_reply = happy_reply(quote="<img src=x onerror=window.__xss=1>공정 중 차감 4")
    parse(page)
    assert status(page) == ""
    assert page.evaluate("() => document.querySelectorAll('#batch-assist-preview img').length") == 0
    assert "<img src=x" in page.inner_text("#batch-assist-preview")
    state.writes.clear()
    page.evaluate("() => { const b = document.getElementById('btn-assist-apply'); b.click(); b.click(); }")
    wait_idle(page)
    page.wait_for_timeout(300)
    assert len(state.writes) == 1, f"저장 횟수 {len(state.writes)}"
    assert page.evaluate("() => window.__xss") is None
    ctx.close()


def test_ac11_without_ai_folder(browser, state):
    print("\n--- [AC11] AI 폴더 없이도 앱 정상 (js/ai_input/ 요청을 404로) ---")
    state.mock_batches = make_batches()
    for mobile in (False, True):
        ctx, page = open_page(browser, state, mobile=mobile, block_ai=True)
        assert page.locator("#btn-batch-assist, #m-btn-ai-input, #batch-assist-modal").count() == 0, "AI 버튼·창이 남아 있음"
        if mobile:
            page.wait_for_selector("#m-batch-search")
            count = page.locator(".m-card[data-lot]").count()
        else:
            page.wait_for_selector(".batch-chip")
            count = page.locator(".batch-chip").count()
        print(f"  * {'모바일 배치 목록' if mobile else 'PC 메인 보드'} 카드 {count}개")
        assert count > 0
        ctx.close()


def test_ac12_deduct_current_step_and_lot_cap(browser, state):
    print("\n--- [AC12] '샘플 3개 빼'는 지금 있는 공정에서 빼고, 배치 4개 초과 응답은 안내만 ---")
    state.mock_batches = make_batches()
    quote = "PA-MOCK-3 시험용 샘플 3개 빼"
    state.assist_reply = (200, {"ok": True, "notes": "", "changes": [{"op": "deduct", "lot": "PA-MOCK-3", "step": None, "qty": 3, "quote": quote}]})
    ctx, page = open_page(browser, state)
    page.click("#btn-batch-assist")
    parse(page, quote)
    ids = [c["id"] for c in checks(page)]
    print(f"  * 줄: {ids}")
    assert ids == ["PA-MOCK-3|deduct|E"], ids  # 공정5 구역 → 공정5 차감
    apply(page, state)
    t = by_lot(state.writes[0])["PA-MOCK-3"]
    print(f"  * 저장: 차감={t['quantities']['losses']}, 비고={t['remarks'].get('E')}")
    assert t["quantities"]["losses"]["E"] == 3 and t["quantities"]["losses"]["B"] == 20
    assert "샘플 3개 빼" in t["remarks"]["E"]
    assert len(state.writes[0]) == len(state.mock_batches)

    state.assist_reply = (422, {"ok": False, "reason": "too_many_lots"})
    state.writes.clear()
    parse(page, "배치 다섯 개")
    print(f"  * 4개 초과 안내: {status(page)}")
    assert "4개까지" in status(page) and checks(page) == [] and page.is_disabled("#btn-assist-apply") and state.writes == []
    state.assist_reply = happy_reply()
    ctx.close()


def test_ac13_flag_wrong_result(browser, state):
    print("\n--- [AC13] 해석 기록이 있으면 [오류 보고] 버튼, 누르면 그 기록에만 표시 ---")
    state.mock_batches = make_batches()
    ctx, page = open_page(browser, state)
    page.click("#btn-batch-assist")
    parse(page)
    assert page.locator("#btn-assist-flag").count() == 0, "기록 id가 없는데 버튼이 보임"
    code, body = happy_reply()
    state.assist_reply = (code, {**body, "logId": 5})
    parse(page)
    page.click("#btn-assist-flag")
    page.wait_for_function("() => document.getElementById('btn-assist-flag').disabled")
    page.wait_for_timeout(300)
    label = page.inner_text("#btn-assist-flag")
    print(f"  * 표시 요청 {state.flag_calls}, 버튼 '{label}'")
    assert [c["body"] for c in state.flag_calls] == [{"p_id": 5}], state.flag_calls
    assert "기록했어요" in label and state.writes == []
    state.assist_reply = happy_reply()
    ctx.close()


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), QuietHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    state = State()
    print("=" * 60)
    print(f"qa_runner_batch_assist.py 시작 (PORT={PORT})")
    print("=" * 60)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            for t in (test_ac1_pc_happy_path, test_ac2_unchecked_line, test_ac3_conflict, test_ac4_no_delete,
                      test_ac5_errors, test_ac6_mobile, test_ac7_unverified_pc, test_ac8_ac9_ac10, test_ac11_without_ai_folder,
                      test_ac12_deduct_current_step_and_lot_cap, test_ac13_flag_wrong_result):
                state.writes.clear()
                t(browser, state)
            print(f"\n  * 페이지 오류 {len(state.page_errors)}건, Google 직접 호출 {len(state.google_hits)}건")
            assert state.page_errors == [], state.page_errors
            assert state.google_hits == []
            print("\n=== RESULT: ALL AC TESTS PASSED ===")
        finally:
            browser.close()
            server.shutdown()


if __name__ == "__main__":
    main()
