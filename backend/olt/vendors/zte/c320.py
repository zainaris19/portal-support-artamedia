"""ZTE C320 (GPON) adapter — READ-ONLY.

Proven CLI (software V2.1.0):
    show version-running
    show card
    show gpon onu state
    show gpon onu uncfg
    show gpon onu detail-info gpon-onu_{ONU}
    show running-config interface gpon-onu_{ONU}

All parsers are pure and defensive: they never raise on unexpected input and
return null / "-" for fields that are absent. The frontend only ever sees the
normalized JSON produced here.
"""
from __future__ import annotations
import re
from typing import Any, Dict, List, Optional

from ...base import (
    BaseOLTAdapter, UNSUPPORTED,
    ONU_ONLINE, ONU_LOS, ONU_DYING_GASP, ONU_OFFLINE, ONU_UNKNOWN,
    normalized_onu,
)

# Phase-state -> normalized status. LOS / DyingGasp / OffLine kept DISTINCT.
_PHASE_MAP = {
    "working": ONU_ONLINE,
    "los": ONU_LOS,
    "losi": ONU_LOS,
    "dyinggasp": ONU_DYING_GASP,
    "offline": ONU_OFFLINE,
}


def map_status(phase: Optional[str]) -> str:
    if not phase:
        return ONU_UNKNOWN
    return _PHASE_MAP.get(re.sub(r"[\s_\-]", "", phase).lower(), ONU_UNKNOWN)


# CLI error detection for write/provisioning output. Lines that merely echo a
# confirmation ('y') or contain 'reboot' are NOT treated as errors.
_ERR_RE = re.compile(
    r"(%\s*error|invalid input|unknown command|bad command|incomplete command|"
    r"command not found|does not exist|already exist|no such|ambiguous|"
    r"operation fail|configure fail|error:)", re.IGNORECASE)


def find_cli_error(output: str) -> Optional[str]:
    for ln in (output or "").splitlines():
        s = ln.strip()
        if not s or s.lower() == "y":
            continue
        if "reboot" in s.lower():
            continue
        if _ERR_RE.search(s):
            return s
    return None


def _f(v: Any) -> Optional[float]:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# index helpers -- accept both "gpon-onu_1/1/1:1" and bare "1/1/1:1" (C320 state table)
_IDX_RE = re.compile(r"(?:gpon[-_]onu[_-])?(\d+/\d+/\d+):(\d+)", re.IGNORECASE)


def _parse_index(token: str):
    """Return (pon, onu_id, normalized_index) from a gpon-onu token."""
    m = _IDX_RE.search(token or "")
    if not m:
        return None, None, None
    pon, onu_id = m.group(1), m.group(2)
    return pon, onu_id, f"{pon}:{onu_id}"


# --- parsers ------------------------------------------------------------------
def parse_version(text: str) -> Dict[str, Any]:
    """C320 `show version-running` is a table:
        PhyLoc  FileType  VerType  VerTag   BuildTime  VerLength
        1/1/3   SMXA      MVR      V2.1.0   ...
    The running software version is the MVR (main) VerTag on the control card.
    """
    sw = None
    # Prefer the MVR (main running) version line.
    for line in (text or "").splitlines():
        if re.search(r"\bMVR\b", line):
            m = re.search(r"\b([VR]\d[\w.]*)\b", line)
            if m:
                sw = m.group(1)
                break
    if sw is None:
        for line in (text or "").splitlines():
            m = re.search(r"[Vv]ersion[:\s]+((?:V|R)?\d[\w.\-]*)", line)
            if m:
                sw = m.group(1).strip().rstrip(",")
                break
    if sw is None:
        m = re.search(r"\b(V\d+\.\d+[\w.]*)\b", text or "")
        if m:
            sw = m.group(1)
    return {"software_version": sw}


