"""ตรรกะของถังน้ำ / บ่อเก็บน้ำที่เพิ่มจากหน้าเว็บ

พอร์ตจาก frontend-utilities/src/lib/waterSystems/model.ts — ต้องให้ผลตรงกันทุกฟังก์ชัน
(normalize / validate / readPath / toNum / toBool / readSystem / levelToCm / calcSystem / scanPayload)
ถ้าแก้ฝั่งใดฝั่งหนึ่ง ให้แก้อีกฝั่งด้วย
"""
from __future__ import annotations

import math
import re
from datetime import datetime, timezone
from typing import Any

MAX_TANKS = 4
MAX_PUMPS = 4
KINDS = ("tank", "pond")
SENSOR_KEYS = ("level", "meterTotal", "flowRate", "inletValve")
LEVEL_UNITS = ("cm", "m", "mm", "percent")
ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,47}$")
DEFAULT_WATER_COLOR = "#2563eb"
COLOR_PATTERN = re.compile(r"^#[0-9a-f]{6}$", re.I)

SENSOR_DEFAULTS: dict[str, dict[str, str]] = {
    "level": {"path": "water_level.level_cm", "unit": ""},
    "meterTotal": {"path": "flow_meter.volumn", "unit": "m³"},
    "flowRate": {"path": "flow_meter.flow_rate", "unit": "m³/h"},
    "inletValve": {"path": "controls.valve_on", "unit": ""},
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def is_obj(v: Any) -> bool:
    return isinstance(v, dict)


def shape_for_kind(kind: str) -> str:
    return "cylinder" if kind == "tank" else "rect"


def default_tank(kind: str, index: int) -> dict:
    if kind == "tank":
        return {"name": f"ถัง {index + 1}", "shape": "cylinder", "width_m": 2, "length_m": 2, "diameter_m": 2, "height_m": 2.5, "offset_cm": 0}
    return {"name": f"บ่อ {index + 1}", "shape": "rect", "width_m": 4, "length_m": 8, "diameter_m": 2, "height_m": 1.5, "offset_cm": 0}


def default_pump(index: int, drive: str = "inverter") -> dict:
    path = f"pump{index + 1}" if drive == "inverter" else f"controls.pump{index + 1}_on"
    return {"name": f"ปั๊ม {index + 1}", "drive": drive, "path": path, "faultPath": ""}


def new_system(kind: str) -> dict:
    now = _now_iso()
    return {
        "id": "",
        "name": "",
        "location": "",
        "kind": kind,
        "broker": None,
        "topic": "",
        "tanks": [default_tank(kind, 0)],
        "sensorTank": 0,
        "sensors": {k: {"enabled": k == "level", **SENSOR_DEFAULTS[k]} for k in SENSOR_KEYS},
        "levelUnit": "cm",
        "waterColor": DEFAULT_WATER_COLOR,
        "pumps": [],
        "lowPct": 20,
        "highPct": 95,
        "createdAt": now,
        "updatedAt": now,
    }


# ---------------------------------------------------------------- อ่านค่า
def is_valid_path(path: str) -> bool:
    return len(path) > 0 and all(p.strip() != "" for p in path.split("."))


def read_path(root: Any, path: str) -> Any:
    if not path:
        return None
    cur = root
    for key in path.split("."):
        if not is_obj(cur):
            return None
        cur = cur.get(key)
    return cur


def to_num(v: Any) -> float | None:
    """ตัวเลขที่ใช้ได้ — boolean ไม่นับเป็นตัวเลข (เหมือน JS typeof)"""
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        f = float(v)
        return f if math.isfinite(f) else None
    if isinstance(v, str) and v.strip() != "":
        try:
            f = float(v.strip())
        except ValueError:
            return None
        return f if math.isfinite(f) else None
    return None


_TRUE = {"1", "on", "open", "true", "run", "running"}
_FALSE = {"0", "off", "close", "closed", "false", "stop", "stopped"}


def to_bool(v: Any) -> bool | None:
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return (v != 0) if math.isfinite(float(v)) else None
    if isinstance(v, str):
        s = v.strip().lower()
        if s in _TRUE:
            return True
        if s in _FALSE:
            return False
    return None


def _coalesce(node: dict, *keys: str) -> Any:
    """เหมือน a ?? b ?? c ของ JS"""
    for k in keys:
        v = node.get(k)
        if v is not None:
            return v
    return None


def scan_payload(raw: Any, max_depth: int = 5) -> list[dict]:
    out: list[dict] = []

    def walk(node: Any, prefix: str, depth: int) -> None:
        if not is_obj(node) or depth > max_depth:
            return
        for key, value in node.items():
            if "." in key:
                continue
            path = f"{prefix}.{key}" if prefix else key
            if isinstance(value, bool):
                out.append({"path": path, "type": "boolean", "preview": "true" if value else "false"})
            elif isinstance(value, (int, float)) and math.isfinite(float(value)):
                out.append({"path": path, "type": "number", "preview": _js_num(value)})
            elif is_obj(value):
                out.append({"path": path, "type": "object", "preview": "{ " + ", ".join(list(value.keys())[:6]) + " }"})
                walk(value, path, depth + 1)

    walk(raw, "", 1)
    return sorted(out, key=lambda p: p["path"])


def _js_num(v: float | int) -> str:
    f = float(v)
    return str(int(f)) if f.is_integer() and abs(f) < 1e21 else repr(f)


def guess_level_path(points: list[dict]) -> str:
    nums = [p for p in points if p["type"] == "number"]
    for pat in (r"level_cm$", r"level"):
        for p in nums:
            if re.search(pat, p["path"], re.I):
                return p["path"]
    return ""


def read_pump(pump: dict, raw: Any) -> dict:
    node = read_path(raw, pump["path"])
    ext_fault = to_bool(read_path(raw, pump["faultPath"])) if pump.get("faultPath") else None
    if is_obj(node):
        running = to_bool(_coalesce(node, "running", "run", "on"))
        return {
            "found": True,
            "running": bool(running),
            "fault": bool(ext_fault) or any(to_bool(node.get(k)) is True for k in ("alarm", "fault", "overload", "trip")),
            "freq": to_num(_coalesce(node, "freq", "frequency", "hz")),
            "current": to_num(_coalesce(node, "current", "amp")),
            "commOk": to_bool(_coalesce(node, "modbus_ok", "comm_ok")),
        }
    running = to_bool(node)
    return {"found": running is not None, "running": bool(running), "fault": bool(ext_fault), "freq": None, "current": None, "commOk": None}


def read_system(cfg: dict, raw: Any) -> dict:
    s = cfg["sensors"]
    return {
        "levelRaw": to_num(read_path(raw, s["level"]["path"])) if s["level"]["enabled"] else None,
        "meterTotal": to_num(read_path(raw, s["meterTotal"]["path"])) if s["meterTotal"]["enabled"] else None,
        "flowRate": to_num(read_path(raw, s["flowRate"]["path"])) if s["flowRate"]["enabled"] else None,
        "valveOn": to_bool(read_path(raw, s["inletValve"]["path"])) if s["inletValve"]["enabled"] else None,
        "pumps": [read_pump(p, raw) for p in cfg["pumps"]],
    }


# ---------------------------------------------------------------- ปริมาตร / ระดับน้ำ
def tank_area(t: dict) -> float:
    return math.pi * (t["diameter_m"] / 2) ** 2 if t["shape"] == "cylinder" else t["width_m"] * t["length_m"]


def level_to_cm(cfg: dict, value: float) -> float:
    unit = cfg["levelUnit"]
    if unit == "m":
        return value * 100
    if unit == "mm":
        return value / 10
    if unit == "percent":
        tanks = cfg["tanks"]
        idx = cfg["sensorTank"]
        h = tanks[idx]["height_m"] if 0 <= idx < len(tanks) else 0
        return (value / 100) * h * 100
    return value


def calc_system(cfg: dict, sensor_cm: float) -> dict:
    tanks_cfg = cfg["tanks"]
    idx = cfg["sensorTank"]
    sensor_offset = tanks_cfg[idx]["offset_cm"] if 0 <= idx < len(tanks_cfg) else 0
    tanks = []
    for t in tanks_cfg:
        height_cm = t["height_m"] * 100
        level_cm = max(0.0, min(height_cm, sensor_cm + t["offset_cm"] - sensor_offset))
        area = tank_area(t)
        volume_l = area * level_cm * 10
        capacity_l = area * t["height_m"] * 1000
        tanks.append({
            "level_cm": level_cm,
            "height_cm": height_cm,
            "volume_l": volume_l,
            "capacity_l": capacity_l,
            "percent": min(100.0, volume_l / capacity_l * 100) if capacity_l > 0 else 0.0,
        })
    volume_l = sum(t["volume_l"] for t in tanks)
    capacity_l = sum(t["capacity_l"] for t in tanks)
    return {"tanks": tanks, "total": {"volume_l": volume_l, "capacity_l": capacity_l, "percent": min(100.0, volume_l / capacity_l * 100) if capacity_l > 0 else 0.0}}


def system_metrics(cfg: dict, raw: Any) -> tuple[dict, dict | None, dict[str, float]]:
    """อ่านทุกค่าของระบบจากข้อความ 1 ก้อน → (reading, calc, metrics สำหรับบันทึก)"""
    reading = read_system(cfg, raw)
    calc = None
    m: dict[str, float] = {}
    if reading["levelRaw"] is not None:
        level_cm = level_to_cm(cfg, reading["levelRaw"])
        calc = calc_system(cfg, level_cm)
        m["level_raw"] = reading["levelRaw"]
        m["level_cm"] = level_cm
        m["level_pct"] = calc["total"]["percent"]
        m["volume_l"] = calc["total"]["volume_l"]
    if reading["meterTotal"] is not None:
        m["meter_total"] = reading["meterTotal"]
    if reading["flowRate"] is not None:
        m["flow_rate"] = reading["flowRate"]
    if reading["valveOn"] is not None:
        m["valve_on"] = 1.0 if reading["valveOn"] else 0.0
    for i, p in enumerate(reading["pumps"], start=1):
        if not p["found"]:
            continue
        m[f"pump{i}_running"] = 1.0 if p["running"] else 0.0
        m[f"pump{i}_fault"] = 1.0 if p["fault"] else 0.0
        if p["freq"] is not None:
            m[f"pump{i}_freq"] = p["freq"]
        if p["current"] is not None:
            m[f"pump{i}_current"] = p["current"]
    return reading, calc, m


# ---------------------------------------------------------------- ตรวจ / ซ่อมข้อมูล
def is_valid_topic(topic: str) -> bool:
    return 0 < len(topic) <= 200 and not re.search(r"[\s#+]", topic) and not topic.startswith("/") and not topic.endswith("/")


def is_valid_broker_url(url: str) -> bool:
    return bool(re.match(r"^wss?://[^\s/]+", url, re.I))


def _pos_num(v: Any, fallback: float) -> float:
    n = to_num(v) if not isinstance(v, bool) else None
    return n if n is not None and n > 0 else fallback


def _any_num(v: Any, fallback: float) -> float:
    if v is None or v == "" or isinstance(v, bool):
        return fallback
    n = to_num(v)
    return n if n is not None else fallback


def _text(v: Any) -> str:
    return v.strip() if isinstance(v, str) else ""


def normalize_system(inp: Any) -> dict | None:
    """คืน None เมื่อขาด id / ชื่อ ; ค่าที่หาย/ผิดรูปเติมจากค่าตั้งต้น"""
    if not is_obj(inp):
        return None
    sid = _text(inp.get("id")).lower()
    name = _text(inp.get("name"))
    if not ID_PATTERN.match(sid) or not name:
        return None
    kind = "pond" if inp.get("kind") == "pond" else "tank"
    base = new_system(kind)

    tanks = []
    for i, t in enumerate([t for t in (inp.get("tanks") if isinstance(inp.get("tanks"), list) else []) if is_obj(t)][:MAX_TANKS]):
        d = default_tank(kind, i)
        tanks.append({
            "name": _text(t.get("name")) or d["name"],
            "shape": shape_for_kind(kind),
            "width_m": _pos_num(t.get("width_m"), d["width_m"]),
            "length_m": _pos_num(t.get("length_m"), d["length_m"]),
            "diameter_m": _pos_num(t.get("diameter_m"), d["diameter_m"]),
            "height_m": _pos_num(t.get("height_m"), d["height_m"]),
            "offset_cm": 0 if i == 0 else _any_num(t.get("offset_cm"), 0),
        })
    if not tanks:
        tanks = base["tanks"]

    pumps = []
    for i, p in enumerate([p for p in (inp.get("pumps") if isinstance(inp.get("pumps"), list) else []) if is_obj(p)][:MAX_PUMPS]):
        drive = "magnetic" if p.get("drive") == "magnetic" else "inverter"
        d = default_pump(i, drive)
        pumps.append({"name": _text(p.get("name")) or d["name"], "drive": drive, "path": _text(p.get("path")) or d["path"], "faultPath": _text(p.get("faultPath"))})

    raw_sensors = inp.get("sensors") if is_obj(inp.get("sensors")) else {}

    def sensor(key: str) -> dict:
        s = raw_sensors.get(key) if is_obj(raw_sensors.get(key)) else {}
        return {
            "enabled": s["enabled"] if isinstance(s.get("enabled"), bool) else base["sensors"][key]["enabled"],
            "path": _text(s.get("path")) or SENSOR_DEFAULTS[key]["path"],
            "unit": s["unit"].strip() if isinstance(s.get("unit"), str) else SENSOR_DEFAULTS[key]["unit"],
        }

    b = inp.get("broker") if is_obj(inp.get("broker")) else None
    broker = (
        {"url": _text(b.get("url")), "username": _text(b.get("username")), "password": b["password"] if isinstance(b.get("password"), str) else ""}
        if b and _text(b.get("url"))
        else None
    )
    sensor_tank = math.floor(_any_num(inp.get("sensorTank"), 0) + 0.5)  # = Math.round ของ JS
    low = min(100.0, max(0.0, _any_num(inp.get("lowPct"), base["lowPct"])))
    high = min(100.0, max(0.0, _any_num(inp.get("highPct"), base["highPct"])))
    color = inp.get("waterColor")

    return {
        "id": sid,
        "name": name,
        "location": _text(inp.get("location")),
        "kind": kind,
        "broker": broker,
        "topic": _text(inp.get("topic")),
        "tanks": tanks,
        "sensorTank": sensor_tank if 0 <= sensor_tank < len(tanks) else 0,
        "sensors": {k: sensor(k) for k in SENSOR_KEYS},
        "levelUnit": inp.get("levelUnit") if inp.get("levelUnit") in LEVEL_UNITS else "cm",
        "waterColor": color.lower() if isinstance(color, str) and COLOR_PATTERN.match(color) else DEFAULT_WATER_COLOR,
        "pumps": pumps,
        "lowPct": low if low < high else base["lowPct"],
        "highPct": high if low < high else base["highPct"],
        "createdAt": _text(inp.get("createdAt")) or base["createdAt"],
        "updatedAt": _text(inp.get("updatedAt")) or base["updatedAt"],
    }


def validate_system(cfg: dict) -> dict[str, str]:
    """คืน key ของข้อความผิดพลาด (ตรงกับ water_systems.error.* ของ frontend)"""
    e: dict[str, str] = {}
    if not cfg["name"].strip():
        e["name"] = "name_required"
    if cfg["broker"] and not is_valid_broker_url(cfg["broker"]["url"]):
        e["broker"] = "broker_invalid"
    if not cfg["topic"]:
        e["topic"] = "topic_required"
    elif not is_valid_topic(cfg["topic"]):
        e["topic"] = "topic_invalid"
    tanks = cfg["tanks"]
    if len(tanks) < 1 or len(tanks) > MAX_TANKS:
        e["tanks"] = "tanks_count"
    elif any(not (t["height_m"] > 0) or not (tank_area(t) > 0) or not math.isfinite(t["offset_cm"]) or not t["name"].strip() for t in tanks):
        e["tanks"] = "tanks_invalid"
    if any(cfg["sensors"][k]["enabled"] and not is_valid_path(cfg["sensors"][k]["path"]) for k in SENSOR_KEYS):
        e["sensors"] = "sensor_path_required"
    pumps = cfg["pumps"]
    if len(pumps) > MAX_PUMPS or any(not p["name"].strip() for p in pumps):
        e["pumps"] = "pump_name_required"
    elif any(not is_valid_path(p["path"]) or (p["faultPath"] != "" and not is_valid_path(p["faultPath"])) for p in pumps):
        e["pumps"] = "pump_path_required"
    if not (cfg["lowPct"] >= 0 and cfg["highPct"] <= 100 and cfg["lowPct"] < cfg["highPct"]):
        e["limits"] = "limits_invalid"
    return e
