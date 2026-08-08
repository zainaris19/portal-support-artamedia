#!/usr/bin/env python3
"""
GenieACS Integration Bug Fix Verification Test
Tests that GET /api/genieacs/devices/{id} returns scalar values for scalar fields,
not raw GenieACS node dicts like {"_object": false, "_writable": false}.
"""
import sys
import requests
from urllib.parse import quote
from typing import Any, List, Dict, Tuple

# Configuration
BASE_URL = "https://portal-support-dev.preview.emergentagent.com"
API_BASE = f"{BASE_URL}/api"
LOGIN_EMAIL = "admin@noc.local"
LOGIN_PASSWORD = "Admin@123"

# Scalar fields that MUST NOT be dict/array
SCALAR_FIELDS = [
    "model", "manufacturer", "product_class", "serial", 
    "hardware_version", "software_version", "wan_ip", "mgmt_ip", 
    "pppoe_username", "connection_type", "vlan", "pon_mode", "ssid"
]

# Fields in nested arrays that must be scalar
WLAN_SCALAR_FIELDS = ["ssid", "channel"]
LAN_CLIENT_SCALAR_FIELDS = ["hostname", "ip", "mac"]


def login() -> str:
    """Login and return JWT token."""
    print(f"🔐 Logging in as {LOGIN_EMAIL}...")
    resp = requests.post(
        f"{API_BASE}/auth/login",
        json={"email": LOGIN_EMAIL, "password": LOGIN_PASSWORD},
        timeout=30
    )
    if resp.status_code != 200:
        print(f"❌ Login failed: HTTP {resp.status_code}")
        print(f"Response: {resp.text}")
        sys.exit(1)
    
    data = resp.json()
    token = data.get("token")
    if not token:
        print(f"❌ No token in login response: {data}")
        sys.exit(1)
    
    print(f"✅ Login successful, token received")
    return token


def get_headers(token: str) -> Dict[str, str]:
    """Return headers with authorization."""
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }


def check_scalar_field(value: Any, field_name: str, device_id: str, failures: List[str]) -> None:
    """Check if a value is scalar (not dict/array). Record failure if not."""
    if isinstance(value, dict):
        failures.append(f"  ❌ Device {device_id}: field '{field_name}' is a dict: {value}")
    elif isinstance(value, list):
        failures.append(f"  ❌ Device {device_id}: field '{field_name}' is an array: {value}")


def verify_device_detail(device_id: str, token: str, refresh: bool = False) -> Tuple[bool, List[str]]:
    """
    Verify a single device detail response.
    Returns (success, list_of_failures).
    """
    failures = []
    
    # URL-encode the device_id
    encoded_id = quote(device_id, safe='')
    url = f"{API_BASE}/genieacs/devices/{encoded_id}"
    if refresh:
        url += "?refresh=true"
    
    try:
        resp = requests.get(url, headers=get_headers(token), timeout=60)
        
        if resp.status_code != 200:
            failures.append(f"  ❌ Device {device_id}: HTTP {resp.status_code} - {resp.text[:200]}")
            return False, failures
        
        detail = resp.json()
        
        # Check top-level scalar fields
        for field in SCALAR_FIELDS:
            if field in detail:
                check_scalar_field(detail[field], field, device_id, failures)
        
        # Check wlan array items
        wlan = detail.get("wlan", [])
        if isinstance(wlan, list):
            for idx, wlan_item in enumerate(wlan):
                if isinstance(wlan_item, dict):
                    for field in WLAN_SCALAR_FIELDS:
                        if field in wlan_item:
                            check_scalar_field(
                                wlan_item[field], 
                                f"wlan[{idx}].{field}", 
                                device_id, 
                                failures
                            )
        
        # Check lan_clients array items
        lan_clients = detail.get("lan_clients", [])
        if isinstance(lan_clients, list):
            for idx, client in enumerate(lan_clients):
                if isinstance(client, dict):
                    for field in LAN_CLIENT_SCALAR_FIELDS:
                        if field in client:
                            check_scalar_field(
                                client[field], 
                                f"lan_clients[{idx}].{field}", 
                                device_id, 
                                failures
                            )
        
        return len(failures) == 0, failures
    
    except Exception as e:
        failures.append(f"  ❌ Device {device_id}: Exception - {str(e)}")
        return False, failures


