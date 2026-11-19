"""
qa_runner_shelf_sync.py - 선반·창고 동기화에서 편집이 사라지지 않는지, 방 사이 보내기가 서버에 남는지 (화면 조작으로)
서버의 shelf_data 행을 방마다 상태로 흉내 낸다: 읽으면 지금 행을 주고, 쓰면 받은 데이터로 바뀐다.
st.fail이면 쓰기가 500으로 실패한다. 실패해도 멈추지 않고 모든 항목을 돈 뒤, 하나라도 실패면 종료 코드 1.
저장 엔진 자체(재시도·끌기 중 무시·첫 읽기 뒤 받기)는 tests/room_store.test.js가 단위로 본다.
"""
import copy
import json
import os
import re
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright

import qa_runner_common

PORT = qa_runner_common.free_port()
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))  # 저장소 맨 위 폴더
RETRY_TIMEOUT_MS = 15000  # 실패한 저장은 5초 뒤 다시 보낸다
FAILS = []
PAGE_ERRORS = []
SHELF_SEED = json.load(open(os.path.join(ROOT, "src", "rooms", "shelf", "defaults", "supplies.json"), encoding="utf-8"))
TOOLROOM_SEED = json.load(open(os.path.join(ROOT, "src", "rooms", "shelf", "defaults", "toolroom.json"), encoding="utf-8"))
WH_SEED = {
    "bays": {
        "4-left": [{"uid": "W-4L-1", "name": "접이식 운반 카트 (핸드카트)"}], "4-right": [{"uid": "W-4R-1", "name": "완충 에어캡 롤 (뽁뽁이)"}],
        "3-left": [{"uid": "W-3L-1", "name": "포장용 OPP 박스 테이프"}], "3-right": [{"uid": "W-3R-1", "name": "스트레치 필름 롤"}],
        "2-left": [{"uid": "W-2L-1", "name": "골판지 아웃박스 (중형)"}], "2-right": [{"uid": "W-2R-1", "name": "골판지 아웃박스 (대형)"}],
        "1-left": [{"uid": "W-1L-1", "name": "플라스틱 파렛트 (예비)"}], "1-right": [{"uid": "W-1R-1", "name": "바코드 라벨 용지 롤"}]
    },
    "tray": [{"uid": "T-1", "name": "디스펜서 테이프 커터기"}, {"uid": "T-2", "name": "청결용 소독 분무기"}]
}
OPERATOR = "localStorage.setItem('APP_VERIFIED_OPERATOR', JSON.stringify({name:'검증자', dept:'생산팀 대리'}));"


class QuietHandler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=qa_runner_common.SITE_ROOT, **k)
    def log_message(self, fmt, *a): pass


class State:
    def __init__(self, rows=None):
        self.rows = copy.deepcopy(rows or {})
        self.fail = False
        self.writes = []
        self.reads = 0
        self.hold = set()
        self.held = []
        self.prompt = None

    def release(self, room):
        """붙잡아 둔 첫 읽기를 이제 돌려준다."""
        self.hold.discard(room)
        for route in self.held:
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"data": self.rows[room]}))
        self.held = []


def handle(route, st):
    req, url = route.request, route.request.url
    if "/rest/v1/shelf_data" in url:
        if req.method in ("POST", "PATCH", "PUT"):
            body = json.loads(req.post_data or "null")
            row = body[0] if isinstance(body, list) else body
            st.writes.append({"room": row["room_id"], "data": copy.deepcopy(row["data"]), "failed": st.fail})
            if st.fail:
                return route.fulfill(status=500, content_type="application/json", body=json.dumps({"message": "down"}))
            st.rows[row["room_id"]] = copy.deepcopy(row["data"])
            return route.fulfill(status=201, content_type="application/json", body="[]")
        room = re.search(r"room_id=eq\.([\w-]+)", url).group(1)
        st.reads += 1
        if room in st.hold:
            st.held.append(route)
            return None
        if room not in st.rows:
            return route.fulfill(status=200, content_type="application/json", body="null")
        return route.fulfill(status=200, content_type="application/json", body=json.dumps({"data": st.rows[room]}))
    if req.method in ("POST", "PUT", "PATCH", "DELETE"):
        return route.fulfill(status=201, content_type="application/json", body="[]")
    return qa_runner_common.fallback(route)


def wait_until(page, cond, ms=5000):
    """조건이 맞을 때까지(최대 ms) 기다린다. 여러 러너를 같이 돌려 느려져도 고정 대기처럼 흔들리지 않게."""
    for _ in range(ms // 100):
        if cond():
            return
        page.wait_for_timeout(100)


def check(name, ok, detail):
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}: {detail}")
    if not ok:
        FAILS.append(name)


