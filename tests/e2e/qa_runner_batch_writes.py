"""
qa_runner_batch_writes.py - 배치 목록 쓰기 E2E
서버의 배치 행(current_batches)을 상태로 흉내 낸다: 읽으면 지금 목록을 주고, 쓰면 받은 목록으로 바뀐다.
실패해도 멈추지 않고 모든 항목을 돈 뒤, 하나라도 실패면 종료 코드 1.
"""
import copy
import json
import os
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright

import qa_runner_common

PORT = qa_runner_common.free_port()
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))  # 저장소 맨 위 폴더
WORKER = {"id": 1, "name": "김작업", "display": "김작업"}
MOBILE_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36"
FAILS = []
PAGE_ERRORS = []


class QuietHandler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=qa_runner_common.SITE_ROOT, **k)
    def log_message(self, fmt, *a): pass


def batch(lot, zone, **extra):
    return {"lotNumber": lot, "manualZone": zone, "assignedZone": zone, "createdAt": "2026-11-01T00:00:00.000Z", **extra}


class State:
    def __init__(self, batches):
        self.server = copy.deepcopy(batches)
        self.writes = []
        self.other_writes = []
        self.other_rows = []  # batches 표의 다른 행(템플릿 등) 쓰기
        self.ac_jobs = []  # 서버에 있는 장비 예약

    def lots(self):
        return [b["lotNumber"] for b in self.server]

    def zone(self, lot):
        return next((b.get("manualZone") for b in self.server if b["lotNumber"] == lot), None)


def handle(route, state):
    req, url = route.request, route.request.url
    if "/rest/v1/batches" in url:
        if req.method in ("POST", "PUT", "PATCH"):
            body = json.loads(req.post_data or "{}")
            if body.get("id") == "current_batches":
                state.writes.append(copy.deepcopy(body["data"]))
                state.server = copy.deepcopy(body["data"])
            else:
                state.other_rows.append(copy.deepcopy(body))
            return route.fulfill(status=201, content_type="application/json", body="{}")
        if "current_batches" in url:
            return route.fulfill(status=200, content_type="application/json", body=json.dumps({"id": "current_batches", "data": state.server}))
        return qa_runner_common.fallback(route)
    if "equipment_jobs" in url and req.method == "GET":
        return route.fulfill(status=200, content_type="application/json", body=json.dumps(state.ac_jobs))
    if "equipment_templates" in url and req.method == "GET":
        return route.fulfill(status=200, content_type="application/json", body=json.dumps([{"id": 1, "name": "QA", "duration_minutes": 30, "notify_worker_ids": []}]))
    if req.method in ("POST", "PUT", "PATCH", "DELETE"):
        state.other_writes.append(url)
        return route.fulfill(status=201, content_type="application/json", body="{}")
    return qa_runner_common.fallback(route)


def check(name, ok, detail):
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}: {detail}")
    if not ok:
        FAILS.append(name)


def open_page(browser, state, mobile=False):
    """한 PC(또는 폰): 열 때의 서버 목록이 이 탭의 localStorage가 된다. 실시간은 막혀 있어 다른 기기의 변경을 모른다."""
    if mobile:
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, user_agent=MOBILE_UA, is_mobile=True, has_touch=True)
    else:
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    page.on("pageerror", lambda e: PAGE_ERRORS.append(str(e)))
    page.route("**/*", lambda r: handle(r, state))
    qa_runner_common.block_realtime(page)
    page.add_init_script(
        "if (window === window.top) {"
        f"localStorage.setItem('APP_BATCH_RECORDS', JSON.stringify({json.dumps(state.server)}));"
        f"localStorage.setItem('APP_VERIFIED_OPERATOR', JSON.stringify({json.dumps(WORKER)}));"
        "}")
    page.goto(f"http://127.0.0.1:{PORT}/index.html?qa=true{'#m=batch' if mobile else ''}", wait_until="domcontentloaded")
    page.wait_for_function("() => document.querySelectorAll(%r).length > 0" % (".m-card[data-lot]" if mobile else ".batch-chip"))
    page.wait_for_timeout(800)
    return ctx, page


def drop(page, lot, zone):
    page.evaluate("""([lot, zone]) => {
        const cell = document.querySelector(`.zone-cell[data-zone-id="${zone}"]`);
        const ev = new Event('drop', { bubbles: true, cancelable: true });
        ev.dataTransfer = { getData: () => lot };
        cell.dispatchEvent(ev);
    }""", [lot, zone])


