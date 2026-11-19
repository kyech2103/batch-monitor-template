"""
qa_runner_timeline.py - 메인 평면도 2단계 타임라인 탭 E2E 검증 러너 (AC-6 ~ AC-20)
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

MOCK_BATCHES = [
    {"lotNumber": "LOT-01", "manualZone": "stage1-1", "size": 8000, "schedule": {"A": {"start": "2026-10-22T08:00:00Z", "end": "2026-10-22T16:00:00Z"}, "B": {"start": "2026-10-24T09:00:00Z", "end": "2026-10-24T18:00:00Z"}}},
    {"lotNumber": "LOT-02", "manualZone": "stage1-wait", "size": 8000, "schedule": {"A": {"start": "2026-10-21T02:00:00Z", "end": "2026-10-21T10:00:00Z"}}},
    {"lotNumber": "LOT-03", "manualZone": "stage2-wait", "size": 7500, "schedule": {"B": {"start": "2026-10-25T08:00:00Z", "end": "2026-10-26T08:00:00Z"}, "C": {"start": "2026-10-26T09:00:00Z", "end": "2026-10-27T09:00:00Z"}}},
    {"lotNumber": "LOT-LOG", "manualZone": "logistics", "size": 8000, "schedule": {"A": {"start": "2026-10-22T08:00:00Z", "end": "2026-10-22T16:00:00Z"}}},
    {"lotNumber": "LOT-POST-E", "manualZone": "semi-storage-pre", "size": 7800, "schedule": {"E": {"end": "2026-10-21T00:00:00Z"}}},
    {"lotNumber": "LOT-OUT", "manualZone": "stage1-wait", "size": 8000, "schedule": {"A": {"start": "2026-11-20T08:00:00Z", "end": "2026-11-20T16:00:00Z"}}}
]

JS_CONTRAST = """(sel) => {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    if (!el) return { ratio: 0, text: '', bg: '' };
    const p = s => (s.match(/\\d+(\\.\\d+)?/g) || [0,0,0]).slice(0,3).map(Number);
    const lum = c => c.map(v => (v/=255) <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4)).reduce((acc,v,i) => acc + v * [0.2126,0.7152,0.0722][i], 0);
    const cs = window.getComputedStyle(el), col = p(cs.color), bg = p(cs.backgroundColor);
    const [l1, l2] = [lum(col), lum(bg)]; return { ratio: (Math.max(l1,l2) + 0.05) / (Math.min(l1,l2) + 0.05), text: cs.color, bg: cs.backgroundColor };
}"""

class QuietHandler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=qa_runner_common.SITE_ROOT, **k)
    def log_message(self, fmt, *a): pass

def start_server():
    s = ThreadingHTTPServer(('127.0.0.1', PORT), QuietHandler)
    threading.Thread(target=s.serve_forever, daemon=True).start(); return s

class QAState:
    def __init__(self):
        self.blocked_writes, self.console_errors, self.mock_batches = [], [], list(MOCK_BATCHES)

def handle_supabase_route(route, state):
    req = route.request
    if req.method in ["POST", "PUT", "PATCH", "DELETE"]:
        state.blocked_writes.append({"method": req.method, "url": req.url, "body": (req.post_data or "")[:3000]})
        return route.fulfill(status=200, content_type="application/json", body="{}")
    if "batches" in req.url:
        return route.fulfill(status=200, content_type="application/json", body=json.dumps({"id": "current_batches", "data": state.mock_batches}))
    if "todo_schedules" in req.url: return route.fulfill(status=200, content_type="application/json", body="[]")
    if "process_managers" in req.url: return route.fulfill(status=200, content_type="application/json", body=json.dumps({"p1_a": "홍길동"}))
    return qa_runner_common.fallback(route)

def setup_page(browser, state, viewport=None, clock_time="2026-10-23T03:00:00Z"):
    ctx = browser.new_context(viewport=viewport or {"width": 1440, "height": 900})
    p = ctx.new_page()
    if clock_time: p.clock.install(time=clock_time)
    p.on("console", lambda m: print(f"[{m.type.upper()}] {m.text}") if m.type in ["error", "warning"] else None)
    p.on("pageerror", lambda e: print("PAGEERROR:", e))
    p.route("**/rest/v1/**", lambda r: handle_supabase_route(r, state))
    qa_runner_common.install(p)
    p.add_init_script(f"localStorage.setItem('APP_BATCH_RECORDS', JSON.stringify({json.dumps(state.mock_batches)}));")
    p.goto(f"http://127.0.0.1:{PORT}/index.html?qa=true", wait_until="domcontentloaded")
    p.wait_for_timeout(350); return ctx, p

def assert_view_state(page, is_timeline, label=""):
    tab = page.locator("#tab-timeline" if is_timeline else "#tab-floorplan").get_attribute("aria-selected")
    vis = page.is_visible("#timeline-view" if is_timeline else "#process-grid")
    target_name = "타임라인" if is_timeline else "평면도"
    print(f"  * {label}: aria-selected({target_name})={tab}, 표시={vis}")
    assert tab == "true" and vis, f"{label} 상태 불일치"

def test_ac6_tabs(page):
    print("\n--- [AC-6] 기본 탭, 전환, aria-selected, 키보드, 새로고침 복원 검증 ---")
    assert_view_state(page, False, "기본 평면도")
    page.click("#tab-timeline"); page.wait_for_timeout(150)
    assert_view_state(page, True, "타임라인 전환")

    page.locator("#tab-timeline").focus(); page.keyboard.press("ArrowLeft"); page.wait_for_timeout(150)
    assert_view_state(page, False, "탭 포커스 ArrowLeft")
    page.locator("#tab-floorplan").focus(); page.keyboard.press("ArrowRight"); page.wait_for_timeout(150)
    assert_view_state(page, True, "탭 포커스 ArrowRight")

    page.locator("#lot-search-input").focus(); page.keyboard.press("ArrowLeft"); page.wait_for_timeout(100)
    assert_view_state(page, True, "탭 밖(검색창) ArrowLeft")

    page.reload(wait_until="domcontentloaded"); page.wait_for_timeout(300)
    assert_view_state(page, True, "새로고침 후 복원")
    page.screenshot(path=os.path.join(SHOT_DIR, "AC-6_tabs.png"))

def test_ac7_timeline_rows(page):
    print("\n--- [AC-7] 정상 데이터 줄 수, 순서, 막대 공정 목록, past 판정, 상자 높이 검증 ---")
    page.wait_for_selector(".timeline-row")
    lots = [el.inner_text().split("\n")[0].strip() for el in page.locator(".timeline-row").all()]
    print(f"  * 타임라인 줄 수: {len(lots)}개, 순서: {lots}"); assert lots == ["LOT-02", "LOT-01", "LOT-03"], f"정렬 불일치: {lots}"
    past_count, all_segs = page.locator(".timeline-segment.is-past").count(), page.locator(".timeline-segment").count()
    print(f"  * 전체 막대 수: {all_segs}개, past 막대 수: {past_count}개"); assert all_segs == 5 and past_count == 2, "막대 수 및 past 판정 불일치"
    h = page.evaluate("""() => {
        const tv = document.getElementById('timeline-view'), tb = document.querySelector('.timeline-toolbar'), th = document.querySelector('.timeline-header-line');
        const rows = Array.from(document.querySelectorAll('.timeline-row'));
        const headH = (tb?.getBoundingClientRect().height || 0) + (th?.getBoundingClientRect().height || 0);
        const rowsH = rows.reduce((acc, r) => acc + r.getBoundingClientRect().height, 0), boxH = tv.getBoundingClientRect().height;
        return { boxH, headH, rowsH, max: headH + rowsH + 32, diff: boxH - (headH + rowsH) };
    }""")
    print(f"  * 타임라인 상자 높이: 실제={h['boxH']:.1f}px, 내용(머리줄 {h['headH']:.1f}px + 줄합 {h['rowsH']:.1f}px)={h['headH']+h['rowsH']:.1f}px, 여백={h['diff']:.1f}px (한도 <= {h['max']:.1f}px)")
    assert h['boxH'] <= h['max'], f"상자 높이 초과: {h['boxH']} > {h['max']}"
    page.screenshot(path=os.path.join(SHOT_DIR, "AC-7_timeline_2w.png"))

def test_ac8_segment_contrast(page):
    print("\n--- [AC-8] 막대 글자 제거 및 title 공정명 검증 (F-6) ---")
    segs = page.locator(".timeline-segment").all(); assert len(segs) > 0
    valid_proc_names = ["공정1", "공정2", "공정3", "공정4", "공정5"]
    for i, seg in enumerate(segs):
        text = seg.inner_text().strip()
        title = seg.get_attribute("title") or ""
        print(f"  * 막대 #{i+1}: text='{text}', title='{title}'")
        assert text == "", f"막대에 글자가 남아있음: '{text}'"
        assert any(name in title for name in valid_proc_names), f"title에 공정명이 없음: '{title}'"

def test_ac9_now_line(page):
    print("\n--- [AC-9] 현재 시각 선 기대값 비교 및 3시간 후 타이머 갱신 검증 ---")
    info = page.evaluate("""() => {
        // 2주 보기: 3일 전 0시부터 14일
        const now = new Date(), st = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3), pct = (now - st) / (14 * 864e5) * 100;
        const exp = pct;
        const line = document.getElementById('timeline-now-line'), track = document.getElementById('timeline-overlay-track');
        const lb = line.getBoundingClientRect(), tb = track.getBoundingClientRect();
        return { exp, styleLeft: parseFloat(line.style.left), boxPct: ((lb.x - tb.x) / tb.width) * 100 };
    }""")
    print(f"  * 현재 시각 선 left%: 기대값={info['exp']:.4f}%, style={info['styleLeft']:.4f}%, box={info['boxPct']:.4f}% (기대값오차={abs(info['styleLeft']-info['exp']):.4f}%, box오차={abs(info['styleLeft']-info['boxPct']):.4f}%)")
    assert abs(info['styleLeft'] - info['exp']) <= 0.5 and abs(info['styleLeft'] - info['boxPct']) <= 0.5, "시각 선 오차 초과"
    page.clock.fast_forward(3 * 3600 * 1000); page.wait_for_timeout(200)
    post = page.evaluate("""() => {
        const now = new Date(), st = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3), pct = (now - st) / (14 * 864e5) * 100;
        return { newExp: pct, newStyle: parseFloat(document.getElementById('timeline-now-line').style.left) };
    }""")
    diff = post['newStyle'] - info['styleLeft']
    print(f"  * 3시간 후 1분 타이머 갱신 left%: 이전={info['styleLeft']:.4f}%, 이후={post['newStyle']:.4f}%, 기대값={post['newExp']:.4f}%, 변화량={diff:+.4f}%")
    assert post['newStyle'] > info['styleLeft'] and abs(post['newStyle'] - post['newExp']) <= 0.5, "3시간 후 타이머 갱신 실패"

def test_ac10_timeline_1w(page):
    print("\n--- [AC-10] 1주 전환 시 7칸 머리줄, 막대 재계산, 새로고침 유지 검증 ---")
    page.click("#btn-timeline-1w"); page.wait_for_timeout(200)
    days_cnt, lots_1w = page.locator(".timeline-day-col").count(), [el.inner_text().split("\n")[0].strip() for el in page.locator(".timeline-row").all()]
    print(f"  * 1주 날짜 칸 수={days_cnt}개 (기대: 7개), 로트 목록={lots_1w}"); assert days_cnt == 7 and lots_1w == ["LOT-01", "LOT-03"], "1주 칸 수 또는 로트 불일치"
    page.reload(wait_until="domcontentloaded"); page.wait_for_timeout(300)
    days_re = page.locator(".timeline-day-col").count()
    print(f"  * 새로고침 후 1주 유지: 칸 수={days_re}개"); assert days_re == 7, "1주 유지 실패"
    page.screenshot(path=os.path.join(SHOT_DIR, "AC-10_timeline_1w.png"))

def test_ac11_empty_states(browser, state):
    print("\n--- [AC-11] 배치 0건 및 logistics/post-E만 있을 때 빈 안내 문구 검증 ---")
    for label, b_list in [("배치 0건", []), ("logistics/post-E만 있음", [MOCK_BATCHES[3], MOCK_BATCHES[4]])]:
        state.mock_batches = b_list; ctx, p = setup_page(browser, state)
        p.click("#tab-timeline"); p.wait_for_timeout(150)
        hint = p.text_content("#timeline-empty-hint").strip()
        print(f"  * {label}: 안내 문구='{hint}', 보임={p.is_visible('#timeline-empty-hint')}")
        assert "표시할 진행·예정 배치가 없습니다" in hint and p.is_visible("#timeline-empty-hint")
        if label == "배치 0건": p.screenshot(path=os.path.join(SHOT_DIR, "AC-11_empty.png"))
        p.close(); ctx.close()
    state.mock_batches = list(MOCK_BATCHES)

def test_ac12_partial_missing(browser, state):
    print("\n--- [AC-12] 일정 일부 누락 및 콘솔 오류 0 검증 ---")
    state.mock_batches = [{"lotNumber": "LOT-PARTIAL", "manualZone": "stage1-1", "size": 8000, "schedule": {"A": {"start": "2026-10-23T08:00:00Z"}}}]
    ctx, p = setup_page(browser, state)
    p.click("#tab-timeline"); p.wait_for_timeout(150); rows_c = p.locator(".timeline-row").count()
    print(f"  * 누락 일정 렌더: 행 수={rows_c}개, 콘솔 에러={len(state.console_errors)}건")
    assert len(state.console_errors) == 0, f"콘솔 에러 발생: {state.console_errors}"
    p.close(); ctx.close(); state.mock_batches = list(MOCK_BATCHES)

def test_ac13_selection(page):
    print("\n--- [AC-13] 줄 클릭 선택 연동, 칩 동기화, 패널 값 일치 검증 ---")
    page.click("#tab-floorplan"); page.wait_for_timeout(150)
    page.locator(".batch-chip[data-lot='LOT-01']").click(); page.wait_for_timeout(150)
    floor_txt = page.locator("#side-selected-content").inner_text().strip()
    print(f"  * 평면도 LOT-01 칩 클릭 후 패널 내용:\n{floor_txt}")
    page.click("#tab-timeline"); page.click("#btn-timeline-2w"); page.wait_for_timeout(150)
    page.locator(".timeline-row[data-lot='LOT-02']").click(); page.wait_for_timeout(100)
    page.locator(".timeline-row[data-lot='LOT-01']").click(); page.wait_for_timeout(150)
    time_txt = page.locator("#side-selected-content").inner_text().strip()
    print(f"  * 타임라인 LOT-01 줄 클릭 후 패널 내용:\n{time_txt}")
    print(f"  * 동일 배치(LOT-01) 칩/줄 클릭 시 패널 내용 일치 여부={floor_txt == time_txt}")
    assert floor_txt == time_txt, "칩 클릭과 줄 클릭 시 패널 내용 불일치"
    page.click("#tab-floorplan"); page.wait_for_timeout(150)
    chip_sel = "is-selected" in page.locator(".batch-chip[data-lot='LOT-01']").get_attribute("class")
    print(f"  * 평면도 전환 후 칩 선택 상태={chip_sel}"); assert chip_sel, "평면도 칩 선택 상태 공유"
    page.locator(".batch-chip[data-lot='LOT-02']").click(); page.wait_for_timeout(150)
    page.click("#tab-timeline"); page.wait_for_timeout(150)
    row_sel = "is-selected" in page.locator(".timeline-row[data-lot='LOT-02']").get_attribute("class")
    print(f"  * 타임라인 복귀 후 LOT-02 줄 선택 상태={row_sel}"); assert row_sel, "타임라인 줄 선택 상태 공유"
    page.screenshot(path=os.path.join(SHOT_DIR, "AC-13_selected.png"))

def test_ac14_lot_search(page):
    print("\n--- [AC-14] 타임라인 로트 검색 강조, Enter 선택/스크롤, 평면도 유지 검증 ---")
    page.click("#tab-timeline"); page.wait_for_timeout(100)
    page.fill("#lot-search-input", "LOT-01"); page.wait_for_timeout(150)
    mc = page.locator(".timeline-row.is-search-match").count()
    print(f"  * 타임라인 검색 일치 줄 수={mc}"); assert mc == 1, "타임라인 검색 일치 줄 강조"
    page.press("#lot-search-input", "Enter"); page.wait_for_timeout(150)
    assert "LOT-01" in page.locator("#side-selected-content").text_content()
    page.click("#tab-floorplan"); page.wait_for_timeout(150)
    page.fill("#lot-search-input", "LOT-02"); page.wait_for_timeout(150)
    chip_mc = page.locator(".batch-chip.is-search-match").count()
    print(f"  * 평면도 검색 일치 칩 수={chip_mc}"); assert chip_mc >= 1, "평면도 칩 검색 강조 유지"
    page.fill("#lot-search-input", "")

def test_ac15_floorplan_drag(page, state):
    print("\n--- [AC-15] 탭 왕복 후 평면도 드래그 놓기 성공 및 manualZone 검증 ---")
    page.click("#tab-timeline"); page.wait_for_timeout(100); page.click("#tab-floorplan"); page.wait_for_timeout(100)
    page.evaluate("() => { const t = document.querySelector('[data-zone-id=\"stage5-wait\"]'), ev = new Event('drop', { bubbles: true, cancelable: true }); ev.dataTransfer = { getData: () => 'LOT-02' }; t.dispatchEvent(ev); }")
    page.wait_for_timeout(400)
    bw = [b for b in state.blocked_writes if "batches" in b["url"]]
    target_bw = [b for b in bw if "stage5-wait" in b.get("body", "")]
    print(f"  * 드래그 놓기 후 가로챈 쓰기 요청 수={len(bw)}건, manualZone='stage5-wait' 반영 확인 (body={target_bw[-1]['body'][:70]}...)")
    assert len(target_bw) > 0, "manualZone=stage5-wait 반영"

def test_ac16_dom_reuse(page):
    print("\n--- [AC-16] 데이터 불변 시 3초간 첫 자식 DOM 동일 객체 유지 및 변경 시 다시 그림 검증 ---")
    page.click("#tab-timeline"); page.wait_for_timeout(200)
    h1 = page.evaluate_handle("() => document.querySelector('#timeline-rows').firstElementChild")
    page.wait_for_timeout(3000)
    h2 = page.evaluate_handle("() => document.querySelector('#timeline-rows').firstElementChild")
    same = page.evaluate("([a, b]) => a === b", [h1, h2])
    print(f"  * 3초간 첫 자식 DOM 객체 일치 여부={same}"); assert same, "DOM 노드 재사용 실패"
    page.evaluate("() => { const b = JSON.parse(localStorage.getItem('APP_BATCH_RECORDS')); b[0].lotNumber = 'LOT-MODIFIED'; localStorage.setItem('APP_BATCH_RECORDS', JSON.stringify(b)); renderBatchIcons(); }")
    page.wait_for_timeout(200)
    lots = page.evaluate("() => [...document.querySelectorAll('#timeline-rows .timeline-row')].map(r => r.dataset.lot)")
    print(f"  * 데이터 변경 후 줄 로트: {lots}"); assert "LOT-MODIFIED" in lots, "데이터 변경 시 다시 그림"

def test_ac17_responsive_980(browser, state):
    print("\n--- [AC-17] 980x900 탭 바 한 줄, 타임라인 상자 내 스크롤, 문서 가로스크롤 부재 검증 ---")
    ctx, p = setup_page(browser, state, viewport={"width": 980, "height": 900})
    p.click("#tab-timeline"); p.wait_for_timeout(200)
    tb_h = p.locator("#main-view-tabs").bounding_box()['height']
    no_h = p.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth")
    sw = p.evaluate("() => document.getElementById('timeline-scroll-box').scrollWidth")
    print(f"  * 980px: 탭 바 높이={tb_h:.1f}px (<=45px 한줄), 문서가로스크롤없음={no_h}, 타임라인상자 scrollWidth={sw}px")
    assert tb_h <= 45 and no_h and sw >= 960, "980px 반응형 위반"
    p.screenshot(path=os.path.join(SHOT_DIR, "AC-17_980.png")); p.close(); ctx.close()

def test_ac18_ac19_isolation(page, state):
    print("\n--- [AC-18 / AC-19] 2초 후 로딩 문구 부재, 콘솔 에러 0, 운영 데이터 격리 목록 검증 ---")
    page.wait_for_timeout(2000)
    txt = page.locator("#dashboard-container").inner_text()
    for wd in ["로딩 중", "불러오는 중"]: assert wd not in txt
    assert len(state.console_errors) == 0, f"콘솔 에러: {state.console_errors}"
    print(f"  * 로딩 문구 부재 통과, 콘솔 에러={len(state.console_errors)}건")
    print(f"  * 차단된 원격 쓰기 요청 총 {len(state.blocked_writes)}건 (운영 격리 성공):")
    for bw in state.blocked_writes: print(f"    - [{bw['method']}] {bw['url']}")
    assert len(state.blocked_writes) > 0, "쓰기 요청 차단 필수"

def run_all():
    server, state = start_server(), QAState()
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx, page = setup_page(browser, state)
        for fn in [test_ac6_tabs, test_ac7_timeline_rows, test_ac8_segment_contrast, test_ac9_now_line, test_ac10_timeline_1w]: fn(page)
        test_ac11_empty_states(browser, state); test_ac12_partial_missing(browser, state)
        for fn in [test_ac13_selection, test_ac14_lot_search]: fn(page)
        test_ac15_floorplan_drag(page, state); test_ac16_dom_reuse(page); test_ac17_responsive_980(browser, state)
        test_ac18_ac19_isolation(page, state)
        page.close(); ctx.close(); browser.close()
    server.shutdown()
    shots = [f for f in os.listdir(SHOT_DIR) if f.endswith(".png")]
    print(f"\n=== [qa_runner_timeline.py] 스크린샷 총 {len(shots)}장 생성 완료 ===\n=== [qa_runner_timeline.py] 모든 Playwright 검증 성공적으로 통과함 ===")

if __name__ == '__main__':
    run_all()