def test_genieacs_integration():
    """Main test function."""
    print("=" * 80)
    print("GenieACS Integration Bug Fix Verification")
    print("=" * 80)
    print()
    
    # Step 1: Login
    token = login()
    print()
    
    # Step 2: Get device list
    print("📋 Fetching device list (limit=100)...")
    resp = requests.get(
        f"{API_BASE}/genieacs/devices?limit=100",
        headers=get_headers(token),
        timeout=60
    )
    
    if resp.status_code != 200:
        print(f"❌ Failed to get device list: HTTP {resp.status_code}")
        print(f"Response: {resp.text}")
        sys.exit(1)
    
    data = resp.json()
    
    # Check connected status
    if not data.get("connected"):
        print(f"❌ GenieACS not connected: {data.get('error')}")
        sys.exit(1)
    
    print(f"✅ GenieACS connected, received device list")
    
    items = data.get("items", [])
    device_ids = [item["id"] for item in items if "id" in item]
    
    print(f"📊 Found {len(device_ids)} devices to test")
    print()
    
    if not device_ids:
        print("⚠️  No devices found in GenieACS. Cannot test device detail endpoint.")
        print("   This might be expected if GenieACS has no devices configured.")
        sys.exit(0)
    
    # Step 3: Test each device detail
    print("🔍 Testing device detail endpoints...")
    print()
    
    all_failures = []
    success_count = 0
    
    for idx, device_id in enumerate(device_ids, 1):
        print(f"  [{idx}/{len(device_ids)}] Testing device: {device_id}")
        success, failures = verify_device_detail(device_id, token)
        
        if success:
            success_count += 1
            print(f"      ✅ PASS - All scalar fields are valid")
        else:
            print(f"      ❌ FAIL - Found {len(failures)} issue(s)")
            all_failures.extend(failures)
    
    print()
    
    # Step 4: Test with refresh=true on one device
    if device_ids:
        print("🔄 Testing with refresh=true on first device...")
        test_device = device_ids[0]
        print(f"  Testing device: {test_device}")
        success, failures = verify_device_detail(test_device, token, refresh=True)
        
        if success:
            print(f"  ✅ PASS - Refresh test successful")
        else:
            print(f"  ❌ FAIL - Refresh test failed")
            all_failures.extend(failures)
        print()
    
    # Step 5: Sanity check summary endpoint
    print("📊 Sanity check: GET /api/genieacs/summary...")
    resp = requests.get(
        f"{API_BASE}/genieacs/summary",
        headers=get_headers(token),
        timeout=30
    )
    
    if resp.status_code == 200:
        print(f"  ✅ Summary endpoint: HTTP 200")
    else:
        print(f"  ❌ Summary endpoint: HTTP {resp.status_code}")
        all_failures.append(f"Summary endpoint failed: HTTP {resp.status_code}")
    
    print()
    
    # Step 6: Sanity check devices list with limit=5
    print("📋 Sanity check: GET /api/genieacs/devices?limit=5...")
    resp = requests.get(
        f"{API_BASE}/genieacs/devices?limit=5",
        headers=get_headers(token),
        timeout=30
    )
    
    if resp.status_code == 200:
        print(f"  ✅ Devices list endpoint: HTTP 200")
    else:
        print(f"  ❌ Devices list endpoint: HTTP {resp.status_code}")
        all_failures.append(f"Devices list endpoint failed: HTTP {resp.status_code}")
    
    print()
    print("=" * 80)
    print("TEST RESULTS")
    print("=" * 80)
    print()
    
    if all_failures:
        print(f"❌ FAIL - Found {len(all_failures)} issue(s):")
        print()
        for failure in all_failures:
            print(failure)
        print()
        print(f"Summary: {success_count}/{len(device_ids)} devices passed")
        sys.exit(1)
    else:
        print(f"✅ PASS - All tests successful!")
        print()
        print(f"  • Tested {len(device_ids)} devices")
        print(f"  • All scalar fields are valid (no dict/array leaks)")
        print(f"  • Refresh test passed")
        print(f"  • Summary endpoint working")
        print(f"  • Devices list endpoint working")
        print()
        print("🎉 Bug fix verified: GenieACS device detail endpoint returns proper scalar values")
        sys.exit(0)


if __name__ == "__main__":
    test_genieacs_integration()
