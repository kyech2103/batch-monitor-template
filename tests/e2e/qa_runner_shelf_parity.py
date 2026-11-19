"""qa_runner_shelf_parity.py - 선반 화면 3개(부품 보관실·비품실·포장 비품실)의 동작이 기록본과 같은지 비교한다.

새 창 화면을 띄운 뒤 같은 편집을 화면 단추로만 차례로 하고, 매 단계 서버에 쓴 데이터와 처음·마지막 화면 구조,
작업 기록, CSV 내보내기를 tests/fixtures/shelf_golden/<방>.json 과 비교한다. --record 로 실행하면 기록본을 새로 쓴다.
(편집 함수 자체는 tests/shelf_model.test.js가 단위로 본다)
"""
import json
import os
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright

import qa_runner_common

PORT = qa_runner_common.free_port()
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))  # 저장소 맨 위 폴더
GOLDEN_DIR = os.path.join(ROOT, "tests", "fixtures", "shelf_golden")
ROOMS = ["sub_toolroom", "sub_supplies", "sub_packaging"]
FIXED_TIME = "2026-10-27T09:00:00+09:00"
XSS = '<img src=x onerror="window.__xss=1">'

SNAPSHOT_DOM = """() => {
  const props = ['display','position','width','height','color','background-color','font-size','font-weight',
                 'border-top-width','border-top-color','border-radius','margin-top','padding-top','gap','opacity','visibility',
                 'background-image','box-shadow','outline-style','text-align','line-height','font-family','overflow','z-index'];
  const walk = (el) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const own = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').trim();
    return [el.tagName, el.className && el.className.baseVal === undefined ? el.className : '',
            own, [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(','),
            props.map(p => s.getPropertyValue(p)).join('|'),
            Array.from(el.children).map(walk)];
  };
  return walk(document.querySelector('[data-room-app]'));
}"""


def menu(page, col, label):
    page.locator(".col-bay").nth(col).click(button="right")
    page.click(f'.col-context-menu-item:has-text("{label}")')


# 세 방에 모두 되는 편집만 쓴다 (방마다 기본 배치가 달라도 첫 단·첫 열 등 늘 있는 자리로)
STEPS = [
    ("load", None),
    ("addTier", lambda p: p.locator(".btn-add-tier-bar").first.click()),
    ("addColumn", lambda p: p.locator(".btn-tier-add-col").first.click()),
    ("placeWaiting", lambda p: (p.locator(".tab-item-chip > span").first.click(), p.locator(".item-slot-bay").first.click())),
    # 품목을 고른 뒤 품목·칸 밖을 누르면 선택이 풀리는지 (비품실만 풀린다)
    ("outsideClick", lambda p: (p.locator(".block-card").first.click(), p.mouse.click(5, 5), p.locator(".block-card.is-selected").count(), p.keyboard.press("Escape"))[-2]),
    ("moveByClick", lambda p: (p.locator(".block-card").first.click(), p.locator(".tier-block").first.locator(".col-bay").last.locator(".item-slot-bay").first.click())),
    # 끌어 놓는 칸은 화면 안에 있는 것으로 (멀면 끄는 도중 화면이 스크롤되어 다른 것을 끌게 된다)
    ("dragItem", lambda p: p.locator(".block-card").first.drag_to(p.locator(".tier-block").first.locator(".col-bay").nth(1).locator(".item-slot-bay").first)),
    ("stackByClick", lambda p: (p.locator(".unit-drag-handle").first.click(), p.locator(".btn-click-merge-top").first.click())),
    ("unstack", lambda p: p.locator(".btn-unit-unstack").first.click()),
    ("color", lambda p: (p.locator(".block-card").first.hover(), p.locator(".block-card").first.locator(".block-btn-color").click(), p.click('.color-picker-dot[title="빨강"]'))),
    ("renameColumn", lambda p: menu(p, 0, "이름 변경")),
    ("deleteColumn", lambda p: menu(p, -1, "이 구역 삭제")),
    ("deleteTier", lambda p: menu(p, -1, "단 전체 삭제")),
    ("addNewItem", lambda p: (p.fill(".new-item-name", "E2E 품목"), p.select_option(".new-item-cat", "tool"), p.click('.tab-color-dot[title="초록"]'), p.click(".btn-add-new-item"))),
    ("deleteWaiting", lambda p: p.locator('.tab-item-chip').last.locator('.tab-item-chip-del[title="대기 목록에서 삭제"]').click()),
]


class QuietHandler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=qa_runner_common.SITE_ROOT, **k)
    def log_message(self, fmt, *a): pass


def start_server():
    s = ThreadingHTTPServer(("127.0.0.1", PORT), QuietHandler)
    threading.Thread(target=s.serve_forever, daemon=True).start()


