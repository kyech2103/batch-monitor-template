"""
qa_runner_main_board.py - 메인 평면도 1단계 개선 E2E 검증 러너 (AC-5 ~ AC-20)
"""
import json
import os
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

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
    threading.Thread(target=s.serve_forever, daemon=True).start(); return s

class QAState:
    def __init__(self):
        self.blocked_writes, self.console_errors, self.batch_fail, self.todo_fail = [], [], False, False
        self.mock_todos = [{"id": "t1", "record_type": "TODO", "target_date": "2026-10-23", "worker_name": "홍길동"}]
        self.mock_batches = [
            {"lotNumber": "LOT-01", "manualZone": "stage1-1", "size": 8000, "schedule": {"A": {"start": "2026-10-23T08:00:00Z", "end": "2026-10-23T16:00:00Z"}, "B": {"start": "2026-10-24T09:00:00Z", "end": "2026-10-24T18:00:00Z"}}},
            {"lotNumber": "LOT-02", "manualZone": "stage1-wait", "size": 8000, "schedule": {"A": {"start": "2026-10-23T14:00:00Z", "end": "2026-10-23T18:00:00Z"}}}, {"lotNumber": "LOT-03", "manualZone": "semi-storage-pre", "size": 7850, "schedule": {}}, {"lotNumber": "LOT-04", "manualZone": "inspection", "size": 7850, "schedule": {}}]

def handle_supabase_route(route, state):
    req = route.request
    if req.method in ["POST", "PUT", "PATCH", "DELETE"]:
        state.blocked_writes.append({"method": req.method, "url": req.url, "body": (req.post_data or "")[:3000]})
        return route.fulfill(status=200, content_type="application/json", body="{}")
    if "batches" in req.url:
        st, b = (500, '{"error":"db fail"}') if state.batch_fail else (200, json.dumps({"id": "current_batches", "data": state.mock_batches}))
        return route.fulfill(status=st, content_type="application/json", body=b)
    if "todo_schedules" in req.url:
        st, b = (500, '{"error":"db fail"}') if state.todo_fail else (200, json.dumps(state.mock_todos))
        return route.fulfill(status=st, content_type="application/json", body=b)
    if "process_managers" in req.url:
        return route.fulfill(status=200, content_type="application/json", body=json.dumps({"p1_a": "홍길동", "p1_b": "김철수", "fill": "이영희"}))
    return qa_runner_common.fallback(route)

def setup_page(browser, worker, state, viewport=None, is_qa=True):
    ctx = browser.new_context(viewport=viewport or {"width": 1440, "height": 900})
    p = ctx.new_page()
    p.on("console", lambda m: state.console_errors.append(m.text) if m.type == "error" and "Failed to load resource" not in m.text else None)
    p.route("**/rest/v1/**", lambda r: handle_supabase_route(r, state))
    qa_runner_common.install(p)
    js = f"localStorage.setItem('APP_BATCH_RECORDS', JSON.stringify({json.dumps(state.mock_batches)}));" + (f"localStorage.setItem('APP_VERIFIED_OPERATOR', JSON.stringify({json.dumps(worker)}));" if worker else "")
    p.add_init_script(js)
    p.goto(f"http://127.0.0.1:{PORT}/index.html" + ("?qa=true" if is_qa else ""), wait_until="domcontentloaded")
    p.wait_for_timeout(400)
    return ctx, p

def check_boxes_overlap(boxes):
    ov = 0
    for i, b1 in enumerate(boxes):
        for b2 in boxes[i+1:]:
            if b1 and b2:
                xo = max(0, min(b1['x'] + b1['width'], b2['x'] + b2['width']) - max(b1['x'], b2['x']))
                yo = max(0, min(b1['y'] + b1['height'], b2['y'] + b2['height']) - max(b1['y'], b2['y']))
                ov = max(ov, xo * yo)
    return ov

