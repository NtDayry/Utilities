"""End-to-end check against a running stack (API :8000, stack broker :1883, upstream broker :1884)
ใช้ login จริง: ตั้ง E2E_ADMIN_USER/PASSWORD, E2E_OPERATOR_USER/PASSWORD (operator ต้องมีสิทธิ์ alarm:acknowledge)

python tests/e2e_local.py   — exits non-zero on the first failure
"""
import asyncio
import json
import math
import os
import subprocess
import time

import httpx
import jwt
import websockets

API = os.getenv("API", "http://127.0.0.1:8000/api/utilities")
BASE = API.rsplit("/api/", 1)[0]
WS = os.getenv("WS", "ws://127.0.0.1:8000/ws/utilities/mqtt")
STACK = ["-h", "127.0.0.1", "-p", "1883", "-u", "utilities", "-P", os.getenv("MQTT_PASSWORD", "mqpass")]
UP = ["-h", "127.0.0.1", "-p", "1884", "-u", "polipharm", "-P", os.getenv("UPSTREAM_PASSWORD", "uppass")]


def login(user: str, password: str) -> dict:
    """login จริงผ่านระบบหลัก (/api/auth/login) → cookie access_token"""
    r = httpx.post(f"{BASE}/api/auth/login", json={"username": user, "password": password})
    r.raise_for_status()
    return {"access_token": r.cookies.get("access_token")}


# ผู้ใช้สำหรับทดสอบ: admin (role admin/super admin) และ operator ที่มีสิทธิ์ alarm:acknowledge
ADMIN = login(os.getenv("E2E_ADMIN_USER", "admin"), os.getenv("E2E_ADMIN_PASSWORD", "Admin#1234"))
OPER_NAME = os.getenv("E2E_OPERATOR_USER", "op1")
OPER = login(OPER_NAME, os.getenv("E2E_OPERATOR_PASSWORD", "OpPass#123"))
ok_count = 0


def check(cond: bool, label: str, extra: object = "") -> None:
    global ok_count
    if not cond:
        raise SystemExit(f"FAIL: {label} {extra}")
    ok_count += 1
    print(f"  ok  {label}")


def pub(args: list[str], topic: str, data: dict) -> None:
    subprocess.run(["mosquitto_pub", *args, "-q", "1", "-t", topic, "-m", json.dumps(data)], check=True)


TANK = {
    "id": "tank-a", "name": "ถังสูง A", "kind": "tank", "broker": None, "topic": "tank-a",
    "tanks": [
        {"name": "ถัง 1", "shape": "cylinder", "diameter_m": 2, "height_m": 2.5, "offset_cm": 0, "width_m": 2, "length_m": 2},
        {"name": "ถัง 2", "shape": "cylinder", "diameter_m": 2, "height_m": 2.5, "offset_cm": -20, "width_m": 2, "length_m": 2},
    ],
    "sensorTank": 0,
    "sensors": {"level": {"enabled": True, "path": "water_level.level_cm", "unit": ""},
                "flowRate": {"enabled": True, "path": "flow_meter.flow_rate", "unit": "m³/h"}},
    "levelUnit": "cm", "pumps": [{"name": "ปั๊มเติม", "drive": "inverter", "path": "pump1", "faultPath": ""}],
    "lowPct": 20, "highPct": 95,
}
POND = {"id": "pond-b", "name": "บ่อเก็บน้ำ B", "kind": "pond", "topic": "pond-b", "levelUnit": "m",
        "tanks": [{"name": "บ่อ 1", "width_m": 4, "length_m": 8, "height_m": 1.5}],
        "pumps": [{"name": "P1", "drive": "magnetic", "path": "controls.pump1_on", "faultPath": "controls.pump1_ol"}]}


def expected_tank_pct(level_cm: float) -> tuple[float, float]:
    area = math.pi * 1.0 ** 2
    l1 = max(0, min(250, level_cm))
    l2 = max(0, min(250, level_cm - 20))
    vol = area * (l1 + l2) * 10
    cap = area * 2.5 * 1000 * 2
    return vol / cap * 100, vol


