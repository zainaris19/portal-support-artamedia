#!/usr/bin/env python3
"""
Quick sample test of GenieACS device detail endpoint.
Tests first 10 devices to verify scalar fields are not dicts/arrays.
"""
import sys
import requests
from urllib.parse import quote

BASE_URL = "https://portal-support-dev.preview.emergentagent.com"
API_BASE = f"{BASE_URL}/api"
LOGIN_EMAIL = "admin@noc.local"
LOGIN_PASSWORD = "Admin@123"

SCALAR_FIELDS = [
    "model", "manufacturer", "product_class", "serial", 
    "hardware_version", "software_version", "wan_ip", "mgmt_ip", 
    "pppoe_username", "connection_type", "vlan", "pon_mode", "ssid"
]

def login():
    resp = requests.post(f"{API_BASE}/auth/login", 
                        json={"email": LOGIN_EMAIL, "password": LOGIN_PASSWORD}, 
                        timeout=30)
    return resp.json()["token"]

def test_sample():
    print("=" * 80)
    print("GenieACS Bug Fix - Sample Test (First 10 Devices)")
    print("=" * 80)
    print()
    
    token = login()
    print("✅ Logged in")
    
    # Get devices
    resp = requests.get(f"{API_BASE}/genieacs/devices?limit=10",
                       headers={"Authorization": f"Bearer {token}"}, timeout=30)
    data = resp.json()
    
    if not data.get("connected"):
        print(f"❌ GenieACS not connected: {data.get('error')}")
        return False
    
    device_ids = [item["id"] for item in data.get("items", [])]
    print(f"📊 Testing {len(device_ids)} devices\n")
    
    failures = []
    
    for idx, device_id in enumerate(device_ids, 1):
        encoded_id = quote(device_id, safe='')
        url = f"{API_BASE}/genieacs/devices/{encoded_id}"
        
        print(f"[{idx}/{len(device_ids)}] {device_id}")
        
        try:
            resp = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=30)
            
            if resp.status_code != 200:
                print(f"    ⚠️  HTTP {resp.status_code}")
                continue
            
            detail = resp.json()
            device_failures = []
            
            # Check scalar fields
            for field in SCALAR_FIELDS:
                if field in detail:
                    value = detail[field]
                    if isinstance(value, dict):
                        device_failures.append(f"      ❌ {field} is dict: {value}")
                    elif isinstance(value, list):
                        device_failures.append(f"      ❌ {field} is array: {value}")
            
            # Check wlan items
            for wlan_idx, wlan in enumerate(detail.get("wlan", [])):
                if isinstance(wlan, dict):
                    for field in ["ssid", "channel"]:
                        if field in wlan:
                            value = wlan[field]
                            if isinstance(value, (dict, list)):
                                device_failures.append(f"      ❌ wlan[{wlan_idx}].{field} is {type(value).__name__}: {value}")
            
            # Check lan_clients items
            for client_idx, client in enumerate(detail.get("lan_clients", [])):
                if isinstance(client, dict):
                    for field in ["hostname", "ip", "mac"]:
                        if field in client:
                            value = client[field]
                            if isinstance(value, (dict, list)):
                                device_failures.append(f"      ❌ lan_clients[{client_idx}].{field} is {type(value).__name__}: {value}")
            
            if device_failures:
                print(f"    ❌ FAIL - {len(device_failures)} issue(s):")
                for f in device_failures:
                    print(f)
                failures.extend(device_failures)
            else:
                # Show sample values
                print(f"    ✅ PASS")
                print(f"       model: {detail.get('model')}")
                print(f"       serial: {detail.get('serial')}")
                print(f"       ssid: {detail.get('ssid')}")
        
        except Exception as e:
            print(f"    ⚠️  Exception: {str(e)[:100]}")
    
    print()
    print("=" * 80)
    
    if failures:
        print(f"❌ FAIL - Found {len(failures)} scalar field violations")
        for f in failures:
            print(f)
        return False
    else:
        print("✅ PASS - All scalar fields are valid (no dict/array leaks)")
        print("🎉 Bug fix verified!")
        return True

if __name__ == "__main__":
    success = test_sample()
    sys.exit(0 if success else 1)