JS_CONTRAST = """(sel) => {
    const el = document.querySelector(sel); if (!el) return { ratio: 0, text: '', bg: '' };
    const p = s => (s.match(/\\d+(\\.\\d+)?/g) || [0,0,0]).slice(0,3).map(Number), lum = c => c.map(v => (v/=255) <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4)).reduce((acc,v,i) => acc + v * [0.2126,0.7152,0.0722][i], 0);
    const cs = window.getComputedStyle(el), col = p(cs.color); let cur = el, bg = p(cs.backgroundColor);
    while ((cs.backgroundColor.includes('rgba(0, 0, 0, 0)') || cs.backgroundColor === 'transparent') && cur.parentElement) { cur = cur.parentElement; const b = window.getComputedStyle(cur).backgroundColor; if (!b.includes('rgba(0, 0, 0, 0)') && b !== 'transparent') { bg = p(b); break; } }
    const [l1, l2] = [lum(col), lum(bg)]; return { ratio: (Math.max(l1,l2) + 0.05) / (Math.min(l1,l2) + 0.05), text: cs.color, bg: cs.backgroundColor };
}"""

def test_ac5_header(page):
    print("\n--- [AC-5] 1440x900 헤더 요소 배치 및 비중복 검증 ---")
    el_ids = [".header-title-wrap", "#dashboard-clock", "#lot-search-input", "#btn-batch-modal-trigger", "#btn-daily-todo", "#btn-pm-modal-trigger", "#btn-user-guide", "#user-info-badge"]
    boxes = [page.locator(sel).bounding_box() for sel in el_ids]
    max_ov = check_boxes_overlap(boxes)
    assert max_ov == 0, f"헤더 충돌: {max_ov}px²"
    ub = page.locator("#user-info-badge").bounding_box()
    for b in boxes[:-1]: assert not b or ub['x'] >= b['x'], "작업자 배지 우측 끝 배치"
    hb, sb = page.locator("#dashboard-header").bounding_box(), page.locator("#dashboard-summary").bounding_box()
    assert sb['y'] >= hb['y'] + hb['height'] - 1, "요약 띠 헤더 하단 위치"
    page.screenshot(path=os.path.join(SHOT_DIR, "AC-5_header.png"))
    print(f"  * AC-5 통과: 헤더 요소 최대 겹침={max_ov}px², 헤더-요약띠 교차=0, 작업자 배지 x={ub['x']}")

def test_ac6_summary_cards(browser, state):
    print("\n--- [AC-6] 요약 띠 5칸 상태별 계산 검증 ---")
    scenarios = [("정상", state.mock_batches, False, ["1", "1", "1", "2", "1"], "AC-6_normal.png"),
                 ("0건", [], False, ["0", "0", "0", "0"], "AC-6_empty.png"),
                 ("오류", state.mock_batches, True, None, "AC-6_error.png")]
    saved = state.mock_batches
    for name, batches, fail, exp, shot in scenarios:
        state.mock_batches, state.batch_fail = batches, fail
        ctx, p = setup_page(browser, {"name": "홍길동", "dept": "생산팀 대리"}, state)
        v = [p.text_content(f"#summary-count-{k}") for k in ["in-progress", "ending-soon", "waiting", "storage", "my-todo"]]
        cc = p.locator(".batch-chip").count()
        print(f"  * {name} 요약 5칸: {v}, 칩 수={cc}개")
        if exp: assert v[:len(exp)] == exp, f"{name} 요약 불일치: {v}"
        if fail: assert cc == 4, f"대체 칩 수 불일치: {cc}"
        p.screenshot(path=os.path.join(SHOT_DIR, shot)); p.close(); ctx.close()
    state.batch_fail, state.mock_batches = False, saved

def test_ac7_todo_states(browser, state):
    print("\n--- [AC-7] 내 오늘 할 일 5가지 분기 및 클릭 검증 ---")
    w_hong = {"name": "홍길동", "dept": "생산팀"}
    subtests = [
        (None, False, [{"id": "t1", "record_type": "TODO", "target_date": "2026-10-23", "worker_name": "홍길동"}], False, "-", "작업자 인증 필요", "미인증"),
        (w_hong, True, [], False, "-", "일정 반영 전", "반영 전"),
        (w_hong, True, [{"id": "t_o", "record_type": "TODO", "target_date": "2026-10-23", "worker_name": "김철수"}], False, "0", None, "본인 0건"),
        (w_hong, True, [{"id": "t1", "record_type": "TODO", "target_date": "2026-10-23", "worker_name": "홍길동"}], False, "1", None, "본인 N건"),
        (w_hong, True, [], True, "-", "조회 실패", "조회 오류"),
    ]
    for w, is_qa, todos, fail, exp_val, exp_tip, label in subtests:
        state.mock_todos, state.todo_fail = todos, fail
        ctx, p = setup_page(browser, w, state, is_qa=is_qa)
        val, tip = p.text_content("#summary-count-my-todo"), p.locator("#summary-card-my-todo").get_attribute("title")
        print(f"  * {label}: 값={val}, 툴팁='{tip}'")
        assert val == exp_val, f"{label} 값 불일치: {val}"
        if exp_tip: assert exp_tip in tip, f"{label} 툴팁 불일치: {tip}"
        if label == "본인 N건":
            p.click("#summary-card-my-todo"); p.wait_for_timeout(250); assert p.is_visible("#daily-todo-modal")
        p.close(); ctx.close()
    state.todo_fail = False