def run_room(browser, sub):
    calls = []

    def handle(route):
        req = route.request
        if "/rest/v1/" in req.url and req.method in ("POST", "PATCH"):
            table = req.url.split("/rest/v1/")[1].split("?")[0]
            calls.append({"table": table, "body": json.loads(req.post_data or "null")})
            return route.fulfill(status=201, content_type="application/json", body="[]")
        return qa_runner_common.fallback(route)

    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    ctx.route("**/*", handle)
    qa_runner_common.block_realtime(ctx)
    page = ctx.new_page()
    page.clock.install(time=FIXED_TIME)
    page.clock.pause_at(FIXED_TIME)
    page.on("dialog", lambda d: d.accept(d.default_value))
    page.add_init_script("""(() => {
      window.__exports = [];
      const orig = URL.createObjectURL;
      URL.createObjectURL = (blob) => { blob.text().then(t => window.__exports.push(t)); return orig(blob); };
      HTMLAnchorElement.prototype.click = function () {};
    })()""")
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"http://127.0.0.1:{PORT}/{sub}/Index.html")
    # 시계를 멈춰 두고 단계마다 같은 만큼만 흘린다: 0.3초 지연 저장이 부하와 상관없이 같은 단계에서 나가게
    for _ in range(50):
        page.clock.run_for(200)
        if page.locator("#subapp-auth-gate").is_hidden() and page.locator("[data-room-app]").count():
            break
    page.add_style_tag(content="*, *::before, *::after { transition: none !important; animation: none !important; }")
    page.clock.run_for(1000)
    page.wait_for_timeout(200)

    result = {"steps": []}
    for i, (name, act) in enumerate(STEPS):
        probe = act(page) if act else None
        if act:
            page.clock.run_for(1000)
            page.wait_for_timeout(100)
        saved = [c["body"] for c in calls if c["table"] == "shelf_data"]
        step = {"name": name, "model": saved[-1]["data"] if saved else None, "status": page.text_content(".sync-text")}
        if isinstance(probe, int):
            step["probe"] = probe
        # 화면 구조는 처음과 마지막만 남긴다 (중간 단계까지 담으면 기록본이 너무 커진다)
        if i in (0, len(STEPS) - 1):
            step["dom"] = page.evaluate(SNAPSHOT_DOM)
        result["steps"].append(step)
    page.clock.run_for(1000)
    page.wait_for_timeout(300)
    result["saves"] = list(calls)
    page.click(".btn-export-menu")
    page.click('.pt-dropdown__item:has-text("CSV")')
    page.wait_for_timeout(100)
    result["csv"] = page.evaluate("() => window.__exports.slice()")
    # HTML 내보내기는 지금 화면 그대로(편집 단추 없이) 혼자 열리는 파일
    page.click(".btn-export-menu")
    page.click('.pt-dropdown__item:has-text("HTML")')
    page.wait_for_timeout(100)
    html = page.evaluate("() => window.__exports[window.__exports.length - 1]")
    first_item = page.locator(".tier-label-bar").first.text_content()
    assert html.startswith("<!DOCTYPE html>") and first_item in html and 'class="block-btn-del"' not in html and "<script" not in html, f"{sub}: HTML 내보내기 {html[:120]}"
    # 품목 이름에 HTML을 넣어도 글자로만 보여야 한다 (기록본과 별개 검사)
    page.fill(".new-item-name", XSS)
    page.click(".btn-add-new-item")
    page.clock.run_for(500)
    page.wait_for_timeout(200)
    shown = page.locator(".tab-item-chip").last.text_content()
    assert XSS in shown and page.locator('img[src="x"]').count() == 0 and not page.evaluate("() => window.__xss"), f"{sub}: 품목 이름의 HTML이 실행됨"
    result["errors"] = errors
    ctx.close()
    return result


def first_diff(a, b, path="$"):
    if type(a) is not type(b):
        return f"{path}: {str(a)[:120]!r} != {str(b)[:120]!r}"
    if isinstance(a, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a or k not in b:
                return f"{path}.{k}: missing on one side"
            d = first_diff(a[k], b[k], f"{path}.{k}")
            if d:
                return d
        return None
    if isinstance(a, list):
        for i, (x, y) in enumerate(zip(a, b)):
            d = first_diff(x, y, f"{path}[{i}]")
            if d:
                return d
        return f"{path}: length {len(a)} != {len(b)}" if len(a) != len(b) else None
    return None if a == b else f"{path}: {str(a)[:120]!r} != {str(b)[:120]!r}"


def main():
    record = "--record" in sys.argv
    start_server()
    os.makedirs(GOLDEN_DIR, exist_ok=True)
    failed = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for sub in ROOMS:
            res = run_room(browser, sub)
            path = os.path.join(GOLDEN_DIR, f"{sub}.json")
            print(f"\n--- [{sub}] 단계 {len(res['steps'])}개, 저장 요청 {len(res['saves'])}건, CSV {len(res['csv'])}건, 오류 {len(res['errors'])}건")
            if record:
                with open(path, "w", encoding="utf-8") as f:
                    json.dump(res, f, ensure_ascii=False, separators=(",", ":"))
                print(f"  * 기록본 저장: {path}")
                continue
            with open(path, encoding="utf-8") as f:
                golden = json.load(f)
            diff = first_diff(golden, res)
            print(f"  * 기록본과 비교: {'같음' if not diff else '다름 -> ' + diff}")
            if diff:
                failed.append(sub)
        browser.close()
    assert not failed, f"기록본과 다른 화면: {failed}"
    print("\n=== [qa_runner_shelf_parity] ALL PASS ===")


if __name__ == "__main__":
    main()
