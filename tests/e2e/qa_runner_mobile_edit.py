"""
qa_runner_mobile_edit.py - 모바일 UI 2단계 E2E 검증 러너 (AC-2 ~ AC-8, AC-R1 ~ AC-R3)
"""
import copy
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

def make_mock_batches():
    return [
        {
            "lotNumber": "PA-EDIT-1",
            "manualZone": "stage2",
            "assignedZone": "stage2",
            "createdAt": "2026-10-20T08:00:00.000Z",
            "updatedAt": "2026-10-20T08:00:00.000Z",
            "productType": "Standard-10ml",
            "stage1Machine": "기계 1",
            "stage3Machine": "기계 1",
            "stage4Machine": "기계 1",
            "totalDurationMinutes": 600,
            "totalDurationText": "10시간 00분",
            "overallStartCode": "10220900",
            "overallEndCode": "10231800",
            "overallStartFriendly": "10월 22일(목) 09:00",
            "overallEndFriendly": "10월 23일(금) 18:00",
            "schedule": {
                "A": {
                    "stepId": "A", "stepName": "공정1", "room": "공정1실", "machine": "기계 1",
                    "startDate": "2026-10-22T09:00:00+09:00", "endDate": "2026-10-22T11:00:00+09:00",
                    "startCode": "10220900", "endCode": "10221100",
                    "startFriendly": "10월 22일(목) 09:00", "endFriendly": "10월 22일(목) 11:00",
                    "durationMinutes": 120, "durationText": "2시간 00분",
                    "remarks": "공정1 특이사항 없음"
                },
                "B": {
                    "stepId": "B", "stepName": "공정2", "room": "공정2실",
                    "startDate": "2026-10-22T11:00:00+09:00", "endDate": "2026-10-22T13:00:00+09:00",
                    "startCode": "10221100", "endCode": "10221300",
                    "startFriendly": "10월 22일(목) 11:00", "endFriendly": "10월 22일(목) 13:00",
                    "durationMinutes": 120, "durationText": "2시간 00분",
                    "remarks": "공정2 정상 진행"
                },
                "C": {
                    "stepId": "C", "stepName": "공정3", "room": "공정3실", "machine": "기계 1",
                    "startDate": "2026-10-22T13:00:00+09:00", "endDate": "2026-10-22T15:00:00+09:00",
                    "startCode": "10221300", "endCode": "10221500",
                    "startFriendly": "10월 22일(목) 13:00", "endFriendly": "10월 22일(목) 15:00",
                    "durationMinutes": 120, "durationText": "2시간 00분",
                    "remarks": "공정3 1호기"
                },
                "D": {
                    "stepId": "D", "stepName": "공정4", "room": "공정4실", "machine": "기계 1",
                    "startDate": "2026-10-22T15:00:00+09:00", "endDate": "2026-10-22T17:00:00+09:00",
                    "startCode": "10221500", "endCode": "10221700",
                    "startFriendly": "10월 22일(목) 15:00", "endFriendly": "10월 22일(목) 17:00",
                    "durationMinutes": 120, "durationText": "2시간 00분",
                    "remarks": "공정4 초기 비고"
                },
                "E": {
                    "stepId": "E", "stepName": "공정5", "room": "공정5실",
                    "startDate": "2026-10-22T17:00:00+09:00", "endDate": "2026-10-22T18:00:00+09:00",
                    "startCode": "10221700", "endCode": "10221800",
                    "startFriendly": "10월 22일(목) 17:00", "endFriendly": "10월 22일(목) 18:00",
                    "durationMinutes": 60, "durationText": "1시간 00분",
                    "remarks": "공정5 비고"
                },
                "packaging": {
                    "stepId": "packaging", "stepName": "포장", "room": "포장실",
                    "startDate": "2026-10-23T16:00:00+09:00", "endDate": "2026-10-23T18:00:00+09:00",
                    "startCode": "10231600", "endCode": "10231800",
                    "startFriendly": "10월 23일(금) 16:00", "endFriendly": "10월 23일(금) 18:00",
                    "durationMinutes": 120, "durationText": "2시간 00분",
                    "remarks": "포장 대기 비고"
                }
            },
            "quantities": {
                "B": 500, "BNet": 490, "C": 485, "D": 480, "E": 475, "inspection": 470, "packaging": 465,
                "losses": { "B": 10, "C": 5, "D": 5, "E": 5, "inspection": 5, "packaging": 5 }
            },
            "qtyB": 500, "lossB": 10, "qtyC": 485, "qtyD": 480, "qtyE": 475, "qtyInspection": 470, "qtyPackaging": 465,
            "lossQuantities": { "B": 10, "C": 5, "D": 5, "E": 5, "inspection": 5, "packaging": 5 },
            "remarks": {
                "A": "공정1 특이사항 없음", "B": "공정2 정상 진행", "C": "공정3 1호기",
                "D": "공정4 초기 비고", "E": "공정5 비고", "inspection": "검사 양호", "packaging": "포장 대기 비고"
            }
        },
        {"lotNumber": "PA-MOCK-2", "manualZone": "stage1-1", "assignedZone": "stage1-1", "quantities": {"B": 300, "packaging": 290, "losses": {"B": 10}}},
        {"lotNumber": "PA-MOCK-3", "manualZone": "stage5", "assignedZone": "stage5", "quantities": {"B": 400, "packaging": 380, "losses": {"B": 20}}},
        {"lotNumber": "PA-MOCK-4", "manualZone": "semi-storage-pre", "assignedZone": "semi-storage-pre", "quantities": {"B": 200, "packaging": 190, "losses": {"B": 10}}},
        {"lotNumber": "PA-MOCK-5", "manualZone": "logistics", "assignedZone": "logistics", "completed_at": "2026-10-21T10:00:00Z", "quantities": {"B": 600, "packaging": 590, "losses": {"B": 10}}}
    ]

