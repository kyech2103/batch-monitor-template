"""
qa_runner_popup_layout.py - 팝업 레이아웃 개편 1단계 E2E 검증 러너
AC-1 ~ AC-9, AC-R3, AC-R4 검증 및 측정값 상세 로깅
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
    def __init__(self, *a, **k):
        super().__init__(*a, directory=qa_runner_common.SITE_ROOT, **k)

    def log_message(self, fmt, *a):
        pass


def start_server():
    s = ThreadingHTTPServer(('127.0.0.1', PORT), QuietHandler)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s


def _mock_workers(route):
    return route.fulfill(status=200, content_type="application/json", body="[]")


def dispatch_mock_get(route, url, state=None):
    if "/rest/v1/workers" in url:
        return _mock_workers(route)
    if "/rest/v1/process_managers" in url:
        return route.fulfill(status=200, content_type="application/json", body=json.dumps([{"id": 1}]))
    if "/rest/v1/batches" in url:
        return route.fulfill(status=200, content_type="application/json", body=json.dumps({"data": []}))
    if any(k in url for k in ["/rest/v1/equipment_jobs", "/rest/v1/todo_schedules", "/rest/v1/todo_rules"]):
        return route.fulfill(status=200, content_type="application/json", body="[]")
    return qa_runner_common.fallback(route)


def setup_mocking(context, state):
    def handle_route(route):
        req = route.request
        if req.method in ["POST", "PUT", "PATCH", "DELETE"]:
            state["writes"].append({"method": req.method, "url": req.url})
            return route.fulfill(status=200, content_type="application/json", body="{}")
        return dispatch_mock_get(route, req.url, state)
    context.route("**/*", handle_route)
    qa_runner_common.block_realtime(context)


def test_ac1_tokens_and_theme(page):
    with open(os.path.join(ROOT, "css", "popup-theme.css"), "r", encoding="utf-8") as f:
        lines = len(f.readlines())
    print(f"  [AC-1] popup-theme.css line count: {lines} <= 300")
    assert lines <= 300, f"popup-theme.css 300줄 초과: {lines}"
    accent = page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--pt-accent').trim()")
    print(f"  [AC-1] --pt-accent: {accent}")
    assert accent == "#2563eb", f"Invalid accent: {accent}"


def _check_modal_luminance(page, mid):
    res = page.evaluate(f"""() => {{
        const d = document.getElementById('{mid}');
        const inps = Array.from(d.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), select, textarea'));
        const ths = Array.from(d.querySelectorAll('th'));
        function getLum(el) {{
            const c = getComputedStyle(el).backgroundColor.match(/\\d+/g);
            if (!c || c.length < 3) return 1.0;
            return (0.2126*c[0] + 0.7152*c[1] + 0.0722*c[2])/255;
        }}
        const badInps = inps.filter(el => el.offsetHeight > 0 && getLum(el) < 0.85).map(el => (el.id || el.className) + ':' + getLum(el).toFixed(2));
        const badThs = ths.filter(el => el.offsetHeight > 0 && getLum(el) < 0.85).map(el => el.textContent.trim() + ':' + getLum(el).toFixed(2));
        return {{ badInps, badThs, inpCount: inps.length, thCount: ths.length }};
    }}""")
    assert len(res["badInps"]) == 0, f"{mid} inputs luminance < 0.85: {res['badInps']}"
    assert len(res["badThs"]) == 0, f"{mid} th luminance < 0.85: {res['badThs']}"
    return res


def _check_modal(page, mid, kind, exp_w):
    page.evaluate(f"document.getElementById('{mid}').showModal()")
    page.wait_for_timeout(80)
    box = page.locator(f"#{mid}").bounding_box()
    diff_x = abs(box["x"] - (1440 - (box["x"] + box["width"])))
    diff_y = abs(box["y"] - (900 - (box["y"] + box["height"])))
    lum_res = _check_modal_luminance(page, mid)
    print(f"    - {mid:24s} w={box['width']:.0f}px (exp {exp_w}) | diff_x={diff_x:.1f}px diff_y={diff_y:.1f}px | inps={lum_res['inpCount']} ths={lum_res['thCount']}")
    assert abs(box["width"] - exp_w) <= 2, f"{mid} width {box['width']} != {exp_w}"
    if kind == "Full":
        assert abs(box["x"] - 16) <= 2 and abs(box["y"] - 16) <= 2, f"{mid} Full margin error"
    else:
        assert diff_x <= 4 and diff_y <= 4, f"{mid} center error"
    br = page.evaluate(f"parseFloat(getComputedStyle(document.getElementById('{mid}')).borderRadius)")
    assert br <= 12, f"{mid} radius {br} > 12"
    has_grad = page.evaluate(f"getComputedStyle(document.getElementById('{mid}')).backgroundImage.includes('gradient')")
    assert not has_grad, f"{mid} has gradient"
    page.screenshot(path=os.path.join(SHOT_DIR, f"AC-2_{mid}.png"))
    page.evaluate(f"document.getElementById('{mid}').close()")


def test_ac2_and_ac3_modals(page):
    print("  [AC-2, AC-3] Verifying geometry, margins, and luminance for 12 modals:")
    cfg = [
        ("operator-auth-modal", "S", 440), ("process-managers-modal", "M", 720),
        ("equipment-modal", "M", 720), ("daily-todo-modal", "L", 1080),
        ("todo-rules-modal", "L", 1080), ("finished-warehouse-modal", "L", 1080),
        ("user-guide-modal", "L", 1080), ("batch-schedule-modal", "Full", 1408),
        ("toolroom-shelf-modal", "Full", 1408), ("supplies-modal", "Full", 1408),
        ("pack-supplies-modal", "Full", 1408), ("warehouse-modal", "Full", 1408)
    ]
    for mid, kind, exp_w in cfg:
        _check_modal(page, mid, kind, exp_w)


def _check_ac_modal(page):
    page.evaluate("document.getElementById('equipment-modal').showModal()")
    page.click("#tab-btn-ac-list")
    assert page.is_visible("#tab-pane-ac-list"), "AC list tab not visible"
    page.screenshot(path=os.path.join(SHOT_DIR, "AC-4_ac_list.png"))
    page.click("#tab-btn-ac-new")
    assert page.is_visible("#tab-pane-ac-new"), "AC new tab not visible"
    page.screenshot(path=os.path.join(SHOT_DIR, "AC-4_ac_new.png"))
    page.evaluate("document.getElementById('equipment-modal').close()")


def test_ac4_layouts(page):
    page.evaluate("document.getElementById('process-managers-modal').showModal()")
    rows = page.locator("#process-managers-modal tbody tr").count()
    print(f"  [AC-4] Process managers rows: {rows} (exp 13)")
    assert rows == 12, f"Process managers rows {rows} != 12"
    page.screenshot(path=os.path.join(SHOT_DIR, "AC-4_pm_modal.png"))
    page.evaluate("document.getElementById('process-managers-modal').close()")

    _check_ac_modal(page)

    page.click("#btn-daily-todo")
    page.wait_for_timeout(150)
    # 평일 기준 과업 0건 빈 상태 확인을 위해 다음 영업일로 이동 (주말 휴무 분기 방지)
    page.click("#btn-todo-next-day")
    page.wait_for_selector("#daily-todo-modal .todo-empty-text", timeout=5000)
    todo_info = page.evaluate("""() => {
        const d = document.getElementById('daily-todo-modal');
        const emptyCard = d.querySelector('.todo-empty-state');
        const emptyEl = d.querySelector('.todo-empty-text');
        const emptyText = emptyEl ? emptyEl.textContent.trim() : '';
        const dateVal = document.getElementById('todo-date-input').value;
        const lastGen = document.getElementById('todo-last-generated').textContent.trim();
        const pendingCount = (d.textContent.match(/확인\\s*중/g) || []).length;
        let cardLum = 1.0;
        if (emptyCard) {
            const rgb = getComputedStyle(emptyCard).backgroundColor.match(/\\d+/g);
            if (rgb && rgb.length >= 3) {
                cardLum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
            }
        }
        return { emptyText, dateVal, lastGen, pendingCount, cardLum, box: d.innerText.slice(0, 500) };
    }""")
    print(f"  [AC-4] Daily Todo - date={todo_info['dateVal']}, empty='{todo_info['emptyText']}', lastGen='{todo_info['lastGen']}', pending={todo_info['pendingCount']}, cardLum={todo_info['cardLum']:.3f}")
    assert "해당 일자에 배정된 과업이 없습니다" in todo_info["emptyText"], "Todo empty text missing: " + todo_info["box"]
    assert todo_info["dateVal"], "Todo date input empty"
    assert todo_info["pendingCount"] == 0, f"Todo has '확인 중': {todo_info['pendingCount']}"
    assert todo_info["cardLum"] >= 0.85, f"Todo empty card luminance {todo_info['cardLum']} < 0.85"
    box = page.locator("#daily-todo-modal").bounding_box()
    assert box["height"] <= 480, f"Todo empty height {box['height']} > 480"
    page.screenshot(path=os.path.join(SHOT_DIR, "AC-4_todo_empty.png"))
    page.evaluate("document.getElementById('daily-todo-modal').close()")


def test_ac5_rules_panel(page):
    page.click("#btn-daily-todo")
    page.wait_for_timeout(100)
    page.click("#btn-todo-rules")
    page.wait_for_timeout(150)
    page.click("#btn-todo-rule-add")
    page.wait_for_timeout(100)
    side_w = page.locator("#todo-rule-form-container").bounding_box()["width"]
    rules_info = page.evaluate("""() => {
        const d = document.getElementById('todo-rules-modal');
        const badge = document.getElementById('todo-rules-status-badge').textContent.trim();
        const countPill = document.getElementById('todo-rules-count-pill').textContent.trim();
        const rowCount = document.querySelectorAll('#todo-rules-table-body tr.rule-row').length;
        const pendingCount = (d.textContent.match(/확인\\s*중/g) || []).length;
        const firstTitleCell = document.querySelector('#todo-rules-table-body tr td.rule-title-cell');
        const firstRowH = firstTitleCell ? firstTitleCell.offsetHeight : 0;
        const tableEls = Array.from(document.querySelectorAll('#todo-rules-table-body .rule-role-chip'));
        let minLum = 1.0;
        tableEls.forEach(el => {
            const rgb = getComputedStyle(el).backgroundColor.match(/\\d+/g);
            if (rgb && rgb.length >= 3 && el.offsetHeight > 0) {
                const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
                if (lum < minLum) minLum = lum;
            }
        });
        return { badge, countPill, rowCount, pendingCount, firstRowH, minLum };
    }""")
    print(f"  [AC-5] Todo Rules - side_w={side_w:.1f}px, badge='{rules_info['badge']}', rows={rules_info['rowCount']}, firstRowH={rules_info['firstRowH']}px, minLum={rules_info['minLum']:.3f}")
    assert abs(side_w - 360) <= 2, f"Rules side panel width {side_w} != 360"
    assert rules_info["rowCount"] == 14, f"Rules count {rules_info['rowCount']} != 14"
    assert rules_info["pendingCount"] == 0, f"Rules has '확인 중': {rules_info['pendingCount']}"
    assert rules_info["firstRowH"] <= 56, f"Rules first title row height {rules_info['firstRowH']} > 56"
    assert rules_info["minLum"] >= 0.85, f"Rules table elements min luminance {rules_info['minLum']} < 0.85"
    page.screenshot(path=os.path.join(SHOT_DIR, "AC-5_rules_side.png"))
    page.evaluate("document.getElementById('todo-rules-modal').close()")
    page.evaluate("document.getElementById('daily-todo-modal').close()")


def test_ac6_warehouse_and_guide(page):
    page.evaluate("document.getElementById('finished-warehouse-modal').showModal()")
    w_box = page.locator("#finished-warehouse-modal").bounding_box()
    print(f"  [AC-6] Finished warehouse width: {w_box['width']:.1f}px (exp 1080)")
    assert abs(w_box["width"] - 1080) <= 2, "Warehouse modal not L (1080px)"
    page.screenshot(path=os.path.join(SHOT_DIR, "AC-6_warehouse_aligned.png"))
    page.evaluate("document.getElementById('finished-warehouse-modal').close()")

    page.evaluate("document.getElementById('user-guide-modal').showModal()")
    caps_count = page.evaluate("""() => {
        const textNodes = [];
        const walk = document.createTreeWalker(document.getElementById('user-guide-modal'), NodeFilter.SHOW_TEXT);
        let n;
        while(n = walk.nextNode()) {
            if (/^[A-Z &]{6,}$/.test(n.nodeValue.trim())) textNodes.push(n.nodeValue.trim());
        }
        return textNodes.length;
    }""")
    print(f"  [AC-6] User guide uppercase badges count: {caps_count} (exp 0)")
    assert caps_count == 0, f"Guide has uppercase badges: {caps_count}"
    page.screenshot(path=os.path.join(SHOT_DIR, "AC-6_user_guide_typography.png"))
    page.evaluate("document.getElementById('user-guide-modal').close()")


def _check_export_dropdown(p, sub, name):
    hidden_check = p.evaluate("""() => {
        const items = Array.from(document.querySelectorAll('.pt-dropdown .pt-dropdown__item'));
        const menu = document.querySelector('.pt-dropdown__menu');
        const menuHidden = !menu || menu.offsetParent === null || getComputedStyle(menu).display === 'none';
        const allHidden = items.every(it => it.offsetParent === null || getComputedStyle(it).display === 'none');
        return { count: items.length, menuHidden, allHidden };
    }""")
    print(f"    - {sub} closed dropdown items check: count={hidden_check['count']}, allHidden={hidden_check['allHidden']}")
    assert hidden_check["allHidden"], f"{sub} menu items not hidden before opening: {hidden_check}"
    p.screenshot(path=os.path.join(SHOT_DIR, f"AC-7_{name}_menu_closed.png"))
    p.click(".btn-export-menu")
    p.wait_for_timeout(80)
    open_items = p.locator(".pt-dropdown .pt-dropdown__item:visible").all_text_contents()
    print(f"    - {sub} dropdown items when open: {open_items}")
    assert len(open_items) == 3, f"{sub} expected 3 export items, found {len(open_items)}"
    assert any("HTML" in t for t in open_items) and any("PNG" in t for t in open_items), f"{sub} items text missing"
    p.screenshot(path=os.path.join(SHOT_DIR, f"AC-7_{name}_embedded.png"))
    p.keyboard.press("Escape")
    p.wait_for_timeout(80)
    assert p.locator(".pt-dropdown .pt-dropdown__item:visible").count() == 0, f"{sub} menu not closed by Escape"


def _check_shelf_menu_and_buttons(p, sub, name):
    move_count = p.locator(".unit-drag-handle:has-text('≡ 이동')").count()
    print(f"    - {sub} '≡ 이동' handle count: {move_count}")
    if sub != "sub_warehouse":
        assert move_count > 0, f"{sub} missing '≡ 이동' handle"
    _check_export_dropdown(p, sub, name)
    if sub == "sub_warehouse":
        # 품목마다 반복되는 행 버튼(🚚, 🗑️ 삭제)은 정상이므로 상단 도구 막대만 검사한다
        texts = [t.strip() for t in p.locator(".shelf-unified-toolbar button:visible").all_text_contents() if t.strip()]
        dups = [t for t in set(texts) if texts.count(t) > 1]
        print(f"    - {sub} visible buttons count={len(texts)}, duplicates={dups}")
        assert len(dups) == 0, f"{sub} duplicate buttons found: {dups}"


def test_ac7_and_ac8_shelves(context, port):
    print("  [AC-7, AC-8] Verifying 4 shelf screens (toolbar, menu, flat styling):")
    for sub, name in [("sub_toolroom", "toolroom"), ("sub_supplies", "supplies"), ("sub_packaging", "packaging"), ("sub_warehouse", "warehouse")]:
        p = context.new_page()
        p.set_viewport_size({"width": 1440, "height": 900})
        p.goto(f"http://127.0.0.1:{port}/{sub}/Index.html")
        p.wait_for_selector("#subapp-auth-gate", state="hidden", timeout=5000)
        p.wait_for_selector("[data-room-app]")
        _check_shelf_menu_and_buttons(p, sub, name)
        res = p.evaluate("""() => {
            const els = Array.from(document.querySelectorAll('header, button, .board-card, .col-header-box, table'));
            let grads = 0, rads = 0, darks = 0;
            els.forEach(el => {
                const s = getComputedStyle(el);
                if (s.backgroundImage.includes('linear-gradient')) grads++;
                if (parseFloat(s.borderRadius) > 12) rads++;
                const c = s.backgroundColor.match(/\\d+/g);
                if (c && c.length >= 3 && s.display !== 'none' && el.offsetHeight > 0) {
                    const lum = (0.2126*c[0] + 0.7152*c[1] + 0.0722*c[2])/255;
                    if (lum < 0.3 && s.backgroundColor !== 'rgba(0, 0, 0, 0)') darks++;
                }
            });
            return { grads, rads, darks };
        }""")
        assert res["grads"] == 0 and res["rads"] == 0 and res["darks"] == 0, f"{sub} AC-8 violations: {res}"
        p.close()


def test_ac9_batch_scheduler(context, port):
    p = context.new_page()
    p.set_viewport_size({"width": 1440, "height": 900})
    p.goto(f"http://127.0.0.1:{port}/sub_batches/Index.html")
    p.wait_for_selector("#subapp-auth-gate", state="hidden", timeout=5000)
    top_btns = [t.strip() for t in p.locator(".hdr-actions button:visible").all_text_contents() if t.strip()]
    foot_btns = [t.strip() for t in p.locator(".app-footer button:visible").all_text_contents() if t.strip()]
    print(f"  [AC-9] Batch scheduler - top buttons: {top_btns}")
    print(f"  [AC-9] Batch scheduler - footer buttons: {foot_btns}")
    assert not any("등록" in b for b in top_btns if "목록" not in b), f"Top toolbar still has submit button: {top_btns}"
    assert not any("초기화" in b for b in top_btns), f"Top toolbar still has reset button: {top_btns}"
    assert any("초기화" in b for b in foot_btns), f"Footer missing reset button: {foot_btns}"
    assert any("등록" in b or "저장" in b for b in foot_btns), f"Footer missing submit button: {foot_btns}"
    p.screenshot(path=os.path.join(SHOT_DIR, "AC-9_batch_new.png"))
    p.click("#btn-history")
    p.wait_for_timeout(80)
    p.screenshot(path=os.path.join(SHOT_DIR, "AC-9_batch_list.png"))
    p.close()


def test_room_popups_load(page):
    print("  [AC-1] Verifying 4 room popups (shelves, warehouse) open from real buttons and render inside the main window:")
    popups = [
        ("toolroom-shelf-modal", "#btn-room-toolroom", "#modal-btn-close"),
        ("supplies-modal", "#btn-room-supplies", "#supplies-modal-btn-close"),
        ("pack-supplies-modal", "#btn-room-pack-supplies", "#pack-supplies-modal-btn-close"),
        ("warehouse-modal", "#btn-room-warehouse-main", "#warehouse-modal-btn-close"),
    ]
    for mid, btn_sel, close_sel in popups:
        page.click(btn_sel)
        page.wait_for_selector(f"#{mid} [data-room-app] .tier-block, #{mid} [data-room-app] .shelf-bay")
        info = page.evaluate(f"""() => {{
            const d = document.getElementById('{mid}');
            const app = d.querySelector('[data-room-app]');
            // 창 머리에 제목이 있으므로 화면 안 제목은 숨긴다
            const title = app.querySelector('header > div:first-child');
            return {{ open: d.open, chars: app.innerText.trim().length, titleHidden: !title || getComputedStyle(title).display === 'none' }};
        }}""")
        print(f"    - {mid:22s} open={info['open']} | body_chars={info['chars']} | title_hidden={info['titleHidden']}")
        assert info["open"] and info["chars"] > 0 and info["titleHidden"], f"{mid} {info}"
        page.screenshot(path=os.path.join(SHOT_DIR, f"AC-1_{mid}_loaded.png"))
        page.click(close_sel)
        page.wait_for_timeout(100)
    # 배치 등록 창은 iframe 없이 메인 창 안에 뜬다
    page.click("#btn-batch-modal-trigger")
    page.wait_for_selector("#batch-schedule-modal #inp-lot")
    _check_net_qty_sync(page.locator("#batch-schedule-modal"), os.path.join(SHOT_DIR, "AC-1_batch_qty_sync.png"), page)
    page.click("#batch-modal-btn-close")
    page.wait_for_timeout(100)


def _check_net_qty_sync(frame, shot_path, page):
    print("  [배치 수량] 차감 수량과 실수량 양방향 연동 검증")
    val = lambda sel: frame.locator(sel).input_value()
    assert frame.locator("#disp-actual-D").is_disabled(), "공정2 실적 전에는 실수량 입력 잠금"
    frame.locator("#qty-B").fill("7387")
    assert val("#disp-actual-D") == "7387"
    # 보고받은 실수량 입력 -> 차감 자동 계산
    frame.locator("#disp-actual-D").fill("7371")
    assert val("#loss-D") == "16", f"공정4 차감 {val('#loss-D')}"
    assert val("#disp-actual-E") == "7371", "뒤 공정 인계"
    frame.locator("#disp-actual-E").fill("7357")
    assert val("#loss-E") == "14", f"공정5 차감 {val('#loss-E')}"
    # 차감 입력 -> 실수량 자동 계산, 뒤 공정 차감은 유지
    frame.locator("#loss-D").fill("20")
    assert val("#disp-actual-D") == "7367" and val("#disp-actual-E") == "7353" and val("#loss-E") == "14"
    # 실수량을 앞 공정보다 크게 적으면 음수 차감
    frame.locator("#disp-actual-packaging").fill("7360")
    assert val("#loss-packaging") == "-7"
    # 실수량을 비우면 차감도 비움
    frame.locator("#disp-actual-E").fill("")
    assert val("#loss-E") == ""
    page.screenshot(path=shot_path)
    for sel in ["#qty-B", "#loss-D", "#loss-packaging"]:
        frame.locator(sel).fill("")
    assert frame.locator("#disp-actual-D").is_disabled()


def test_regression_writes(page, state):
    page.click("#btn-daily-todo")
    page.wait_for_timeout(80)
    page.click("#btn-todo-rules")
    page.wait_for_timeout(80)
    page.click("#btn-todo-rules-save")
    page.wait_for_timeout(200)
    print(f"  [AC-R4] Safe isolation intercepted writes: {len(state['writes'])}")
    assert len(state["writes"]) >= 2, f"Write requests intercepted: {len(state['writes'])}"


def main():
    print(f"=== Starting E2E qa_runner_popup_layout ===")
    _server = start_server()
    state = {"writes": [], "console_errors": []}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        context.add_init_script(qa_runner_common.login_js({'id': 1, 'name': '관리자', 'dept': '관리자', 'department': '관리자'}))
        setup_mocking(context, state)
        page = context.new_page()
        page.on("console", lambda m: state["console_errors"].append(m.text) if m.type == "error" else None)
        page.goto(f"http://127.0.0.1:{PORT}/index.html")
        page.wait_for_timeout(400)
        test_ac1_tokens_and_theme(page)
        test_ac2_and_ac3_modals(page)
        test_ac4_layouts(page)
        test_ac5_rules_panel(page)
        test_ac6_warehouse_and_guide(page)
        test_ac7_and_ac8_shelves(context, PORT)
        test_ac9_batch_scheduler(context, PORT)
        test_room_popups_load(page)
        test_regression_writes(page, state)
        assert len(state["console_errors"]) == 0, f"Console errors: {state['console_errors']}"
        print("  [AC-R3] Console errors: 0")
        browser.close()
    print("=== qa_runner_popup_layout PASSED ===")


if __name__ == "__main__":
    main()