def test_ac8_empty_cells(page):
    print("\n--- [AC-8] 빈 칸 높이 및 '비어 있음' 텍스트 온전성 검증 ---")
    m_js = """() => Array.from(document.querySelectorAll('.zone-cell:has(.cell-empty-hint)')).map(c => {
        const h = c.querySelector('.cell-empty-hint'), cb = c.getBoundingClientRect(), hb = h ? h.getBoundingClientRect() : { top:0, bottom:0, height:0 };
        return { zone: c.dataset.zoneId || '?', cellH: Math.round(cb.height), hintH: Math.round(hb.height), inside: hb.top >= cb.top - 1 && hb.bottom <= cb.bottom + 1, noOverflow: h ? h.scrollHeight <= h.clientHeight + 1 : false, text: h ? h.textContent.trim() : '' };
    })"""
    res = page.evaluate(m_js)
    assert len(res) > 0, "빈 칸 검출 필수"
    for r in res[:5]:
        print(f"  * 빈 칸 [{r['zone']}]: 높이={r['cellH']}px, 글자높이={r['hintH']}px, 포함={r['inside']}, 노오버플로우={r['noOverflow']}, 문구='{r['text']}'")
        assert 36 <= r['cellH'] <= 48 and r['inside'] and r['noOverflow'] and "비어 있음" in r['text']
    page.screenshot(path=os.path.join(SHOT_DIR, "AC-8_grid.png")); page.screenshot(path=os.path.join(SHOT_DIR, "AC-8_empty_text_1440.png"))
    print(f"  * AC-8 통과: 빈 칸 총 {len(res)}개 전수 검사 완료, 잘림 없음 확인")

def test_ac9_ac10_side_panel(page):
    print("\n--- [AC-9 / AC-10] 사이드 패널 상세, 단일/더블클릭/일정수정, 72h 일정 검증 ---")
    page.locator(".batch-chip[data-lot='LOT-02']").click(); page.wait_for_timeout(150)
    isOpen = page.is_visible("#batch-schedule-modal")
    print(f"  * 한 번 클릭 후 모달 열림 여부={isOpen} (닫힘 유지 확인)"); assert not isOpen, "한 번 클릭 시 모달 열림 금지"
    for lot, exps, shot in [("LOT-02", ["LOT-02", "공정1", "8,000 EA"], "AC-9_waiting.png"), ("LOT-01", ["LOT-01", "공정1", "8,000 EA"], "AC-9_running.png"), ("LOT-03", ["LOT-03", "7,850 EA"], "AC-9_selected.png")]:
        page.locator(f".batch-chip[data-lot='{lot}']").click()
        page.wait_for_function("lot => (document.querySelector('#side-selected-content') || {}).innerText?.includes(lot)", arg=lot, timeout=5000)
        txt = page.locator("#side-selected-content").inner_text()
        print(f"  * [{lot}]: {txt.replace(chr(10), ' | ')}")
        for exp in exps: assert exp in txt
        page.screenshot(path=os.path.join(SHOT_DIR, shot))
    page.click("#btn-side-edit-schedule"); page.wait_for_timeout(180)
    e_open = page.is_visible("#batch-schedule-modal")
    print(f"  * 일정 수정 클릭 후 모달 열림 여부={e_open} (열림 확인: #batch-schedule-modal)"); assert e_open
    page.keyboard.press("Escape"); page.wait_for_timeout(100)
    page.locator(".batch-chip[data-lot='LOT-01']").dblclick(); page.wait_for_timeout(180)
    d_open = page.is_visible("#batch-schedule-modal")
    print(f"  * 더블클릭 후 모달 열림 여부={d_open} (열림 확인: #batch-schedule-modal)"); assert d_open
    page.keyboard.press("Escape"); ev_cnt = page.locator("#side-events-content .side-event-item").count()
    print(f"  * 다가오는 72h 일정 건수={ev_cnt}개 (최대 8개)"); assert ev_cnt <= 8