class EditQAState:
    def __init__(self):
        self.blocked_writes = []
        self.console_errors = []
        self.mock_worker = {"id": 1, "name": "김작업", "role": "제조"}
        self.mock_batches = make_mock_batches()
        self.fail_batches_read = False
        self.fail_managers_read = False
        self.fail_rules_read = False
        self.fail_batches_write = False
        self.fail_rpc = False

def handle_routes(route, state):
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
            "body": post_data
        })
        print(f"[BLOCKED WRITE] {method} {url} | body={post_data[:120]}")

        if state.fail_batches_write and "batches" in url:
            return route.fulfill(status=500, content_type="application/json", body='{"error":"db write error"}')
        if state.fail_rpc and "rpc/replace_todo_schedules" in url:
            return route.fulfill(status=500, content_type="application/json", body='{"error":"rpc error"}')
        if "rpc/replace_todo_schedules" in url:
            return route.fulfill(status=200, content_type="application/json", body='{"success":true}')

        if "batches" in url and not state.fail_batches_write:
            try:
                parsed = json.loads(post_data)
                if "data" in parsed and isinstance(parsed["data"], list):
                    state.mock_batches = copy.deepcopy(parsed["data"])
            except (json.JSONDecodeError, KeyError, TypeError):
                pass

        return route.fulfill(status=201 if method == "POST" else 200, content_type="application/json", body="{}")

    if "batches" in url:
        if state.fail_batches_read:
            return route.fulfill(status=500, content_type="application/json", body='{"error":"db read error"}')
        return route.fulfill(status=200, content_type="application/json", body=json.dumps({"id": "current_batches", "data": state.mock_batches}))

    if "todo_schedules" in url:
        return route.fulfill(status=200, content_type="application/json", body="[]")

    if "holidays" in url:
        return route.fulfill(status=200, content_type="application/json", body="[]")

    if "process_managers" in url:
        if state.fail_managers_read:
            return route.fulfill(status=500, content_type="application/json", body='{"error":"db read error"}')
        return route.fulfill(status=200, content_type="application/json", body='{"id":1}')

    if "todo_rules" in url:
        if state.fail_rules_read:
            return route.fulfill(status=500, content_type="application/json", body='{"error":"db read error"}')
        return route.fulfill(status=200, content_type="application/json", body="[]")

    return qa_runner_common.fallback(route)

def setup_page(browser, state, viewport=None, user_agent=None, hash_route=""):
    vp = viewport or {"width": 390, "height": 844}
    ua = user_agent or "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36"
    ctx = browser.new_context(
        viewport=vp,
        user_agent=ua,
        is_mobile=bool(vp["width"] <= 920),
        has_touch=bool(vp["width"] <= 920)
    )
    p = ctx.new_page()
    p.on("console", lambda m: print(f"CONSOLE [{m.type}]: {m.text}"))
    p.route("**/*", lambda r: handle_routes(r, state))
    qa_runner_common.block_realtime(p)

    init_js = f"localStorage.setItem('BATCH_STORAGE_KEY', JSON.stringify({json.dumps(state.mock_batches)}));"
    init_js += f"localStorage.setItem('APP_BATCH_RECORDS', JSON.stringify({json.dumps(state.mock_batches)}));"
    init_js += f"localStorage.setItem('APP_VERIFIED_OPERATOR', JSON.stringify({json.dumps(state.mock_worker)}));"
    p.add_init_script(init_js)

    url = f"http://127.0.0.1:{PORT}/index.html?qa=true{hash_route}"
    p.goto(url, wait_until="domcontentloaded")
    p.wait_for_timeout(500)
    return ctx, p