def parse_cards(text: str) -> List[Dict[str, Any]]:
    cards: List[Dict[str, Any]] = []
    for line in (text or "").splitlines():
        s = line.strip()
        if not s:
            continue
        # header / separators
        if re.match(r"(rack|shelf|slot|-{3,}|=+)", s, re.IGNORECASE) and not re.match(r"\d", s):
            continue
        parts = s.split()
        # Expect at least: rack shelf slot cfgType realType port ...
        if len(parts) >= 4 and parts[0].isdigit() and parts[1].isdigit() and parts[2].isdigit():
            rack, shelf, slot = parts[0], parts[1], parts[2]
            cfg_type = parts[3] if len(parts) > 3 else None
            real_type = parts[4] if len(parts) > 4 else None
            port = next((p for p in parts[5:] if p.isdigit()), None)
            hw = next((p for p in parts[5:] if re.match(r"V[\d.]", p)), None)
            sws = [p for p in parts[5:] if re.match(r"V[\d.]", p)]
            sw = sws[1] if len(sws) > 1 else None
            status = parts[-1]
            cards.append({
                "rack": rack, "shelf": shelf, "slot": slot,
                "cfg_type": cfg_type, "real_type": real_type,
                "port_count": int(port) if port and port.isdigit() else None,
                "hardware_version": hw, "software_version": sw,
                "status": status,
            })
    return cards


def parse_onu_state(text: str) -> List[Dict[str, Any]]:
    onus: List[Dict[str, Any]] = []
    for line in (text or "").splitlines():
        s = line.strip()
        if not _IDX_RE.search(s):
            continue
        parts = s.split()
        idx_tok = parts[0]
        pon, onu_id, index = _parse_index(idx_tok)
        rest = parts[1:]
        admin = rest[0] if len(rest) > 0 else None
        omcc = rest[1] if len(rest) > 1 else None
        phase = rest[2] if len(rest) > 2 else None
        channel = rest[3] if len(rest) > 3 else None
        # Some builds omit omcc -> phase would shift. Detect known phase words.
        known = {"working", "los", "losi", "dyinggasp", "offline"}
        for tok in rest:
            if re.sub(r"[\s_\-]", "", tok).lower() in known:
                phase = tok
                break
        onus.append({
            "onu_index": index, "pon": pon, "onu_id": onu_id,
            "admin_state": admin, "omcc_state": omcc, "phase_state": phase,
            "channel": channel, "status": map_status(phase),
        })
    return onus


def parse_uncfg(text: str) -> List[Dict[str, Any]]:
    t = text or ""
    if re.search(r"no related information", t, re.IGNORECASE):
        return []
    out: List[Dict[str, Any]] = []
    for line in t.splitlines():
        s = line.strip()
        sn = None
        msn = re.search(r"\b([0-9A-Fa-f]{4}[0-9A-Fa-f]{8})\b", s)  # 12-hex SN
        msn2 = re.search(r"\b([A-Z]{4}[0-9A-Fa-f]{8})\b", s)       # e.g. ZTEG/HWTC + 8
        m_gpon = re.search(r"gpon[-_]onu[_-]?(\d+/\d+/\d+)", s, re.IGNORECASE)
        m_pon = m_gpon or re.search(r"\b(\d+/\d+/\d+)\b", s)
        if msn2:
            sn = msn2.group(1)
        elif msn:
            sn = msn.group(1)
        if not sn:
            continue
        parts = s.split()
        state = parts[-1] if parts else None
        out.append({"pon": m_pon.group(1) if m_pon else None, "serial_number": sn, "state": state})
    return out


def parse_inventory(text: str) -> List[Dict[str, Any]]:
    """Best-effort inventory rows like:
        gpon-onu_1/1/1:1  HG8546M  SN:HWTC3F8374A2  ready
    """
    out: List[Dict[str, Any]] = []
    for line in (text or "").splitlines():
        s = line.strip()
        m = _IDX_RE.search(s)
        if not m:
            continue
        pon, onu_id, index = _parse_index(m.group(0))
        sn = None
        msn = re.search(r"SN[:\s]+([0-9A-Za-z]+)", s, re.IGNORECASE)
        if msn:
            sn = msn.group(1)
        # model = a token that is not the index / not SN / not state
        after = s[m.end():].split()
        model = None
        state = after[-1] if after else None
        for tok in after:
            if tok.upper().startswith("SN"):
                continue
            if re.match(r"^[A-Za-z][A-Za-z0-9\-]{2,}$", tok) and tok.lower() not in ("ready", "working", "los", "offline"):
                model = tok
                break
        out.append({"onu_index": index, "pon": pon, "onu_id": onu_id,
                    "model": model, "serial_number": sn, "registration_state": state})
    return out


