"""VSOL V1600G0-B (GPON) adapter — READ-ONLY (software tested V1.4.6R).

Connection: SSH CLI. Login enters ``gpon-olt>`` then ``enable`` -> ``gpon-olt#``.
Per-ONU detail commands run inside a GPON interface context:
    configure terminal
    interface gpon 0/1
    show onu <id> optical_info
    ...
    end

All parsers are pure and DEFENSIVE — they never raise on unexpected input and
return null / "-" for absent fields. The frontend only ever sees normalized JSON
(the same schema as the ZTE C320 adapter, so OLT Management UI is reused as-is).

SAFETY (read path): read commands are strictly read-only. Passwords (PPPoE /
WiFi key / TR069 / ACS) are NEVER parsed, stored, logged, or returned —
running-config is whitelist-parsed for safe fields only (profile / VLAN), the
raw text is discarded.

PROVISIONING (write path, phase 2): authorize / delete / reboot / rename ONU
inside a ``interface gpon <port>`` context. Every write goes through a Preview
(dry_run) that renders the exact CLI without touching the device, and each run
is audited. Operators can fully override the generated CLI per firmware via a
Provisioning Profile ``command_template`` (same mechanism as the ZTE adapter).
"""
from __future__ import annotations
import re
from typing import Any, Dict, List, Optional

from ...base import (
    BaseOLTAdapter, UNSUPPORTED,
    ONU_ONLINE, ONU_LOS, ONU_DYING_GASP, ONU_OFFLINE, ONU_UNKNOWN,
    normalized_onu,
)

_PHASE_MAP = {
    "working": ONU_ONLINE,
    "online": ONU_ONLINE,
    "los": ONU_LOS,
    "losi": ONU_LOS,
    "dyinggasp": ONU_DYING_GASP,
    "offline": ONU_OFFLINE,
}


def map_status(phase: Optional[str]) -> str:
    if not phase:
        return ONU_UNKNOWN
    return _PHASE_MAP.get(re.sub(r"[\s_\-]", "", phase).lower(), ONU_UNKNOWN)


def _f(v: Any) -> Optional[float]:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# OnuIndex e.g. "GPON0/1:1"  -> port "0/1", onu_id "1", index "GPON0/1:1"
_IDX_RE = re.compile(r"GPON\s*(\d+/\d+)\s*:\s*(\d+)", re.IGNORECASE)


def _parse_index(token: str):
    m = _IDX_RE.search(token or "")
    if not m:
        return None, None, None
    port, onu_id = m.group(1), m.group(2)
    return f"GPON{port}", onu_id, f"GPON{port}:{onu_id}"


def _kv(line: str) -> Optional[str]:
    if ":" in line:
        return line.split(":", 1)[1].strip() or None
    return None


# --- parsers ------------------------------------------------------------------
def parse_state_all(text: str) -> Dict[str, Any]:
    """`show onu state all` -> normalized onu states + per-pon summary."""
    onus: List[Dict[str, Any]] = []
    summary: List[Dict[str, Any]] = []
    for raw in (text or "").splitlines():
        s = raw.strip()
        if not s:
            continue
        msum = re.search(r"pon\s*:\s*(\d+)\s+total\s*:\s*(\d+)\s+working\s*:\s*(\d+)", s, re.IGNORECASE)
        if msum:
            summary.append({"pon": msum.group(1), "total": int(msum.group(2)), "working": int(msum.group(3))})
            continue
        m = _IDX_RE.search(s)
        if not m:
            continue
        pon, onu_id, index = _parse_index(s)
        rest = s[m.end():].split()
        admin = rest[0] if len(rest) > 0 else None
        omcc = rest[1] if len(rest) > 1 else None
        phase = rest[2] if len(rest) > 2 else None
        serial = None
        for tok in rest:
            if re.match(r"^[0-9A-Za-z]{8,}$", tok) and not re.match(r"^(enable|disable|working|offline|dyinggasp|los)$", tok, re.IGNORECASE):
                serial = tok
        onus.append({
            "onu_index": index, "pon": pon, "onu_id": onu_id,
            "admin_state": admin, "omcc_state": omcc, "phase_state": phase,
            "status": map_status(phase), "serial_number": serial,
        })
    return {"onus": onus, "summary": summary}