def test_ac2_sheet_open_and_appearance(browser, state):
    print("\n--- [AC-2] 시트 열기 및 모양/접근성 검증 ---")
    ctx, page = setup_page(browser, state, hash_route="#m=batch")
    page.wait_for_timeout(300)

    # 1. PA-EDIT-1 상세 카드 클릭
    print(f"  * m-app HTML: {page.locator('#m-app').inner_html()[:400]}")
    card = page.locator(".m-card[data-lot='PA-EDIT-1']")
    card.click()
    page.wait_for_timeout(300)

    # 2. 수정 버튼 높이 측정
    edit_btn = page.locator("#m-batch-edit-btn")
    btn_box = edit_btn.bounding_box()
    btn_h = btn_box["height"] if btn_box else 0
    print(f"  * 수정 버튼 높이: h={btn_h:.1f}px (기대치: >= 44px)")
    assert btn_h >= 44, f"수정 버튼 높이 부족: {btn_h}px"

    # 3. 수정 버튼 클릭하여 시트 열기
    print(f"  * openBatchEditSheet: {page.evaluate('() => typeof window.openBatchEditSheet')}")
    edit_btn.click()
    page.wait_for_timeout(300)
    sheet = page.locator(".m-sheet-container")
    assert sheet.is_visible(), "수정 시트 표출 실패"

    # 4. 채워진 초기값 확인 및 로그
    lot_val = page.input_value("#m-edit-lot")
    zone_val = page.locator("#m-edit-zone option:checked").text_content()
    qty_b_val = page.input_value("#m-edit-qty-B")
    loss_b_val = page.input_value("#m-edit-loss-B")
    start_a_val = page.input_value("#m-edit-start-A")
    rem_d_val = page.input_value("#m-edit-remarks-D")
    print(f"  * 채워진 값: 로트='{lot_val}', 위치='{zone_val}', B수량={qty_b_val}, B손실={loss_b_val}, A시작='{start_a_val}', D비고='{rem_d_val}'")
    assert lot_val == "PA-EDIT-1"
    # 저장된 위치(공정2실)가 아니라 평면도와 같은, 스케줄대로 진행된 위치(공정5 끝 → 반제품 보관실)
    assert zone_val == "반제품 보관실 (이전)", zone_val
    assert qty_b_val == "500"
    assert loss_b_val == "10"
    assert start_a_val == "2026-10-22T09:00"
    assert rem_d_val == "공정4 초기 비고"

    # 5. 배경 휘도 및 텍스트 대비 검증
    luminance = page.evaluate("""() => {
        const el = document.querySelector('.m-sheet-container');
        const bg = window.getComputedStyle(el).backgroundColor;
        const rgb = bg.match(/\\d+/g).map(Number);
        return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
    }""")
    print(f"  * 시트 배경 휘도: {luminance:.3f} (기대치: >= 0.85)")
    assert luminance >= 0.85, f"배경 휘도 낮음: {luminance}"

    # 저장 버튼 배경색 rgb(37, 99, 235)
    save_bg = page.evaluate("() => window.getComputedStyle(document.querySelector('#m-batch-edit-save')).backgroundColor")
    print(f"  * 저장 버튼 배경색: {save_bg} (기대치: rgb(37, 99, 235))")
    assert "rgb(37, 99, 235)" in save_bg

    # 입력 글자 크기 >= 16px
    input_fz = page.evaluate("() => parseFloat(window.getComputedStyle(document.querySelector('#m-edit-lot')).fontSize)")
    print(f"  * 입력 글자 크기: {input_fz}px (기대치: >= 16px)")
    assert input_fz >= 16

    # 44px 미만 터치 대상 0
    small_targets = page.evaluate("""() => {
        const els = Array.from(document.querySelectorAll('.m-sheet-container button, .m-sheet-container input, .m-sheet-container select'));
        return els.filter(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && (rect.height < 43.5 || rect.width < 43.5);
        }).length;
    }""")
    print(f"  * 44px 미만 터치 대상 수: {small_targets}개 (기대치: 0개)")
    assert small_targets == 0

    # scrollWidth <= 390
    scroll_w = page.evaluate("() => document.querySelector('.m-sheet-container').scrollWidth")
    print(f"  * scrollWidth: {scroll_w}px (기대치: <= 390px)")
    assert scroll_w <= 390

    # 390px 뷰포트에서 공정 시각 입력 칸 폭 >= 300px
    start_a_w = page.evaluate("() => document.querySelector('#m-edit-start-A').getBoundingClientRect().width")
    print(f"  * 390px 공정 시각 입력 칸 폭: w={start_a_w:.1f}px (기대치: >= 300px)")
    assert start_a_w >= 300, f"입력 칸 폭 부족: {start_a_w}px"

    # 시트 텍스트콘텐트에 MMDDHHMM 또는 오전/오후 0개
    sheet_text = page.evaluate("() => document.querySelector('.m-sheet-container').innerText")
    has_8digit = bool(re.search(r'\b\d{8}\b', sheet_text))
    has_ampm = bool(re.search(r'오전|오후', sheet_text))
    print(f"  * textContent 내 8자리 코드 포함={has_8digit}, 오전/오후 포함={has_ampm}")
    assert not has_8digit and not has_ampm, "시트 내 비표준 시각 형식 발견"

    # 스크린샷 저장
    shot_path = os.path.join(SHOT_DIR, "AC-2_edit_sheet.png")
    page.screenshot(path=shot_path)
    print(f"  * 스크린샷 저장: {shot_path}")

    ctx.close()