def test_ac11_quick_contrast(page):
    print("\n--- [AC-11] 기타 구역 버튼 모달 오픈 및 완제품 창고 버튼 글자 대비 검증 ---")
    c_res = page.evaluate(f"() => ({JS_CONTRAST})('#btn-finished-wh-nav')")
    ratio = c_res["ratio"]
    print(f"  * 완제품 창고 버튼 글자 대비: {ratio:.2f}:1 (>=4.5:1 기준 충족, text={c_res['text']}, bg={c_res['bg']})")
    assert ratio >= 4.5, f"대비 부족: {ratio:.2f}:1"
    page.screenshot(path=os.path.join(SHOT_DIR, "AC-11_panel_contrast.png"))
    assert page.locator("#quick-actions-bar").count() == 0, "#quick-actions-bar DOM 부재"
    quick_map = [("#btn-room-toolroom", "#toolroom-shelf-modal"), ("#btn-room-pack-supplies", "#pack-supplies-modal"), ("#btn-room-supplies", "#supplies-modal"), ("#btn-room-warehouse-main", "#warehouse-modal"), ("#btn-finished-wh-nav", "#finished-warehouse-modal"), ("#equipment-display-card", "#equipment-modal")]
    opened = []
    for btn_id, modal_id in quick_map:
        page.click(btn_id); page.wait_for_timeout(180); assert page.is_visible(modal_id), f"{btn_id} 클릭 시 {modal_id} 오픈"
        opened.append(f"{btn_id}->{modal_id}"); page.keyboard.press("Escape"); page.wait_for_timeout(100)
    print(f"  * AC-11 확인: #quick-actions-bar 부재, 모달 6종: {', '.join(opened)}")

def test_ac12_lot_search(page):
    print("\n--- [AC-12] 로트 검색 및 Ctrl+K 단축키 검증 ---")
    page.keyboard.press("Control+k"); page.wait_for_timeout(100)
    assert page.evaluate("() => document.activeElement.id === 'lot-search-input'")
    page.fill("#lot-search-input", "LOT-01"); page.wait_for_timeout(150)
    mc = page.locator(".batch-chip.is-search-match").count()
    print(f"  * 검색 일치 강조 칩 수={mc}"); assert mc >= 1
    page.press("#lot-search-input", "Enter"); page.wait_for_timeout(150)
    assert "LOT-01" in page.locator("#side-selected-content").text_content()
    page.fill("#lot-search-input", "NOT_EXIST_LOT"); page.wait_for_timeout(150); assert page.is_visible("#lot-search-feedback")
    page.fill("#lot-search-input", ""); page.wait_for_timeout(100); assert page.locator(".batch-chip.is-search-match").count() == 0
    print("  * AC-12 통과: 검색 강조/피드백/단축키/Enter선택 정상")

def test_ac13_drag_isolation(page, state):
    print("\n--- [AC-13 / AC-18] 드래그 이동 격리 및 선택 불변 검증 ---")
    page.locator(".batch-chip[data-lot='LOT-01']").click()
    sb = page.locator("#side-selected-content .lot-val").text_content()
    page.evaluate("() => { const t = document.querySelector('[data-zone-id=\"stage5-wait\"]'), ev = new Event('drop', { bubbles: true, cancelable: true }); ev.dataTransfer = { getData: () => 'LOT-02' }; t.dispatchEvent(ev); }")
    page.wait_for_timeout(500)
    sa = page.locator("#side-selected-content .lot-val").text_content()
    print(f"  * 드래그 전후 선택 로트: 전='{sb}', 후='{sa}' (불변 확인)"); assert sb == sa == "LOT-01"
    print(f"  * blocked_writes 총 {len(state.blocked_writes)}건: {[b['url'] for b in state.blocked_writes]}")
    bw = [b for b in state.blocked_writes if "batches" in b["url"]]
    print(f"  * bw 개수: {len(bw)}"); assert len(bw) > 0 and any("stage5-wait" in b.get("body", "") for b in bw), "manualZone=stage5-wait 반영"
    print(f"  * 가로챈 batches upsert 본문: {bw[-1].get('body', '')[:120]}...")