async def main() -> None:
    async with httpx.AsyncClient(base_url=API, timeout=20) as c:
        print("auth")
        r = await c.get("/water-systems")
        check(r.status_code == 401, "no cookie → 401", r.status_code)
        r = await c.get("/water-systems", cookies={"access_token": jwt.encode({"sub": "admin", "token_version": "1"}, "wrong-secret-of-32-bytes-minimum!!", algorithm="HS256")})
        check(r.status_code == 401, "bad signature → 401")
        r = await c.put("/water-systems", json=[TANK], cookies=OPER)
        check(r.status_code == 403, "operator cannot save → 403", r.status_code)

        print("water systems CRUD")
        r = await c.put("/water-systems", json=[{**TANK, "topic": "bad topic #"}], cookies=ADMIN)
        check(r.status_code == 422 and r.json()["detail"]["errors"]["topic"] == "topic_invalid", "invalid topic → 422 topic_invalid", r.text)
        r = await c.put("/water-systems", json=[TANK, POND, {**POND}], cookies=ADMIN)
        check(r.status_code == 422, "duplicate id → 422")
        r = await c.put("/water-systems", json=[TANK, POND], cookies=ADMIN)
        check(r.status_code == 200, "save 2 systems", r.text)
        saved = r.json()
        check(saved[1]["sensors"]["meterTotal"]["path"] == "flow_meter.volumn", "normalize fills frontend defaults")
        check(saved[1]["highPct"] == 95 and saved[1]["tanks"][0]["shape"] == "rect", "pond defaults (highPct 95, rect)")
        r = await c.get("/water-systems", cookies=OPER)
        check([s["id"] for s in r.json()] == ["tank-a", "pond-b"], "operator can read, order kept")
        await asyncio.sleep(1)

        print("ingest via bridge (upstream → stack) and direct")
        for lvl in (150, 151, 152):
            pub(UP, "tank-a", {"water_level": {"level_cm": lvl}, "flow_meter": {"flow_rate": 3.5},
                               "pump1": {"running": True, "freq": 45.5, "current": 7.2, "alarm": False}})
            await asyncio.sleep(1.2)
        pub(STACK, "pond-b", {"level_m": 0.9, "controls": {"pump1_on": "run", "pump1_ol": 0}})
        await asyncio.sleep(1.5)
        r = await c.get("/water-systems/tank-a/latest", cookies=OPER)
        d = r.json()
        pct, vol = expected_tank_pct(152)
        check(d["metrics"]["level_cm"] == 152, "tank latest level_cm", d.get("metrics"))
        check(abs(d["metrics"]["level_pct"] - pct) < 1e-6 and abs(d["metrics"]["volume_l"] - vol) < 1e-6, f"connected-tank % / volume (expect {pct:.2f}%)", d["metrics"])
        check(d["metrics"]["pump1_freq"] == 45.5 and d["metrics"]["pump1_running"] == 1 and d["metrics"]["flow_rate"] == 3.5, "pump + flow parsed")
        r = await c.get("/water-systems/pond-b/latest", cookies=OPER)
        check("level_cm" not in r.json()["metrics"] and r.json()["metrics"]["pump1_running"] == 1, "pond: default level path absent → no level, pump still read", r.json()["metrics"])

        # ปรับ pond ให้ path ระดับตรงข้อมูล (หน่วย m)
        pond = {**saved[1], "sensors": {**saved[1]["sensors"], "level": {"enabled": True, "path": "level_m", "unit": ""}}}
        r = await c.put("/water-systems/pond-b", json=pond, cookies=ADMIN)
        check(r.status_code == 200, "PUT single system", r.text)
        await asyncio.sleep(0.5)
        pub(STACK, "pond-b", {"level_m": 0.9, "controls": {"pump1_on": "run", "pump1_ol": 0}})
        await asyncio.sleep(1.5)
        m = (await c.get("/water-systems/pond-b/latest", cookies=OPER)).json()["metrics"]
        check(abs(m["level_cm"] - 90) < 1e-9 and abs(m["level_pct"] - 60) < 1e-9 and m["pump1_running"] == 1, "pond m→cm, 60%, magnetic pump 'run'", m)

        print("history")
        recent = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 600))
        await asyncio.sleep(2.5)  # flush
        r = await c.get("/water-systems/tank-a/history", params={"metrics": "level_cm,pump1_freq", "bucket": 10, "start": recent}, cookies=OPER)
        h = r.json()
        check(r.status_code == 200 and h["source"] == "readings", "raw source for 10 s buckets", h.get("source"))
        n = sum(p["n"] for p in h["series"]["level_cm"])
        check(n >= 3, f"raw level samples stored ({n})", h)
        r = await c.get("/water-systems/tank-a/history", params={"metrics": "level_cm", "bucket": 60}, cookies=OPER)
        h = r.json()
        check(h["source"] == "readings_1m" and sum(p["n"] for p in h["series"]["level_cm"]) >= 3, "1-min continuous aggregate (real-time) returns data", h)
        mx = max(p["max"] for p in h["series"]["level_cm"])
        check(mx == 152, "aggregate max correct")
        r = await c.get("/water-systems/tank-a/history", params={"metrics": "level_cm", "bucket": 3600, "start": "2026-11-17T00:00:00+07:00"}, cookies=OPER)
        check(r.json()["source"] == "readings_1h" and r.json()["series"]["level_cm"], "1-h hierarchical aggregate returns data", r.json())
        r = await c.get("/water-systems/tank-a/history", params={"metrics": "level_cm", "bucket": 10, "start": "2026-01-01T00:00:00Z"}, cookies=OPER)
        check(r.status_code == 422, "too many points → 422")

        print("alarms")
        pub(UP, "tank-a", {"water_level": {"level_cm": 20}, "pump1": {"running": False, "alarm": True}})
        await asyncio.sleep(1.5)
        ev = (await c.get("/alarms/events", params={"active": "true", "group_id": "water-system:tank-a"}, cookies=OPER)).json()
        kinds = sorted((e["metricName"], e["level"]) for e in ev["items"])
        check(kinds == [("level_pct", "L"), ("pump1_fault", "STATE")], "low level + pump fault raised", kinds)
        low = next(e for e in ev["items"] if e["level"] == "L")
        check(low["groupId"] == "water-system:tank-a" and low["severity"] == "warning" and low["limit"] == 20, "event shape", low)
        pub(UP, "tank-a", {"water_level": {"level_cm": 20.5}, "pump1": {"running": False, "alarm": True}})
        await asyncio.sleep(1)
        check((await c.get("/alarms/events", params={"active": "true", "group_id": "water-system:tank-a"}, cookies=OPER)).json()["total"] == 2, "no duplicate while still active")
        # 22% ยังอยู่ใน deadband (20 + 1) ... ค่า 60 cm → >21%
        pub(UP, "tank-a", {"water_level": {"level_cm": 100}, "pump1": {"running": True, "alarm": False}})
        await asyncio.sleep(1.5)
        ev = (await c.get("/alarms/events", params={"system": "water", "group_id": "water-system:tank-a"}, cookies=OPER)).json()
        check(ev["total"] == 2 and all(e["endedAt"] for e in ev["items"]) and all(e["durationSec"] is not None for e in ev["items"]), "both cleared")
        r = await c.post("/alarms/events/ack", json={"ids": [low["id"]]}, cookies=OPER)
        check(r.json()["updated"] == 1 and r.json()["items"][0]["ackBy"] == OPER_NAME, "operator ack")
        r = await c.put("/alarms/water/rules", json={"tank-a.level_pct": {"enabled": True, "l": 25}}, cookies=OPER)
        check(r.status_code == 403, "operator cannot change rules")
        await c.put("/alarms/water/targets", json={"emails": "eng@example.com"}, cookies=ADMIN)
        r = await c.get("/alarms/water/targets", cookies=OPER)
        check(r.json() == {"emails": "eng@example.com"}, "targets saved")

        print("comm loss (COMM_TIMEOUT_SEC=8)")
        await asyncio.sleep(14)
        ev = (await c.get("/alarms/events", params={"active": "true"}, cookies=OPER)).json()
        comm = sorted(e["deviceName"] for e in ev["items"] if e["level"] == "COMM")
        check(comm == ["pond-b", "tank-a"], "COMM raised for silent systems", ev)
        pub(UP, "tank-a", {"water_level": {"level_cm": 100}})
        await asyncio.sleep(1.5)
        ev = (await c.get("/alarms/events", params={"active": "true"}, cookies=OPER)).json()
        check([e["deviceName"] for e in ev["items"]] == ["pond-b"], "COMM cleared on new message")

        print("websocket bridge")
        async with websockets.connect(WS, additional_headers={"Cookie": f"access_token={OPER['access_token']}"}) as ws:
            hello = json.loads(await ws.recv())
            check(hello == {"type": "hello", "username": OPER_NAME, "isAdmin": False}, "ws hello (operator)")
            await ws.send(json.dumps({"type": "subscribe", "topic": "tank-a", "systemId": "tank-a"}))
            got = [json.loads(await asyncio.wait_for(ws.recv(), 3)) for _ in range(2)]
            check(got[0]["type"] == "status" and got[0]["connected"] and got[1]["type"] == "msg", "status + cached latest on subscribe", got)
            pub(UP, "tank-a", {"water_level": {"level_cm": 101}})
            m = json.loads(await asyncio.wait_for(ws.recv(), 3))
            check(m["type"] == "msg" and m["data"]["water_level"]["level_cm"] == 101, "live message pushed")
            await ws.send(json.dumps({"type": "publish", "id": "1", "topic": "tank-a/set", "payload": {"x": 1}, "systemId": "tank-a"}))
            m = json.loads(await asyncio.wait_for(ws.recv(), 3))
            check(m == {"type": "publish-ack", "id": "1", "ok": False, "error": "forbidden"}, "operator publish forbidden")
        try:
            async with websockets.connect(WS) as ws:
                await ws.recv()
            check(False, "ws without cookie must fail")
        except websockets.exceptions.InvalidStatus as exc:
            check(exc.response.status_code == 403, "ws without cookie rejected")

        async with websockets.connect(WS, additional_headers={"Cookie": f"access_token={ADMIN['access_token']}"}) as ws:
            await ws.recv()
            up = subprocess.Popen(["mosquitto_sub", *UP, "-t", "tank-a/set", "-C", "1", "-W", "5"], stdout=subprocess.PIPE, text=True)
            await asyncio.sleep(0.5)
            await ws.send(json.dumps({"type": "publish", "id": "2", "topic": "tank-a/set", "payload": {"manual_pump1": True}, "systemId": "tank-a"}))
            m = json.loads(await asyncio.wait_for(ws.recv(), 3))
            check(m["ok"] is True, "admin publish ack", m)
            out = up.communicate(timeout=6)[0].strip()
            check(out == '{"manual_pump1": true}', "command reached the upstream broker through the bridge", out)
            await ws.send(json.dumps({"type": "publish", "id": "3", "topic": "other/set", "payload": {}}))
            m = json.loads(await asyncio.wait_for(ws.recv(), 3))
            check(m["error"] == "topic_not_allowed", "publish to unknown topic refused")

        print("probe")
        r = await c.post("/mqtt/probe", json={"topic": "tank-a", "timeout_sec": 3}, cookies=ADMIN)
        check(r.json() == {"ok": False, "stage": "message", "connectedMs": r.json().get("connectedMs"), "error": "no_message"}, "probe: no message → no_message", r.json())
        async def later():
            await asyncio.sleep(1)
            pub(STACK, "probe-x", {"water_level": {"level_cm": 77, "ok": True}, "a.b": 1})
        t = asyncio.create_task(later())
        r = await c.post("/mqtt/probe", json={"topic": "probe-x", "timeout_sec": 5}, cookies=ADMIN)
        await t
        d = r.json()
        check(d["ok"] and d["guessedLevelPath"] == "water_level.level_cm" and [p["path"] for p in d["points"]] == ["water_level", "water_level.level_cm", "water_level.ok"], "probe scans payload", d)
        r = await c.post("/mqtt/probe", json={"broker": {"url": "ws://127.0.0.1:1", "username": "", "password": ""}, "topic": "x", "timeout_sec": 2}, cookies=ADMIN)
        check(r.json()["ok"] is False and r.json()["stage"] == "connect", "probe: unreachable broker", r.json())

        print("delete")
        r = await c.delete("/water-systems/pond-b", cookies=ADMIN)
        check(r.status_code == 200, "delete")
        await asyncio.sleep(1)
        ev = (await c.get("/alarms/events", params={"active": "true"}, cookies=OPER)).json()
        check(ev["total"] == 0, "alarms of deleted system closed", ev)
        r = await c.get("/water-systems/pond-b/latest", cookies=OPER)
        check(r.status_code == 404, "deleted system 404")
    print(f"\nALL {ok_count} CHECKS PASSED")


asyncio.run(main())