def test_ac3_normal_save(browser, state):
    print("\n--- [AC-3] 정상 저장 (수량 사슬, 일정, 비고, 위치 변경) 검증 ---")
    state.blocked_writes.clear()
    ctx, page = setup_page(browser, state, hash_route="#m=batch")
    page.wait_for_timeout(300)

    # PA-EDIT-1 상세 -> 수정 시트 열기
    page.locator(".m-card[data-lot='PA-EDIT-1']").click()
    page.wait_for_timeout(300)
    page.locator("#m-batch-edit-btn").click()
    page.wait_for_timeout(300)

    # 값 변경: 비고(D), 공정2 실적, 손실(E), B 종료 시각, 위치(stage5)
    page.fill("#m-edit-remarks-D", "공정4 변경 비고")
    page.fill("#m-edit-qty-B", "550")
    page.fill("#m-edit-loss-E", "15")
    page.fill("#m-edit-end-B", "2026-10-22T14:30")
    page.select_option("#m-edit-zone", "stage5")

    # 최종 실수량 자동 계산 확인
    final_preview = page.input_value("#m-edit-net-packaging")
    print(f"  * 포장 실수량 자동 계산: {final_preview}")
    # 550 - 10(B) - 5(C) - 5(D) - 15(E) - 5(insp) - 5(pkg) = 505
    assert final_preview == "505"

    # 실수량을 입력하면 차감이 계산되고, 차감을 입력하면 실수량이 계산된다
    d_net = int(page.input_value("#m-edit-net-D"))
    page.fill("#m-edit-net-D", str(d_net - 3))
    assert page.input_value("#m-edit-loss-D") == "8", "공정4 차감 5 + 3"
    page.fill("#m-edit-loss-D", "5")
    assert page.input_value("#m-edit-net-D") == str(d_net)
    assert page.input_value("#m-edit-net-packaging") == "505"
    # 공정2 실적을 비우면 인계 실수량이 잠기고 안내가 보인다
    page.fill("#m-edit-qty-B", "")
    assert page.is_visible("#m-qty-hint") and page.is_disabled("#m-edit-net-D")
    page.fill("#m-edit-qty-B", "550")
    assert not page.is_visible("#m-qty-hint") and page.input_value("#m-edit-net-packaging") == "505"
    page.locator(".m-qty-table").scroll_into_view_if_needed()
    assert page.evaluate("document.querySelector('.m-sheet-container').scrollWidth <= document.querySelector('.m-sheet-container').clientWidth"), "가로 넘침 없음"
    page.screenshot(path=os.path.join(SHOT_DIR, "mobile_edit_qty_table.png"))

    # 저장 클릭
    page.locator("#m-batch-edit-save").click()
    page.wait_for_timeout(500)

    # 차단된 batches POST 확인
    batch_writes = [w for w in state.blocked_writes if w["method"] in ["POST", "PUT"] and "batches" in w["url"]]
    print(f"  * batches 쓰기 호출 수: {len(batch_writes)}")
    assert len(batch_writes) == 1, "batches 쓰기 요청 1건 발생"

    body = json.loads(batch_writes[0]["body"])
    saved_list = body.get("data", [])
    print(f"  * 저장된 배치 수: {len(saved_list)} (기대치: 5)")
    assert len(saved_list) == len(state.mock_batches)

    # 수정 로트 외 모든 로트가 서버 목 값과 일치하는지 검증
    others_equal = True
    for orig in state.mock_batches:
        if orig["lotNumber"] == "PA-EDIT-1":
            continue
        saved_match = next((b for b in saved_list if b["lotNumber"] == orig["lotNumber"]), None)
        if saved_match != orig:
            others_equal = False
            break
    print(f"  * others_equal={others_equal}")
    assert others_equal is True, "수정 대상 외 로트가 변경됨"

    saved_edit = next(b for b in saved_list if b["lotNumber"] == "PA-EDIT-1")
    assert saved_edit["remarks"]["D"] == "공정4 변경 비고"
    assert saved_edit["schedule"]["D"]["remarks"] == "공정4 변경 비고"
    assert saved_edit["quantities"]["B"] == 550
    assert saved_edit["qtyB"] == 550
    assert saved_edit["quantities"]["packaging"] == 505
    assert saved_edit["qtyPackaging"] == 505
    assert saved_edit["schedule"]["B"]["endCode"] == "10221430"
    assert saved_edit["schedule"]["B"]["durationMinutes"] == 210
    assert saved_edit["overallEndCode"] == "10231800"
    assert saved_edit["manualZone"] == "stage5"
    print(f"  * PA-EDIT-1 검증: D비고='{saved_edit['remarks']['D']}', qtyPackaging={saved_edit['qtyPackaging']}, B종료={saved_edit['schedule']['B']['endCode']}, zone={saved_edit['manualZone']}")

    # timeline_logs POST 1건
    log_writes = [w for w in state.blocked_writes if "timeline_logs" in w["url"]]
    print(f"  * timeline_logs 호출 수: {len(log_writes)}")
    assert len(log_writes) == 1
    log_body = json.loads(log_writes[0]["body"])
    print(f"  * timeline_log: {log_body}")
    assert log_body[0]["target_lot"] == "PA-EDIT-1"

    # 토스트 확인
    toast_text = page.locator(".m-toast").text_content()
    print(f"  * 토스트 문구: '{toast_text}'")
    assert "저장했어요" in toast_text

    # 상세 화면 확인: 새 비고, 새 수량, 시각 변경 안내 줄
    detail_text = page.locator("#m-app").text_content()
    assert "공정4 변경 비고" in detail_text
    # 공정5실 로트의 현재 수량은 공정5(E)·검사·포장 손실을 아직 빼지 않은 550-10-5-5 = 530
    assert "530개" in detail_text, detail_text
    banner_vis = page.locator("#m-time-change-banner").is_visible()
    print(f"  * 시각 변경 안내 줄 보임: {banner_vis}")
    assert banner_vis is True

    # 안내 줄의 일정 반영 버튼 글자 한 줄 및 높이 <= 48px 검증
    banner_btn = page.locator("#m-banner-apply-todo")
    btn_box = banner_btn.bounding_box()
    banner_btn_h = btn_box["height"] if btn_box else 0
    banner_btn_ws = page.evaluate("() => window.getComputedStyle(document.querySelector('#m-banner-apply-todo')).whiteSpace")
    print(f"  * 시각 변경 안내 줄 일정 반영 버튼: 높이={banner_btn_h:.1f}px (기대치: <= 48px), white-space='{banner_btn_ws}'")
    assert banner_btn_h <= 48, f"안내 줄 버튼 높이 초과: {banner_btn_h}px"
    assert banner_btn_ws == "nowrap", f"white-space nowrap 아님: {banner_btn_ws}"

    shot_path = os.path.join(SHOT_DIR, "AC-3_saved.png")
    page.screenshot(path=shot_path)
    print(f"  * 스크린샷 저장: {shot_path}")

    ctx.close()

