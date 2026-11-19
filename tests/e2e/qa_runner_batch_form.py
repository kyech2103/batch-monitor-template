"""
qa_runner_batch_form.py - PC 배치 등록 화면(sub_batches) 동작 E2E
시간 칸 자동 연동, 로트 → 제품 표시, 템플릿 저장·적용·삭제, 일정 미리보기.
React로 옮길 때 같은 동작을 지키는지 보는 기준이다. 서버 흉내·화면 열기는 qa_runner_batch_writes를 그대로 쓴다.
"""
import sys
import threading
from datetime import datetime, timedelta
from http.server import ThreadingHTTPServer

from playwright.sync_api import sync_playwright

import qa_runner_batch_writes as w

FAILS = w.FAILS


def val(frame, sel):
    return frame.input_value(sel)


def test_time_sync(browser):
    print("\n--- 시작·소요·종료 칸 자동 연동 ---")
    state = w.State([w.batch("LOT-1", "stage1-wait")])
    ctx, page = w.open_page(browser, state)
    f = w.open_form(page)
    f.fill("#start-B", "11180900")
    f.fill("#dur-B", "0230")
    w.check("시작+소요 → 종료", val(f, "#end-B") == "11181130", f"종료={val(f, '#end-B')}")
    f.fill("#end-B", "11181300")
    w.check("종료 → 소요", val(f, "#dur-B") == "0400", f"소요={val(f, '#dur-B')}")
    f.fill("#start-C", "")  # 폼은 기본 일정으로 채워져 열린다
    f.fill("#end-C", "")
    f.fill("#dur-C", "0100")
    f.fill("#end-C", "11181500")
    w.check("시작 없이 소요+종료 → 시작", val(f, "#start-C") == "11181400", f"시작={val(f, '#start-C')}")
    ctx.close()


def test_product_badge(browser):
    print("\n--- 로트 넘버 → 제품 표시 ---")
    state = w.State([w.batch("LOT-1", "stage1-wait")])
    ctx, page = w.open_page(browser, state)
    f = w.open_form(page)
    seen = []
    for lot in ["PA2611-01", "LOT-PD2611", "PC-1", "PE-1", "ABC-1"]:
        f.fill("#inp-lot", lot)
        seen.append(f.text_content("#lot-product-badge"))
    f.fill("#inp-lot", "")
    hidden = not f.is_visible("#lot-product-badge")
    w.check("제품 이름", seen == ["제품 A", "제품 D", "제품 C", "제품 B", "기타 제품"] and hidden, f"{seen}, 빈 로트 숨김={hidden}")
    ctx.close()


def test_template_cycle(browser):
    print("\n--- 템플릿 저장 → 적용(시작 시각 하나로 전체 일정) → 삭제 ---")
    state = w.State([w.batch("LOT-1", "stage1-wait")])
    ctx, page = w.open_page(browser, state)
    page.on("dialog", lambda d: d.accept())
    f = w.open_form(page)
    f.fill("#start-A", "11180900")
    f.fill("#dur-C", "2400")
    f.fill("#remarks-C", "QA 건조 비고")
    f.click("#btn-tpl-save")
    f.fill("#inp-tpl-name", "QA 템플릿")
    f.click("#btn-confirm-save-tpl")
    page.wait_for_timeout(500)
    saved = state.other_rows[-1] if state.other_rows else {}
    tpl = (saved.get("data") or [{}])[0]
    ofs = tpl.get("offsets", {})
    w.check("템플릿 저장", saved.get("id") == "batch_templates" and tpl.get("name") == "QA 템플릿" and ofs.get("C", {}).get("dur") == 1440
            and tpl.get("remarks", {}).get("C") == "QA 건조 비고", f"id={saved.get('id')}, 이름={tpl.get('name')}, C={ofs.get('C')}")

    f.fill("#start-A", "")
    f.fill("#dur-C", "0100")
    f.click("#btn-tpl-load")
    page.wait_for_timeout(300)
    f.click(f".btn-apply-tpl[data-tpl-id='{tpl.get('id')}']")
    page.wait_for_timeout(200)
    w.check("적용: 소요 채움·시작 비움", val(f, "#dur-C") == "2400" and val(f, "#start-A") == "" and val(f, "#remarks-C") == "QA 건조 비고",
            f"C 소요={val(f, '#dur-C')}, A 시작='{val(f, '#start-A')}'")
    f.fill("#start-A", "11190800")
    page.wait_for_timeout(200)
    t0 = datetime(datetime.now().year, 11, 19, 8, 0)
    want = (t0 + timedelta(minutes=ofs["E"]["endOffset"])).strftime("%m%d%H%M")
    w.check("시작 시각 하나로 공정5 종료까지", val(f, "#end-E") == want, f"공정5 종료={val(f, '#end-E')}, 기대={want}")

    f.click("#btn-tpl-load")
    page.wait_for_timeout(300)
    f.click(f".btn-del-tpl[data-tpl-id='{tpl.get('id')}']")
    page.wait_for_timeout(400)
    left = [t.get("id") for t in state.other_rows[-1].get("data", [])]
    w.check("템플릿 삭제", tpl.get("id") not in left and len(state.other_rows) == 2, f"남은 템플릿={left}, 쓰기 {len(state.other_rows)}회")
    ctx.close()


