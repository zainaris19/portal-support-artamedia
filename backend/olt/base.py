"""Generic, vendor-agnostic OLT adapter interface + normalized data model.

Every vendor/model adapter subclasses :class:`BaseOLTAdapter` and overrides ONLY
the capabilities it supports. Unsupported capabilities return the ``UNSUPPORTED``
sentinel (or ``None``) so the frontend never breaks.

The frontend NEVER sees vendor CLI. Adapters translate raw CLI -> normalized JSON.
"""
from __future__ import annotations
from typing import Any, Dict, List, Optional

# --- Normalized ONU status vocabulary (kept distinct on purpose for NOC) ------
ONU_ONLINE = "ONLINE"
ONU_LOS = "LOS"
ONU_DYING_GASP = "DYING_GASP"
ONU_OFFLINE = "OFFLINE"
ONU_UNKNOWN = "UNKNOWN"
ONU_STATUSES = [ONU_ONLINE, ONU_LOS, ONU_DYING_GASP, ONU_OFFLINE, ONU_UNKNOWN]


class _Unsupported:
    """Sentinel returned by adapters for capabilities they do not implement."""
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __bool__(self):
        return False

    def __repr__(self):
        return "UNSUPPORTED"


UNSUPPORTED = _Unsupported()


def is_unsupported(value: Any) -> bool:
    return value is UNSUPPORTED


# --- Normalized schema helpers ------------------------------------------------
def normalized_olt(**kw) -> Dict[str, Any]:
    keys = [
        "id", "name", "vendor", "model", "location_id", "host", "protocol",
        "software_version", "status", "total_pon", "total_onu", "online_onu",
        "los_onu", "dying_gasp_onu", "offline_onu", "unconfigured_onu", "last_poll",
    ]
    return {k: kw.get(k) for k in keys}


def normalized_onu(**kw) -> Dict[str, Any]:
    keys = [
        "olt_id", "pon", "onu_id", "onu_index", "name", "model", "serial_number",
        "status", "rx_power", "tx_power", "attenuation", "distance", "uptime",
        "profile", "upstream_limit", "downstream_limit", "internet_vlan",
        "tr069_vlan", "last_seen",
    ]
    return {k: kw.get(k) for k in keys}


class BaseOLTAdapter:
    """Abstract base. Subclasses receive a `transport` (already-connected helper)
    and a `device` config dict. Methods are async and MUST be defensive:
    never raise on missing fields — return null/"-"/UNSUPPORTED instead.

    Capability contract (all optional to override):
      test_connection, get_system_info, get_cards, get_pon_ports, get_onu_states,
      get_unconfigured_onu, get_onu_inventory, get_onu_detail, get_onu_optical,
      get_onu_running_config, get_alarm_summary
    """

    vendor: str = "generic"
    model: str = "generic"
    protocols: List[str] = ["telnet", "ssh"]
    needs_enable: bool = False
    supports_provisioning: bool = False

    def __init__(self, transport, device: Dict[str, Any]):
        self.t = transport
        self.device = device or {}

    # ---- lifecycle -----------------------------------------------------------
    async def test_connection(self) -> Dict[str, Any]:
        return {"ok": False, "message": "Adapter tidak mengimplementasikan test_connection"}

    # ---- read-only capabilities (default = unsupported) ----------------------
    async def get_system_info(self) -> Any:
        return UNSUPPORTED

    async def get_cards(self) -> Any:
        return UNSUPPORTED

    async def get_pon_ports(self) -> Any:
        return UNSUPPORTED

    async def get_onu_states(self) -> Any:
        return UNSUPPORTED

    async def get_unconfigured_onu(self) -> Any:
        return UNSUPPORTED

    async def get_onu_inventory(self) -> Any:
        return UNSUPPORTED

    async def get_onu_detail(self, onu_index: str) -> Any:
        return UNSUPPORTED

    async def get_onu_optical(self, onu_index: str) -> Any:
        return UNSUPPORTED

    async def get_onu_running_config(self, onu_index: str) -> Any:
        return UNSUPPORTED

    async def get_alarm_summary(self) -> Any:
        return UNSUPPORTED

    # ---- write / provisioning (default = unsupported) ------------------------
    # Adapters that can push config to the OLT set ``supports_provisioning=True``
    # and override these. Every method MUST return a dict:
    #   {"ok": bool, "commands": [str], "output": str, "error": Optional[str]}
    # or the UNSUPPORTED sentinel. On dry_run they return commands WITHOUT
    # touching the device.
    async def provision_authorize(self, params: Dict[str, Any]) -> Any:
        return UNSUPPORTED

    async def provision_delete_onu(self, onu_index: str, dry_run: bool = False) -> Any:
        return UNSUPPORTED

    async def provision_reboot_onu(self, onu_index: str, dry_run: bool = False) -> Any:
        return UNSUPPORTED

    async def provision_set_name(self, onu_index: str, name: str, dry_run: bool = False) -> Any:
        return UNSUPPORTED