def parse_detail_info(text: str) -> Dict[str, Any]:
    """Parse C320 `show gpon onu detail-info`. Info fields are key:value; the
    online/offline history is a table (Authpass Time / OfflineTime / Cause)."""
    d = {"serial_number": None, "model": None, "name": None,
         "rx_power": None, "tx_power": None, "attenuation": None,
         "distance": None, "online_time": None, "offline_time": None,
         "offline_cause": None, "uptime": None}
    lines = (text or "").splitlines()
    # locate history table header (contains Authpass + Cause)
    hist_start = None
    for i, ln in enumerate(lines):
        low = ln.lower()
        if "authpass" in low and "cause" in low:
            hist_start = i
            break
    info_lines = lines if hist_start is None else lines[:hist_start]
    hist_lines = [] if hist_start is None else lines[hist_start + 1:]

    for raw in info_lines:
        line = raw.strip()
        low = line.lower()
        if d["rx_power"] is None and "rx" in low and "optical" in low and "power" in low:
            m = re.search(r"(-?\d+\.\d+)", line)
            if m:
                d["rx_power"] = _f(m.group(1))
        elif d["tx_power"] is None and "tx" in low and "optical" in low and "power" in low:
            m = re.search(r"(-?\d+\.\d+)", line)
            if m:
                d["tx_power"] = _f(m.group(1))
        elif d["attenuation"] is None and "attenuation" in low:
            m = re.search(r"(-?\d+\.\d+)", line)
            if m:
                d["attenuation"] = _f(m.group(1))
        elif d["distance"] is None and "distance" in low:
            m = re.search(r"(\d+)", line)
            if m:
                d["distance"] = int(m.group(1))
        elif d["uptime"] is None and "online duration" in low:
            d["uptime"] = _kv_value(line)
        elif d["serial_number"] is None and re.match(r"serial|sn\b", low):
            m = re.search(r"[:\s]([0-9A-Za-z]{8,})\s*$", line)
            if m:
                d["serial_number"] = m.group(1)
        elif d["model"] is None and low.startswith("type"):
            d["model"] = _kv_value(line)
        elif d["name"] is None and low.startswith("name"):
            d["name"] = _kv_value(line)

    # history table: keep the most recent (last) row
    for raw in hist_lines:
        cols = re.split(r"\s{2,}", raw.strip())
        cols = [c for c in cols if c]
        if len(cols) >= 3 and cols[0].isdigit():
            authpass = cols[1] if len(cols) > 1 else None
            offline = cols[2] if len(cols) > 2 else None
            cause = cols[3] if len(cols) > 3 else None
            if authpass and not authpass.startswith("0000"):
                d["online_time"] = authpass
            if offline and not offline.startswith("0000"):
                d["offline_time"] = offline
            if cause:
                d["offline_cause"] = cause
    return d


def parse_running_config(text: str) -> Dict[str, Any]:
    cfg = {"name": None, "profile": None, "internet_gemport": None,
           "tr069_gemport": None, "upstream_limit": None, "downstream_limit": None,
           "internet_vlan": None, "tr069_vlan": None, "service_ports": [], "gemports": []}
    tconts: List[Dict[str, Any]] = []
    for raw in (text or "").splitlines():
        line = raw.strip()
        low = line.lower()
        if low.startswith("name "):
            cfg["name"] = line[5:].strip()
        elif low.startswith("tcont "):
            mprof = re.search(r"profile\s+(\S+)", line)
            mname = re.search(r"name\s+(\S+)", line)
            tconts.append({"name": mname.group(1) if mname else None,
                           "profile": mprof.group(1) if mprof else None})
        elif low.startswith("gemport "):
            mg = re.match(r"gemport\s+(\d+)", line)
            up = re.search(r"upstream\s+(\S+)", line)
            dw = re.search(r"downstream\s+(\S+)", line)
            cfg["gemports"].append({
                "id": int(mg.group(1)) if mg else None,
                "upstream": up.group(1) if up else None,
                "downstream": dw.group(1) if dw else None,
            })
        elif low.startswith("service-port"):
            uv = re.search(r"user-vlan\s+(\d+)", line)
            vl = re.search(r"\bvlan\s+(\d+)", line)
            sp = re.match(r"service-port\s+(\d+)", line)
            cfg["service_ports"].append({
                "id": int(sp.group(1)) if sp else None,
                "user_vlan": int(uv.group(1)) if uv else None,
                "vlan": int(vl.group(1)) if vl else None,
            })
    # Internet profile: prefer a tcont whose name hints INET/INTERNET, else first.
    prof = None
    for tc in tconts:
        if tc.get("name") and re.search(r"inet|internet", tc["name"], re.IGNORECASE):
            prof = tc.get("profile")
            break
    if prof is None and tconts:
        prof = tconts[0].get("profile")
    cfg["profile"] = prof
    # Internet gemport = highest downstream; tr069 = the other (heuristic per sample).
    gps = cfg["gemports"]
    if gps:
        def _num(s):
            m = re.search(r"(\d+)", s or "")
            return int(m.group(1)) if m else -1
        inet = max(gps, key=lambda g: _num(g.get("downstream")))
        cfg["internet_gemport"] = inet.get("id")
        cfg["upstream_limit"] = inet.get("upstream")
        cfg["downstream_limit"] = inet.get("downstream")
        others = [g for g in gps if g.get("id") != inet.get("id")]
        if others:
            cfg["tr069_gemport"] = others[0].get("id")
    # VLANs: service-port 1 = internet, service-port 2 = tr069 (per sample).
    sps = sorted(cfg["service_ports"], key=lambda s: s.get("id") or 0)
    if len(sps) >= 1:
        cfg["internet_vlan"] = sps[0].get("vlan")
    if len(sps) >= 2:
        cfg["tr069_vlan"] = sps[1].get("vlan")
    return cfg