def new_page(browser, st, init_script=None):
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    ctx.route("**/*", lambda r: handle(r, st))
    qa_runner_common.block_realtime(ctx)
    page = ctx.new_page()
    if init_script:
        page.add_init_script(init_script)
    page.on("pageerror", lambda e: PAGE_ERRORS.append(str(e)))
    page.on("dialog", lambda d: d.accept(st.prompt if d.type == "prompt" and st.prompt else d.default_value))
    return ctx, page


def open_room(browser, st, path, init_script=None):
    ctx, page = new_page(browser, st, init_script)
    page.goto(f"http://127.0.0.1:{PORT}/{path}")
    page.wait_for_selector("#subapp-auth-gate", state="hidden")
    wait_until(page, lambda: st.reads)
    page.wait_for_selector("[data-room-app]")
    page.wait_for_timeout(300)
    return ctx, page


def open_main(browser, st, init_script=""):
    ctx, page = new_page(browser, st, OPERATOR + init_script)
    page.goto(f"http://127.0.0.1:{PORT}/index.html?qa=true")
    page.wait_for_selector("#btn-room-toolroom")
    page.wait_for_timeout(800)
    return ctx, page


def refetch_on_return(page):
    page.evaluate("() => document.dispatchEvent(new Event('visibilitychange'))")
    page.wait_for_timeout(800)


def test_shelf_failed_save_kept(browser):
    print("[F1] 선반: 저장 실패 뒤 화면으로 돌아와 다시 읽어도 편집 유지·다시 저장")
    st = State({"supplies": SHELF_SEED})
    ctx, page = open_room(browser, st, "sub_supplies/Index.html")
    n0 = len(SHELF_SEED["toBe"])
    st.fail = True
    page.locator(".btn-add-tier-bar").first.click()
    wait_until(page, lambda: any(w["failed"] for w in st.writes))
    check("선반 저장 실패", any(w["failed"] for w in st.writes) and len(st.rows["supplies"]["toBe"]) == n0,
          f"쓰기 {len(st.writes)}회, 서버 단 {len(st.rows['supplies']['toBe'])}개, 상태 '{page.text_content('.sync-text')}'")
    refetch_on_return(page)
    kept = page.locator(".tier-block").count()
    check("선반 다시 읽어도 편집 유지", kept == n0 + 1, f"화면 단 {kept}개 (기대 {n0 + 1})")
    st.fail = False
    wait_until(page, lambda: len(st.rows["supplies"]["toBe"]) == n0 + 1, RETRY_TIMEOUT_MS)
    saved = len(st.rows["supplies"]["toBe"])
    check("선반 실패한 편집 다시 저장", saved == n0 + 1, f"서버 단 {saved}개 (기대 {n0 + 1})")
    ctx.close()


def test_warehouse_failed_save_kept(browser):
    print("[F1] 창고: 저장 실패 뒤 화면으로 돌아와 다시 읽어도 편집 유지·다시 저장")
    st = State({"warehouse_main": WH_SEED})
    ctx, page = open_room(browser, st, "sub_warehouse/Index.html")
    st.fail = True
    page.click('.item-card[data-uid="W-4L-1"] .item-del-btn')
    wait_until(page, lambda: any(w["failed"] for w in st.writes))
    refetch_on_return(page)
    kept = page.locator('.item-card[data-uid="W-4L-1"]').count()
    check("창고 다시 읽어도 삭제 유지", not kept, f"화면에 W-4L-1 {'다시 생김' if kept else '없음'}")
    st.fail = False
    gone = lambda: not any(i["uid"] == "W-4L-1" for i in st.rows["warehouse_main"]["bays"]["4-left"])
    wait_until(page, gone, RETRY_TIMEOUT_MS)
    check("창고 실패한 편집 다시 저장", gone(), f"서버에 W-4L-1 {'없음' if gone() else '남음'}")
    ctx.close()


def custom_uids(st, room):
    return [b.get("uid") for b in (st.rows.get(room) or {}).get("custom") or []]


