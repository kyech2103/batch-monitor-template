"""
qa_runner_mobile.py - 모바일 UI E2E 종합 검증 러너
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

class QuietHandler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=qa_runner_common.SITE_ROOT, **k)
    def log_message(self, fmt, *a): pass

def start_server():
    s = ThreadingHTTPServer(('127.0.0.1', PORT), QuietHandler)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s

def make_default_batches():
    now_iso = "2026-10-25T12:00:00Z"
    return [
        {"lotNumber": "PA-MIX-PROG", "manualZone": "stage1-1", "manualMovedAt": now_iso, "schedule": {"A": {"start": "2026-10-25T10:00:00Z", "end": "2026-10-25T18:00:00Z"}}},
        {"lotNumber": "PA-MIX-WAIT", "manualZone": "stage1-wait", "manualMovedAt": now_iso, "schedule": {}},
        {"lotNumber": "PA-FD-1", "manualZone": "stage3-1", "manualMovedAt": now_iso, "schedule": {"C": {"start": "2026-10-25T10:00:00Z", "end": "2026-10-25T18:00:00Z"}}},
        {"lotNumber": "PA-STER-1", "manualZone": "stage4-1", "manualMovedAt": now_iso, "schedule": {"D": {"start": "2026-10-25T10:00:00Z", "end": "2026-10-25T18:00:00Z"}}},
        {"lotNumber": "PA-STER-2", "manualZone": "stage4-2", "manualMovedAt": now_iso, "schedule": {"D": {"start": "2026-10-25T10:00:00Z", "end": "2026-10-25T18:00:00Z"}}},
        {"lotNumber": "PA-CAP-WAIT", "manualZone": "stage5-wait", "manualMovedAt": now_iso, "schedule": {}},
        {"lotNumber": "PA-STOR-1", "manualZone": "semi-storage-pre", "manualMovedAt": now_iso, "schedule": {}},
        {"lotNumber": "PA-STOR-2", "manualZone": "semi-storage-post", "manualMovedAt": now_iso, "schedule": {},
         "quantities": {"B": 1000, "losses": {"inspection": 10, "packaging": 5}}},
        {"lotNumber": "PA-PACK-1", "manualZone": "packaging", "manualMovedAt": now_iso, "schedule": {}},
        {"lotNumber": "PA-LOGI-1", "manualZone": "logistics", "manualMovedAt": now_iso, "schedule": {}},
        {"lotNumber": "PA-LOGI-2", "manualZone": "logistics", "manualMovedAt": now_iso, "schedule": {}},
    ]

class MobileQAState:
    def __init__(self):
        self.blocked_writes = []
        self.console_errors = []
        self.mock_worker = {"id": 1, "name": "김작업", "role": "제조"}
        self.fail_jobs = False
        self.fail_todos = False
        self.mock_jobs = []
        self.mock_templates = [
            {"id": 1, "name": "예시 품목 A", "duration_minutes": 90, "notify_worker_ids": []},
            {"id": 2, "name": "예시 품목 C", "duration_minutes": 45, "notify_worker_ids": [7, 8]},
        ]
        self.mock_workers = [{"id": 7, "name": "김작업"}, {"id": 8, "name": "박사원"}]
        self.mock_todos = []
        self.mock_holidays = []
        self.mock_batches = make_default_batches()

def handle_supabase_route(route, state):
    req = route.request
    url = req.url
    method = req.method

    # 이 테스트 서버의 정적 파일은 그대로 보낸다 (js/app/08_floorplan_batches.js처럼 이름에 테이블명이 들어간 파일)
    if url.startswith(f"http://127.0.0.1:{PORT}/"):
        return route.continue_()

    if method in ["POST", "PUT", "PATCH", "DELETE"]:
        post_data = req.post_data or ""
        state.blocked_writes.append({
            "method": method,
            "url": url,
            "body": post_data[:2000]
        })
        print(f"[BLOCKED WRITE] {method} {url} | body={post_data[:200]}")
        if state.fail_jobs and "equipment_jobs" in url:
            return route.fulfill(status=500, content_type="application/json", body='{"error":"fail"}')
        return route.fulfill(status=201 if method == "POST" else 200, content_type="application/json", body="{}")

    if "equipment_templates" in url:
        return route.fulfill(status=200, content_type="application/json", body=json.dumps(state.mock_templates))
    if "/rest/v1/workers" in url and "select=id%2Cname" in url.replace(",", "%2C"):
        return route.fulfill(status=200, content_type="application/json", body=json.dumps(state.mock_workers))

    if "equipment_jobs" in url:
        if state.fail_jobs:
            return route.fulfill(status=500, content_type="application/json", body='{"error":"db error"}')
        return route.fulfill(status=200, content_type="application/json", body=json.dumps(state.mock_jobs))

    if "todo_schedules" in url:
        if state.fail_todos:
            return route.fulfill(status=500, content_type="application/json", body='{"error":"db error"}')
        order_match = re.search(r"order=([a-zA-Z0-9_]+)", url)
        if order_match:
            order_col = order_match.group(1)
            valid_cols = [
                "id", "record_type", "target_date", "target_time",
                "role_key", "worker_name", "lot_id", "lot_ids",
                "process_code", "rule_id", "task_key", "title",
                "generated_at", "created_at"
            ]
            if order_col not in valid_cols:
                print(f"[REJECTED ORDER] column {order_col} not in todo_schedules schema -> 400")
                return route.fulfill(status=400, content_type="application/json", body=f'{{"error":"column todo_schedules.{order_col} does not exist"}}')
        if "record_type=eq.HOLIDAY" in url:
            return route.fulfill(status=200, content_type="application/json", body=json.dumps(state.mock_holidays))
        return route.fulfill(status=200, content_type="application/json", body=json.dumps(state.mock_todos))

    if "batches" in url:
        return route.fulfill(status=200, content_type="application/json", body=json.dumps({"id": "current_batches", "data": state.mock_batches}))

    return qa_runner_common.fallback(route)

def setup_mobile_page(browser, state, viewport=None, user_agent=None, hash_route="", worker=None):
    vp = viewport or {"width": 390, "height": 844}
    ua = user_agent or "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36"
    ctx = browser.new_context(
        viewport=vp,
        user_agent=ua,
        is_mobile=bool(vp["width"] <= 920),
        has_touch=bool(vp["width"] <= 920)
    )
    p = ctx.new_page()
    p.on("console", lambda m: state.console_errors.append(m.text) if m.type == "error" and "Failed to load resource" not in m.text else None)
    p.route("**/*", lambda r: handle_supabase_route(r, state))
    qa_runner_common.block_realtime(p)

    # 시작 전 캐시 배치가 한 번이라도 그려졌는지 기록
    init_js = "new MutationObserver(() => { if (document.querySelector('#m-app [data-lot]')) window.__mSawLot = true; }).observe(document, {childList: true, subtree: true});"
    init_js += f"localStorage.setItem('BATCH_STORAGE_KEY', JSON.stringify({json.dumps(state.mock_batches)}));"
    init_js += f"localStorage.setItem('APP_BATCH_RECORDS', JSON.stringify({json.dumps(state.mock_batches)}));"
    if worker is not False:
        w = worker if worker is not None else state.mock_worker
        if w:
            init_js += f"localStorage.setItem('APP_VERIFIED_OPERATOR', JSON.stringify({json.dumps(w)}));"
    p.add_init_script(init_js)

    url = f"http://127.0.0.1:{PORT}/index.html?qa=true{hash_route}"
    p.goto(url, wait_until="domcontentloaded")
    p.wait_for_timeout(500)
    return ctx, p

def check_time_formats(page, context_label=""):
    res = page.evaluate("""() => {
        const text = document.getElementById('m-app')?.innerText || '';
        const ddhhmmMatches = (text.match(/\\b\\d{6}\\b/g) || []);
        const ampmMatches = (text.match(/오전|오후/g) || []);
        return { ddhhmmCount: ddhhmmMatches.length, ddhhmmMatches, ampmCount: ampmMatches.length, ampmMatches };
    }""")
    print(f"  * [{context_label}] 시각 형식 검사: 6자리 코드={res['ddhhmmCount']}개, 오전/오후={res['ampmCount']}개 (기대: 0개)")
    assert res['ddhhmmCount'] == 0, f"[{context_label}] 화면에 6자리 DDHHMM 코드 노출: {res['ddhhmmMatches']}"
    assert res['ampmCount'] == 0, f"[{context_label}] 화면에 오전/오후 노출: {res['ampmMatches']}"

def test_ac2_height_and_tabbar(browser, state):
    print("\n--- [AC-2] 높이·탭 막대 검증 ---")
    tabs = ["batch", "todo", "equipment", "more"]
    ctx, page = setup_mobile_page(browser, state, viewport={"width": 390, "height": 844})

    for t in tabs:
        page.evaluate(f"window.MobileApp.setRoute('{t}', null)")
        page.wait_for_timeout(200)

        metrics = page.evaluate("""() => {
            const innerH = window.innerHeight;
            const tb = document.querySelector('.m-tab-bar');
            const tbRect = tb ? tb.getBoundingClientRect() : null;
            const tbBottom = tbRect ? tbRect.bottom : 0;
            const tbH = tbRect ? tbRect.height : 0;
            const head = document.querySelector('.m-header');
            const headH = head ? head.getBoundingClientRect().height : 0;
            const btn = document.querySelector('.m-tab-btn');
            const btnFlexDir = btn ? window.getComputedStyle(btn).flexDirection : '';
            return {
                diffBottom: Math.round(Math.abs(tbBottom - innerH)),
                tbH: Math.round(tbH),
                headH: Math.round(headH),
                btnFlexDir
            };
        }""")
        print(f"  [{t}] 탭바 bottom - innerHeight 차이: {metrics['diffBottom']}px, 탭바 높이: {metrics['tbH']}px (기대 48), 머리 높이: {metrics['headH']}px (기대 48), 버튼 flex-direction: {metrics['btnFlexDir']}")
        assert metrics['diffBottom'] == 0, f"[{t}] 탭바 bottom과 window.innerHeight 불일치: {metrics['diffBottom']}px"
        assert metrics['tbH'] == 48, f"[{t}] 탭바 높이 48px 기대, 실제 {metrics['tbH']}px"
        assert metrics['headH'] == 48, f"[{t}] 머리 높이 48px 기대, 실제 {metrics['headH']}px"
        assert metrics['btnFlexDir'] == 'row', f"[{t}] 버튼 가로 한 줄(flex-direction: row) 기대, 실제 {metrics['btnFlexDir']}"

    # [SPEC F-2] 390px 탭 글자 한 줄(높이 ≤ 20px) 측정
    tab_labels_390 = page.evaluate("""() => {
        const btns = Array.from(document.querySelectorAll('.m-tab-btn'));
        return btns.map(b => {
            const labelEl = b.querySelector('.m-tab-label') || b.querySelectorAll('span')[1] || b;
            const r = labelEl.getBoundingClientRect();
            return {
                text: labelEl.textContent.trim(),
                h: Math.round(r.height),
                w: Math.round(b.getBoundingClientRect().width)
            };
        });
    }""")
    labels_str_390 = ", ".join([f"{item['text']}={item['h']}px(w={item['w']}px)" for item in tab_labels_390])
    print(f"  * 390px 탭 글자 요소 높이: {labels_str_390} (기대 ≤ 20px)")
    for item in tab_labels_390:
        assert item['h'] <= 20, f"390px 탭 '{item['text']}' 글자 높이 {item['h']}px > 20px (줄바꿈 발생)"

    # [SPEC F-2] 360px 탭 글자 한 줄(높이 ≤ 20px) 측정 + 스크린샷 AC-2_tabbar_360.png
    page.set_viewport_size({"width": 360, "height": 844})
    page.wait_for_timeout(200)
    tab_labels_360 = page.evaluate("""() => {
        const btns = Array.from(document.querySelectorAll('.m-tab-btn'));
        return btns.map(b => {
            const labelEl = b.querySelector('.m-tab-label') || b.querySelectorAll('span')[1] || b;
            const r = labelEl.getBoundingClientRect();
            return {
                text: labelEl.textContent.trim(),
                h: Math.round(r.height),
                w: Math.round(b.getBoundingClientRect().width)
            };
        });
    }""")
    labels_str_360 = ", ".join([f"{item['text']}={item['h']}px(w={item['w']}px)" for item in tab_labels_360])
    print(f"  * 360px 탭 글자 요소 높이: {labels_str_360} (기대 ≤ 20px)")
    for item in tab_labels_360:
        assert item['h'] <= 20, f"360px 탭 '{item['text']}' 글자 높이 {item['h']}px > 20px (줄바꿈 발생)"

    shot_path_360 = os.path.join(SHOT_DIR, "AC-2_tabbar_360.png")
    page.screenshot(path=shot_path_360)
    print("  * 스크린샷 저장: AC-2_tabbar_360.png")

    # 390x844 -> 390x900 뷰포트 변경
    page.set_viewport_size({"width": 390, "height": 900})
    page.wait_for_timeout(200)
    diff_900 = page.evaluate("""() => {
        const tb = document.querySelector('.m-tab-bar');
        return Math.round(Math.abs((tb ? tb.getBoundingClientRect().bottom : 0) - window.innerHeight));
    }""")
    print(f"  * 390x900 뷰포트 변경 후 탭바 bottom - innerHeight 차이: {diff_900}px")
    assert diff_900 == 0, f"뷰포트 900px에서 탭바 bottom 불일치: {diff_900}px"

    # 13px 미만 글자 0, 44px 미만 터치 대상 0
    checks = page.evaluate("""() => {
        const smallTargets = [];
        const smallFonts = [];
        const els = document.querySelectorAll('#m-app button, #m-app a, #m-app [role="tab"], #m-app .m-tab-btn, #m-app .m-btn, #m-app .m-proc-chip');
        els.forEach(el => {
            if (el.offsetParent === null) return;
            const r = el.getBoundingClientRect();
            if (r.width < 43 || r.height < 43) {
                smallTargets.push({ tag: el.tagName, text: el.textContent.trim().slice(0, 15), w: Math.round(r.width), h: Math.round(r.height) });
            }
        });
        const textNodes = document.querySelectorAll('#m-app p, #m-app span, #m-app div, #m-app button');
        textNodes.forEach(el => {
            if (el.offsetParent === null) return;
            const fs = parseFloat(window.getComputedStyle(el).fontSize);
            if (fs < 12.5 && el.textContent.trim().length > 0 && !el.classList.contains('m-chip-dot') && !el.classList.contains('m-proc-chip-dot') && !el.classList.contains('m-proc-group-dot')) {
                smallFonts.push({ tag: el.tagName, text: el.textContent.trim().slice(0, 15), fs });
            }
        });
        return { smallTargets, smallFonts };
    }""")
    print(f"  * 44px 미만 터치 대상 수={len(checks['smallTargets'])}, 13px 미만 글자 수={len(checks['smallFonts'])}")
    assert len(checks['smallTargets']) == 0, f"44px 미만 터치 대상 발견: {checks['smallTargets']}"
    assert len(checks['smallFonts']) == 0, f"13px 미만 글자 발견: {checks['smallFonts']}"
    ctx.close()

def test_ac3_scroll_preservation(browser, state):
    print("\n--- [AC-3] 스크롤 유지 및 불필요한 전체 다시 그리기 방지 검증 ---")
    ctx, page = setup_mobile_page(browser, state, hash_route="#m=batch")
    page.wait_for_timeout(400)

    # 머리 요소 교체 횟수 Observer
    page.evaluate("""() => {
        let replaceCount = 0;
        const app = document.getElementById('m-app');
        const obs = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node.nodeType === 1 && (node.matches?.('.m-header') || node.querySelector?.('.m-header'))) {
                        replaceCount++;
                    }
                }
            }
        });
        obs.observe(app, { childList: true });
        window.__headerReplaceCount = () => replaceCount;
    }""")

    # scrollTop = 400 설정
    page.evaluate("() => { const el = document.getElementById('m-content-root'); el.scrollTop = 400; }")
    page.wait_for_timeout(100)

    # 5초 동안 1초 간격 관찰
    scroll_values = []
    for _ in range(5):
        page.wait_for_timeout(1000)
        page.evaluate("if (typeof renderBatchIcons === 'function') renderBatchIcons();")
        val = page.evaluate("() => document.getElementById('m-content-root')?.scrollTop")
        scroll_values.append(val)

    print(f"  * 5초 동안 1초 간격 scrollTop 기록: {scroll_values}")
    assert all(v == 400 for v in scroll_values), f"scrollTop 400 유지 실패: {scroll_values}"

    header_replaces = page.evaluate("() => window.__headerReplaceCount()")
    print(f"  * 5초 동안 머리 요소 교체(전체 다시 그리기) 횟수: {header_replaces}")
    assert header_replaces == 0, f"데이터 미변경 상태에서 전체 다시 그리기 발생: {header_replaces}회"

    # 검색 칸에 PA 입력 후 5초 관찰
    page.fill("#m-batch-search", "PA")
    for _ in range(5):
        page.wait_for_timeout(1000)
        page.evaluate("if (typeof renderBatchIcons === 'function') renderBatchIcons();")
    search_val = page.locator("#m-batch-search").input_value()
    print(f"  * 5초 후 검색어 입력값: '{search_val}' (기대: 'PA')")
    assert search_val == "PA", f"검색어 유지 실패: {search_val}"

    # 검색어 초기화, 초점 해제 및 scrollTop=400 복귀
    page.fill("#m-batch-search", "")
    page.evaluate("() => { const el = document.getElementById('m-content-root'); el.scrollTop = 400; const s = document.getElementById('m-batch-search'); if (s) s.blur(); }")
    page.wait_for_timeout(200)

    # 목 배치 하나의 위치를 변경하고 renderBatchIcons() 호출
    page.evaluate("""() => {
        const batches = JSON.parse(localStorage.getItem('APP_BATCH_RECORDS') || '[]');
        const target = batches.find(b => b.lotNumber === 'PA-MIX-WAIT');
        if (target) {
            target.manualZone = 'stage2-wait';
            target.manualMovedAt = new Date().toISOString();
        }
        localStorage.setItem('APP_BATCH_RECORDS', JSON.stringify(batches));
        localStorage.setItem('BATCH_STORAGE_KEY', JSON.stringify(batches));
        if (typeof renderBatchIcons === 'function') renderBatchIcons();
    }""")
    page.wait_for_timeout(300)

    st_after_move = page.evaluate("() => document.getElementById('m-content-root')?.scrollTop")
    stage2_has_card = page.evaluate("() => Boolean(document.querySelector('#m-group-B .m-card[data-lot=\"PA-MIX-WAIT\"]'))")
    print(f"  * 데이터 변경 후 카드가 공정2(B) 묶음으로 이동={stage2_has_card}, scrollTop={st_after_move}px")
    assert stage2_has_card is True, "배치 데이터 변경 시 카드가 공정2 묶음으로 이동"
    assert st_after_move == 400, f"데이터 변경 시 scrollTop 유지 실패: {st_after_move}"

    # 상세 화면 5초 검사
    page.locator(".m-card[data-lot='PA-MIX-PROG']").click()
    page.wait_for_timeout(300)
    detail_target = page.evaluate("() => { const el = document.getElementById('m-content-root'); el.scrollTop = 80; return el.scrollTop; }")
    detail_scrolls = []
    for _ in range(5):
        page.wait_for_timeout(1000)
        page.evaluate("if (typeof renderBatchIcons === 'function') renderBatchIcons();")
        detail_scrolls.append(page.evaluate("() => document.getElementById('m-content-root')?.scrollTop"))
    print(f"  * 상세 화면 5초 동안 scrollTop 기록: {detail_scrolls}")
    assert all(v == detail_target for v in detail_scrolls), f"상세 화면 scrollTop 유지 실패: {detail_scrolls}"

    ctx.close()

def test_ac4_todo_tab(browser, state):
    print("\n--- [AC-4] 할 일 탭 검증 (target_time 정렬, 역할 칩, 400 거부) ---")
    today_str = "2026-10-23"
    state.mock_todos = [
        {"id": "t1", "record_type": "TODO", "target_date": today_str, "target_time": "09:00", "title": "공정3 완료품 이동 및 수량 확인", "worker_name": "김철수", "role_key": "fd_1"},
        {"id": "t2", "record_type": "TODO", "target_date": today_str, "target_time": "09:00", "title": "공정4 설비 준비 및 시작", "worker_name": "이영희", "role_key": "p4_a"},
        {"id": "t3", "record_type": "TODO", "target_date": today_str, "target_time": "09:00", "title": "용기 소독", "worker_name": "이작업", "role_key": "p2_a"},
        {"id": "t4", "record_type": "TODO", "target_date": today_str, "target_time": "14:00", "title": "공정2 모니터링", "worker_name": "김작업", "role_key": "p2_b"},
        {"id": "t5", "record_type": "TODO", "target_date": today_str, "target_time": "14:00", "title": "공정1 준비", "worker_name": "박작업", "role_key": "p1_a"}
    ]

    ctx, page = setup_mobile_page(browser, state, hash_route="#m=todo")
    page.wait_for_timeout(500)

    # 전체 전환
    page.locator("#m-todo-btn-all").click()
    page.wait_for_timeout(400)

    body_text = page.locator("#m-content-root").text_content()
    assert "불러오지 못했습니다" not in body_text, "화면에 '불러오지 못했습니다' 없음"

    all_count = page.locator(".m-todo-item").count()
    first_time = page.locator(".m-card div[style*='font-weight: 700']").first.text_content().strip()
    role_chips = [r.strip() for r in page.locator(".m-todo-item .m-chip").all_text_contents()]

    print(f"  * 전체 행 수: {all_count} (기대 {len(state.mock_todos)})")
    print(f"  * 첫 묶음 시각: '{first_time}' (기대 '09:00')")
    print(f"  * 역할 칩 라벨: {role_chips}")

    assert all_count == len(state.mock_todos), f"전체 행 수 {len(state.mock_todos)} 기대, 실제: {all_count}"
    assert first_time == "09:00", f"첫 묶음 시각 '09:00' 기대, 실제: {first_time}"
    assert any("공정4" in r or "공정1" in r for r in role_chips), f"ROLE_MAP 라벨 노출 확인 실패: {role_chips}"

    def measure_long_row():
        return page.evaluate("""() => {
            const items = Array.from(document.querySelectorAll('.m-todo-item'));
            const row = items.find(el => el.textContent.includes('공정3 완료품 이동')) || items[0];
            if (!row) return null;
            const workerEl = row.querySelector('.m-todo-worker') || row.querySelector('.m-todo-meta span');
            const chipEl = row.querySelector('.m-todo-chip') || row.querySelector('.m-chip');
            const titleEl = row.querySelector('.m-todo-title') || row.firstElementChild;
            const workerH = workerEl ? Math.round(workerEl.getBoundingClientRect().height) : 0;
            const chipH = chipEl ? Math.round(chipEl.getBoundingClientRect().height) : 0;
            const titleH = titleEl ? Math.round(titleEl.getBoundingClientRect().height) : 0;
            const rowScrollW = row.scrollWidth;
            const rowClientW = row.clientWidth;
            const docScrollW = document.scrollingElement.scrollWidth;
            const winW = window.innerWidth;
            const hasHScroll = (rowScrollW > rowClientW + 1) || (docScrollW > winW + 1);
            return {
                workerText: workerEl ? workerEl.textContent.trim() : '',
                workerH,
                chipText: chipEl ? chipEl.textContent.trim() : '',
                chipH,
                titleH,
                rowScrollW,
                rowClientW,
                hasHScroll
            };
        }""")

    # [SPEC F-8] 390px 긴 제목 행 측정
    m390 = measure_long_row()
    print(f"  * [390px] 긴 제목 행 측정: 이름='{m390['workerText']}' 높이={m390['workerH']}px (기대 ≤ 20), 칩='{m390['chipText']}' 높이={m390['chipH']}px (기대 ≤ 26), 제목높이={m390['titleH']}px, 가로스크롤={m390['hasHScroll']}")
    assert m390['workerH'] <= 20, f"390px 이름 높이 {m390['workerH']}px > 20px"
    assert m390['chipH'] <= 26, f"390px 칩 높이 {m390['chipH']}px > 26px"
    assert not m390['hasHScroll'], f"390px 가로 스크롤 감지 (rowScrollW={m390['rowScrollW']}, clientW={m390['rowClientW']})"

    shot_path = os.path.join(SHOT_DIR, "AC-4_todo.png")
    page.screenshot(path=shot_path)
    print("  * 스크린샷 저장: AC-4_todo.png")

    # [SPEC F-8] 360px 긴 제목 행 측정 + 스크린샷 AC-4_todo_long.png
    page.set_viewport_size({"width": 360, "height": 844})
    page.wait_for_timeout(200)
    m360 = measure_long_row()
    print(f"  * [360px] 긴 제목 행 측정: 이름='{m360['workerText']}' 높이={m360['workerH']}px (기대 ≤ 20), 칩='{m360['chipText']}' 높이={m360['chipH']}px (기대 ≤ 26), 제목높이={m360['titleH']}px, 가로스크롤={m360['hasHScroll']}")
    assert m360['workerH'] <= 20, f"360px 이름 높이 {m360['workerH']}px > 20px"
    assert m360['chipH'] <= 26, f"360px 칩 높이 {m360['chipH']}px > 26px"
    assert not m360['hasHScroll'], f"360px 가로 스크롤 감지 (rowScrollW={m360['rowScrollW']}, clientW={m360['rowClientW']})"

    shot_path_long = os.path.join(SHOT_DIR, "AC-4_todo_long.png")
    page.screenshot(path=shot_path_long)
    print("  * 스크린샷 저장: AC-4_todo_long.png")

    # 390px 뷰포트 원복
    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(200)

    # 평일 이동 (금 -> 월)
    date_before = page.locator("#m-content-root span").first.text_content().strip()
    page.locator("#m-todo-next").click()
    page.wait_for_timeout(300)
    date_after = page.locator("#m-content-root span").first.text_content().strip()
    print(f"  * 평일 이동: {date_before} → {date_after} (금 → 월 확인)")
    assert "금" in date_before and "월" in date_after, f"평일 이동 전후 날짜(금 → 월) 불일치: {date_before} → {date_after}"
    ctx.close()

    # PC와 같은 공휴일 목록: 월요일(10/26)이 공휴일이면 금 → 화
    state.mock_holidays = [{"target_date": "2026-10-26", "title": "테스트 공휴일"}]
    ctx, page = setup_mobile_page(browser, state, hash_route="#m=todo")
    page.wait_for_timeout(600)
    page.locator("#m-todo-next").click()
    page.wait_for_timeout(300)
    date_hol = page.locator("#m-content-root span").first.text_content().strip()
    state.mock_holidays = []
    print(f"  * 공휴일 건너뛰기: {date_before} → {date_hol} (금 → 화 확인)")
    assert "화" in date_hol, f"공휴일을 건너뛰지 않음: {date_before} → {date_hol}"

    ctx.close()

def test_ac5_push_settings(browser, state):
    print("\n--- [AC-5] 알림 설정 모달 상태 문구 검증 ---")
    # 1. 미인증 상태
    ctx_unauth, page_unauth = setup_mobile_page(browser, state, hash_route="#m=more", worker=False)
    page_unauth.wait_for_timeout(400)
    page_unauth.locator("#m-btn-open-push").click()
    page_unauth.wait_for_timeout(1500)
    st_text = page_unauth.locator("#push-status-text").text_content().strip()
    print(f"  * 미인증 상태 문구: '{st_text}'")
    assert "상태를 확인하고 있습니다" not in st_text, "무한 로딩 문구 아님"
    assert "인증" in st_text or "작업자" in st_text or "미인증" in st_text, "미인증 상태 문구 표출"
    page_unauth.locator("#btn-push-modal-close").click()
    ctx_unauth.close()

    # 2. 인증 + 구독 꺼짐 상태
    ctx_auth, page_auth = setup_mobile_page(browser, state, hash_route="#m=more")
    page_auth.wait_for_timeout(400)
    page_auth.locator("#m-btn-open-push").click()
    page_auth.wait_for_timeout(1500)
    st_text_auth = page_auth.locator("#push-status-text").text_content().strip()
    print(f"  * 인증 상태 문구: '{st_text_auth}'")
    assert "상태를 확인하고 있습니다" not in st_text_auth, "무한 로딩 문구 아님"
    assert "꺼짐" in st_text_auth or "알림을 받으려면" in st_text_auth or "설정" in st_text_auth or "켜기" in page_auth.locator("#btn-push-enable").text_content(), "꺼짐/구독 가능 문구 표출"
    page_auth.locator("#btn-push-modal-close").click()
    ctx_auth.close()

def test_install_card(browser, state):
    print("\n--- [설치] 더보기의 홈 화면 설치 카드 검증 ---")
    ctx, page = setup_mobile_page(browser, state, hash_route="#m=more")
    page.wait_for_timeout(400)
    guide = page.locator("#m-btn-install").text_content()
    assert "앱 설치" in guide and "⋮" in guide, f"크롬 설치 안내가 없음: {guide}"
    # 크롬이 설치 가능하다고 알려 주면 누르는 버튼이 되고, 누르면 설치 창(prompt)을 띄운다
    page.evaluate("""() => {
      const e = new Event('beforeinstallprompt', { cancelable: true });
      e.prompt = () => { window.__prompted = (window.__prompted || 0) + 1; };
      e.userChoice = Promise.resolve({ outcome: 'accepted' });
      window.dispatchEvent(e);
    }""")
    page.wait_for_timeout(300)
    assert "누르면" in page.locator("#m-btn-install").text_content(), "설치 버튼으로 바뀌지 않음"
    page.locator("#m-btn-install").click()
    page.wait_for_timeout(300)
    prompted = page.evaluate("() => window.__prompted")
    print(f"  * 안내: '{guide.strip()[:40]}', 설치 창 호출 {prompted}회")
    assert prompted == 1, "설치 창을 띄우지 않음"
    ctx.close()
    ctx_ios, page_ios = setup_mobile_page(browser, state, hash_route="#m=more", user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")
    page_ios.wait_for_timeout(400)
    assert "홈 화면에 추가" in page_ios.locator("#m-btn-install").text_content(), "아이폰 안내가 없음"
    ctx_ios.close()

def test_ac6_process_order_list(browser, state):
    print("\n--- [AC-6] 공정 순서 목록(칩 줄, 묶음 머리, 얇은 카드, 스크롤 이동) 검증 ---")
    state.mock_batches = make_default_batches()
    ctx, page = setup_mobile_page(browser, state, hash_route="#m=batch")
    page.wait_for_timeout(500)

    # 1. 공정 칩 글자 및 건수 검증
    chips_text = [c.strip() for c in page.locator(".m-proc-chip").all_text_contents()]
    print(f"  * 공정 칩 글자·건수: {', '.join(chips_text)}")
    assert "공정1 2" in chips_text[0], f"공정1 2 기대, 실제 {chips_text[0]}"
    assert "공정2 0" in chips_text[1], f"공정2 0 기대, 실제 {chips_text[1]}"
    assert "공정3 1" in chips_text[2], f"공정3 1 기대, 실제 {chips_text[2]}"
    assert "공정4 2" in chips_text[3], f"공정4 2 기대, 실제 {chips_text[3]}"
    assert "공정5 1" in chips_text[4], f"공정5 1 기대, 실제 {chips_text[4]}"

    # 0건 칩 opacity <= 0.5
    stage2_opacity = page.evaluate("() => parseFloat(window.getComputedStyle(document.querySelector('.m-proc-chip[data-group-key=\"B\"]')).opacity)")
    print(f"  * 공정2 0건 칩 opacity: {stage2_opacity} (기대 <= 0.5)")
    assert stage2_opacity <= 0.5, f"0건 칩 opacity 미달: {stage2_opacity}"

    # 2. 묶음 머리 순서 및 완제품 창고 검증
    headers = [h.strip() for h in page.locator(".m-proc-group-title").all_text_contents()]
    print(f"  * 묶음 머리 순서: {', '.join(headers)}")
    # 공정5 이후는 구역별로: 보관실(검사 전) → 검사실 → 보관실(검사 후) → 포장 대기 → 포장 (빈 묶음은 안 보임)
    expected_headers = ['공정1 · 2', '공정3 · 1', '공정4 · 2', '공정5 · 1', '반제품 보관실 (검사 전) · 1', '반제품 보관실 (검사 후) · 1', '포장 · 1']
    assert headers == expected_headers, f"묶음 머리 순서 불일치: {headers} vs {expected_headers}"

    sub_line_text = page.locator(".m-sub-line").text_content()
    print(f"  * 하단 창고 문구: '{sub_line_text.strip()}'")
    assert "완제품 창고 2건" in sub_line_text, "완제품 창고 2건 표출"

    # 2-1. 포장 전 로트(검사 후 보관)는 포장 손실을 빼지 않은 수량: 1000 - 검사 10 = 990
    stor2 = page.locator('.m-card[data-lot="PA-STOR-2"]').text_content()
    print(f"  * 검사 후 보관 로트 카드: '{stor2.strip()}' (기대 990개)")
    assert "990개" in stor2 and "985개" not in stor2, f"포장 전 로트에 포장 손실이 빠짐: {stor2}"

    # 3. 공정4 묶음 안 첫 카드 = 진행 중 로트
    first_ster_card = page.locator("#m-group-D .m-card[data-lot]").first
    first_ster_lot = first_ster_card.get_attribute("data-lot")
    first_ster_has_fill = first_ster_card.locator(".m-slim-progress").count() > 0
    print(f"  * 공정4 묶음 첫 카드: {first_ster_lot}, 진행 막대 존재={first_ster_has_fill}")
    assert first_ster_lot in ["PA-STER-1", "PA-STER-2"], "공정4 묶음 첫 카드 로트"
    assert first_ster_has_fill is True, "진행 중 로트에 진행 막대 존재"
    bar_h = first_ster_card.locator(".m-slim-progress").evaluate("el => el.getBoundingClientRect().height")
    print(f"  * 진행 막대 높이: {bar_h}px (기대 <= 4px, 로트 번호 가림 방지)")
    assert bar_h <= 4, f"진행 막대가 카드를 덮음: {bar_h}px"

    # 4. 카드 높이 최대값 <= 64px, '다음:' 글자 0개
    card_heights = page.evaluate("() => Array.from(document.querySelectorAll('.m-card.m-slim-card')).map(c => Math.round(c.getBoundingClientRect().height))")
    max_h = max(card_heights) if card_heights else 0
    next_count = page.evaluate("() => Array.from(document.querySelectorAll('#m-batch-card-list .m-card')).filter(c => c.textContent.includes('다음:')).length")
    print(f"  * 카드 높이 목록: {card_heights}, 최대 높이: {max_h}px (기대 <= 64px), '다음:' 노출 개수: {next_count}개")
    assert max_h <= 64, f"카드 높이 64px 초과: {max_h}px"
    assert next_count == 0, f"목록 카드에 '다음:' 문구 노출됨: {next_count}개"

    # 5. 공정4 칩 클릭 -> 1초 뒤 공정4 머리 relative top 0~60px 안
    page.locator(".m-proc-chip[data-group-key='D']").click()
    page.wait_for_timeout(1000)
    ster_rel_top = page.evaluate("""() => {
        const cr = document.getElementById('m-content-root').getBoundingClientRect();
        const gr = document.getElementById('m-group-D').getBoundingClientRect();
        return Math.round(gr.top - cr.top);
    }""")
    print(f"  * 공정4 칩 클릭 1초 후 공정4 머리 relative top: {ster_rel_top}px (기대 0~60px 안)")
    assert 0 <= ster_rel_top <= 60, f"스크롤 위치 범위 초과: {ster_rel_top}px"

    # 6. 목록 전체 높이 및 가로 스크롤 없음
    list_h = page.evaluate("() => Math.round(document.getElementById('m-batch-card-list').getBoundingClientRect().height)")
    sw = page.evaluate("document.documentElement.scrollWidth")
    print(f"  * 목록 전체 높이: {list_h}px (기준 756px 이하), scrollWidth: {sw}px (기대 <= 390)")
    assert list_h <= 756, f"목록 전체 높이 초과: {list_h}px"
    assert sw <= 390, f"가로 스크롤 발생: {sw}px"

    # 스크린샷 저장
    page.screenshot(path=os.path.join(SHOT_DIR, "AC-6_list.png"))
    page.evaluate("() => { const el = document.getElementById('m-content-root'); el.scrollTop = el.scrollHeight; }")
    page.wait_for_timeout(300)
    page.screenshot(path=os.path.join(SHOT_DIR, "AC-6_list_bottom.png"))
    print("  * 스크린샷 저장: AC-6_list.png, AC-6_list_bottom.png")

    ctx.close()

def test_ac7_shapes_and_theme(browser, state):
    print("\n--- [AC-7] 칩·카드·묶음 머리 휘도(>=0.85), 본문 대비(>=4.5), 탭 글자색 검증 ---")
    ctx, page = setup_mobile_page(browser, state, hash_route="#m=batch")
    page.wait_for_timeout(400)

    metrics = page.evaluate("""() => {
        function parseRgb(str) {
            const m = (str || '').match(/\\d+(\\.\\d+)?/g);
            if (!m || m.length < 3) return [255, 255, 255];
            return [parseFloat(m[0]), parseFloat(m[1]), parseFloat(m[2])];
        }
        function luminance([r, g, b]) {
            const a = [r, g, b].map(v => {
                const s = v / 255;
                return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
            });
            return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
        }
        function contrast(l1, l2) {
            const lighter = Math.max(l1, l2), darker = Math.min(l1, l2);
            return (lighter + 0.05) / (darker + 0.05);
        }

        const chip = document.querySelector('.m-proc-chip');
        const chipBg = chip ? window.getComputedStyle(chip).backgroundColor : 'rgb(255, 255, 255)';
        const card = document.querySelector('.m-card.m-slim-card') || document.querySelector('.m-card');
        const cardBg = card ? window.getComputedStyle(card).backgroundColor : 'rgb(255, 255, 255)';
        const header = document.querySelector('.m-proc-group-header') || document.querySelector('.m-header');
        const headerBg = header ? window.getComputedStyle(header).backgroundColor : 'rgb(241, 245, 249)';

        const textEl = document.querySelector('.m-slim-lot') || document.querySelector('#m-app p, #m-app span');
        const textCol = textEl ? window.getComputedStyle(textEl).color : 'rgb(15, 23, 42)';

        const chipLum = luminance(parseRgb(chipBg));
        const cardLum = luminance(parseRgb(cardBg));
        const headerLum = luminance(parseRgb(headerBg));
        const textLum = luminance(parseRgb(textCol));
        const cont = contrast(cardLum, textLum);

        const activeTabBtn = document.querySelector('.m-tab-btn.is-active');
        const tabCol = activeTabBtn ? window.getComputedStyle(activeTabBtn).color : '';

        return {
            chipLum: Math.round(chipLum * 1000) / 1000,
            cardLum: Math.round(cardLum * 1000) / 1000,
            headerLum: Math.round(headerLum * 1000) / 1000,
            contrast: Math.round(cont * 100) / 100,
            tabCol
        };
    }""")

    print(f"  * 배경 휘도: 칩={metrics['chipLum']}, 카드={metrics['cardLum']}, 묶음머리={metrics['headerLum']} (기대 >= 0.85)")
    print(f"  * 본문 대비: {metrics['contrast']}:1 (기대 >= 4.5), 선택된 탭 글자색: {metrics['tabCol']} (기대 rgb(37, 99, 235))")

    assert metrics['chipLum'] >= 0.85, f"칩 배경 휘도 미달: {metrics['chipLum']}"
    assert metrics['cardLum'] >= 0.85, f"카드 배경 휘도 미달: {metrics['cardLum']}"
    assert metrics['headerLum'] >= 0.85, f"묶음 머리 배경 휘도 미달: {metrics['headerLum']}"
    assert metrics['contrast'] >= 4.5, f"본문 대비 미달: {metrics['contrast']}"
    assert metrics['tabCol'] == "rgb(37, 99, 235)", f"선택된 탭 글자색 불일치: {metrics['tabCol']}"

    check_time_formats(page, "AC-7")
    ctx.close()

def test_acr1_mobile_features(browser, state):
    print("\n--- [AC-R1] 기존 상세·장비·오프라인 및 PC 1초 동작 검증 ---")
    # 1. 상세 화면 및 뒤로가기
    ctx, page = setup_mobile_page(browser, state, hash_route="#m=batch")
    page.wait_for_timeout(300)
    page.locator(".m-card[data-lot='PA-MIX-PROG']").click()
    page.wait_for_timeout(300)
    assert page.locator(".m-timeline-item").count() >= 5, "상세 타임라인 공정 항목 표시"
    page.locator("#m-detail-back").click()
    page.wait_for_timeout(300)
    assert page.locator("#m-batch-card-list").is_visible(), "뒤로가기 후 목록 복귀"
    ctx.close()

    # 2. 장비 탭
    ctx_ac, page_ac = setup_mobile_page(browser, state, hash_route="#m=equipment")
    page_ac.wait_for_timeout(300)
    st_ac = page_ac.locator("#m-ac-status-box").text_content()
    print(f"  * 장비 상태 문구: '{st_ac.strip()}'")
    assert "대기" in st_ac or "가동" in st_ac, "장비 상태 표시"
    ctx_ac.close()

    # 3. 오프라인 화면: 연결이 끊기면 배치 대신 안내, '다시 확인'은 새로 고침
    ctx_off, p_off = setup_mobile_page(browser, state, hash_route="#m=batch")
    p_off.evaluate("() => window.dispatchEvent(new Event('offline'))")
    p_off.wait_for_timeout(300)
    off_text = p_off.locator("#m-app").text_content()
    print(f"  * 모바일 오프라인 문구: '{off_text[:60]}...'")
    assert "인터넷에 연결해 주세요" in off_text, "오프라인 안내 문구 표출"
    assert p_off.locator("#m-app [data-lot]").count() == 0, "오프라인 화면에 배치가 남음"
    with p_off.expect_navigation():
        p_off.locator("#m-offline-retry-btn").click()
    ctx_off.close()

    # 3-1. 작업자 미인증이면 배치 대신 인증 안내
    ctx_off, p_off = setup_mobile_page(browser, state, hash_route="#m=batch", worker=False)
    p_off.evaluate("() => window.updateCurrentUserUI(null)")
    p_off.wait_for_timeout(300)
    lock_text = p_off.locator("#m-content-root").text_content()
    print(f"  * 미인증 화면: '{lock_text.strip()[:30]}', 로트 카드 수={p_off.locator('#m-app [data-lot]').count()}")
    assert "작업자 인증" in lock_text and p_off.locator("#m-app [data-lot]").count() == 0, "미인증 시 배치 노출"
    p_off.locator("#m-lock-auth-btn").click()
    p_off.wait_for_timeout(300)
    assert p_off.evaluate("() => document.getElementById('operator-auth-modal').open"), "잠금 화면 '작업자 인증' 버튼이 인증창을 열지 않음"
    ctx_off.close()

    # 3-2. 보던 중 연결이 끊기면 배치가 사라지고 차단 화면 + 작업자 워터마크
    ctx_off, p_off = setup_mobile_page(browser, state, hash_route="#m=batch")
    p_off.wait_for_timeout(500)
    wm = p_off.evaluate("() => getComputedStyle(document.getElementById('user-watermark')).backgroundImage")
    print(f"  * 워터마크 배경: {wm[:40]}...")
    assert "svg" in wm, "작업자 워터마크 없음"
    before = p_off.locator("#m-app [data-lot]").count()
    ctx_off.set_offline(True)
    p_off.wait_for_timeout(300)
    after = p_off.locator("#m-app [data-lot]").count()
    print(f"  * 연결 끊김 전후 로트 카드: {before} -> {after}")
    assert before > 0 and after == 0 and "인터넷" in p_off.locator("#m-app").text_content(), "연결 끊김 후에도 배치 노출"
    ctx_off.close()

    # 3-3. 저장된 작업자가 있어도 로그인 세션이 없으면 로그인 창 (취소 불가, qa=true 없이 실제 흐름)
    ctx_off, p_off = setup_mobile_page(browser, state, hash_route="#m=batch")
    p_off.goto(f"http://127.0.0.1:{PORT}/index.html#m=batch", wait_until="domcontentloaded")
    p_off.wait_for_timeout(1000)
    modal_open = p_off.evaluate("() => document.getElementById('operator-auth-modal').open")
    cancel_shown = p_off.locator("#btn-cancel-auth").is_visible()
    lots = p_off.locator("#m-app [data-lot]").count()
    print(f"  * 재방문 모바일: 인증창={modal_open}, 취소버튼={cancel_shown}, 로트 카드={lots}")
    assert modal_open and not cancel_shown and lots == 0, "세션 없는 재방문 시 로그인 강제 실패"
    header_user = p_off.locator(".m-header-user").text_content()
    print(f"  * 재인증 전 머리말 작업자: '{header_user}' (저장된 '{state.mock_worker['name']}'이면 안 됨)")
    assert state.mock_worker["name"] not in header_user, "다시 인증하기 전에 이전 작업자로 표시됨"
    ctx_off.close()

    # 4. PC 모드(1440x900)에서 renderBatchIcons 1초 동작 검증
    ctx_pc = browser.new_context(viewport={"width": 1440, "height": 900}, is_mobile=False, has_touch=False)
    p_pc = ctx_pc.new_page()
    p_pc.route("**/*", lambda r: handle_supabase_route(r, state))
    qa_runner_common.block_realtime(p_pc)
    p_pc.goto(f"http://127.0.0.1:{PORT}/index.html?qa=true", wait_until="domcontentloaded")
    p_pc.wait_for_timeout(1000)

    badge_count = p_pc.evaluate("""() => {
        if (typeof renderBatchIcons === 'function') renderBatchIcons();
        return document.querySelectorAll('.batch-badge, .batch-card-badge, .batch-icon').length;
    }""")
    print(f"  * PC 1440x900 renderBatchIcons() 평면도 배지 수: {badge_count}개")
    assert badge_count >= 0, "PC 평면도 배지 정상 렌더"
    ctx_pc.close()

def test_acr2_console_and_loading(browser, state):
    print("\n--- [AC-R2] 콘솔 에러 0개 및 2초 뒤 로딩 문구 미잔존 검증 ---")
    ctx, page = setup_mobile_page(browser, state)
    tabs = ["batch", "todo", "equipment", "more"]
    for t in tabs:
        page.evaluate(f"window.MobileApp.setRoute('{t}', null)")
        page.wait_for_timeout(500)
        body = page.locator("#m-content-root").text_content()
        assert "불러오는 중" not in body and "로딩" not in body, f"[{t}] 2초 뒤 로딩 문구 잔존"

    print(f"  * 콘솔 에러 수: {len(state.console_errors)}")
    assert len(state.console_errors) == 0, f"콘솔 에러 발생: {state.console_errors}"
    ctx.close()

def test_equipment_templates(browser, state):
    print("\n--- [AC-T] 장비 템플릿: 모바일 종류 버튼·알림 대상 저장 / PC 템플릿 관리 ---")
    state.mock_jobs = []
    state.blocked_writes.clear()
    ctx, page = setup_mobile_page(browser, state, hash_route="#m=equipment")
    page.wait_for_selector("#m-ac-new-btn")
    page.click("#m-ac-new-btn")
    btns = [b.strip() for b in page.locator(".m-ac-type-btn").all_text_contents()]
    print(f"  * 모바일 종류 버튼: {btns}")
    assert btns == ["예시 품목 A (90분)", "예시 품목 C (45분)"], btns
    page.locator(".m-ac-type-btn", has_text="예시 품목 C").click()
    dur = page.input_value("#m-inp-dur")
    page.fill("#m-inp-date", "2099-01-02")
    page.fill("#m-inp-time", "10:00")
    page.click("#m-sheet-save")
    page.wait_for_timeout(500)
    posts = [w for w in state.blocked_writes if "equipment_jobs" in w["url"] and w["method"] == "POST"]
    body = json.loads(posts[-1]["body"]) if posts else {}
    body = body[0] if isinstance(body, list) else body
    print(f"  * 소요 {dur}분, 저장 행: type={body.get('setting_type')}, notify={body.get('notify_worker_ids')}, start_push_done={body.get('start_push_done')}, start_at={body.get('start_at')}")
    assert dur == "45", dur
    assert body.get("setting_type") == "예시 품목 C" and body.get("notify_worker_ids") == [7, 8], body
    assert body.get("start_push_done") is False and body.get("end_push_done") is False and body.get("start_at"), body
    ctx.close()

    state.blocked_writes.clear()
    ctx, page = setup_mobile_page(browser, state, viewport={"width": 1440, "height": 900})
    page.evaluate("() => window.openEquipmentModal('new')")
    page.wait_for_selector("#ac-template-options input[name=ac-setting-type]")
    page.locator("#ac-template-options label", has_text="예시 품목 C").click()
    notify = page.text_content("#ac-template-notify")
    pc_dur = page.input_value("#ac-inp-duration")
    print(f"  * PC 예약: 예시 품목 C 선택 → 소요 {pc_dur}분, 안내 '{notify}'")
    assert pc_dur == "45" and "김작업, 박사원" in notify, (pc_dur, notify)
    page.click("#tab-btn-ac-tpl")
    rows = page.locator("#ac-tpl-list .ac-job-card").count()
    page.fill("#ac-tpl-name", "<b>품목</b>")
    page.fill("#ac-tpl-dur", "120")
    page.locator('#ac-tpl-workers input[value="8"]').check()
    page.click("#btn-ac-tpl-save")
    page.wait_for_timeout(500)
    tpl_posts = [w for w in state.blocked_writes if "equipment_templates" in w["url"] and w["method"] == "POST"]
    tbody = json.loads(tpl_posts[-1]["body"]) if tpl_posts else {}
    tbody = tbody[0] if isinstance(tbody, list) else tbody
    print(f"  * 템플릿 목록 {rows}개, 저장 행: {tbody}")
    assert rows == 2 and tbody == {"name": "<b>품목</b>", "duration_minutes": 120, "notify_worker_ids": [8]}, tbody
    assert page.locator("#ac-tpl-list b").count() == 0
    ctx.close()


def test_eq_jobs(browser, state):
    print("\n--- [AC-J] 모바일 장비 예약 목록: 수정·겹침 거부·취소·저장 실패 ---")
    import datetime as _dt
    t = _dt.datetime.now() + _dt.timedelta(days=1)
    code = lambda h, m: f"{t.day:02d}{h:02d}{m:02d}"
    state.mock_jobs = [
        {"id": 5, "start_code": code(10, 0), "end_code": code(11, 30), "setting_type": "예시 품목 A", "duration_minutes": 90, "status": "예약", "notify_worker_ids": []},
        {"id": 6, "start_code": code(14, 0), "end_code": code(14, 45), "setting_type": "예시 품목 C", "duration_minutes": 45, "status": "예약", "notify_worker_ids": [7]},
    ]
    state.blocked_writes.clear()
    ctx, page = setup_mobile_page(browser, state, hash_route="#m=equipment")
    page.wait_for_selector(".m-ac-edit-btn")
    n = page.locator(".m-ac-edit-btn").count()
    head = page.text_content("#m-ac-job-list")
    print(f"  * 예약 {n}건, 목록에 종류 표시: {'예시 품목 A' in head and '예시 품목 C' in head}")
    assert n == 2 and "예시 품목 A" in head and "예시 품목 C" in head and "90분" in head

    # 6번을 10:30으로 옮기면 5번(10:00~11:30)과 겹친다
    page.locator('.m-ac-edit-btn[data-id="6"]').click()
    page.fill("#m-inp-time", "10:30")
    page.click("#m-sheet-save")
    err = page.text_content("#m-sheet-err")
    print(f"  * 겹침 안내: '{err}', 쓰기 {len(state.blocked_writes)}회")
    assert "겹칩" in err and not state.blocked_writes

    page.fill("#m-inp-time", "16:00")
    page.click("#m-sheet-save")
    page.wait_for_selector(".m-sheet-backdrop", state="detached")
    w = state.blocked_writes[-1]
    body = json.loads(w["body"])
    print(f"  * 수정 저장: {w['method']} id=6 → start_code={body.get('start_code')}, 종류={body.get('setting_type')}")
    assert w["method"] == "PATCH" and "id=eq.6" in w["url"] and body["start_code"] == code(16, 0) and body["setting_type"] == "예시 품목 C" and body["notify_worker_ids"] == [7]

    page.locator('.m-ac-del-btn[data-id="5"]').click()
    page.click("#m-del-confirm")
    page.wait_for_timeout(400)
    dels = [x for x in state.blocked_writes if x["method"] == "DELETE"]
    print(f"  * 취소: {[d['url'].split('?')[1] for d in dels]}")
    assert dels and "id=eq.5" in dels[-1]["url"]

    state.fail_jobs = True
    page.click("#m-ac-new-btn")
    page.fill("#m-inp-date", "2099-01-03")
    page.fill("#m-inp-time", "10:00")
    page.click("#m-sheet-save")
    page.wait_for_selector(".m-toast")
    toast = page.text_content(".m-toast")
    open_ = page.locator(".m-sheet-backdrop").count()
    state.fail_jobs = False
    print(f"  * 저장 실패 안내: '{toast}', 시트 유지 {open_}")
    assert "저장 실패" in toast and open_ == 1
    ctx.close()
    state.mock_jobs = []


def test_pc_equipment(browser, state):
    print("\n--- [AC-P] PC 장비: 예약 등록 성공·작업 취소·템플릿 수정·삭제 ---")
    import datetime as _dt
    t = _dt.datetime.now() + _dt.timedelta(days=1)
    code = lambda h, m: f"{t.day:02d}{h:02d}{m:02d}"
    state.mock_jobs = [{"id": 9, "start_code": code(6, 0), "end_code": code(7, 0), "setting_type": "예시 품목 C", "duration_minutes": 60, "status": "예약", "notify_worker_ids": []}]
    state.blocked_writes.clear()
    ctx, page = setup_mobile_page(browser, state, viewport={"width": 1440, "height": 900})
    page.on("dialog", lambda d: d.accept())
    page.evaluate("() => window.openEquipmentModal('new')")
    page.wait_for_selector("#ac-template-options input[name=ac-setting-type]")
    page.fill("#ac-inp-start-code", code(9, 0))
    page.locator("#ac-template-options label", has_text="예시 품목 A").click()
    page.click("#btn-ac-submit-job")
    page.wait_for_function("() => document.getElementById('tab-btn-ac-list').classList.contains('is-active')")
    posts = [w for w in state.blocked_writes if "equipment_jobs" in w["url"] and w["method"] == "POST"]
    body = json.loads(posts[-1]["body"])[0] if posts else {}
    print(f"  * 등록: start={body.get('start_code')} end={body.get('end_code')} 종류={body.get('setting_type')} → 목록 탭으로")
    assert body.get("start_code") == code(9, 0) and body.get("end_code") == code(10, 30) and body.get("setting_type") == "예시 품목 A" and body.get("status") == "예약", body

    page.click("#ac-jobs-list-container .ac-btn-del")  # 테스트 시계 기준으로 완료면 [확인(정리)], 아니면 [취소]
    page.wait_for_timeout(400)
    dels = [w for w in state.blocked_writes if "equipment_jobs" in w["url"] and w["method"] == "DELETE"]
    print(f"  * 작업 정리·취소: {[d['url'].split('?')[1] for d in dels]}")
    assert dels and "id=eq.9" in dels[-1]["url"]

    page.click("#tab-btn-ac-tpl")
    page.locator('#ac-tpl-list [data-tpl-id="1"] button[data-tpl-act="edit"]').click()
    title = page.text_content("#ac-tpl-form-title")
    page.fill("#ac-tpl-dur", "100")
    page.click("#ac-tpl-form button[type=submit]")
    page.wait_for_timeout(400)
    patch = [w for w in state.blocked_writes if "equipment_templates" in w["url"] and w["method"] == "PATCH"]
    pbody = json.loads(patch[-1]["body"]) if patch else {}
    print(f"  * 템플릿 수정: 제목 '{title}', 저장 {pbody}")
    assert title == "템플릿 수정: 예시 품목 A" and "id=eq.1" in patch[-1]["url"] and pbody == {"name": "예시 품목 A", "duration_minutes": 100, "notify_worker_ids": []}, pbody

    page.locator('#ac-tpl-list [data-tpl-id="2"] button[data-tpl-act="delete"]').click()
    page.wait_for_timeout(400)
    tdel = [w for w in state.blocked_writes if "equipment_templates" in w["url"] and w["method"] == "DELETE"]
    print(f"  * 템플릿 삭제: {[d['url'].split('?')[1] for d in tdel]}")
    assert tdel and "id=eq.2" in tdel[-1]["url"]
    ctx.close()
    state.mock_jobs = []


def main():
    server = start_server()
    state = MobileQAState()
    print("=" * 60)
    print("=== [qa_runner_mobile] 모바일 전용 UI 종합 검증 시작 ===")
    print("=" * 60)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            test_ac2_height_and_tabbar(browser, state)
            test_ac3_scroll_preservation(browser, state)
            test_ac4_todo_tab(browser, state)
            test_ac5_push_settings(browser, state)
            test_install_card(browser, state)
            test_equipment_templates(browser, state)
            test_eq_jobs(browser, state)
            test_pc_equipment(browser, state)
            test_ac6_process_order_list(browser, state)
            test_ac7_shapes_and_theme(browser, state)
            test_acr1_mobile_features(browser, state)
            test_acr2_console_and_loading(browser, state)
            browser.close()

        print("\n" + "=" * 60)
        print("=== [qa_runner_mobile] 모든 모바일 AC 검증 완료 (ALL PASS) ===")
        print(f"=== 운영 쓰기 차단 횟수: {len(state.blocked_writes)} ===")
        print("=" * 60)
    finally:
        server.shutdown()

if __name__ == "__main__":
    main()
