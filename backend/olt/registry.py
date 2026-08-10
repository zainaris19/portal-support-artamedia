"""Adapter registry + vendor/model metadata catalog.

Adding a new vendor later = (1) write adapter, (2) register it here, (3) flip
`implemented=True` in the catalog. No frontend rewrite required.
"""
from __future__ import annotations
from typing import Dict, Optional, Type

from .base import BaseOLTAdapter
from .vendors.zte.c320 import ZTEC320Adapter
from .vendors.vsol.v1600g0b import VsolV1600G0BAdapter

# Registry keyed by "vendor:model" (lowercased)
ADAPTERS: Dict[str, Type[BaseOLTAdapter]] = {
    "zte:c320": ZTEC320Adapter,
    "vsol:v1600g0-b": VsolV1600G0BAdapter,
}

# Public catalog the frontend uses to build the Add-OLT vendor/model pickers.
# `implemented=False` => show as "Coming Soon / Adapter Not Installed".
VENDOR_CATALOG = [
    {
        "vendor": "ZTE",
        "models": [
            {"model": "C320", "implemented": True, "software_tested": "V2.1.0",
             "protocols": ["telnet"], "needs_enable": True, "tech": "GPON"},
        ],
    },
    {
        "vendor": "VSOL",
        "models": [
            {"model": "V1600G0-B", "implemented": True, "software_tested": "V1.4.6R",
             "protocols": ["ssh"], "needs_enable": True, "tech": "GPON"},
        ],
    },
    {
        "vendor": "HIOSO",
        "models": [
            {"model": "EPON", "implemented": False, "protocols": ["telnet"],
             "needs_enable": False, "tech": "EPON"},
        ],
    },
    {
        "vendor": "BDCOM",
        "models": [
            {"model": "GPON", "implemented": False, "protocols": ["telnet", "ssh"],
             "needs_enable": True, "tech": "GPON"},
        ],
    },
]


def _key(vendor: str, model: str) -> str:
    return f"{(vendor or '').strip().lower()}:{(model or '').strip().lower()}"


def get_adapter_class(vendor: str, model: str) -> Optional[Type[BaseOLTAdapter]]:
    return ADAPTERS.get(_key(vendor, model))


def is_implemented(vendor: str, model: str) -> bool:
    return _key(vendor, model) in ADAPTERS


def supports_provisioning(vendor: str, model: str) -> bool:
    cls = ADAPTERS.get(_key(vendor, model))
    return bool(getattr(cls, "supports_provisioning", False)) if cls else False


def model_meta(vendor: str, model: str) -> Optional[dict]:
    for v in VENDOR_CATALOG:
        if v["vendor"].lower() == (vendor or "").lower():
            for m in v["models"]:
                if m["model"].lower() == (model or "").lower():
                    return {**m, "vendor": v["vendor"]}
    return None


def register_adapter(vendor: str, model: str, adapter_cls: Type[BaseOLTAdapter]) -> None:
    ADAPTERS[_key(vendor, model)] = adapter_cls