def test_transfer_to_closed_room(browser):
    print("[F2] 메인 화면: 열지 않은 방으로 보내도 받는 방의 서버 최신 값에 넣어 저장 (첫 읽기 전에는 쓰지 않음)")
    server = copy.deepcopy(SHELF_SEED)
    server["toBe"][0]["tierTitle"] += " (다른 PC가 바꿈)"
    st = State({"supplies": server, "toolroom": TOOLROOM_SEED})
    st.hold.add("supplies")
    ctx, page = open_main(browser, st)
    page.click("#btn-room-toolroom")
    card = page.locator("#toolroom-shelf-modal .block-card").first
    name = card.locator(".block-title-text").text_content()
    card.hover()
    card.locator(".block-btn-transfer").click()
    page.click('#toolroom-shelf-modal .floating-transfer-popover .popover-target-btn:has-text("비품실")')
    page.click("#toolroom-shelf-modal .floating-transfer-popover .popover-submit-btn")
    wait_until(page, lambda: any(w["room"] == "toolroom" for w in st.writes))
    in_toolroom = name in json.dumps(st.rows["toolroom"], ensure_ascii=False)
    check("보낸 방에서 빠져 저장", not in_toolroom, f"부품 보관실 서버에 [{name}] {'남음' if in_toolroom else '없음'}")
    page.wait_for_timeout(500)
    early = [w for w in st.writes if w["room"] == "supplies"]
    st.release("supplies")
    wait_until(page, lambda: any(w["room"] == "supplies" for w in st.writes))
    got = [b.get("text") for b in st.rows["supplies"].get("custom") or []]
    stale = [w for w in st.writes if w["room"] == "supplies" and "다른 PC가 바꿈" not in w["data"]["toBe"][0]["tierTitle"]]
    check("받는 방 첫 읽기 전에는 쓰지 않음", not early and not stale, f"첫 읽기 전 쓰기 {len(early)}회, 서버 값을 되돌리는 쓰기 {len(stale)}회")
    check("받는 방 대기 품목함 맨 앞에 저장", got[:1] == [name], f"비품실 서버 대기함 {got[:3]}")
    toast = page.locator("#toolroom-shelf-modal .room-toast").text_content() or ""
    check("보낸 쪽 안내", "비품실" in toast, toast)
    ctx.close()


def test_drain_old_pending(browser):
    print("[F2] 옛 화면이 이 기기에 남긴 '보냈지만 못 받은' 품목을 메인 화면이 받는 방에 넣는다")
    st = State({"supplies": SHELF_SEED, "warehouse_main": WH_SEED})
    ctx, page = open_main(browser, st, """if (!sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('APP_PENDING_CROSS_ROOM_ITEMS', JSON.stringify({
          supplies: [{ fromRoom: 'toolroom', fromRoomName: '부품 보관실 선반', item: { uid: 'XFER-S2', name: '대기 품목', text: '대기 품목' } }],
          'warehouse-main': [{ fromRoom: 'toolroom', fromRoomName: '부품 보관실 선반', item: { uid: 'XFER-W1', name: '창고 대기' } }] }));
    }""")
    wh = lambda: [i["uid"] for i in (st.rows["warehouse_main"].get("tray") or [])]
    wait_until(page, lambda: "XFER-S2" in custom_uids(st, "supplies") and "XFER-W1" in wh())
    left = page.evaluate("() => localStorage.getItem('APP_PENDING_CROSS_ROOM_ITEMS')")
    check("옛 대기 품목 받기", "XFER-S2" in custom_uids(st, "supplies") and "XFER-W1" in wh() and left is None,
          f"비품실 {custom_uids(st, 'supplies')[:2]}, 창고 {wh()[:2]}, 남은 대기 {left}")
    ctx.close()


def count_uid(data, uid):
    return sum(i["uid"] == uid for items in [*data["bays"].values(), data.get("tray") or []] for i in items)


def center(page, selector):
    box = page.locator(selector).bounding_box()
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2


def test_warehouse_refresh_during_drag(browser):
    print("[F3] 창고: 끌기 중에 서버 데이터가 와도 끌던 품목이 둘이 되지 않음")
    st = State({"warehouse_main": WH_SEED})
    ctx, page = open_room(browser, st, "sub_warehouse/Index.html")
    x, y = center(page, '.item-card[data-uid="W-4L-1"]')
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + 30, y + 30, steps=5)
    dragging = page.locator(".item-card.is-dragging").count() == 1
    remote = copy.deepcopy(WH_SEED)
    remote["bays"]["3-right"].append(remote["bays"]["4-left"].pop(0))
    st.rows["warehouse_main"] = remote
    refetch_on_return(page)
    page.mouse.move(*center(page, '[data-bay-id="2-left"]'), steps=5)
    page.mouse.up()
    wait_until(page, lambda: st.writes)
    n = count_uid(st.rows["warehouse_main"], "W-4L-1")
    check("창고 끌기 중 다시 읽어도 품목 하나", dragging and n == 1, f"끌기 {'중' if dragging else '아님'}, 서버의 W-4L-1 {n}개")
    after = copy.deepcopy(st.rows["warehouse_main"])
    after["bays"]["1-right"].append({"uid": "W-AFTER", "name": "끌기 뒤 다른 PC 품목"})
    st.rows["warehouse_main"] = after
    refetch_on_return(page)
    applied = page.locator('.item-card[data-uid="W-AFTER"]').count() == 1
    check("창고 끌기가 끝난 뒤 서버 데이터 반영", applied, f"W-AFTER {'보임' if applied else '안 보임'}")
    ctx.close()


