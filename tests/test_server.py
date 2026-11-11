#!/usr/bin/env python3
"""시간정하기 서버 시험: python3 tests/test_server.py"""
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


def call(base, method, path, body=None, raw=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(base + path, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b"null"), dict(r.headers)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            body = json.loads(raw or b"null")
        except ValueError:
            body = None
        return e.code, body, dict(e.headers)


def fake_relay():
    """AI 중계 대신 정해진 답을 주는 가짜(요청 본문은 마지막 것을 기억)."""
    import http.server, threading
    seen = {}
    class R(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a): pass
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            seen["body"], seen["key"] = body, self.headers.get("X-Relay-Key")
            ans = {"busy": [{"key": "2026-11-11", "start": "08:00", "end": "10:30", "why": "외래"}, {"key": "1999-01-01", "start": "09:00", "end": "10:00", "why": "x"},
                            {"key": "2026-11-11", "start": "13:00", "end": "25:00", "why": "밤"}], "note": "표시했어요"}
            b = json.dumps({"choices": [{"message": {"content": "```json\n" + json.dumps(ans, ensure_ascii=False) + "\n```"}}]}).encode()
            self.send_response(200); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), R)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, seen


def main():
    port = free_port(); data = tempfile.mkdtemp()
    relay, seen = fake_relay()
    env = dict(os.environ, MEET_PORT=str(port), MEET_DATA=data, MEET_AI_URL="http://127.0.0.1:%d/v1" % relay.server_address[1], MEET_AI_KEY="k" * 40, MEET_AI_DAILY="2")
    p = subprocess.Popen([sys.executable, os.path.join(ROOT, "server.py")], env=env, stdout=subprocess.DEVNULL)
    base = f"http://127.0.0.1:{port}"
    fails = []
    def ok(cond, msg):
        print(("PASS " if cond else "FAIL ") + msg)
        if not cond: fails.append(msg)
    try:
        for _ in range(50):
            try: urllib.request.urlopen(base + "/healthz"); break
            except Exception: time.sleep(0.1)
        from datetime import datetime
        from zoneinfo import ZoneInfo
        def mk(tz, dates, a, b, step):
            z = ZoneInfo(tz)
            return sorted({int(datetime(*map(int, d.split("-")), m // 60, m % 60, tzinfo=z).timestamp() // 60) for d in dates for m in range(a, b, step)})
        slots = mk("Asia/Seoul", ["2026-11-11"], 540, 840, 30)
        ev = {"title": " 회의‮ ", "mode": "dates", "tz": "Asia/Seoul", "step": 30, "slots": slots, "labels": ["2026-11-11"], "range": [540, 840]}
        c, r, hd = call(base, "POST", "/api/events", ev)
        ok(c == 200 and len(r.get("id", "")) == 8, "모임 만들기 %s %s" % (c, r))
        eid = r["id"]
        c, r, hd = call(base, "GET", "/api/events/" + eid)
        ok(c == 200 and r["title"] == "회의", "제목 정리(제어 문자 제거)")
        ok("frame-ancestors 'none'" in hd.get("Content-Security-Policy", ""), "CSP 헤더")
        c, r, _ = call(base, "PUT", f"/api/events/{eid}/people", {"name": "김 민수", "avail": "1100000000"})
        ok(c == 200 and r["people"]["김 민수"]["a"] == "1100000000", "가능 시간 저장")
        c, r, _ = call(base, "PUT", f"/api/events/{eid}/people", {"name": "김 민수", "avail": "2200000000"})
        ok(c == 200 and r["people"]["김 민수"]["a"] == "2200000000" and len(r["people"]) == 1, "같은 이름은 덮어쓰기")
        for body, why in [({"name": "", "avail": "0" * 10}, "빈 이름"), ({"name": "a", "avail": "0" * 9}, "길이 틀림"),
                          ({"name": "a", "avail": "3" * 10}, "잘못된 값"), ({"name": "a"}, "avail 없음"), ([], "목록 본문")]:
            c, _, _ = call(base, "PUT", f"/api/events/{eid}/people", body)
            ok(c == 400, "거부: " + why)
        c, _, _ = call(base, "PUT", f"/api/events/{eid}/people", raw=b"{bad")
        ok(c == 400, "거부: 깨진 JSON")
        bad = [dict(ev, slots=slots[::-1]), dict(ev, slots=[]), dict(ev, step=20), dict(ev, tz="../etc"), dict(ev, title=""),
               dict(ev, range=[600, 500]), dict(ev, mode="x"), dict(ev, slots=[True] + slots[1:]), dict(ev, labels=["2026/11/11"]),
               dict(ev, slots=list(range(1, 3002))), dict(ev, tz="Invalid/Zone"),
               dict(ev, slots=sorted(slots + [slots[0] + 1440 * 40])), dict(ev, slots=[x + 600 for x in slots])]
        codes = [call(base, "POST", "/api/events", b)[0] for b in bad]
        ok(all(c == 400 for c in codes), "잘못된 모임 거부 13가지 (없는 시간대·흩어진 칸 포함) %s" % codes)
        ny = mk("America/New_York", ["2027-11-06", "2027-11-07"], 0, 240, 30)   # 서머타임 끝: 01:00~01:59 두 번
        c, r, _ = call(base, "POST", "/api/events", {"title": "DST", "mode": "dates", "tz": "America/New_York", "step": 30, "slots": ny, "labels": ["2027-11-06", "2027-11-07"], "range": [0, 240]})
        ok(c == 200, "서머타임 끝나는 날 모임 받음")
        c, _, _ = call(base, "PUT", "/api/events/zzzzzzzz/people", {"name": "a", "avail": "0"})
        ok(c == 404, "없는 모임에 쓰기 404")
        c, _, _ = call(base, "GET", "/api/events/zzzzzzzz")
        ok(c == 404, "없는 모임 404")
        c, _, _ = call(base, "GET", "/api/events/../../etc")
        ok(c == 404, "경로 조작 404")
        c, r, _ = call(base, "PUT", f"/api/events/{eid}/people", {"name": "순번", "avail": "1" * 10, "seq": 2, "tab": "abcd1234"})
        c, r, _ = call(base, "PUT", f"/api/events/{eid}/people", {"name": "순번", "avail": "0" * 10, "seq": 1, "tab": "abcd1234"})
        ok(c == 200 and r["people"]["순번"]["a"] == "1" * 10, "같은 창의 늦게 온 옛 저장은 버림")
        c, r, _ = call(base, "PUT", f"/api/events/{eid}/people", {"name": "순번", "avail": "0" * 10, "seq": 1, "tab": "zzzz9999"})
        ok(c == 200 and r["people"]["순번"]["a"] == "0" * 10, "다른 창(기기)의 저장은 받아들임")
        ok("s" not in r["people"]["순번"] and "w" not in r["people"]["순번"], "순번·창 id 는 응답에 안 나감")
        c, _, _ = call(base, "DELETE", f"/api/events/{eid}/people", {"name": "순번"})
        ok(c == 501 or c == 405 or c == 404, "이름 빼기 요청은 없음")
        with urllib.request.urlopen(base + "/m/" + eid) as rr:
            ok(b"app.js" in rr.read(), "모임 주소에서 화면")
        ok(not [f for f in os.listdir(data) if f.endswith(".tmp")], "임시 파일 안 남음")
        # 언어: 프록시 없이는 Accept-Language
        req = urllib.request.Request(base + "/", headers={"Accept-Language": "en-US,en"})
        with urllib.request.urlopen(req) as rr:
            ok(b'<html lang="en">' in rr.read(), "영어 브라우저는 영어 화면")
        c, r, _ = call(base, "GET", "/api/events/zzzzzzzz")
        ok(r.get("error_en") == "This event doesn't exist. Check the link", "오류문 영어판")
        # 글·사진으로 안 되는 시간 (가짜 중계)
        c, r, _ = call(base, "POST", f"/api/events/{eid}/ai", {"text": "", "tz": "Asia/Seoul"})
        ok(c == 400, "AI: 빈 요청 거부")
        c, r, _ = call(base, "POST", f"/api/events/{eid}/ai", {"text": "x", "tz": "Asia/Seoul", "images": [{"mime": "image/png", "b64": "aGVsbG8="}]})
        ok(c == 400, "AI: 사진이 아닌 파일 거부")
        c, r, _ = call(base, "POST", f"/api/events/{eid}/ai", {"text": "월요일은 종일 외래", "tz": "Asia/Seoul", "lang": "ko"})
        ok(c == 200 and len(r.get("job", "")) == 24 and r.get("left") == 1, "AI: 작업 시작 %s %s" % (c, r))
        for _ in range(50):
            c2, j, _ = call(base, "GET", "/api/ai/" + r["job"])
            if j.get("status") != "run": break
            time.sleep(0.1)
        ok(j.get("status") == "ok" and j["busy"] == [{"key": "2026-11-11", "start": 540, "end": 630, "why": "외래"}, {"key": "2026-11-11", "start": 780, "end": 840, "why": "밤"}],
           "AI: 결과를 후보 날짜·시간 창으로 자름 %s" % j)
        ok(seen.get("key") == "k" * 40 and seen["body"].get("no_fallback") is True and seen["body"].get("model") == "gpt-6-luna" and seen["body"].get("effort") == "high" and "월요일은 종일 외래" in seen["body"].get("raw_prompt", ""), "AI: 중계에 키·모델·대체 없음·글 전달")
        ok("key=2026-11-11" in seen["body"]["raw_prompt"] and "09:00–14:00" in seen["body"]["raw_prompt"], "AI: 후보 날짜와 시간 창을 알려 줌")
        call(base, "POST", f"/api/events/{eid}/ai", {"text": "두 번째", "tz": "Asia/Seoul"})
        c, r, _ = call(base, "POST", f"/api/events/{eid}/ai", {"text": "세 번째", "tz": "Asia/Seoul"})
        ok(c == 429 and "error_en" in r, "AI: 하루 한도 넘으면 거부")
        ok(not [f for f in os.listdir(data) if "월요일" in open(os.path.join(data, f), encoding="utf-8", errors="ignore").read()], "AI: 적은 글은 디스크에 안 남음")
    finally:
        p.terminate(); p.wait()
    print("\n" + ("모두 통과" if not fails else f"{len(fails)}개 실패"))
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