def parse_info_all(text: str) -> Dict[str, Dict[str, Any]]:
    """`show onu info` -> {onu_index: {model, profile, auth_mode, serial}}.

    Handles BOTH the real device TABLE format (one row per ONU, columns:
    Onuindex Model Profile Mode AuthInfo) and the multi-line block format.
    """
    out: Dict[str, Dict[str, Any]] = {}
    cur = None
    for raw in (text or "").splitlines():
        s = raw.strip()
        if not s:
            continue
        low = s.lower()
        if low.startswith("onuindex") or low.startswith("onu index") or set(s) <= set("-"):
            continue  # header / separator
        m = _IDX_RE.search(s)
        rest = s[m.end():].split() if m else []
        if m and rest:  # TABLE row: index + model profile mode sn
            _, _, idx = _parse_index(s)
            model = rest[0] if len(rest) > 0 else None
            if model and model.lower() == "unknown":
                model = "Unknown"
            out[idx] = {
                "onu_index": idx, "model": model,
                "profile": rest[1] if len(rest) > 1 else None,
                "auth_mode": rest[2] if len(rest) > 2 else None,
                "serial_number": rest[3] if len(rest) > 3 else None,
            }
            cur = None
            continue
        if m and not rest:  # BLOCK header line (index alone)
            _, _, cur = _parse_index(s)
            out[cur] = {"onu_index": cur, "model": None, "profile": None, "auth_mode": None, "serial_number": None}
            continue
        if cur is None:
            continue
        if low.startswith("model"):
            mv = _kv(s)
            out[cur]["model"] = "Unknown" if (mv and mv.lower() == "unknown") else mv
        elif low.startswith("profile"):
            out[cur]["profile"] = _kv(s)
        elif low.startswith("mode"):
            out[cur]["auth_mode"] = _kv(s)
        elif low.startswith("sn"):
            out[cur]["serial_number"] = _kv(s)
    return out


def parse_version(text: str) -> Dict[str, Any]:
    sw = None
    m = re.search(r"\b(V\d+\.\d+[\w.\-]*)\b", text or "")
    if m:
        sw = m.group(1)
    return {"software_version": sw}


def parse_detail_info(text: str) -> Dict[str, Any]:
    d = {"vendor_id": None, "version": None, "serial_number": None, "equipment_id": None,
         "admin_status": None, "operate_status": None, "omcc_version": None, "uptime": None}
    for raw in (text or "").splitlines():
        line = raw.strip()
        low = line.lower()
        if low.startswith("vendor id"):
            d["vendor_id"] = _kv(line)
        elif low.startswith("version") and d["version"] is None:
            d["version"] = _kv(line)
        elif (low.startswith("sn") or low.startswith("serial")) and d["serial_number"] is None:
            d["serial_number"] = _kv(line)
        elif low.startswith("equipment id"):
            d["equipment_id"] = _kv(line)
        elif low.startswith("admin status"):
            d["admin_status"] = _kv(line)
        elif low.startswith("operate status"):
            d["operate_status"] = _kv(line)
        elif low.startswith("omcc version"):
            d["omcc_version"] = _kv(line)
        elif "sysuptime" in low or "sys up time" in low:
            v = _kv(line) or line
            mm = re.search(r"(\d+)\s*s", v)
            if mm:
                secs = int(mm.group(1))
                d["uptime"] = _fmt_uptime(secs)
                d["uptime_seconds"] = secs
    return d


def _fmt_uptime(secs: int) -> str:
    d, r = divmod(secs, 86400)
    h, r = divmod(r, 3600)
    m, s = divmod(r, 60)
    if d:
        return f"{d}d {h}h {m}m"
    if h:
        return f"{h}h {m}m {s}s"
    return f"{m}m {s}s"