def test_warehouse_ui(browser):
    print("[W] 창고 화면 조작: 등록·수정·삭제·다른 방 보내기·비우기·빈 칸 등록·CSV·기본 복원 (화면 버튼으로만)")
    st = State({"warehouse_main": WH_SEED, "supplies": SHELF_SEED})
    ctx, page = open_room(browser, st, "sub_warehouse/Index.html")
    srv = lambda: st.rows["warehouse_main"]
    names = lambda loc: [i["name"] for i in (srv()["tray"] if loc == "tray" else srv()["bays"][loc])]

    page.fill(".new-item-name", "새 품목 A")
    page.click(".btn-add-new-item")
    wait_until(page, lambda: "새 품목 A" in names("tray"))
    check("창고 등록은 대기 품목함 맨 앞", names("tray")[:1] == ["새 품목 A"], f"서버 대기함={names('tray')}")

    page.click('.tray-items .item-card:has-text("새 품목 A") .item-text')
    open_ = page.evaluate("() => document.querySelector('dialog.detail-modal').open")
    page.fill(".detail-modal .form-control", "고친 품목 A")
    page.click(".detail-modal .btn-primary")
    wait_until(page, lambda: "고친 품목 A" in names("tray"))
    check("창고 품목명 수정", open_ and "고친 품목 A" in names("tray") and "새 품목 A" not in names("tray"),
          f"창 열림={open_}, 서버 대기함={names('tray')}")

    page.click('.item-card[data-uid="W-4L-1"] .item-del-btn')
    wait_until(page, lambda: not any(i["uid"] == "W-4L-1" for i in srv()["bays"]["4-left"]))
    check("창고 삭제 버튼", not any(i["uid"] == "W-4L-1" for i in srv()["bays"]["4-left"]), f"서버 4-left={names('4-left')}")

    page.click('.item-card[data-uid="W-3L-1"] .item-transfer-btn')
    page.click('.floating-transfer-popover .popover-target-btn:has-text("비품실")')
    page.click(".floating-transfer-popover .popover-submit-btn")
    wait_until(page, lambda: "W-3L-1" in custom_uids(st, "supplies"))
    toast = page.locator(".room-toast").text_content() or ""
    check("창고 다른 방 보내기", not any(i["uid"] == "W-3L-1" for i in srv()["bays"]["3-left"]) and "W-3L-1" in custom_uids(st, "supplies")
          and "비품실" in toast and page.locator(".floating-transfer-popover").count() == 0,
          f"서버 3-left={names('3-left')}, 비품실 대기함 {custom_uids(st, 'supplies')[:2]}, 안내='{toast}'")

    page.click(".btn-clear-all")
    wait_until(page, lambda: all(not v for v in srv()["bays"].values()))
    check("창고 전체 비우기", all(not v for v in srv()["bays"].values()) and names("tray"), f"서버 선반 품목 {sum(len(v) for v in srv()['bays'].values())}개, 대기함 유지 {len(names('tray'))}개")

    st.prompt = "빈 칸 품목"
    page.click('[data-bay-id="1-left"] .bay-empty-hint')
    wait_until(page, lambda: names("1-left") == ["빈 칸 품목"])
    check("창고 빈 선반 클릭 등록", names("1-left") == ["빈 칸 품목"], f"서버 1-left={names('1-left')}")

    page.click(".btn-export-menu")
    with page.expect_download() as dl:
        page.click('.pt-dropdown__item:has-text("CSV")')
    csv = open(dl.value.path(), encoding="utf-8-sig").read()
    check("창고 CSV", '"빈 칸 품목"' in csv and '"고친 품목 A"' in csv and dl.value.suggested_filename.endswith(".csv"),
          f"파일={dl.value.suggested_filename}, 줄 {len(csv.splitlines())}개")

    page.click(".btn-reset-default")
    wait_until(page, lambda: srv()["bays"] == WH_SEED["bays"])
    check("창고 기본 복원", srv()["bays"] == WH_SEED["bays"], f"서버 4-left={names('4-left')}")
    ctx.close()


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), QuietHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        test_shelf_failed_save_kept(browser)
        test_warehouse_failed_save_kept(browser)
        test_transfer_to_closed_room(browser)
        test_drain_old_pending(browser)
        test_warehouse_refresh_during_drag(browser)
        test_warehouse_ui(browser)
        browser.close()
    check("페이지 오류 0", not PAGE_ERRORS, f"{PAGE_ERRORS[:3]}")
    server.shutdown()
    if FAILS:
        print(f"\n=== 실패 {len(FAILS)}건: {FAILS} ===")
        sys.exit(1)
    print("\n=== qa_runner_shelf_sync ALL PASSED ===")


if __name__ == "__main__":
    main()