def test_ac4_conflict(browser, state):
    print("\n--- [AC-4] 동시 수정 충돌 감지 검증 ---")
    state.blocked_writes.clear()
    ctx, page = setup_page(browser, state, hash_route="#m=batch")
    page.wait_for_timeout(300)

    # 시트 열기
    page.locator(".m-card[data-lot='PA-EDIT-1']").click()
    page.wait_for_timeout(300)
    page.locator("#m-batch-edit-btn").click()
    page.wait_for_timeout(300)

    # 1. 서버 목의 remarks.A 변경
    state.mock_batches[0]["remarks"]["A"] = "외부 서버 수정 발생"
    page.locator("#m-batch-edit-save").click()
    page.wait_for_timeout(300)

    err_text = page.locator("#m-sheet-err").text_content()
    print(f"  * 서버 변경 후 충돌 문구: '{err_text}'")
    assert "다른 곳에서 먼저 수정했어요" in err_text

    post_calls = [w for w in state.blocked_writes if "batches" in w["url"]]
    print(f"  * 충돌 시 batches POST 호출 수: {len(post_calls)}")
    assert len(post_calls) == 0

    # 2. 로트 삭제 시 충돌
    state.mock_batches.pop(0) # PA-EDIT-1 제거
    page.locator("#m-batch-edit-save").click()
    page.wait_for_timeout(300)
    err_text_del = page.locator("#m-sheet-err").text_content()
    print(f"  * 로트 삭제 후 충돌 문구: '{err_text_del}'")
    assert "다른 곳에서 먼저 수정했어요" in err_text_del
    post_calls_del = [w for w in state.blocked_writes if "batches" in w["url"]]
    assert len(post_calls_del) == 0

    # 목 원복
    state.mock_batches = make_mock_batches()
    ctx.close()

def test_ac5_validation(browser, state):
    print("\n--- [AC-5] 입력 검증 (중복 로트, 종료<시작, 잘못된 문자) 검증 ---")
    state.blocked_writes.clear()
    ctx, page = setup_page(browser, state, hash_route="#m=batch")
    page.wait_for_timeout(300)

    page.locator(".m-card[data-lot='PA-EDIT-1']").click()
    page.wait_for_timeout(300)
    page.locator("#m-batch-edit-btn").click()
    page.wait_for_timeout(300)

    # 1. 중복 로트
    page.fill("#m-edit-lot", "PA-MOCK-2")
    page.locator("#m-batch-edit-save").click()
    page.wait_for_timeout(200)
    err_dup = page.locator("#m-sheet-err").text_content()
    print(f"  * 중복 로트 문구: '{err_dup}'")
    assert "이미 있는 로트넘버예요" in err_dup

    # 2. 종료 < 시작
    page.fill("#m-edit-lot", "PA-EDIT-1")
    page.fill("#m-edit-start-B", "2026-10-22T14:00")
    page.fill("#m-edit-end-B", "2026-10-22T12:00")
    page.locator("#m-batch-edit-save").click()
    page.wait_for_timeout(200)
    err_time = page.locator("#m-sheet-err").text_content()
    print(f"  * 종료 < 시작 문구: '{err_time}'")
    assert "공정2 종료가 시작보다 빨라요" in err_time

    # 3. 로트넘버에 < 특수문자
    page.fill("#m-edit-end-B", "2026-10-22T15:00")
    page.fill("#m-edit-lot", "<PA-INVALID>")
    page.locator("#m-batch-edit-save").click()
    page.wait_for_timeout(200)
    err_char = page.locator("#m-sheet-err").text_content()
    print(f"  * 특수문자 < 문구: '{err_char}'")
    assert "로트넘버 형식이 올바르지 않아요" in err_char

    batch_posts = [w for w in state.blocked_writes if "batches" in w["url"]]
    print(f"  * 검증 실패 시 batches POST 호출 수: {len(batch_posts)}")
    assert len(batch_posts) == 0

    ctx.close()