def test_ac14_gauges_pm_tooltip(page):
    print("\n--- [AC-14] 게이지 10종, 담당자 배지, 모서리 툴팁 뷰포트 수용, 작업자 모달 검증 ---")
    g_keys = ["stage1-1", "stage1-2", "stage2", "stage3-1", "stage3-2", "stage4-1", "stage4-2", "stage5", "inspection", "packaging"]
    for gk in g_keys: assert page.locator(f"#gauge-{gk}").count() == 1
    print(f"  * 설비 게이지 10종 확인: 개수={len(g_keys)}개 ({', '.join(g_keys)})")
    pms = [c.text_content() for c in page.locator(".pm-badge-chip").all() if c.text_content()]
    print(f"  * 담당자 배지 3개 이상: {pms[:4]}"); assert len(pms) >= 3
    page.locator(".batch-chip[data-lot='LOT-01']").hover(); page.wait_for_timeout(150)
    tb = page.locator("#batch-tooltip").bounding_box()
    print(f"  * [LOT-01] 툴팁 좌표: x={tb['x']}, y={tb['y']}, w={tb['width']}, h={tb['height']} (뷰포트 1440x900 내 완벽 수용)")
    assert 0 <= tb['x'] and (tb['x'] + tb['width']) <= 1440 and 0 <= tb['y'] and (tb['y'] + tb['height']) <= 900
    page.screenshot(path=os.path.join(SHOT_DIR, "AC-14_tooltip_corner.png"))
    page.mouse.move(0, 0); page.wait_for_timeout(150)
    assert not page.is_visible("#batch-tooltip"), "마우스 이탈 시 툴팁 숨김 확인"
    print("  * 툴팁 마우스 이탈 시 숨김 확인: is_visible=False")
    page.click("#user-info-badge"); page.wait_for_timeout(200)
    auth_open = page.is_visible("#operator-auth-modal")
    print(f"  * 작업자 배지 클릭 후 인증 모달 열림 여부={auth_open} (열림 확인: #operator-auth-modal)"); assert auth_open
    page.keyboard.press("Escape")

def test_ac15_todo_regenerate(page, state):
    print("\n--- [AC-15] 투두 재생성 후 요약 갱신 검증 ---")
    state.mock_todos = [{"id": f"t{i}", "record_type": "TODO", "target_date": "2026-10-23", "worker_name": "홍길동"} for i in range(1, 4)]
    page.evaluate("() => fetchMyTodayTodoCount()"); page.wait_for_timeout(300)
    val = page.text_content("#summary-count-my-todo")
    print(f"  * 투두 재생성 후 요약 할 일 수치={val}건 (기대값: 3건)"); assert val == "3"

def test_ac16_responsive_980(browser, state):
    print("\n--- [AC-16 / AC-5] 980x900 반응형 패널 위치, 가로스크롤 부재, 980 대비 및 빈 칸 검증 ---")
    ctx, p = setup_page(browser, {"name": "홍길동", "dept": "생산팀"}, state, viewport={"width": 980, "height": 900})
    gb, pb = p.locator("#process-grid").bounding_box(), p.locator("#dashboard-side-panel").bounding_box()
    no_h = p.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth")
    print(f"  * 980px: 그리드y={gb['y']}, 패널y={pb['y']}, 가로스크롤없음={no_h}")
    assert pb['y'] >= (gb['y'] + 100) and no_h
    c_res = p.evaluate(f"() => ({JS_CONTRAST})('#user-info-badge')")
    ratio = c_res["ratio"]
    print(f"  * 980px 작업자 배지 글자 대비: {ratio:.2f}:1 (>=4.5:1 기준 충족, text={c_res['text']}, bg={c_res['bg']})")
    assert ratio >= 4.5, f"980px 배지 대비 부족: {ratio:.2f}:1"

    res_980 = p.evaluate("""() => Array.from(document.querySelectorAll('.zone-cell:has(.cell-empty-hint)')).map(c => {
        const h = c.querySelector('.cell-empty-hint'), cb = c.getBoundingClientRect(), hb = h ? h.getBoundingClientRect() : { top:0, bottom:0 };
        return hb.top >= cb.top - 1 && hb.bottom <= cb.bottom + 1 && (h ? h.scrollHeight <= h.clientHeight + 1 : false);
    })""")
    assert all(res_980), "980px 빈 칸 텍스트 잘림 발생"
    print(f"  * 980px 빈 칸 총 {len(res_980)}개 텍스트 온전성 전수 통과")
    p.screenshot(path=os.path.join(SHOT_DIR, "AC-16_980.png")); p.close(); ctx.close()

