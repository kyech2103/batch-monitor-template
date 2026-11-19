"""
qa_runner_process_names.py - 공정명 표시 및 '세척/공정2' 문구 정리 E2E 검증 러너
AC-1 ~ AC-4, AC-6, AC-R3 전수 검증
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

MOCK_BATCHES = [
    {
        "lotNumber": "LOT-01",
        "manualZone": "stage1-1",
        "size": 8000,
        "schedule": {
            "A": {"start": "2026-10-23T08:00:00Z", "end": "2026-10-23T16:00:00Z"},
            "B": {"start": "2026-10-24T09:00:00Z", "end": "2026-10-24T18:00:00Z"}
        }
    },
    {
        "lotNumber": "LOT-02",
        "manualZone": "stage2",
        "size": 7500,
        "schedule": {
            "B": {"start": "2026-10-23T02:00:00Z", "end": "2026-10-23T10:00:00Z"}
        }
    },
    {
        "lotNumber": "LOT-E-DONE",
        "currentProcess": "공정 E 완료",
        "size": 7800
    }
]

class QuietHandler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=qa_runner_common.SITE_ROOT, **k)
    def log_message(self, fmt, *a):
        pass

def start_server():
    s = ThreadingHTTPServer(('127.0.0.1', PORT), QuietHandler)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s

class QAState:
    def __init__(self):
        self.blocked_writes = []
        self.console_errors = []
        self.mock_batches = list(MOCK_BATCHES)

def handle_supabase_route(route, state):
    req = route.request
    if req.method in ["POST", "PUT", "PATCH", "DELETE"]:
        msg = f"[PROD ISOLATION] Blocked write: {req.method} {req.url}"
        print(msg)
        state.blocked_writes.append({"method": req.method, "url": req.url, "body": (req.post_data or "")[:3000]})
        return route.fulfill(status=200, content_type="application/json", body="{}")
    if "batches" in req.url:
        return route.fulfill(status=200, content_type="application/json", body=json.dumps({"id": "current_batches", "data": state.mock_batches}))
    if "todo_schedules" in req.url:
        return route.fulfill(status=200, content_type="application/json", body="[]")
    if "todo_rules" in req.url:
        return route.fulfill(status=200, content_type="application/json", body="[]")
    if "equipment_jobs" in req.url:
        return route.fulfill(status=200, content_type="application/json", body="[]")
    if "process_managers" in req.url:
        return route.fulfill(status=200, content_type="application/json", body=json.dumps({"p1_a": "홍길동", "p2_a": "김공정2-A", "p2_b": "이공정2"}))
    return qa_runner_common.fallback(route)

def assert_no_loading_indicators(page, stage_name):
    page.wait_for_timeout(2000)
    body_text = page.inner_text("body")
    for phrase in ["확인 중", "로딩", "불러오는 중"]:
        assert phrase not in body_text, f"[{stage_name}] 2초 후 로딩/대기 문구 잔존: '{phrase}'"

def check_ac1_floor_stage2(page):
    print("\n--- [AC-1] 평면도 '공정2실', '공정2 라인' 및 '세척/공정2' 0건 검증 ---")
    room_name = page.locator("#room-stage2 .room-name").inner_text().strip()
    print(f"  * 공정2실 방 이름: '{room_name}'")
    assert room_name == "공정2실", f"기대값 '공정2실', 실제값: '{room_name}'"

    badge_name = page.locator("#room-stage2 .cell-header-badge").inner_text().strip()
    print(f"  * 공정2 셀 배지: '{badge_name}'")
    assert badge_name == "공정2 라인", f"기대값 '공정2 라인', 실제값: '{badge_name}'"

    body_text = page.inner_text("body")
    leftover_count = body_text.count("세척/공정2")
    print(f"  * 전체 화면 '세척/공정2' 출현 횟수: {leftover_count}회")
    assert leftover_count == 0, f"'세척/공정2' 문구가 화면에 {leftover_count}회 남아있음"

    page.screenshot(path=os.path.join(SHOT_DIR, "AC-1_floor_stage2.png"))
    print("  * AC-1 통과: AC-1_floor_stage2.png 저장 완료")

def check_ac2_narrow_screen(page):
    print("\n--- [AC-2] 창 너비 1100px 축약('라인') 및 1400px 복원('공정2 라인') 검증 ---")
    page.set_viewport_size({"width": 1100, "height": 800})
    page.wait_for_timeout(300)
    narrow_badge = page.locator("#room-stage2 .cell-header-badge").inner_text().strip()
    print(f"  * 1100px 배지: '{narrow_badge}'")
    assert narrow_badge == "라인", f"기대값 '라인', 실제값: '{narrow_badge}'"
    page.screenshot(path=os.path.join(SHOT_DIR, "AC-2_narrow.png"))

    page.set_viewport_size({"width": 1400, "height": 900})
    page.wait_for_timeout(300)
    restored_badge = page.locator("#room-stage2 .cell-header-badge").inner_text().strip()
    print(f"  * 1400px 복원 배지: '{restored_badge}'")
    assert restored_badge == "공정2 라인", f"기대값 '공정2 라인', 실제값: '{restored_badge}'"
    print("  * AC-2 통과: AC-2_narrow.png 저장 완료")

def check_ac3_floor_and_timeline(page, pattern):
    print("\n--- [AC-3] 정규식 '공정 ?[A-E](?![a-zA-Z])' 화면 0건 검증 ---")
    floor_text = page.inner_text("body")
    matches_floor = pattern.findall(floor_text)
    print(f"  * 평면도 매칭 결과: {matches_floor}")
    assert len(matches_floor) == 0, f"평면도에 공정 A~E 문구 남아있음: {matches_floor}"
    page.screenshot(path=os.path.join(SHOT_DIR, "AC-3_floor.png"))

    page.click("#tab-timeline")
    page.wait_for_timeout(500)
    assert_no_loading_indicators(page, "타임라인")
    timeline_text = page.inner_text("body")
    matches_timeline = pattern.findall(timeline_text)
    print(f"  * 타임라인 매칭 결과: {matches_timeline}")
    assert len(matches_timeline) == 0, f"타임라인에 공정 A~E 문구 남아있음: {matches_timeline}"
    page.screenshot(path=os.path.join(SHOT_DIR, "AC-3_timeline.png"))

def check_qa1_timeline_bars(page):
    print("\n--- [QA-1] 타임라인 간트 막대 글자 제거 및 title 공정명 검증 ---")
    seg_info = page.eval_on_selector_all(
        ".timeline-segment",
        "segs => segs.map(s => ({ text: s.textContent.trim(), title: s.getAttribute('title') || '', aria: s.getAttribute('aria-label') || '' }))"
    )
    print(f"  * 타임라인 막대 개수: {len(seg_info)}")
    assert len(seg_info) > 0, "타임라인 막대가 1개 이상 렌더링되어야 함"
    valid_proc_names = ["공정1", "공정2", "공정3", "공정4", "공정5"]
    for s in seg_info:
        assert s["text"] == "", f"타임라인 막대에 텍스트가 남아있음: '{s['text']}'"
        has_name = any(name in s["title"] for name in valid_proc_names)
        assert has_name, f"타임라인 막대 title에 공정명이 없음: '{s['title']}'"
    page.screenshot(path=os.path.join(SHOT_DIR, "QA-1_timeline_bars.png"))
    print("  * QA-1 통과: QA-1_timeline_bars.png 저장 완료")

def check_qa2_rules_list(page):
    print("\n--- [QA-2] 투두 규칙 표시 검증 ---")
    page.click("#tab-floorplan")
    page.wait_for_timeout(300)
    page.click("#btn-daily-todo")
    page.wait_for_timeout(300)
    page.click("#btn-todo-rules")
    page.wait_for_timeout(300)

    page.wait_for_selector("#todo-rules-table-body tr", timeout=5000)
    criteria_texts = page.eval_on_selector_all(
        "#todo-rules-table-body td.rule-when-cell",
        "cells => cells.map(c => c.textContent.trim())"
    )
    print(f"  * 투두 규칙 목록 기준 칸 텍스트: {criteria_texts}")
    assert len(criteria_texts) > 0, "투두 규칙 목록이 1개 이상 있어야 함"
    for ct in criteria_texts:
        if ct != "-":
            assert not re.search(r'^[A-E]\s', ct), f"규칙 목록 기준 칸에 단독 공정 코드 사용됨: '{ct}'"
    assert any("공정1 시작 30분 후" in ct for ct in criteria_texts), f"'공정1 시작 30분 후' 형식 행 누락: {criteria_texts}"

def check_ac6_rule_form(page, pattern):
    print("\n--- [AC-6] 투두 규칙 폼 옵션 표시 검증 ---")
    page.click("#btn-todo-rule-add")
    page.wait_for_timeout(300)
    rule_form_text = page.inner_text("body")
    matches_rule = pattern.findall(rule_form_text)
    print(f"  * 투두 규칙 폼 매칭 결과: {matches_rule}")
    assert len(matches_rule) == 0, f"투두 규칙 폼에 공정 A~E 문구 잔존: {matches_rule}"
    page.screenshot(path=os.path.join(SHOT_DIR, "AC-3_rule_form.png"))

    expected_options = [
        {"value": "A", "text": "공정1"},
        {"value": "B", "text": "공정2"},
        {"value": "C", "text": "공정3"},
        {"value": "D", "text": "공정4"},
        {"value": "E", "text": "공정5"},
        {"value": "PKG", "text": "포장"},
        {"value": "WEEK", "text": "매주 (마지막 평일)"}
    ]
    anchor_options = page.eval_on_selector_all(
        "#form-rule-anchor-step option",
        "opts => opts.map(o => ({ value: o.value, text: o.textContent.trim() }))"
    )
    assert anchor_options == expected_options, f"기준 공정 옵션 불일치. 기대: {expected_options}, 실제: {anchor_options}"
    page.screenshot(path=os.path.join(SHOT_DIR, "QA-2_rule_form.png"))

    page.click("#btn-todo-rule-form-cancel")
    page.wait_for_timeout(200)
    page.click("#btn-todo-rules-close")
    page.wait_for_timeout(200)
    page.click("#btn-todo-modal-close")
    page.wait_for_timeout(300)

def check_ac4_e_done(page):
    print("\n--- [AC-4] currentProcess='공정 E 완료' 호환 및 '공정5 완료' 문구 검증 ---")
    e_done_chip = page.locator("#zone-content-semi-storage-pre .batch-chip[data-lot='LOT-E-DONE']")
    assert e_done_chip.count() == 1, "LOT-E-DONE 배치가 반제품 보관실에 위치해야 함"

    e_done_chip.click()
    page.wait_for_timeout(300)
    side_text = page.locator("#side-selected-content").inner_text()
    print(f"  * LOT-E-DONE 선택 시 사이드바 내용: {side_text.replace(chr(10), ' | ')}")
    assert "공정5 완료" in side_text, f"'공정5 완료' 문구가 사이드바에 표시되어야 함 (실제: {side_text})"
    page.screenshot(path=os.path.join(SHOT_DIR, "AC-4_e_done.png"))

def check_acr3_loading_and_errors(page, state):
    print("\n--- [AC-R3] 로딩/대기 문구 잔존 및 콘솔 에러 검증 ---")
    assert_no_loading_indicators(page, "메인 대시보드")
    print(f"  * 콘솔 에러 수: {len(state.console_errors)}")
    assert len(state.console_errors) == 0, f"콘솔 에러 발생: {state.console_errors}"

    print(f"\n--- [운영 데이터 보호 확인] 차단된 쓰기 요청: {len(state.blocked_writes)}건 ---")
    for bw in state.blocked_writes:
        print(f"  * [PROD ISOLATION VERIFIED] {bw['method']} -> {bw['url']}")

def setup_qa_page(ctx, state):
    page = ctx.new_page()
    page.on("console", lambda msg: state.console_errors.append(msg.text) if msg.type in ["error"] else None)
    page.on("pageerror", lambda err: state.console_errors.append(str(err)))
    page.route(lambda url: "supabase.co" in url or "/rest/v1/" in url, lambda r: handle_supabase_route(r, state))
    qa_runner_common.install(page)

    operator = {"name": "박작업", "dept": "관리팀 대리"}
    init_script = f"""
    localStorage.setItem('APP_VERIFIED_OPERATOR', JSON.stringify({json.dumps(operator)}));
    localStorage.setItem('APP_OPERATOR_DATA', JSON.stringify({json.dumps(operator)}));
    localStorage.setItem('APP_BATCH_RECORDS', JSON.stringify({json.dumps(state.mock_batches)}));
    """
    page.add_init_script(init_script)
    page.goto(f"http://127.0.0.1:{PORT}/index.html?qa=true", wait_until="load")
    page.wait_for_timeout(1000)
    return page

def run_all_checks():
    start_server()
    state = QAState()
    pattern = re.compile(r'공정 ?[A-E](?![a-zA-Z])')

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1400, "height": 900})
        page = setup_qa_page(ctx, state)

        check_ac1_floor_stage2(page)
        check_ac2_narrow_screen(page)
        check_ac3_floor_and_timeline(page, pattern)
        check_qa1_timeline_bars(page)
        check_qa2_rules_list(page)
        check_ac6_rule_form(page, pattern)
        check_ac4_e_done(page)
        check_acr3_loading_and_errors(page, state)

        browser.close()

    print("\n==========================================")
    print("  qa_runner_process_names.py ALL TESTS PASSED!")
    print("==========================================")

if __name__ == "__main__":
    run_all_checks()