def toast(page):
    return page.evaluate("() => document.getElementById('floorplan-toast')?.textContent || ''")


def open_form(page, lot=None):
    """배치 등록 창을 연다. 메인 창 안에 바로 뜨므로 조작은 page에 한다."""
    page.evaluate("lot => openBatchScheduleModal(lot)", lot)
    page.wait_for_selector("#batch-schedule-modal #inp-lot")
    page.wait_for_timeout(150)
    return page


def submit_form(page, frame, wait_ms=1200):
    frame.click("#btn-submit")
    page.wait_for_timeout(wait_ms)


def modal_open(page):
    return page.evaluate("() => document.getElementById('batch-schedule-modal').open")


def frame_toast(frame):
    return frame.evaluate("() => document.getElementById('toast').textContent")


def test_two_writers_keep_each_other(browser):
    print("\n--- [단위 3] PC B가 새 배치를 만든 뒤, 목록이 오래된 PC A가 다른 배치를 옮겨도 B의 배치가 남는다 ---")
    state = State([batch("LOT-A1", "stage1-wait"), batch("LOT-A2", "packaging")])
    ctx_a, a = open_page(browser, state)
    ctx_b, b = open_page(browser, state)
    frame = open_form(b)
    frame.fill("#inp-lot", "LOT-B1")
    submit_form(b, frame)
    check("B 등록 서버 반영", "LOT-B1" in state.lots(), f"서버 로트={state.lots()}")
    drop(a, "LOT-A1", "stage5-wait")
    a.wait_for_timeout(1200)
    check("A 이동 뒤에도 B 배치 유지", "LOT-B1" in state.lots() and state.zone("LOT-A1") == "stage5-wait",
          f"서버 로트={state.lots()}, LOT-A1 위치={state.zone('LOT-A1')}")
    ctx_a.close(); ctx_b.close()


def test_form_create_and_delete_through_main(browser):
    print("\n--- [단위 3] 배치 등록 화면의 등록·삭제는 메인이 서버에 한 번만 쓴다 ---")
    state = State([batch("LOT-1", "stage1-wait"), batch("LOT-2", "packaging")])
    ctx, page = open_page(browser, state)
    state.server.append(batch("LOT-OTHER", "inspection"))
    frame = open_form(page)
    frame.fill("#inp-lot", "LOT-NEW")
    submit_form(page, frame)
    check("등록 쓰기 1회", len(state.writes) == 1, f"쓰기 {len(state.writes)}회")
    check("등록 결과", state.lots()[:1] == ["LOT-NEW"] and "LOT-OTHER" in state.lots() and not modal_open(page),
          f"서버 로트={state.lots()}, 창 열림={modal_open(page)}")
    state.writes.clear()
    frame = open_form(page, "LOT-2")
    page.once("dialog", lambda d: d.accept())
    frame.click("#btn-delete")
    page.wait_for_timeout(1200)
    check("삭제 쓰기 1회", len(state.writes) == 1, f"쓰기 {len(state.writes)}회")
    check("삭제 결과", "LOT-2" not in state.lots() and "LOT-OTHER" in state.lots() and "LOT-NEW" in state.lots(),
          f"서버 로트={state.lots()}")
    ctx.close()


def test_render_does_not_write(browser):
    print("\n--- [단위 3] 화면을 그리는 것만으로는 서버에 쓰지 않는다 ---")
    state = State([batch("LOT-WH", "logistics"), batch("LOT-1", "stage1-wait")])
    ctx, page = open_page(browser, state)
    page.wait_for_timeout(1500)
    check("그리기 중 쓰기 0회", not state.writes, f"쓰기 {len(state.writes)}회")
    ctx.close()


def test_single_form_frame_gets_operator(browser):
    print("\n--- [단위 3] 배치 등록 화면은 iframe 없이 메인 창 안에 뜨고, 같은 작업자를 쓴다 ---")
    state = State([batch("LOT-1", "stage1-wait")])
    ctx, page = open_page(browser, state)
    open_form(page)
    loaded = [f.url for f in page.frames if "sub_batches" in f.url]
    check("배치 등록 iframe 없음", not loaded and page.locator("#batch-schedule-modal iframe").count() == 0, f"불러온 화면={loaded}")
    who = page.evaluate("() => window.currentUserEmail")
    check("작업자", "김작업" in who, f"작업자='{who}'")
    ctx.close()