def test_preview(browser):
    print("\n--- 일정 상세 미리보기 ---")
    state = w.State([w.batch("LOT-1", "stage1-wait")])
    ctx, page = w.open_page(browser, state)
    f = w.open_form(page)
    f.fill("#inp-lot", "PA-PREVIEW")
    f.fill("#start-A", "11180900")
    f.fill("#remarks-B", "공정2 메모")
    f.click("#btn-preview")
    text = f.text_content("#preview-content")
    opened = f.evaluate("() => document.getElementById('modal-preview').classList.contains('open')")
    w.check("미리보기", opened and "PA-PREVIEW" in text and "11181100" in text and "공정2 메모" in text, f"열림={opened}, 내용 일부='{text[:80]}'")
    ctx.close()


def test_history(browser):
    print("\n--- 등록 이력 목록 ---")
    state = w.State([w.batch("PA-H1", "packaging", quantities={"B": 500, "packaging": 480}), w.batch("PD-H2", "stage2")])
    ctx, page = w.open_page(browser, state)
    f = w.open_form(page)
    f.click("#btn-history")
    text = f.text_content("#history-tbody")
    w.check("이력", "PA-H1" in text and "PD-H2" in text and "공정2:500" in text and "완제품:480" in text, f"내용 일부='{' '.join(text.split())[:120]}'")
    ctx.close()


def test_submit_validation(browser):
    print("\n--- 저장 전 입력 검사: 쓰지 않고 이유를 보여 준다 ---")
    state = w.State([w.batch("LOT-1", "stage1-wait")])
    ctx, page = w.open_page(browser, state)
    f = w.open_form(page)
    msgs = []
    for lot, start_a in [("", "11180900"), ("LOT<1>", "11180900"), ("LOT-NEW", "")]:
        f.fill("#inp-lot", lot)
        f.fill("#start-A", start_a)
        w.submit_form(page, f, wait_ms=400)
        msgs.append(w.frame_toast(f))
    ok = "로트 넘버를 입력" in msgs[0] and "특수문자" in msgs[1] and "공정1 시작" in msgs[2] and not state.writes
    w.check("입력 검사", ok, f"토스트={msgs}, 쓰기 {len(state.writes)}회")
    ctx.close()


def main():
    server = ThreadingHTTPServer(("127.0.0.1", w.PORT), w.QuietHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        test_time_sync(browser)
        test_product_badge(browser)
        test_template_cycle(browser)
        test_history(browser)
        test_submit_validation(browser)
        test_preview(browser)
        browser.close()
    w.check("페이지 오류 0", not w.PAGE_ERRORS, f"{w.PAGE_ERRORS[:3]}")
    server.shutdown()
    if FAILS:
        print(f"\n=== 실패 {len(FAILS)}건: {FAILS} ===")
        sys.exit(1)
    print("\n=== qa_runner_batch_form ALL PASSED ===")


if __name__ == "__main__":
    main()