def parse_optical(text: str) -> Dict[str, Any]:
    """Parse C320 `show pon power attenuation gpon-onu_X`:
           OLT            ONU           Attenuation
     up    Rx :-26.6(dbm) Tx:2.4(dbm)   29.0(dB)
     down  Tx :10.7(dbm)  Rx:-17.4(dbm) 28.2(dB)
    ONU RX (customer downstream) = 'down' row 2nd value; ONU TX = 'up' row 2nd value.
    """
    res = {"rx_power": None, "tx_power": None, "attenuation": None,
           "olt_rx_power": None, "olt_tx_power": None,
           "attenuation_up": None, "attenuation_down": None}
    for raw in (text or "").splitlines():
        low = raw.strip().lower()
        nums = re.findall(r"-?\d+\.\d+", raw)
        if low.startswith("up") and len(nums) >= 2:
            res["olt_rx_power"] = _f(nums[0])
            res["tx_power"] = _f(nums[1])
            if len(nums) >= 3:
                res["attenuation_up"] = _f(nums[2])
        elif low.startswith("down") and len(nums) >= 2:
            res["olt_tx_power"] = _f(nums[0])
            res["rx_power"] = _f(nums[1])
            if len(nums) >= 3:
                res["attenuation_down"] = _f(nums[2])
    res["attenuation"] = res["attenuation_down"] if res["attenuation_down"] is not None else res["attenuation_up"]
    return res


def _kv_value(line: str) -> Optional[str]:
    if ":" in line:
        return line.split(":", 1)[1].strip() or None
    parts = line.split(None, 1)
    return parts[1].strip() if len(parts) > 1 else None