def test_form_lot_rules(browser):
    print("\n--- [단위 4] 배치 등록 창: 같은 로트는 거부, 이름 바꾸기는 위치 유지, 특수문자 로트는 그대로 저장 ---")
    state = State([batch("LOT-1", "stage1-wait"), batch("LOT-2", "packaging")])
    ctx, page = open_page(browser, state)
    frame = open_form(page)
    frame.fill("#inp-lot", "LOT-1")
    submit_form(page, frame)
    msg = frame_toast(frame)
    check("같은 로트 등록 거부", "이미 있는 로트넘버" in msg and not state.writes and modal_open(page),
          f"토스트='{msg}', 쓰기 {len(state.writes)}회, 창 열림={modal_open(page)}, 서버 로트={state.lots()}")
    page.evaluate("closeBatchScheduleModal()")
    frame = open_form(page, "LOT-2")
    frame.fill("#start-A", "11010800")
    frame.fill("#inp-lot", "LOT-1")
    submit_form(page, frame)
    msg = frame_toast(frame)
    check("같은 로트로 이름 바꾸기 거부", "이미 있는 로트넘버" in msg and not state.writes,
          f"토스트='{msg}', 쓰기 {len(state.writes)}회, 서버 로트={state.lots()}")
    frame.fill("#inp-lot", "LOT-3")
    submit_form(page, frame)
    check("이름 바꾸기", state.lots() == ["LOT-1", "LOT-3"] and state.zone("LOT-3") == "packaging",
          f"서버 로트={state.lots()}, LOT-3 위치={state.zone('LOT-3')}")
    frame = open_form(page)
    frame.fill("#inp-lot", "PA/2604 (A)#1")
    submit_form(page, frame)
    check("특수문자 로트 그대로 저장", "PA/2604 (A)#1" in state.lots(), f"서버 로트={state.lots()}")
    ctx.close()


RAW_REMARK = "a & b / 'c' <d> \"e\""
ESC_REMARK = "a &amp; b &#x2F; &#x27;c&#x27; &lt;d&gt; &quot;e&quot;"


def saved_remark(state, lot):
    return next(b for b in state.server if b["lotNumber"] == lot).get("remarks", {}).get("C")


def test_remarks_round_trip(browser):
    print("\n--- [단위 5] 비고 특수문자: PC·모바일에서 두 번 저장해도 한 번 변환된 그대로 ---")
    state = State([batch("LOT-R", "packaging", overallStartCode="11010800", remarks={"C": ESC_REMARK})])
    ctx, page = open_page(browser, state)
    for i in (1, 2):
        frame = open_form(page, "LOT-R")
        shown = frame.input_value("#remarks-C")
        submit_form(page, frame)
        check(f"PC {i}회째 저장", shown == RAW_REMARK and saved_remark(state, "LOT-R") == ESC_REMARK,
              f"입력칸='{shown}', 저장='{saved_remark(state, 'LOT-R')}'")
    ctx.close()
    ctx, page = open_page(browser, state, mobile=True)
    for i in (1, 2):
        page.click(".m-card[data-lot='LOT-R']")
        page.click("#m-batch-edit-btn")
        shown = page.input_value("#m-edit-remarks-C")
        page.click("#m-batch-edit-save")
        page.wait_for_timeout(1200)
        check(f"모바일 {i}회째 저장", shown == RAW_REMARK and saved_remark(state, "LOT-R") == ESC_REMARK,
              f"입력칸='{shown}', 저장='{saved_remark(state, 'LOT-R')}', 쓰기 {len(state.writes)}회")
        page.goto(page.url.split("#")[0] + "#m=batch")
        page.wait_for_selector(".m-card[data-lot='LOT-R']")
    ctx.close()


def test_quick_drops_both_saved(browser):
    print("\n--- [단위 2] 한 탭에서 0.25초 안에 두 번 옮겨도 둘 다 서버에 저장 ---")
    state = State([batch("LOT-1", "stage1-wait"), batch("LOT-2", "stage1-wait")])
    ctx, page = open_page(browser, state)
    drop(page, "LOT-1", "stage5-wait")
    drop(page, "LOT-2", "inspection")
    page.wait_for_timeout(1500)
    check("연속 이동 저장", state.zone("LOT-1") == "stage5-wait" and state.zone("LOT-2") == "inspection",
          f"서버 위치 LOT-1={state.zone('LOT-1')}, LOT-2={state.zone('LOT-2')}, 쓰기 {len(state.writes)}회")
    ctx.close()


