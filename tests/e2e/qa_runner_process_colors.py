"""
qa_runner_process_colors.py - 공정 색상 재조정 · 다가오는 일정 공정명 색 · 배치 팝업 공정명 표시 E2E 러너
AC-2 ~ AC-7, AC-R3, AC-R4 전수 검증
"""
import json
import os
import re
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

EXP_TEXT_RGB = {
    'A': 'rgb(15, 118, 110)', 'B': 'rgb(220, 38, 38)', 'C': 'rgb(124, 58, 237)',
    'D': 'rgb(180, 83, 9)', 'E': 'rgb(37, 99, 235)'
}
EXP_BAR_RGB = {
    'A': 'rgb(13, 148, 136)', 'B': 'rgb(220, 38, 38)', 'C': 'rgb(124, 58, 237)',
    'D': 'rgb(245, 158, 11)', 'E': 'rgb(37, 99, 235)'
}

MOCK_BATCHES = [
    {
        "lotNumber": "LOT-COLOR-01", "manualZone": "stage1-1", "size": 8000,
        "schedule": {
            "A": {"start": "2026-10-24T06:00:00Z", "end": "2026-10-24T12:00:00Z", "stepName": "공정A"},
            "B": {"start": "2026-10-24T13:00:00Z", "end": "2026-10-24T14:00:00Z", "stepName": "공정B"},
            "C": {"start": "2026-10-24T15:00:00Z", "end": "2026-10-25T15:00:00Z", "stepName": "공정C"},
            "D": {"start": "2026-10-25T16:00:00Z", "end": "2026-10-25T18:00:00Z", "stepName": "공정D"},
            "E": {"start": "2026-10-25T19:00:00Z", "end": "2026-10-25T20:00:00Z", "stepName": "공정E"}
        }
    },
    {
        "lotNumber": "LOT-COLOR-02", "manualZone": "stage2", "size": 7500,
        "schedule": { "B": {"start": "2026-10-24T11:00:00Z", "end": "2026-10-24T12:00:00Z", "stepName": "공정B"} }
    }
]

class QuietHandler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=qa_runner_common.SITE_ROOT, **k)
    def log_message(self, *a):
        pass

class QAState:
    def __init__(self):
        self.blocked_writes, self.console_errors = [], []
        self.mock_batches = list(MOCK_BATCHES)

def handle_supabase_route(route, state):
    req = route.request
    if req.method in ["POST", "PUT", "PATCH", "DELETE"]:
        print(f"[PROD ISOLATION] Blocked write: {req.method} {req.url}")
        state.blocked_writes.append({"method": req.method, "url": req.url})
        return route.fulfill(status=200, content_type="application/json", body="{}")
    if "batches" in req.url:
        return route.fulfill(status=200, content_type="application/json", body=json.dumps({"id": "current_batches", "data": state.mock_batches}))
    if "process_managers" in req.url:
        return route.fulfill(status=200, content_type="application/json", body=json.dumps({"p1_a": "홍길동", "p2_b": "이공정2"}))
    if any(k in req.url for k in ["todo_schedules", "todo_rules"]):
        return route.fulfill(status=200, content_type="application/json", body="[]")
    return qa_runner_common.fallback(route)

def assert_no_loading(page, locator=None, stage_name=""):
    page.wait_for_timeout(2000)
    txt = (locator if locator is not None else page.locator("body")).inner_text()
    for phrase in ["확인 중", "로딩", "불러오는 중"]:
        assert phrase not in txt, f"[{stage_name}] 로딩 문구 잔존: '{phrase}'"

def test_ac2_ac5_floor(page):
    print("\n--- [AC-2 & AC-5] CSS 변수, 평면도 셀 배지 및 범례 색상 검증 ---")
    vars_ = page.evaluate("() => { const cs = getComputedStyle(document.documentElement); return ['a','b','c','d','e'].map(k => cs.getPropertyValue('--proc-'+k).trim().toLowerCase()); }")
    for act, exp in zip(vars_, ['#0d9488', '#dc2626', '#7c3aed', '#f59e0b', '#2563eb']):
        assert act == exp, f"CSS 변수 불일치: {act} != {exp}"
    b_cols = page.evaluate("""() => ({
        B: getComputedStyle(document.querySelector('[data-zone-id=\"stage2\"] .cell-header-badge')).color,
        C: getComputedStyle(document.querySelector('[data-zone-id=\"stage3-1\"] .cell-header-badge')).color,
        D: getComputedStyle(document.querySelector('[data-zone-id=\"stage4-1\"] .cell-header-badge')).color,
        E: getComputedStyle(document.querySelector('[data-zone-id=\"stage5\"] .cell-header-badge')).color,
        A: getComputedStyle(document.querySelector('[data-zone-id=\"stage1-1\"] .cell-header-badge')).color
    })""")
    for k in ['A', 'B', 'C', 'D', 'E']:
        assert b_cols[k] == EXP_TEXT_RGB[k], f"셀 배지 글자색 {k} 불일치: {b_cols[k]}"
    lg_cols = page.evaluate("() => Array.from(document.querySelectorAll('.timeline-legend .legend-dot')).map(d => getComputedStyle(d).backgroundColor)")
    assert len(lg_cols) == 5
    for act, exp in zip(lg_cols, [EXP_BAR_RGB[k] for k in ['A', 'B', 'C', 'D', 'E']]):
        assert act == exp, f"범례 배경색 불일치: {act} != {exp}"
    page.screenshot(path=os.path.join(SHOT_DIR, "AC-2_floor.png"))