# --- adapter ------------------------------------------------------------------
class ZTEC320Adapter(BaseOLTAdapter):
    vendor = "ZTE"
    model = "C320"
    protocols = ["telnet"]
    needs_enable = True

    CMD_VERSION = "show version-running"
    CMD_CARD = "show card"
    CMD_ONU_STATE = "show gpon onu state"
    CMD_UNCFG = "show gpon onu uncfg"

    def _detail_cmd(self, onu_index: str) -> str:
        return f"show gpon onu detail-info gpon-onu_{onu_index}"

    def _cfg_cmd(self, onu_index: str) -> str:
        return f"show running-config interface gpon-onu_{onu_index}"

    def _optical_cmd(self, onu_index: str) -> str:
        return f"show pon power attenuation gpon-onu_{onu_index}"

    async def test_connection(self) -> Dict[str, Any]:
        res = await self.t.run_commands([self.CMD_VERSION])
        ver = parse_version(res.get(self.CMD_VERSION, ""))
        return {"ok": True, "message": "Terhubung ke ZTE C320",
                "software_version": ver.get("software_version")}

    async def get_system_info(self) -> Dict[str, Any]:
        res = await self.t.run_commands([self.CMD_VERSION])
        return parse_version(res.get(self.CMD_VERSION, ""))

    async def get_cards(self) -> List[Dict[str, Any]]:
        res = await self.t.run_commands([self.CMD_CARD])
        return parse_cards(res.get(self.CMD_CARD, ""))

    async def get_onu_states(self) -> List[Dict[str, Any]]:
        res = await self.t.run_commands([self.CMD_ONU_STATE])
        return parse_onu_state(res.get(self.CMD_ONU_STATE, ""))

    async def get_unconfigured_onu(self) -> List[Dict[str, Any]]:
        res = await self.t.run_commands([self.CMD_UNCFG])
        return parse_uncfg(res.get(self.CMD_UNCFG, ""))

    async def get_pon_ports(self) -> List[Dict[str, Any]]:
        # Derived from ONU states (grouped by PON) — no dedicated proven command.
        states = await self.get_onu_states()
        pons: Dict[str, Dict[str, Any]] = {}
        for o in states:
            p = o.get("pon")
            if not p:
                continue
            g = pons.setdefault(p, {"pon": p, "total_onu": 0, "online": 0,
                                    "los": 0, "dying_gasp": 0, "offline": 0})
            g["total_onu"] += 1
            st = o.get("status")
            if st == ONU_ONLINE:
                g["online"] += 1
            elif st == ONU_LOS:
                g["los"] += 1
            elif st == ONU_DYING_GASP:
                g["dying_gasp"] += 1
            elif st == ONU_OFFLINE:
                g["offline"] += 1
        return sorted(pons.values(), key=lambda x: x["pon"])

    async def get_onu_inventory(self, onu_index: Optional[str] = None) -> List[Dict[str, Any]]:
        # No proven bulk inventory command -> build from per-ONU detail on demand.
        return []

    async def get_onu_detail(self, onu_index: str) -> Dict[str, Any]:
        cmds = [self._detail_cmd(onu_index), self._cfg_cmd(onu_index), self._optical_cmd(onu_index)]
        res = await self.t.run_commands(cmds)
        detail = parse_detail_info(res.get(cmds[0], ""))
        cfg = parse_running_config(res.get(cmds[1], ""))
        opt = parse_optical(res.get(cmds[2], ""))
        pon, onu_id, index = _parse_index(f"gpon-onu_{onu_index}")
        return normalized_onu(
            olt_id=self.device.get("id"), pon=pon, onu_id=onu_id, onu_index=index or onu_index,
            name=cfg.get("name") or detail.get("name"), model=detail.get("model"),
            serial_number=detail.get("serial_number"), status=None,
            rx_power=opt.get("rx_power") if opt.get("rx_power") is not None else detail.get("rx_power"),
            tx_power=opt.get("tx_power") if opt.get("tx_power") is not None else detail.get("tx_power"),
            attenuation=opt.get("attenuation") if opt.get("attenuation") is not None else detail.get("attenuation"),
            distance=detail.get("distance"),
            uptime=detail.get("uptime"), profile=cfg.get("profile"),
            upstream_limit=cfg.get("upstream_limit"), downstream_limit=cfg.get("downstream_limit"),
            internet_vlan=cfg.get("internet_vlan"), tr069_vlan=cfg.get("tr069_vlan"),
            last_seen=None,
        ) | {
            "online_time": detail.get("online_time"),
            "offline_time": detail.get("offline_time"),
            "offline_cause": detail.get("offline_cause"),
            "olt_rx_power": opt.get("olt_rx_power"), "olt_tx_power": opt.get("olt_tx_power"),
            "internet_gemport": cfg.get("internet_gemport"),
            "tr069_gemport": cfg.get("tr069_gemport"),
            "gemports": cfg.get("gemports"),
            "service_ports": cfg.get("service_ports"),
        }

    async def get_onu_optical(self, onu_index: str) -> Dict[str, Any]:
        cmd = self._optical_cmd(onu_index)
        res = await self.t.run_commands([cmd])
        return parse_optical(res.get(cmd, ""))

    async def get_onu_running_config(self, onu_index: str) -> Dict[str, Any]:
        cmd = self._cfg_cmd(onu_index)
        res = await self.t.run_commands([cmd])
        return parse_running_config(res.get(cmd, ""))

    async def get_alarm_summary(self) -> Any:
        # Not part of the proven read-only command set yet.
        return UNSUPPORTED

    # --- provisioning (write) -------------------------------------------------
    supports_provisioning = True

    async def _exec(self, lines: List[str], dry_run: bool) -> Dict[str, Any]:
        lines = [ln for ln in lines if ln is not None and str(ln).strip() != ""]
        if dry_run:
            return {"ok": True, "dry_run": True, "commands": lines, "output": "", "error": None}
        runner = getattr(self.t, "run_script", None)
        if runner is not None:
            output = await runner(lines)
        else:  # fallback
            res = await self.t.run_commands(lines)
            output = "\n".join(f"{c}\n{res.get(c, '')}" for c in lines)
        err = find_cli_error(output)
        return {"ok": err is None, "dry_run": False, "commands": lines, "output": output, "error": err}

    def _authorize_lines(self, p: Dict[str, Any]) -> List[str]:
        """Build the ZTE C320 GPON ONU authorize sequence.

        If ``command_template`` is provided (from a Provisioning Profile) it is
        rendered with the given variables and used verbatim — giving operators
        full control over site-specific CLI. Otherwise a standard sequence is
        generated from the individual fields.
        """
        pon = str(p.get("pon") or "").strip()
        onuid = str(p.get("onu_id") or "").strip()
        sn = str(p.get("sn") or "").strip()
        name = str(p.get("name") or "").strip()
        vlan = str(p.get("vlan") or "").strip()
        onu_type = str(p.get("onu_type") or "").strip()
        tcont_profile = str(p.get("tcont_profile") or "").strip()
        srv_profile = str(p.get("service_profile") or "").strip()

        tmpl = p.get("command_template")
        if tmpl and str(tmpl).strip():
            variables = {
                "pon": pon, "onuid": onuid, "onu_id": onuid, "sn": sn, "name": name,
                "vlan": vlan, "onu_type": onu_type, "type": onu_type,
                "tcont_profile": tcont_profile, "service_profile": srv_profile,
                **{k: str(v) for k, v in (p.get("extra_vars") or {}).items()},
            }
            rendered = str(tmpl)
            for k, v in variables.items():
                rendered = rendered.replace("{" + k + "}", v)
            return [ln.strip() for ln in rendered.splitlines() if ln.strip()]

        # ---- builtin standard sequence ----
        lines: List[str] = ["configure terminal", f"interface gpon-olt_{pon}"]
        reg = f"onu {onuid} type {onu_type} sn {sn}" if onu_type else f"onu {onuid} sn {sn}"
        lines += [reg, "exit", f"interface gpon-onu_{pon}:{onuid}"]
        if name:
            lines.append(f"name {name}")
        if tcont_profile:
            lines += [f"tcont 1 name TCONT1 profile {tcont_profile}", "gemport 1 tcont 1"]
        if vlan:
            lines.append(f"service-port 1 vport 1 user-vlan {vlan} vlan {vlan}")
        lines += ["exit", "end"]
        return lines

    async def provision_authorize(self, params: Dict[str, Any]) -> Dict[str, Any]:
        lines = self._authorize_lines(params)
        return await self._exec(lines, bool(params.get("dry_run")))

    async def provision_delete_onu(self, onu_index: str, dry_run: bool = False) -> Dict[str, Any]:
        pon, onuid, _ = _parse_index(f"gpon-onu_{onu_index}")
        if not pon or not onuid:
            return {"ok": False, "commands": [], "output": "", "error": f"ONU index tidak valid: {onu_index}"}
        lines = ["configure terminal", f"interface gpon-olt_{pon}", f"no onu {onuid}", "exit", "end"]
        return await self._exec(lines, dry_run)

    async def provision_reboot_onu(self, onu_index: str, dry_run: bool = False) -> Dict[str, Any]:
        pon, onuid, _ = _parse_index(f"gpon-onu_{onu_index}")
        if not pon or not onuid:
            return {"ok": False, "commands": [], "output": "", "error": f"ONU index tidak valid: {onu_index}"}
        lines = ["configure terminal", f"pon-onu-mng gpon-onu_{pon}:{onuid}", "reboot", "exit", "end"]
        return await self._exec(lines, dry_run)

    async def provision_set_name(self, onu_index: str, name: str, dry_run: bool = False) -> Dict[str, Any]:
        pon, onuid, _ = _parse_index(f"gpon-onu_{onu_index}")
        if not pon or not onuid:
            return {"ok": False, "commands": [], "output": "", "error": f"ONU index tidak valid: {onu_index}"}
        lines = ["configure terminal", f"interface gpon-onu_{pon}:{onuid}", f"name {name}", "exit", "end"]
        return await self._exec(lines, dry_run)