def test_overflow_is_shown(browser):
    print("\n--- [단위 2] 50개를 넘어 저장이 거부되면 화면에 이유를 보여 준다 ---")
    state = State([batch(f"LOT-{i:02d}", "stage1-wait") for i in range(51)])
    ctx, page = open_page(browser, state)
    drop(page, "LOT-00", "stage5-wait")
    page.wait_for_timeout(800)
    msg = toast(page)
    check("50개 초과 안내", "50개" in msg and not state.writes, f"토스트='{msg}', 쓰기 {len(state.writes)}회")
    ctx.close()
    state = State([batch(f"LOT-{i:02d}", "stage1-wait") for i in range(50)])
    ctx, page = open_page(browser, state)
    frame = open_form(page)
    frame.fill("#inp-lot", "LOT-51")
    submit_form(page, frame)
    msg = frame_toast(frame)
    check("51번째 등록 거부", "50개" in msg and not state.writes and len(state.server) == 50 and modal_open(page),
          f"토스트='{msg}', 쓰기 {len(state.writes)}회, 서버 {len(state.server)}개")
    ctx.close()


def test_drop_in_place_and_rewarehouse(browser):
    print("\n--- [단위 2] 제자리 놓기는 쓰지 않고, 창고에 다시 입고해도 원래 위치를 지킨다 ---")
    state = State([batch("LOT-1", "stage5-wait")])
    ctx, page = open_page(browser, state)
    drop(page, "LOT-1", "stage5-wait")
    page.wait_for_timeout(800)
    check("제자리 놓기 쓰기 0회", not state.writes, f"쓰기 {len(state.writes)}회")
    page.evaluate("() => moveBatchToFinishedWarehouse('LOT-1')")
    page.wait_for_timeout(800)
    page.evaluate("() => moveBatchToFinishedWarehouse('LOT-1')")
    page.wait_for_timeout(800)
    b = state.server[0]
    check("다시 입고해도 원래 위치 유지", b.get("manualZone") == "logistics" and b.get("prevZoneBeforeLogistics") == "stage5-wait" and len(state.writes) == 1,
          f"위치={b.get('manualZone')}, 원래 위치={b.get('prevZoneBeforeLogistics')}, 쓰기 {len(state.writes)}회, 토스트='{toast(page)}'")
    ctx.close()


def test_equipment_overlap_rejected(browser):
    print("\n--- [단위 2] PC 장비: 겹치는 예약과 일자 00은 등록하지 않는다 ---")
    state = State([batch("LOT-1", "stage5-wait")])
    ctx, page = open_page(browser, state)
    # 화면 시계(QA 가짜 날짜)로 1시간 뒤~2시간 뒤 예약을 서버에 두고 다시 읽게 한다
    at = page.evaluate("""() => [1, 2].map(h => { const d = new Date(Date.now() + h * 3600000), p = n => String(n).padStart(2, '0'); return p(d.getDate()) + p(d.getHours()) + p(d.getMinutes()); })""")
    state.ac_jobs = [{"id": 9, "start_code": at[0], "end_code": at[1]}]
    page.evaluate("() => { window.startEquipmentJobs(); window.openEquipmentModal('new'); }")
    page.wait_for_function("() => document.getElementById('ac-jobs-count')?.textContent === '1'")
    starts = [at[0], '001200']
    page.wait_for_selector("#ac-template-options input[name=ac-setting-type]:checked")
    msgs = []
    for start in starts:
        page.fill("#ac-inp-start-code", start)
        page.click("#btn-ac-submit-job")
        msgs.append(page.text_content("#floorplan-toast") or "")
    ac_writes = [u for u in state.other_writes if "equipment_jobs" in u]
    check("겹침·일자 00 거부", "겹칩" in msgs[0] and "시작" in msgs[1] and not ac_writes, f"토스트={msgs}, 등록 {len(ac_writes)}회")
    ctx.close()


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), QuietHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        test_quick_drops_both_saved(browser)
        test_overflow_is_shown(browser)
        test_drop_in_place_and_rewarehouse(browser)
        test_equipment_overlap_rejected(browser)
        test_two_writers_keep_each_other(browser)
        test_form_create_and_delete_through_main(browser)
        test_render_does_not_write(browser)
        test_single_form_frame_gets_operator(browser)
        test_form_lot_rules(browser)
        test_remarks_round_trip(browser)
        browser.close()
    check("페이지 오류 0", not PAGE_ERRORS, f"{PAGE_ERRORS[:3]}")
    server.shutdown()
    if FAILS:
        print(f"\n=== 실패 {len(FAILS)}건: {FAILS} ===")
        sys.exit(1)
    print("\n=== qa_runner_batch_writes ALL PASSED ===")


if __name__ == "__main__":
    main()