def test_ac6_zone_moves(browser, state):
    print("\n--- [AC-6] 위치 이동 및 완제품 창고 복원 검증 ---")
    state.blocked_writes.clear()
    ctx, page = setup_page(browser, state, hash_route="#m=batch")
    page.wait_for_timeout(300)

    # 이동 전 완제품 창고 건수 확인
    before_logistics_txt = page.locator(".m-sub-line:has-text('완제품 창고')").text_content().strip()
    print(f"  * [전후 값] 완제품 창고 이동 전 줄: '{before_logistics_txt}'")

    # 1. 완제품 창고(logistics)로 이동
    page.locator(".m-card[data-lot='PA-EDIT-1']").click()
    page.wait_for_timeout(300)
    page.locator("#m-batch-edit-btn").click()
    page.wait_for_timeout(300)

    shown_zone = page.input_value("#m-edit-zone")
    page.select_option("#m-edit-zone", "logistics")
    page.locator("#m-batch-edit-save").click()
    page.wait_for_timeout(400)

    batch_writes = [w for w in state.blocked_writes if "batches" in w["url"]]
    assert len(batch_writes) >= 1
    body1 = json.loads(batch_writes[-1]["body"])
    saved1 = next(b for b in body1["data"] if b["lotNumber"] == "PA-EDIT-1")
    print(f"  * logistics 이동: manualZone={saved1.get('manualZone')}, completed_at={saved1.get('completed_at')}, prevZoneBeforeLogistics={saved1.get('prevZoneBeforeLogistics')}")
    assert saved1["manualZone"] == "logistics"
    # 꺼낼 때 돌아갈 자리는 넣기 직전 화면에 보이던 위치
    assert saved1["prevZoneBeforeLogistics"] == shown_zone, (saved1["prevZoneBeforeLogistics"], shown_zone)
    assert "completed_at" in saved1

    # 목록으로 돌아가서 완제품 창고 건수 확인
    page.locator("#m-detail-back").click()
    page.wait_for_timeout(300)
    after_logistics_txt = page.locator(".m-sub-line:has-text('완제품 창고')").text_content().strip()
    print(f"  * [전후 값] logistics 이동 후 줄: '{after_logistics_txt}'")
    assert before_logistics_txt != after_logistics_txt

    # 2. 다시 포장실로 복원 이동 (완제품 창고 이동 배치는 해시 라우팅으로 상세 진입)
    page.goto(f"http://127.0.0.1:{PORT}/index.html?qa=true#m=batch&lot=PA-EDIT-1")
    page.wait_for_timeout(300)
    page.locator("#m-batch-edit-btn").click()
    page.wait_for_timeout(300)

    page.select_option("#m-edit-zone", "packaging")
    page.locator("#m-batch-edit-save").click()
    page.wait_for_timeout(400)

    batch_writes2 = [w for w in state.blocked_writes if "batches" in w["url"]]
    body2 = json.loads(batch_writes2[-1]["body"])
    saved2 = next(b for b in body2["data"] if b["lotNumber"] == "PA-EDIT-1")
    print(f"  * packaging 복원: manualZone={saved2.get('manualZone')}, completed_at={saved2.get('completed_at')}")
    assert saved2["manualZone"] == "packaging"
    assert "completed_at" not in saved2
    assert "enteredLogisticsAt" not in saved2

    # 복원 후 목록에서 완제품 창고 건수 원복 확인
    page.locator("#m-detail-back").click()
    page.wait_for_timeout(300)
    restored_logistics_txt = page.locator(".m-sub-line:has-text('완제품 창고')").text_content().strip()
    print(f"  * [전후 값] packaging 복원 후 줄: '{restored_logistics_txt}'")
    assert restored_logistics_txt == before_logistics_txt

    ctx.close()