def test_ac4_upcoming(page):
    print("\n--- [AC-4] 다가오는 일정 공정명 단독 색 (.side-event-step) 검증 ---")
    items = page.evaluate("""() => Array.from(document.querySelectorAll('#side-events-content .side-event-item')).map(it => {
        const s = it.querySelector('.side-event-step'), t = it.querySelector('.side-event-text');
        return { full: t ? t.textContent.strip : '', has: !!s, name: s ? s.textContent.trim() : '', col: s ? getComputedStyle(s).color : '', wt: s ? getComputedStyle(s).fontWeight : '', outCol: t ? getComputedStyle(t).color : '' };
    })""")
    assert len(items) > 0, "다가오는 일정 1건 이상"
    n2k = {"공정1": "A", "공정2": "B", "공정3": "C", "공정4": "D", "공정5": "E"}
    for it in items:
        assert it['has'] and it['name'] in n2k
        assert it['col'] == EXP_TEXT_RGB[n2k[it['name']]]
        assert it['wt'] in ['700', 'bold'] and it['col'] != it['outCol']
    page.screenshot(path=os.path.join(SHOT_DIR, "AC-4_upcoming.png"))

def test_ac3_timeline(page):
    print("\n--- [AC-3] 타임라인 막대 글자 제거, title 공정명, 폭 >=6px, 색상 검증 ---")
    page.click("#tab-timeline")
    page.wait_for_timeout(500)
    assert_no_loading(page, stage_name="타임라인 탭")
    segs = page.evaluate("""() => Array.from(document.querySelectorAll('.timeline-segment')).map(s => ({
        txt: s.textContent.trim(), title: s.getAttribute('title') || '', aria: s.getAttribute('aria-label') || '', w: s.getBoundingClientRect().width, bg: getComputedStyle(s).backgroundColor
    }))""")
    assert len(segs) > 0, "타임라인 막대 1개 이상"
    valid_bgs = set(EXP_BAR_RGB.values())
    for s in segs:
        assert s['txt'] == "" and s['aria'] == s['title'] and s['w'] >= 5.9
        assert any(n in s['title'] for n in ["공정1", "공정2", "공정3", "공정4", "공정5"])
        assert s['bg'] in valid_bgs
    page.screenshot(path=os.path.join(SHOT_DIR, "AC-3_timeline.png"))

def check_card_headers_and_badges(iframe, pat_standalone, exp_titles, mode_name):
    assert iframe.locator(".proc-card .proc-title-text h3").all_inner_texts()[:5] == exp_titles
    for ht in iframe.locator(".proc-card .proc-hdr").all_inner_texts()[:5]:
        assert len(pat_standalone.findall(ht)) == 0, f"{mode_name} 팝업 공정 카드 머리에 단독 A~E 잔존: {ht}"
    assert iframe.locator(".proc-card .proc-badge").all_inner_texts()[:5] == ["1", "2", "3", "4", "5"]

def test_batch_new(page, iframe, pat, pat_standalone, exp_titles):
    page.click("#tab-floorplan")
    page.wait_for_timeout(300)
    page.click("#btn-batch-modal-trigger")
    page.wait_for_timeout(1000)
    assert_no_loading(page, locator=iframe, stage_name="배치 신규")
    assert len(pat.findall(iframe.inner_text())) == 0
    check_card_headers_and_badges(iframe, pat_standalone, exp_titles, "신규")
    page.screenshot(path=os.path.join(SHOT_DIR, "AC-6_batch_new.png"))

