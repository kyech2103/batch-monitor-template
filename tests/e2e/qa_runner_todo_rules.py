"""
qa_runner_todo_rules.py - 일일 투두 작업 부여 규칙 관리 E2E 검증 러너
AC-10 ~ AC-18 Playwright 테스트
"""
import json
import os
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright

import qa_runner_common

PORT = qa_runner_common.free_port()
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))  # 저장소 맨 위 폴더

class QuietHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=qa_runner_common.SITE_ROOT, **kwargs)

    def log_message(self, format, *args):
        pass

def start_server():
    server = ThreadingHTTPServer(('127.0.0.1', PORT), QuietHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server

class RunnerState:
    def __init__(self):
        self.captured_writes, self.captured_rpc_rules, self.captured_rpc_schedules = [], [], []
        self.console_errors, self.xss_alert_triggered, self.current_mock_rules = [], [], []
        self.mock_holidays = [{"target_date": "2026-10-09", "title": "한글날"}]
        self.fail_holidays = False
        self.mock_managers = {
            "p1_a": "홍길동", "p1_b": "김철수", "p2_a": "이영희", "p2_b": "박찬호",
            "p2_c": "최민수", "p3_a": "정우성", "p3_b": "강동원", "p4_a": "송강호",
            "p4_b": "이병헌", "stage5": "유재석", "pk_a": "하하", "pk_b": "노홍철"
        }
        self.mock_batches = [{"lotNumber": "LOT-QA-01", "schedule": {
            "A": {"startCode": "10190900", "endCode": "10191800"},
            "B": {"startCode": "10200900", "endCode": "10201800"}
        }}]

    def handle_console(self, msg):
        if msg.type == "error" and "Failed to load resource" not in msg.text:
            self.console_errors.append(msg.text)

    def handle_dialog(self, dialog):
        if "alert" in dialog.type:
            self.xss_alert_triggered.append(dialog.message)
        dialog.accept()

def handle_write_route(route, state, method, url):
    post_data = route.request.post_data or "{}"
    state.captured_writes.append({"method": method, "url": url, "data_sample": post_data[:200]})
    try:
        payload = json.loads(post_data)
    except (json.JSONDecodeError, ValueError):
        payload = {}
    if "replace_todo_rules" in url:
        state.captured_rpc_rules.append(payload)
        state.current_mock_rules = payload.get("p_rules", [])
        return route.fulfill(status=200, content_type="application/json", body="14")
    if "replace_todo_schedules" in url:
        state.captured_rpc_schedules.append(payload)
        return route.fulfill(status=200, content_type="application/json", body="10")
    return route.fulfill(status=200, content_type="application/json", body="{}")

def handle_read_route(route, state, url):
    if "todo_rules" in url:
        return route.fulfill(status=200, content_type="application/json", body=json.dumps(state.current_mock_rules))
    if "record_type=eq.HOLIDAY" in url:
        if state.fail_holidays:
            return route.fulfill(status=500, content_type="application/json", body='{"message":"db read error"}')
        return route.fulfill(status=200, content_type="application/json", body=json.dumps(state.mock_holidays))
    if "todo_schedules" in url:
        return route.fulfill(status=200, content_type="application/json", body="[]")
    if "equipment_jobs" in url:
        return route.fulfill(status=200, content_type="application/json", body="[]")
    if "batches" in url:
        body = json.dumps({"id": "current_batches", "data": state.mock_batches})
        return route.fulfill(status=200, content_type="application/json", body=body)
    if "process_managers" in url:
        return route.fulfill(status=200, content_type="application/json", body=json.dumps(state.mock_managers))
    return qa_runner_common.fallback(route)

def handle_supabase_route(route, state):
    if route.request.method in ["POST", "PUT", "PATCH", "DELETE"]:
        return handle_write_route(route, state, route.request.method, route.request.url)
    return handle_read_route(route, state, route.request.url)

def create_context_and_page(browser, worker, state, batches=None):
    ctx = browser.new_context(viewport={"width": 1400, "height": 900})
    page = ctx.new_page()
    page.on("console", state.handle_console)
    page.on("dialog", state.handle_dialog)
    page.route("**/rest/v1/**", lambda r: handle_supabase_route(r, state))
    qa_runner_common.install(page)
    init_script = f"localStorage.setItem('APP_VERIFIED_OPERATOR', JSON.stringify({json.dumps(worker)}));"
    if batches:
        init_script += f"localStorage.setItem('APP_OPERATOR_DATA', JSON.stringify({json.dumps(worker)}));"
        init_script += f"localStorage.setItem('APP_BATCH_RECORDS', JSON.stringify({json.dumps(batches)}));"
    page.add_init_script(init_script)
    page.goto(f"http://127.0.0.1:{PORT}/index.html?qa=true", wait_until="domcontentloaded")
    page.wait_for_timeout(300)
    return ctx, page

def test_ac10_rules_button_visibility(browser, state):
    print("\n--- [AC-10] 규칙 관리 버튼 가시성 검증 ---")
    worker_staff = {"name": "김사원", "dept": "생산팀 사원"}
    ctx_staff, p_staff = create_context_and_page(browser, worker_staff, state)
    p_staff.click("#btn-daily-todo")
    p_staff.wait_for_timeout(200)
    is_staff_visible = p_staff.is_visible("#btn-todo-rules")
    print(f"  * 일반 사원 (#btn-todo-rules visible): {is_staff_visible}")
    assert not is_staff_visible, "일반 사원에게 규칙 관리 버튼 노출 금지"
    p_staff.close()
    ctx_staff.close()
    p_staff.close()
    ctx_staff.close()

    worker_admin = {"name": "박작업", "dept": "관리팀 대리"}
    ctx_admin, page = create_context_and_page(browser, worker_admin, state, batches=state.mock_batches)
    page.click("#btn-daily-todo")
    page.wait_for_timeout(200)
    is_admin_visible = page.is_visible("#btn-todo-rules")
    print(f"  * 대리 이상 (#btn-todo-rules visible): {is_admin_visible}")
    assert is_admin_visible, "대리 이상 사용자에게 규칙 관리 버튼 노출"
    page.wait_for_timeout(800)
    label = page.text_content("#todo-last-generated")
    print(f"  * DB에 TODO 0건일 때 반영 상태: {label}")
    assert "확인 중" not in label, "DB가 비어 있어도 반영 상태 문구가 확정되어야 함"
    return ctx_admin, page

def test_ac11_default_rules(page):
    print("\n--- [AC-11] 기본 규칙 14개 표시 및 폴백 상태 검증 ---")
    page.click("#btn-todo-rules")
    page.wait_for_timeout(300)
    status_text = page.text_content("#todo-rules-status-badge")
    assert "기본 규칙" in status_text, "기본 규칙 상태 표기 확인"
    row_count = page.locator("#todo-rules-table-body tr.rule-row").count()
    assert row_count == 14, f"기본 규칙 14개 일치 (실제: {row_count})"
    print(f"  * 상태: {status_text}, 규칙 수: {row_count}")

def test_ac14_validation_error(page):
    print("\n--- [AC-14] 유효성 검사 (잘못된 시각 거부) ---")
    page.click("#btn-todo-rule-add")
    page.wait_for_timeout(200)
    page.fill("#form-rule-title", "잘못된 시각 테스트")
    page.select_option("#form-rule-day-rule", "PREV_BIZ")  # 시각 칸은 직전 평일 규칙에서만 보임
    page.fill("#form-rule-target-time", "")
    page.check("#form-rule-roles-grid input[value='p1_a']")
    page.click("#btn-todo-rule-form-submit")
    page.wait_for_timeout(200)
    assert page.is_visible("#todo-rule-form-errors"), "에러 표시 확인"
    assert "시각을 입력해 주세요" in page.text_content("#todo-rule-form-errors"), "일반 문장 오류"
    assert page.locator("#todo-rules-table-body tr.rule-row").count() == 14
    print("  * 오류 표시 및 목록 반영 차단 확인")

def test_ac15_xss_protection(page, state):
    print("\n--- [AC-15] XSS 방어 검증 (HTML 이스케이프) ---")
    page.fill("#form-rule-title", "<img src=x onerror=alert(1)>")
    page.fill("#form-rule-target-time", "10:45")
    page.click("#btn-todo-rule-form-submit")
    page.wait_for_timeout(200)
    assert len(state.xss_alert_triggered) == 0, "XSS alert 미실행"
    t_html = page.inner_html("#todo-rules-table-body")
    assert "<img src=x onerror=alert(1)>" not in t_html and "&lt;img" in t_html
    print("  * XSS 스크립트 미실행 및 escapeHtml 처리 확인")

def test_ac12_add_and_save_rule(page, state):
    print("\n--- [AC-12] 규칙 추가 후 저장 RPC 요청 검증 ---")
    page.click("#btn-todo-rule-add")
    page.wait_for_timeout(200)
    page.fill("#form-rule-title", "새 공정 점검")
    page.select_option("#form-rule-anchor-step", "A")
    page.select_option("#form-rule-anchor-point", "start")
    page.select_option("#form-rule-day-rule", "SAME")
    page.fill("#form-rule-offset-h", "1")
    page.fill("#form-rule-offset-m", "30")
    page.select_option("#form-rule-offset-dir", "-1")
    page.check("#form-rule-roles-grid input[value='p2_a']")
    page.click("#btn-todo-rule-form-submit")
    page.wait_for_timeout(200)
    page.click("#btn-todo-rules-save")
    page.wait_for_timeout(300)
    assert len(state.captured_rpc_rules) >= 1
    added = next((r for r in state.captured_rpc_rules[-1].get("p_rules", []) if r.get("title") == "새 공정 점검"), None)
    assert added is not None and added.get("time_mode") == "OFFSET" and added.get("offset_minutes") == -90
    print(f"  * RPC payload 내 새 규칙 확인 (ID: {added.get('rule_id')})")

def test_weekly_rule_form(page, state):
    print("\n--- 규칙 폼: 매주·포장 기준과 새 날짜 선택 검증 ---")
    page.click("#btn-todo-rules")
    page.wait_for_timeout(300)
    page.click("#btn-todo-rule-add")
    page.wait_for_timeout(200)
    page.select_option("#form-rule-anchor-step", "WEEK")
    assert not page.is_visible("#form-rule-day-rule") and not page.is_visible("#form-rule-anchor-point")
    assert page.is_visible("#form-rule-target-time")
    weekly = page.evaluate("collectRuleFormData()")
    assert weekly["day_rule"] == "WEEK_LAST" and weekly["time_mode"] == "FIXED" and weekly["process_code"] == "CLEAN"
    page.select_option("#form-rule-anchor-step", "PKG")
    page.select_option("#form-rule-day-rule", "PREV_WEEK_LAST")
    assert page.is_visible("#form-rule-target-time") and not page.is_visible("#form-rule-offset-h")
    pkg = page.evaluate("collectRuleFormData()")
    assert pkg["anchor_step"] == "PKG" and pkg["day_rule"] == "PREV_WEEK_LAST" and pkg["process_code"] == "PKG"
    page.click("#btn-rule-roles-all")
    assert page.locator("input[name='rule-role-chk']:checked").count() == page.locator("input[name='rule-role-chk']").count()
    page.click("#btn-todo-rule-form-cancel")
    print("  * 매주·포장 기준 폼·전체 선택 동작 확인")

    # 저장 안 한 변경: 닫기 전 확인, 패널 입력은 저장 시 함께 반영
    first = page.locator("#todo-rules-table-body tr.rule-row").first
    assert first.locator(".rule-when-cell").inner_text().strip() != ""
    first.locator(".rule-enable-toggle").uncheck()
    assert "저장하지 않은" in page.text_content("#todo-rules-footer-status")
    assert first.get_attribute("class").find("is-off") >= 0
    assert page.evaluate("hasUnsavedRuleChanges()") is True
    first.locator(".rule-enable-toggle").check()
    assert page.evaluate("hasUnsavedRuleChanges()") is False
    first.click()
    page.wait_for_timeout(200)
    box = page.locator("#btn-todo-rule-form-submit").bounding_box()
    assert box and box["y"] + box["height"] <= 900, "적용 버튼이 화면 안에 보임"
    assert page.evaluate("hasUnsavedRuleChanges()") is False, "연 것만으로는 변경 아님"
    page.fill("#form-rule-title", "패널 입력 저장 확인")
    assert page.evaluate("hasUnsavedRuleChanges()") is True, "[적용] 전 패널 입력도 변경으로 침"
    page.click("#btn-todo-rules-save")
    page.wait_for_timeout(400)
    assert any(r.get("title") == "패널 입력 저장 확인" for r in state.captured_rpc_rules[-1].get("p_rules", []))
    print("  * 저장 안 한 변경 표시·패널 입력 자동 반영 확인")

def test_ac13_delete_rule(page, state):
    print("\n--- [AC-13] 규칙 삭제 검증 (모든 규칙 삭제 가능, 특수 표시 없음) ---")
    page.click("#btn-todo-rules")
    page.wait_for_timeout(300)
    assert page.locator("#todo-rules-table-body", has_text="특수").count() == 0
    del_row = page.locator("#todo-rules-table-body tr.rule-row", has_text="새 공정 점검")
    del_row.click()
    page.wait_for_timeout(200)
    page.click("#btn-todo-rule-delete")
    page.wait_for_timeout(200)
    page.click("#btn-todo-rules-save")
    page.wait_for_timeout(300)
    assert not any(r.get("title") == "새 공정 점검" for r in state.captured_rpc_rules[-1].get("p_rules", []))
    print("  * 수정 패널에서 삭제 반영 확인")

def test_ac16_apply_schedule(page, state):
    print("\n--- [AC-16] 규칙 반영 후 [일정 반영] 시 p_rows 반영 검증 ---")
    page.click("#btn-todo-rules")
    page.wait_for_timeout(200)
    page.click("#btn-todo-rule-add")
    page.wait_for_timeout(200)
    cid = "U-APPLY-TEST"
    page.evaluate(f"document.getElementById('form-rule-id').value = '{cid}';")
    page.fill("#form-rule-title", "일정 반영 연동 검증 작업")
    page.select_option("#form-rule-anchor-step", "A")
    page.select_option("#form-rule-anchor-point", "start")
    page.select_option("#form-rule-day-rule", "SAME")
    page.fill("#form-rule-offset-h", "2")  # 목업 배치 A 시작 09:00 + 2시간 30분 = 11:30
    page.fill("#form-rule-offset-m", "30")
    page.select_option("#form-rule-offset-dir", "1")
    page.check("#form-rule-roles-grid input[value='p1_b']")
    page.click("#btn-todo-rule-form-submit")
    page.wait_for_timeout(200)
    page.click("#btn-todo-rules-save")
    page.wait_for_timeout(300)

    page.click("#btn-todo-apply")
    page.wait_for_timeout(500)
    assert len(state.captured_rpc_schedules) >= 1
    p_rows = state.captured_rpc_schedules[-1].get("p_rows", [])
    m_row = next((r for r in p_rows if r.get("rule_id") == cid), None)
    assert m_row is not None and m_row.get("target_time") == "11:30"
    print(f"  * 일정 반영 p_rows 내 {cid} (11:30) 배정 확인 완료")

def test_apply_with_holiday_read_failure(page, state):
    print("\n--- 공휴일을 못 읽어도 일정 반영은 하되 경고를 보여줌 ---")
    before = len(state.captured_rpc_schedules)
    state.fail_holidays = True
    page.click("#btn-todo-apply")
    page.wait_for_timeout(500)
    state.fail_holidays = False
    assert len(state.captured_rpc_schedules) == before + 1, "공휴일 읽기 실패는 반영을 막지 않음"
    warn = page.text_content("#todo-warnings-list") or ""
    print(f"  * 경고 목록: '{warn}'")
    assert page.is_visible("#todo-warnings-panel") and "공휴일" in warn, "공휴일 기본 목록 사용 경고 표시"

def test_ac17_isolation(state):
    print("\n--- [AC-17] 운영 데이터 격리(Production Isolation) 검증 ---")
    print(f"  * 가로채서 차단한 쓰기 요청 수: {len(state.captured_writes)}건")
    for i, w in enumerate(state.captured_writes, 1):
        print(f"    [{i}] {w['method']} {w['url']} (차단됨)")
    assert len(state.captured_writes) > 0

def test_ac18_console_errors(state):
    print("\n--- [AC-18] 콘솔 에러 검증 ---")
    print(f"  * 콘솔 에러 수: {len(state.console_errors)}건")
    assert len(state.console_errors) == 0, f"콘솔 에러 발생: {state.console_errors}"

def print_summary(results):
    print("\n============================================================")
    print("모든 E2E 수용 기준 (AC-10 ~ AC-18) 통과 완료!")
    for ac, res in results.items():
        print(f"  {ac}: {res}")
    print("============================================================\n")

def run_tests():
    start_server()
    print(f"[*] 테스트 서버 가동: http://127.0.0.1:{PORT}")
    state = RunnerState()
    results = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx_admin, page = test_ac10_rules_button_visibility(browser, state)
        results["AC-10"] = "PASSED"
        test_ac11_default_rules(page)
        results["AC-11"] = "PASSED"
        test_ac14_validation_error(page)
        results["AC-14"] = "PASSED"
        test_ac15_xss_protection(page, state)
        results["AC-15"] = "PASSED"
        test_ac12_add_and_save_rule(page, state)
        results["AC-12"] = "PASSED"
        test_weekly_rule_form(page, state)
        test_ac13_delete_rule(page, state)
        results["AC-13"] = "PASSED"
        test_ac16_apply_schedule(page, state)
        results["AC-16"] = "PASSED"
        test_apply_with_holiday_read_failure(page, state)
        test_ac17_isolation(state)
        results["AC-17"] = "PASSED"
        test_ac18_console_errors(state)
        results["AC-18"] = "PASSED"
        page.close()
        ctx_admin.close()
        browser.close()
    print_summary(results)

if __name__ == "__main__":
    run_tests()