def test_ac7_todo_schedule_apply(browser, state):
    print("\n--- [AC-7] 일정 반영 및 확인 시트 검증 ---")
    state.blocked_writes.clear()
    ctx, page = setup_page(browser, state, hash_route="#m=todo")
    page.wait_for_timeout(400)

    # 할 일 탭의 일정 반영 버튼 클릭
    apply_btn = page.locator("#m-todo-apply-schedule")
    assert apply_btn.is_visible()
    apply_btn.click()
    page.wait_for_timeout(300)

    # 확인 시트 확인
    confirm_text = page.locator(".m-sheet-container").text_content()
    print(f"  * 확인 시트 문구: '{confirm_text[:80].strip()}'")
    assert "배치 일정과 담당자 기준으로 할 일을 다시 계산해 저장할까요?" in confirm_text

    # 반영 클릭
    page.locator("#m-sched-confirm").click()
    page.wait_for_timeout(500)

    rpc_calls = [w for w in state.blocked_writes if "rpc/replace_todo_schedules" in w["url"]]
    print(f"  * replace_todo_schedules RPC 호출 수: {len(rpc_calls)}")
    assert len(rpc_calls) == 1

    toast = page.locator(".m-toast").text_content()
    print(f"  * 성공 토스트: '{toast}'")
    assert "할 일" in toast and "반영했어요" in toast

    # RPC 500 실패 케이스 검증
    state.fail_rpc = True
    apply_btn.click()
    page.wait_for_timeout(300)
    page.locator("#m-sched-confirm").click()
    page.wait_for_timeout(500)

    fail_toast = page.locator(".m-toast").text_content()
    print(f"  * RPC 실패 토스트: '{fail_toast}'")
    assert "반영 실패: 인터넷 연결을 확인해 주세요" in fail_toast
    state.fail_rpc = False

    # 시각을 바꾸지 않은 저장 뒤에는 안내 줄 보임 = False
    page.goto(f"http://127.0.0.1:{PORT}/index.html?qa=true#m=batch")
    page.wait_for_timeout(400)
    page.locator(".m-card[data-lot='PA-EDIT-1']").click()
    page.wait_for_timeout(300)
    page.locator("#m-batch-edit-btn").click()
    page.wait_for_timeout(300)
    # 비고만 수정
    page.fill("#m-edit-remarks-A", "비고만 변경")
    page.locator("#m-batch-edit-save").click()
    page.wait_for_timeout(400)

    banner_vis = page.locator("#m-time-change-banner").is_visible()
    print(f"  * 시각 미변경 저장 후 안내 줄 보임: {banner_vis} (기대치: False)")
    assert banner_vis is False

    ctx.close()

def test_ac7_apply_aborts_on_read_failure(browser, state):
    print("\n--- [AC-7b] 입력을 못 읽으면 일정 반영(전체 삭제 후 덮어쓰기)을 하지 않음 ---")
    ctx, page = setup_page(browser, state, hash_route="#m=todo")
    page.wait_for_timeout(400)
    for flag in ("fail_batches_read", "fail_managers_read", "fail_rules_read"):
        state.blocked_writes.clear()
        setattr(state, flag, True)
        page.locator("#m-todo-apply-schedule").click()
        page.wait_for_timeout(300)
        page.locator("#m-sched-confirm").click()
        page.wait_for_timeout(500)
        setattr(state, flag, False)
        rpc_calls = [w for w in state.blocked_writes if "rpc/replace_todo_schedules" in w["url"]]
        toast = page.locator(".m-toast").text_content()
        print(f"  * {flag}: RPC 호출 수={len(rpc_calls)}, 토스트='{toast}'")
        assert len(rpc_calls) == 0, f"{flag}: 읽기 실패인데 replace_todo_schedules 호출됨"
        assert "반영 실패" in toast, f"{flag}: 실패 안내가 보여야 함"
    ctx.close()

def test_ac8_save_failures(browser, state):
    print("\n--- [AC-8] 서버 읽기/쓰기 500 실패 및 폼 유지 검증 ---")
    state.blocked_writes.clear()
    ctx, page = setup_page(browser, state, hash_route="#m=batch")
    page.wait_for_timeout(300)

    page.locator(".m-card[data-lot='PA-EDIT-1']").click()
    page.wait_for_timeout(300)
    page.locator("#m-batch-edit-btn").click()
    page.wait_for_timeout(300)

    # 1. batches select 500 실패
    state.fail_batches_read = True
    page.fill("#m-edit-remarks-A", "읽기 실패 테스트 비고")
    page.locator("#m-batch-edit-save").click()
    page.wait_for_timeout(400)

    toast1 = page.locator(".m-toast").text_content()
    sheet_open1 = page.locator(".m-sheet-container").is_visible()
    lot_val1 = page.input_value("#m-edit-lot")
    rem_val1 = page.input_value("#m-edit-remarks-A")
    ls_batches1 = page.evaluate("() => JSON.parse(localStorage.getItem('APP_BATCH_RECORDS'))")
    ls_same1 = (ls_batches1 == state.mock_batches)
    print(f"  * 읽기 500 토스트: '{toast1}'")
    print(f"  * [읽기 500 검증] 시트 열림={sheet_open1}, 로트 입력값='{lot_val1}', 비고='{rem_val1}', localStorage 불변={ls_same1}")
    assert "저장 실패: 인터넷 연결을 확인해 주세요" in toast1
    assert sheet_open1 is True
    assert lot_val1 == "PA-EDIT-1"
    assert rem_val1 == "읽기 실패 테스트 비고"
    assert ls_same1 is True
    state.fail_batches_read = False

    # 2. batches upsert 500 실패
    state.fail_batches_write = True
    page.locator("#m-batch-edit-save").click()
    page.wait_for_timeout(400)

    toast2 = page.locator(".m-toast").text_content()
    sheet_open2 = page.locator(".m-sheet-container").is_visible()
    lot_val2 = page.input_value("#m-edit-lot")
    rem_val2 = page.input_value("#m-edit-remarks-A")
    ls_batches2 = page.evaluate("() => JSON.parse(localStorage.getItem('APP_BATCH_RECORDS'))")
    ls_same2 = (ls_batches2 == state.mock_batches)
    print(f"  * 쓰기 500 토스트: '{toast2}'")
    print(f"  * [쓰기 500 검증] 시트 열림={sheet_open2}, 로트 입력값='{lot_val2}', 비고='{rem_val2}', localStorage 불변={ls_same2}")
    assert "저장 실패: 인터넷 연결을 확인해 주세요" in toast2
    assert sheet_open2 is True
    assert lot_val2 == "PA-EDIT-1"
    assert rem_val2 == "읽기 실패 테스트 비고"
    assert ls_same2 is True
    state.fail_batches_write = False

    ctx.close()