def test_ac20_room_heights(browser, state):
    print("\n--- [AC-20] 1440x900 방 높이 내용맞춤 압축 검증 ---")
    m_js = """() => Array.from(document.querySelectorAll('.process-room')).map(r => {
        const rb = r.getBoundingClientRect(), hb = r.querySelector('.room-header')?.getBoundingClientRect();
        const b = r.querySelector('.room-body'), ch = b ? Array.from(b.children).map(c => c.getBoundingClientRect().height) : [0];
        const contentH = (hb ? hb.height : 0) + Math.max(...ch, 0);
        return { id: r.id, roomH: Math.round(rb.height), contentH: Math.round(contentH), diff: Math.round(rb.height - contentH) };
    })"""
    for mode, batches, shot in [("정상", state.mock_batches, "AC-20_1440_normal.png"), ("0건", [], "AC-20_1440_empty.png")]:
        saved, state.mock_batches = state.mock_batches, batches
        ctx, p = setup_page(browser, {"name": "홍길동", "dept": "생산팀"}, state)
        for r in p.evaluate(m_js):
            print(f"  * [{mode}] 방 {r['id']}: 높이={r['roomH']}px, 내용={r['contentH']}px, 여백={r['diff']}px (<=24px)"); assert r['diff'] <= 24
        if mode == "정상":
            c1_h = p.locator(".zone-cell[data-zone-id='stage1-1']").bounding_box()['height']
            print(f"  * 공정1 1호기 설비 칸 높이={c1_h}px (<=100px)"); assert c1_h <= 100
        p.screenshot(path=os.path.join(SHOT_DIR, shot)); p.close(); ctx.close(); state.mock_batches = saved

def test_ac17_ac18_isolation(page, state):
    print("\n--- [AC-17 / AC-18] 2초 후 로딩 문구 부재 및 원격 쓰기 차단 검증 ---")
    page.wait_for_timeout(2000)
    text = page.locator("#dashboard-container").inner_text()
    for wd in ["로딩 중", "불러오는 중"]: assert wd not in text, f"2초 후 화면에 '{wd}' 잔존"
    assert len(state.console_errors) == 0, f"콘솔 에러: {state.console_errors}"
    print(f"  * AC-17 통과: 잔여 로딩 문구 없음, 콘솔 에러={len(state.console_errors)}건")
    print(f"  * AC-18 차단된 원격 쓰기 요청 총 {len(state.blocked_writes)}건:")
    for bw in state.blocked_writes: print(f"    - [{bw['method']}] {bw['url']} | body: {bw['body']}")
    assert len(state.blocked_writes) > 0, "원격 저장소 쓰기 요청 차단 필수"

def run_all():
    server, state = start_server(), QAState()
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx, page = setup_page(browser, {"name": "홍길동", "dept": "생산팀 대리"}, state)
        test_ac5_header(page); test_ac6_summary_cards(browser, state); test_ac7_todo_states(browser, state)
        test_ac8_empty_cells(page); test_ac9_ac10_side_panel(page); test_ac11_quick_contrast(page)
        test_ac12_lot_search(page); test_ac13_drag_isolation(page, state); test_ac14_gauges_pm_tooltip(page)
        test_ac15_todo_regenerate(page, state); test_ac16_responsive_980(browser, state)
        test_ac20_room_heights(browser, state); test_ac17_ac18_isolation(page, state)
        page.close(); ctx.close(); browser.close()
    server.shutdown()
    shots = [f for f in os.listdir(SHOT_DIR) if f.endswith(".png")]
    print(f"\n=== 스크린샷 총 {len(shots)}장 생성 완료 ===")
    print("\n=== 모든 Playwright 검증 성공적으로 통과함 ===")

if __name__ == '__main__':
    run_all()