def parse_optical(text: str) -> Dict[str, Any]:
    res = {"rx_power": None, "olt_rx_power": None, "tx_power": None,
           "voltage": None, "laser_bias": None, "temperature": None}
    for raw in (text or "").splitlines():
        line = raw.strip()
        low = line.lower()
        num = re.search(r"(-?\d+\.?\d*)", line)
        val = _f(num.group(1)) if num else None
        if "rx optical level" in low and "onu" in low:
            res["rx_power"] = val
        elif "rx optical level" in low and "olt" in low:
            res["olt_rx_power"] = val
        elif "tx optical level" in low:
            res["tx_power"] = val
        elif "power feed voltage" in low or low.startswith("voltage"):
            res["voltage"] = val
        elif "laser bias" in low:
            res["laser_bias"] = val
        elif "temperature" in low:
            res["temperature"] = val
    return res


def parse_distance(text: str) -> Optional[int]:
    m = re.search(r"distance\s*:?\s*(\d+)\s*m", text or "", re.IGNORECASE)
    return int(m.group(1)) if m else None


def parse_timestamp(text: str) -> Dict[str, Any]:
    """Handle BOTH the real columnar single-row format and the labeled
    multi-line format."""
    if re.search(r"last\s+regist\s*:", text or "", re.IGNORECASE):
        return _parse_timestamp_labeled(text)
    return _parse_timestamp_columnar(text)


def _parse_timestamp_labeled(text: str) -> Dict[str, Any]:
    d = {"last_regist": None, "last_deregist": None, "last_deregist_reason": None, "alive_time": None}
    lines = [l.strip() for l in (text or "").splitlines()]
    for i, line in enumerate(lines):
        low = line.lower()
        nxt = lines[i + 1].strip() if i + 1 < len(lines) else ""
        if "last regist" in low:
            d["last_regist"] = _kv(line) or nxt or None
        elif "last deregist" in low and "reason" not in low and "detail" not in low:
            d["last_deregist"] = _kv(line) or nxt or None
        elif low.startswith("reason") or "deregist reason" in low:
            d["last_deregist_reason"] = _kv(line) or nxt or None
        elif "alive time" in low:
            d["alive_time"] = _kv(line) or nxt or None
    return d


_DT_RE = re.compile(r"\d{4}[:/-]\d{1,2}[:/-]\d{1,2}\s+\d{1,2}:\d{1,2}:\d{1,2}")
_ALIVE_RE = re.compile(r"(\d+\s+\d{1,2}:\d{1,2}:\d{1,2})\s*$")


def _parse_timestamp_columnar(text: str) -> Dict[str, Any]:
    d = {"last_regist": None, "last_deregist": None, "last_deregist_reason": None, "alive_time": None}
    # keep only the data line(s), drop the header ("onu id ... alive time")
    data = " ".join(l for l in (text or "").splitlines()
                     if _DT_RE.search(l) or _ALIVE_RE.search(l.strip()))
    data = " ".join(data.split())
    if not data:
        return d
    dts = _DT_RE.findall(data)
    if dts:
        d["last_regist"] = dts[0]
    if len(dts) > 1:
        d["last_deregist"] = dts[1]
    am = _ALIVE_RE.search(data)
    if am:
        d["alive_time"] = am.group(1)
    if len(dts) > 1:
        tail = data.split(dts[1], 1)[1]
        if d["alive_time"]:
            tail = tail.replace(d["alive_time"], "")
        d["last_deregist_reason"] = tail.strip() or None
    return d


_REASON_MAP = {"onu los": ONU_LOS, "los": ONU_LOS, "power off": "POWER_OFF", "poweroff": "POWER_OFF"}


def _norm_reason(reason: Optional[str]) -> Optional[str]:
    if not reason:
        return None
    key = reason.strip().lower()
    for k, v in _REASON_MAP.items():
        if k in key:
            return v
    return None