def test_ac_r1_and_r2(browser, state):
    print("\n--- [AC-R1 & AC-R2] 수량 요약 및 PC 일정 반영 회귀 검증 ---")
    # AC-R1: 모바일 배치 상세 수량 요약 공정2 기준 수량 확인
    ctx_m, page_m = setup_page(browser, state, hash_route="#m=batch")
    page_m.wait_for_timeout(300)
    page_m.locator(".m-card[data-lot='PA-EDIT-1']").click()
    page_m.wait_for_timeout(300)

    detail_content = page_m.locator("#m-app").text_content()
    print(f"  * AC-R1 배치 상세 공정2 기준 수량 포함 여부: '500개' in detail: {'500개' in detail_content}")
    assert "500개" in detail_content
    ctx_m.close()

    # AC-R2: PC 1440x900 일정 반영 버튼 동작
    ctx_pc = browser.new_context(viewport={"width": 1440, "height": 900}, is_mobile=False, has_touch=False)
    page_pc = ctx_pc.new_page()
    page_pc.on("dialog", lambda d: d.accept())
    page_pc.on("console", lambda m: state.console_errors.append(m.text) if m.type == "error" else None)
    page_pc.route("**/*", lambda r: handle_routes(r, state))
    qa_runner_common.block_realtime(page_pc)
    page_pc.add_init_script(f"""
        localStorage.setItem('BATCH_STORAGE_KEY', JSON.stringify({json.dumps(state.mock_batches)}));
        localStorage.setItem('APP_BATCH_RECORDS', JSON.stringify({json.dumps(state.mock_batches)}));
        localStorage.setItem('APP_VERIFIED_OPERATOR', JSON.stringify({json.dumps(state.mock_worker)}));
    """)
    page_pc.goto(f"http://127.0.0.1:{PORT}/index.html?qa=true", wait_until="domcontentloaded")
    page_pc.wait_for_timeout(500)

    # PC 투두 모달 오픈 및 일정 반영 버튼 클릭
    state.blocked_writes.clear()
    page_pc.click("#btn-daily-todo")
    page_pc.wait_for_timeout(300)

    btn_apply = page_pc.locator("#btn-todo-apply")
    assert btn_apply.is_visible()
    btn_apply.click()
    page_pc.wait_for_timeout(500)

    rpc_calls = [w for w in state.blocked_writes if "rpc/replace_todo_schedules" in w["url"]]
    print(f"  * PC 일정 반영 RPC 호출 수: {len(rpc_calls)}")
    assert len(rpc_calls) >= 1
    ctx_pc.close()

def main():
    start_server()
    state = EditQAState()
    print("=" * 60)
    print(f"qa_runner_mobile_edit.py 시작 (PORT={PORT})")
    print("=" * 60)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            test_ac2_sheet_open_and_appearance(browser, state)
            test_ac3_normal_save(browser, state)
            test_ac4_conflict(browser, state)
            test_ac5_validation(browser, state)
            test_ac6_zone_moves(browser, state)
            test_ac7_todo_schedule_apply(browser, state)
            test_ac7_apply_aborts_on_read_failure(browser, state)
            test_ac8_save_failures(browser, state)
            test_ac_r1_and_r2(browser, state)

            # AC-R3 콘솔 오류 검사
            print("\n--- [AC-R3] 콘솔 오류 검사 ---")
            print(f"  * 수집된 콘솔 오류 수: {len(state.console_errors)}")
            for err in state.console_errors:
                print(f"    - {err}")
            assert len(state.console_errors) == 0, "콘솔 오류 발생"

            print("\n=== RESULT: ALL AC TESTS PASSED ===")
        finally:
            browser.close()

if __name__ == "__main__":
    main()