def test_batch_history(page, iframe):
    iframe.locator("#btn-history").click()
    page.wait_for_timeout(500)
    hdrs = iframe.locator("#modal-history table thead tr th").all_inner_texts()
    for h in ["시작(공정1)", "완료(공정5)", "공정1 설비", "공정3 설비", "공정4 설비"]:
        assert h in hdrs, f"표 머리글 '{h}' 누락"
    page.screenshot(path=os.path.join(SHOT_DIR, "AC-7_batch_list.png"))
    iframe.locator("[data-close='modal-history']").click()
    page.wait_for_timeout(200)
    page.click("#batch-modal-btn-close")
    page.wait_for_timeout(400)

def test_batch_edit(page, iframe, pat, pat_standalone, exp_titles):
    page.locator(".batch-chip[data-lot='LOT-COLOR-01']").click()
    page.wait_for_timeout(300)
    page.click("#btn-side-edit-schedule")
    page.wait_for_timeout(1000)
    assert_no_loading(page, locator=iframe, stage_name="배치 수정")
    assert len(pat.findall(iframe.inner_text())) == 0
    check_card_headers_and_badges(iframe, pat_standalone, exp_titles, "수정")
    page.screenshot(path=os.path.join(SHOT_DIR, "AC-6_batch_edit.png"))
    page.click("#batch-modal-btn-close")
    page.wait_for_timeout(300)

def test_ac6_ac7_batches(page):
    print("\n--- [AC-6 & AC-7] 배치 팝업 표시 (신규 및 수정) 검증 ---")
    pat = re.compile(r'공정 ?[A-E](?![a-zA-Z])')
    pat_standalone = re.compile(r'\b[A-E]\b')
    exp_titles = ["공정1", "공정2", "공정3", "공정4", "공정5"]
    iframe = page.locator("#batch-schedule-modal")  # 배치 등록 창은 메인 창 안에 바로 뜬다

    test_batch_new(page, iframe, pat, pat_standalone, exp_titles)
    test_batch_history(page, iframe)
    test_batch_edit(page, iframe, pat, pat_standalone, exp_titles)

def test_acr4_empty(ctx, state, target_url, op_json):
    print("\n--- [AC-R4] 다가오는 일정 0건 상태 안내 문구 검증 ---")
    state.mock_batches = []
    p_empty = ctx.new_page()
    p_empty.add_init_script(f"localStorage.setItem('APP_VERIFIED_OPERATOR', JSON.stringify({op_json})); localStorage.setItem('APP_BATCH_RECORDS', '[]');")
    p_empty.goto(target_url, wait_until="load")
    p_empty.wait_for_timeout(1000)
    assert_no_loading(p_empty, stage_name="배치 0건")
    hint = p_empty.locator("#side-events-content .side-empty-hint").inner_text()
    assert "72시간 안 예정된 공정 일정이 없습니다" in hint
    p_empty.screenshot(path=os.path.join(SHOT_DIR, "AC-R4_upcoming_empty.png"))
    p_empty.close()

def run_all_checks():
    server = ThreadingHTTPServer(('127.0.0.1', PORT), QuietHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    state = QAState()
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1400, "height": 900})
        ctx.route("**/rest/v1/**", lambda r: handle_supabase_route(r, state))
        qa_runner_common.install(ctx)
        ctx.route("**/auth/v1/**", lambda r: r.fulfill(status=200, content_type="application/json", body="{}"))
        page = ctx.new_page()
        page.on("console", lambda m: state.console_errors.append(m.text) if m.type == "error" and "favicon.ico" not in m.text else None)
        page.on("pageerror", lambda e: state.console_errors.append(str(e)))
        op_json = json.dumps({"name": "박작업", "dept": "관리팀 대리"})
        page.add_init_script(f"localStorage.setItem('APP_VERIFIED_OPERATOR', JSON.stringify({op_json})); localStorage.setItem('APP_BATCH_RECORDS', JSON.stringify({json.dumps(state.mock_batches)}));")
        url = f"http://127.0.0.1:{PORT}/index.html?qa=true"
        page.goto(url, wait_until="load")
        page.wait_for_timeout(1000)
        assert_no_loading(page, stage_name="메인 진입")

        test_ac2_ac5_floor(page)
        test_ac4_upcoming(page)
        test_ac3_timeline(page)
        test_ac6_ac7_batches(page)
        test_acr4_empty(ctx, state, url, op_json)

        print(f"\n--- [AC-R3] 콘솔 에러 수: {len(state.console_errors)} ---")
        assert len(state.console_errors) == 0, f"콘솔 에러: {state.console_errors}"
        print(f"\n--- [운영 데이터 보호 확인] 차단된 쓰기 요청: {len(state.blocked_writes)}건 ---")
        browser.close()

if __name__ == "__main__":
    run_all_checks()
    print("\n==========================================\n  qa_runner_process_colors.py ALL TESTS PASSED!\n==========================================")