def parse_deregist_detail(text: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for raw in (text or "").splitlines():
        s = raw.strip()
        if not s:
            continue
        mdt = re.search(r"(\d{4}[:/-]\d{1,2}[:/-]\d{1,2}\s+\d{1,2}:\d{1,2}:\d{1,2})", s)
        if not mdt:
            continue
        when = mdt.group(1)
        reason_raw = s[mdt.end():].strip(" \t:-|") or None
        out.append({"time": when, "raw_reason": reason_raw, "reason": _norm_reason(reason_raw)})
    return out[:20]


def parse_desc(text: str) -> Optional[str]:
    lines = [l.strip() for l in (text or "").splitlines() if l.strip()]
    for i, line in enumerate(lines):
        if "description" in line.lower():
            v = _kv(line)
            if v:
                return v
            if i + 1 < len(lines):
                return lines[i + 1]
    return None


def parse_eth(text: str) -> Dict[str, Any]:
    e = {"speed_status": None, "admin_status": None, "link_status": None,
         "speed_config": None, "bridge_ip": None, "eth_loop": None}
    for raw in (text or "").splitlines():
        low = raw.strip().lower()
        if low.startswith("speed status"):
            e["speed_status"] = _kv(raw)
        elif low.startswith("admin status"):
            e["admin_status"] = _kv(raw)
        elif low.startswith("link status"):
            e["link_status"] = _kv(raw)
        elif low.startswith("speed config"):
            e["speed_config"] = _kv(raw)
        elif low.startswith("bridge or ip") or low.startswith("bridge/ip"):
            e["bridge_ip"] = _kv(raw)
        elif "ethernet loop" in low or low.startswith("eth loop"):
            e["eth_loop"] = _kv(raw)
    return e if any(v is not None for v in e.values()) else {}


# Whitelist-only running-config parser. Passwords are NEVER captured — we scan
# ONLY for safe numeric/name tokens and drop everything else.
def parse_running_config_safe(text: str) -> Dict[str, Any]:
    cfg = {"profile": None, "internet_vlan": None, "tr069_vlan": None, "vlans": []}
    for raw in (text or "").splitlines():
        low = raw.strip().lower()
        if any(w in low for w in ("password", "passwd", "shared-key", "shared_key", "secret",
                                   "psk", "acs", "key ", "community", "wpa", "wep", "auth-key")):
            continue  # never touch credential/secret lines
        if "profile" in low and cfg["profile"] is None:
            m = re.search(r"profile\s+([\w\-.]+)", low)
            if m:
                cfg["profile"] = m.group(1)
        mv = re.findall(r"\bvlan\s+(\d{1,4})\b", low)
        for v in mv:
            iv = int(v)
            if iv not in cfg["vlans"]:
                cfg["vlans"].append(iv)
        if "tr069" in low or "tr-069" in low:
            mt = re.search(r"vlan\s+(\d{1,4})", low)
            if mt:
                cfg["tr069_vlan"] = int(mt.group(1))
    vlans = [v for v in cfg["vlans"] if v != cfg["tr069_vlan"]]
    if vlans:
        cfg["internet_vlan"] = vlans[0]
    return cfg


# --- provisioning helpers -----------------------------------------------------
# CLI error detection for write output. A confirmation echo ('y') or a line that
# merely mentions 'reboot'/'reset'/'success' is NOT treated as an error. The
# pattern is intentionally conservative (mirrors the ZTE adapter) to avoid false
# positives on normal VSOL success output.
_ERR_RE = re.compile(
    r"(%\s*error|invalid input|unknown command|bad command|incomplete command|"
    r"command not found|does not exist|already exist|already registered|no such|"
    r"ambiguous|not exist|operation fail|configure fail|add fail|del(?:ete)? fail|"
    r"reboot fail|reset fail|error:)", re.IGNORECASE)


def find_cli_error(output: str) -> Optional[str]:
    for ln in (output or "").splitlines():
        s = ln.strip()
        if not s or s.lower() == "y":
            continue
        low = s.lower()
        if "success" in low or "reboot" in low or "reset" in low:
            continue
        if _ERR_RE.search(s):
            return s
    return None


# --- adapter ------------------------------------------------------------------
class VsolV1600G0BAdapter(BaseOLTAdapter):
    vendor = "VSOL"
    model = "V1600G0-B"
    protocols = ["ssh"]
    needs_enable = True
    supports_provisioning = True  # phase 2 = provisioning (write) enabled

    # GPON ports are probed 0/1..0/8; only ports that respond yield ONU rows,
    # so the effective port count is auto-detected (not hardcoded).
    PORTS = [f"0/{i}" for i in range(1, 9)]

    def _port_onu(self, onu_index: str):
        pon, onu_id, _ = _parse_index(onu_index)
        port = (pon or "").replace("GPON", "")
        return port, onu_id

    async def test_connection(self) -> Dict[str, Any]:
        # Login + enable already validated by the transport before we get here.
        return {"ok": True, "message": "Terhubung ke VSOL V1600G0-B (SSH)"}

    async def get_system_info(self) -> Dict[str, Any]:
        return {"software_version": None}

    async def get_onu_states(self) -> List[Dict[str, Any]]:
        # `show onu state` / `show onu info` exist ONLY inside a gpon interface
        # context and are per-PON. Query each port separately so the state table
        # and the info table are parsed from their OWN output (never mixed).
        all_onus: List[Dict[str, Any]] = []
        info_map: Dict[str, Dict[str, Any]] = {}
        for p in self.PORTS:
            res = await self.t.run_commands(
                ["end", "configure terminal", f"interface gpon {p}", "show onu state", "show onu info"])
            st = parse_state_all(res.get("show onu state", ""))
            if not st["onus"]:
                continue  # invalid/empty PON -> skip (auto-detects real ports)
            info_map.update(parse_info_all(res.get("show onu info", "")))
            all_onus.extend(st["onus"])
        for o in all_onus:
            meta = info_map.get(o["onu_index"]) or {}
            o["model"] = meta.get("model")
            o["profile"] = meta.get("profile")
            if not o.get("serial_number"):
                o["serial_number"] = meta.get("serial_number")
        return all_onus

    async def get_unconfigured_onu(self) -> Any:
        return UNSUPPORTED

    async def get_cards(self) -> Any:
        return UNSUPPORTED

    async def get_pon_ports(self) -> List[Dict[str, Any]]:
        states = await self.get_onu_states()
        pons: Dict[str, Dict[str, Any]] = {}
        for o in states:
            p = o.get("pon")
            if not p:
                continue
            g = pons.setdefault(p, {"pon": p, "total_onu": 0, "online": 0, "los": 0,
                                    "dying_gasp": 0, "offline": 0})
            g["total_onu"] += 1
            key = {ONU_ONLINE: "online", ONU_LOS: "los", ONU_DYING_GASP: "dying_gasp",
                   ONU_OFFLINE: "offline"}.get(o.get("status"))
            if key:
                g[key] += 1
        return sorted(pons.values(), key=lambda x: x["pon"])

    async def get_onu_detail(self, onu_index: str) -> Dict[str, Any]:
        port, onu_id = self._port_onu(onu_index)
        if not port or not onu_id:
            return normalized_onu(onu_index=onu_index)
        c = {
            "detail": f"show onu {onu_id} detail-info",
            "cfg": f"show onu {onu_id} profile",
            "optical": f"show onu {onu_id} optical_info",
            "distance": f"show onu {onu_id} distance",
            "desc": f"show onu {onu_id} desc",
            "eth": f"show onu {onu_id} eth 1",
            "ts": f"show onu {onu_id} time-stamp",
            "dereg": f"show onu {onu_id} time-stamp deregist-detail",
        }
        cmds = ["end", "configure terminal", f"interface gpon {port}"] + list(c.values()) + ["end"]
        res = await self.t.run_commands(cmds)
        info = parse_detail_info(res.get(c["detail"], ""))
        cfg = parse_running_config_safe(res.get(c["cfg"], ""))  # whitelist-only (no secrets)
        optical = parse_optical(res.get(c["optical"], ""))
        distance = parse_distance(res.get(c["distance"], ""))
        desc = parse_desc(res.get(c["desc"], ""))
        eth = parse_eth(res.get(c["eth"], ""))
        ts = parse_timestamp(res.get(c["ts"], ""))
        dereg = parse_deregist_detail(res.get(c["dereg"], ""))

        pon, oid, index = _parse_index(onu_index)
        return normalized_onu(
            olt_id=self.device.get("id"), pon=pon, onu_id=oid, onu_index=index or onu_index,
            name=desc, model=None, serial_number=info.get("serial_number"),
            status=None, rx_power=optical.get("rx_power"), tx_power=optical.get("tx_power"),
            attenuation=None, distance=distance,
            uptime=info.get("uptime") or ts.get("alive_time"),
            profile=cfg.get("profile"), upstream_limit=None, downstream_limit=None,
            internet_vlan=cfg.get("internet_vlan"), tr069_vlan=cfg.get("tr069_vlan"), last_seen=None,
        ) | {
            "vendor_id": info.get("vendor_id"),
            "version": info.get("version"),
            "equipment_id": info.get("equipment_id"),
            "operate_status": info.get("operate_status"),
            "olt_rx_power": optical.get("olt_rx_power"),
            "temperature": optical.get("temperature"),
            "voltage": optical.get("voltage"),
            "laser_bias": optical.get("laser_bias"),
            "distance_m": distance,
            "online_time": ts.get("last_regist"),
            "offline_time": ts.get("last_deregist"),
            "offline_cause": ts.get("last_deregist_reason"),
            "alive_time": ts.get("alive_time"),
            "deregist_history": dereg,
            "eth": eth or None,
        }

    async def get_onu_optical(self, onu_index: str) -> Dict[str, Any]:
        port, onu_id = self._port_onu(onu_index)
        if not port or not onu_id:
            return {}
        cmds = ["end", "configure terminal", f"interface gpon {port}",
                f"show onu {onu_id} optical_info", "end"]
        res = await self.t.run_commands(cmds)
        return parse_optical(res.get(f"show onu {onu_id} optical_info", ""))

    async def get_onu_running_config(self, onu_index: str) -> Dict[str, Any]:
        # Whitelist-only (safe fields). Passwords are never returned.
        port, onu_id = self._port_onu(onu_index)
        if not port or not onu_id:
            return {}
        cmds = ["end", "configure terminal", f"interface gpon {port}",
                f"show onu {onu_id} profile", "end"]
        res = await self.t.run_commands(cmds)
        return parse_running_config_safe(res.get(f"show onu {onu_id} profile", ""))

    async def get_alarm_summary(self) -> Any:
        return UNSUPPORTED

    # --- provisioning (write) -------------------------------------------------
    # Every method returns: {ok, dry_run, commands, output, error}. On dry_run
    # the commands are rendered WITHOUT opening/using a device session.
    async def _exec(self, lines: List[str], dry_run: bool) -> Dict[str, Any]:
        lines = [ln for ln in lines if ln is not None and str(ln).strip() != ""]
        if dry_run:
            return {"ok": True, "dry_run": True, "commands": lines, "output": "", "error": None}
        runner = getattr(self.t, "run_script", None)
        if runner is not None:
            output = await runner(lines)
        else:  # fallback (should not happen for a live session)
            res = await self.t.run_commands(lines)
            output = "\n".join(f"{c}\n{res.get(c, '')}" for c in lines)
        err = find_cli_error(output)
        return {"ok": err is None, "dry_run": False, "commands": lines, "output": output, "error": err}

    @staticmethod
    def _norm_port(pon: Any) -> str:
        """Accept '0/1', 'GPON0/1', 'gpon 0/1', '0/1:1' -> return bare '0/1'."""
        p = re.sub(r"(?i)gpon", "", str(pon or "")).strip()
        p = p.split(":", 1)[0].strip()
        return p

    def _authorize_lines(self, p: Dict[str, Any]) -> List[str]:
        """Build the VSOL V1600G0-B GPON ONU authorize sequence.

        If ``command_template`` is provided (from a Provisioning Profile) it is
        rendered with the given variables and used verbatim — giving operators
        full control over firmware-specific CLI. Otherwise a standard V-SOL
        sequence is generated (``onu add <id> profile <name> sn <sn>`` inside the
        ``interface gpon <port>`` context). Optional binds/description are only
        emitted when the operator supplies them, so nothing unexpected is pushed.
        """
        port = self._norm_port(p.get("pon"))
        onuid = str(p.get("onu_id") or "").strip()
        sn = str(p.get("sn") or "").strip()
        name = str(p.get("name") or "").strip()
        vlan = str(p.get("vlan") or "").strip()
        onu_profile = str(p.get("onu_type") or "").strip()      # VSOL onu profile name
        srv_profile = str(p.get("service_profile") or "").strip()
        line_profile = str(p.get("tcont_profile") or "").strip()  # reuse field as line-profile

        tmpl = p.get("command_template")
        if tmpl and str(tmpl).strip():
            variables = {
                "pon": port, "port": port, "onuid": onuid, "onu_id": onuid, "sn": sn,
                "name": name, "vlan": vlan,
                "onu_type": onu_profile, "type": onu_profile, "profile": onu_profile,
                "onu_profile": onu_profile,
                "service_profile": srv_profile, "srv_profile": srv_profile,
                "tcont_profile": line_profile, "line_profile": line_profile,
                **{k: str(v) for k, v in (p.get("extra_vars") or {}).items()},
            }
            rendered = str(tmpl)
            for k, v in variables.items():
                rendered = rendered.replace("{" + k + "}", v)
            return [ln.strip() for ln in rendered.splitlines() if ln.strip()]

        # ---- builtin standard V-SOL sequence ----
        lines: List[str] = ["end", "configure terminal", f"interface gpon {port}"]
        reg = f"onu add {onuid} profile {onu_profile} sn {sn}" if onu_profile else f"onu add {onuid} sn {sn}"
        lines.append(reg)
        if line_profile:
            lines.append(f"onu {onuid} line-profile {line_profile}")
        if srv_profile:
            lines.append(f"onu {onuid} service-profile {srv_profile}")
        if name:
            lines.append(f"onu {onuid} description {name}")
        lines += ["exit", "end"]
        return lines

    async def provision_authorize(self, params: Dict[str, Any]) -> Dict[str, Any]:
        lines = self._authorize_lines(params)
        return await self._exec(lines, bool(params.get("dry_run")))

    async def provision_delete_onu(self, onu_index: str, dry_run: bool = False) -> Dict[str, Any]:
        port, onuid = self._port_onu(onu_index)
        if not port or not onuid:
            return {"ok": False, "commands": [], "output": "", "error": f"ONU index tidak valid: {onu_index}"}
        lines = ["end", "configure terminal", f"interface gpon {port}", f"onu del {onuid}", "exit", "end"]
        return await self._exec(lines, dry_run)

    async def provision_reboot_onu(self, onu_index: str, dry_run: bool = False) -> Dict[str, Any]:
        port, onuid = self._port_onu(onu_index)
        if not port or not onuid:
            return {"ok": False, "commands": [], "output": "", "error": f"ONU index tidak valid: {onu_index}"}
        lines = ["end", "configure terminal", f"interface gpon {port}", f"onu reset {onuid}", "exit", "end"]
        return await self._exec(lines, dry_run)

    async def provision_set_name(self, onu_index: str, name: str, dry_run: bool = False) -> Dict[str, Any]:
        port, onuid = self._port_onu(onu_index)
        if not port or not onuid:
            return {"ok": False, "commands": [], "output": "", "error": f"ONU index tidak valid: {onu_index}"}
        safe = str(name or "").strip()
        lines = ["end", "configure terminal", f"interface gpon {port}",
                 f"onu {onuid} description {safe}", "exit", "end"]
        return await self._exec(lines, dry_run)
