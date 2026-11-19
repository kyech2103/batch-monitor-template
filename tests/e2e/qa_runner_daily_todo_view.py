"""qa_runner_daily_todo_view.py - 일일 투두 창의 직급별 보기 권한 검증.

사원·주임은 본인 할 일만, 대리 이상·관리자는 전체와 담당자 필터, 미인증은 안내만 보이고,
창을 연 채 작업자가 바뀌면 권한이 바로 바뀌는지 확인한다. (지운 qa_runner_daily_todo_auth.py의 권한 항목)
"""
import json
import os
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright

import qa_runner_common

PORT = qa_runner_common.free_port()
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))  # 저장소 맨 위 폴더
DAY = "2026-10-23"  # index.html의 qa=true 가짜 날짜(금요일)

TODOS = [
    {"id": 1, "record_type": "TODO", "target_date": DAY, "target_time": "09:00", "worker_name": "김사원", "rule_id": "R1", "task_key": "k1", "title": "사원 할 일", "lot_id": "LOT-1", "process_code": "A", "generated_at": "2026-10-23T08:00:00Z"},
    {"id": 2, "record_type": "TODO", "target_date": DAY, "target_time": "10:00", "worker_name": "홍길동", "rule_id": "R2", "task_key": "k2", "title": "다른 사람 할 일", "lot_id": "LOT-1", "process_code": "A", "generated_at": "2026-10-23T08:00:00Z"},
    {"id": 3, "record_type": "TODO", "target_date": DAY, "target_time": "11:00", "worker_name": "홍길동", "rule_id": "R3", "task_key": "k3", "title": "다른 사람 두번째", "lot_id": "LOT-1", "process_code": "B", "generated_at": "2026-10-23T08:00:00Z"},
]


class QuietHandler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=qa_runner_common.SITE_ROOT, **k)
    def log_message(self, fmt, *a): pass


def handle(route):
    req = route.request
    if req.method != "GET":
        return route.fulfill(status=200, content_type="application/json", body="{}")
    url = req.url
    if "todo_schedules" in url:
        rows = TODOS if "record_type=eq.TODO" in url else []
        return route.fulfill(status=200, content_type="application/json", body=json.dumps(rows))
    if "todo_rules" in url or "equipment_jobs" in url:
        return route.fulfill(status=200, content_type="application/json", body="[]")
    if "batches" in url:
        return route.fulfill(status=200, content_type="application/json", body=json.dumps({"id": "current_batches", "data": []}))
    return qa_runner_common.fallback(route)


def open_todo(browser, worker, errors):
    ctx = browser.new_context(viewport={"width": 1400, "height": 900}, timezone_id="Asia/Seoul")
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.route("**/rest/v1/**", handle)
    qa_runner_common.install(page)
    if worker:
        page.add_init_script(f"localStorage.setItem('APP_VERIFIED_OPERATOR', JSON.stringify({json.dumps(worker)}));")
    page.goto(f"http://127.0.0.1:{PORT}/index.html?qa=true", wait_until="domcontentloaded")
    page.wait_for_timeout(500)
    page.evaluate("() => openDailyTodoModal()")
    page.wait_for_timeout(500)
    return ctx, page


def view(page):
    return {
        "filter": page.locator("#todo-worker-filter").is_visible(),
        "summary": page.text_content("#todo-summary-count").strip(),
        "others": "다른 사람" in page.text_content("#todo-items-container"),
    }


def main():
    threading.Thread(target=ThreadingHTTPServer(("127.0.0.1", PORT), QuietHandler).serve_forever, daemon=True).start()
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        for label, dept in [("사원", "생산팀 사원"), ("주임", "생산팀 주임")]:
            ctx, page = open_todo(browser, {"name": "김사원", "dept": dept}, errors)
            v = view(page)
            print(f"  * {label}: {v}")
            assert not v["filter"] and not v["others"] and "1건 배정" in v["summary"], f"{label}은 본인 할 일만 보여야 함"
            ctx.close()

        for label, worker in [("대리", {"name": "박작업", "dept": "관리팀 대리"}), ("관리자", {"name": "관리자", "dept": ""})]:
            ctx, page = open_todo(browser, worker, errors)
            v = view(page)
            print(f"  * {label}: {v}")
            assert v["filter"] and v["others"] and "3건 배정" in v["summary"], f"{label}은 전체 할 일을 봐야 함"
            ctx.close()

        ctx, page = open_todo(browser, {"name": "박작업", "dept": "관리팀 대리"}, errors)
        page.select_option("#todo-worker-filter", "홍길동")
        page.wait_for_timeout(300)
        v = view(page)
        print(f"  * 대리가 홍길동 선택: {v}")
        assert "2건 배정" in v["summary"] and "사원 할 일" not in page.text_content("#todo-items-container"), "담당자 필터가 그 사람만 보여야 함"
        ctx.close()

        # qa=true는 저장된 작업자가 없으면 'QA 테스터'로 들어가므로, 연 뒤에 인증을 해제한다
        ctx, page = open_todo(browser, None, errors)
        page.evaluate("() => window.updateCurrentUserUI(null)")
        page.wait_for_timeout(300)
        v = view(page)
        print(f"  * 미인증: {v}")
        assert "미인증" in v["summary"] and not v["others"], "미인증은 할 일이 보이면 안 됨"
        ctx.close()

        ctx, page = open_todo(browser, {"name": "김사원", "dept": "생산팀 사원"}, errors)
        page.evaluate("() => window.updateCurrentUserUI({ name: '박작업', dept: '관리팀 대리' })")
        page.wait_for_timeout(300)
        up = view(page)
        page.evaluate("() => window.updateCurrentUserUI({ name: '김사원', dept: '생산팀 사원' })")
        page.wait_for_timeout(300)
        down = view(page)
        print(f"  * 창을 연 채 사원 -> 대리: {up}, 다시 사원: {down}")
        assert up["filter"] and up["others"], "대리로 바뀌면 바로 전체가 보여야 함"
        assert not down["filter"] and not down["others"], "사원으로 바뀌면 바로 본인 것만 보여야 함"
        ctx.close()

        browser.close()
    assert not errors, f"화면 오류: {errors}"
    print("\n=== [qa_runner_daily_todo_view] ALL PASS ===")


if __name__ == "__main__":
    main()
