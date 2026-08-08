"""
Backend regression + new feature tests for Portal Support Artamedia.
Covers: device-templates engine, Zabbix integration, extended Device schema, and
existing endpoints regression.
"""
import io
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback to reading /app/frontend/.env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break

API = f"{BASE_URL}/api"
ADMIN_EMAIL = "admin@noc.local"
ADMIN_PASS = "Admin@123"


# ----------------------------- Fixtures --------------------------------------
@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    tok = data.get("token") or data.get("access_token")
    assert tok, f"no token in response: {data}"
    return tok


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="session")
def templates(admin_headers):
    r = requests.get(f"{API}/device-templates", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    return r.json().get("items", [])


# --------------------------- Health & regression -----------------------------
class TestRegression:
    def test_health(self):
        r = requests.get(f"{API}/health", timeout=10)
        assert r.status_code == 200

    def test_dashboard_stats(self, admin_headers):
        r = requests.get(f"{API}/dashboard/stats", headers=admin_headers, timeout=15)
        assert r.status_code == 200

    def test_racks(self, admin_headers):
        r = requests.get(f"{API}/racks", headers=admin_headers, timeout=15)
        assert r.status_code == 200

    def test_devices(self, admin_headers):
        r = requests.get(f"{API}/devices", headers=admin_headers, timeout=15)
        assert r.status_code == 200

    def test_interconnections(self, admin_headers):
        r = requests.get(f"{API}/interconnections", headers=admin_headers, timeout=15)
        assert r.status_code == 200

    def test_mikrotik_routers(self, admin_headers):
        # Actual endpoint is /api/network/routers (not /network/mikrotik/routers)
        r = requests.get(f"{API}/network/routers", headers=admin_headers, timeout=15)
        assert r.status_code == 200


# --------------------------- Device Templates --------------------------------
EXPECTED_TEMPLATES = {
    # Actual seeded port counts as implemented in device_templates.py
    ("Huawei", "CE6870-24S6CQ-EI"): 27,
    ("MikroTik", "CCR1036-8G-2S+"): 11,
    ("MikroTik", "CCR2004-1G-12S+2XS"): 16,
    ("MikroTik", "CRS326-24S+2Q+RM"): 28,
    ("MikroTik", "CRS354-48G-4S+2Q+"): 56,
}


class TestDeviceTemplates:
    def test_list_seeded_templates(self, templates):
        assert len(templates) >= 5, f"expected >=5 seeded templates, got {len(templates)}"
        by_key = {(t["vendor"], t["model"]): t for t in templates}
        missing = [k for k in EXPECTED_TEMPLATES if k not in by_key]
        assert not missing, f"missing seeded templates: {missing}"

    def test_seeded_port_counts(self, templates):
        by_key = {(t["vendor"], t["model"]): t for t in templates}
        mismatches = []
        for key, expected in EXPECTED_TEMPLATES.items():
            actual = len(by_key[key].get("ports", []))
            if actual != expected:
                mismatches.append((key, expected, actual))
        assert not mismatches, f"port count mismatches: {mismatches}"

    def test_get_template_image(self, templates, admin_headers):
        # Pick first template with image_filename
        target = next((t for t in templates if t.get("image_filename")), None)
        assert target, "no template has image_filename"
        r = requests.get(f"{API}/device-templates/{target['id']}/image", timeout=15)
        assert r.status_code == 200, f"expected 200, got {r.status_code}"
        assert r.headers.get("content-type", "").startswith("image/png")
        assert len(r.content) > 100

    def test_image_public_no_auth(self, templates):
        target = next((t for t in templates if t.get("image_filename")), None)
        assert target
        # Explicitly no auth header
        r = requests.get(f"{API}/device-templates/{target['id']}/image", timeout=15)
        assert r.status_code == 200

    def test_get_single_template(self, templates, admin_headers):
        tid = templates[0]["id"]
        r = requests.get(f"{API}/device-templates/{tid}", headers=admin_headers, timeout=10)
        assert r.status_code == 200
        assert r.json()["id"] == tid

    def test_resolve_by_device(self, admin_headers):
        # find MT-CORE-BALI-01
        r = requests.get(f"{API}/devices", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        devices = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
        dev = next((d for d in devices
                    if d.get("hostname") == "MT-CORE-BALI-01"
                    or d.get("name") == "MT-CORE-BALI-01"), None)
        if not dev:
            # fallback: any device with model containing CRS354
            dev = next((d for d in devices
                        if "CRS354" in (d.get("model") or "")), None)
        assert dev, f"MT-CORE-BALI-01 not found among {len(devices)} devices"
        r = requests.get(f"{API}/device-templates/resolve/{dev['id']}",
                         headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        payload = r.json()
        assert payload.get("template"), f"no template resolved: {payload}"
        assert "CRS354" in payload["template"]["model"], \
            f"expected CRS354 model, got {payload['template']['model']}"

    def test_admin_crud_full_lifecycle(self, admin_headers):
        # Create
        create_body = {
            "vendor": "TEST_VENDOR",
            "model": "TEST_MODEL_1",
            "description": "TEST unit template",
            "height_u": 1,
            "ports": [
                {"id": "p1", "label": "1", "type": "RJ45",
                 "x": 10.0, "y": 20.0, "width": 5.0, "height": 30.0},
            ],
            "match_patterns": ["TEST_MODEL_1"],
        }
        r = requests.post(f"{API}/device-templates", json=create_body,
                          headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        tid = r.json()["id"]

        try:
            # Upload PNG (1x1 valid PNG)
            png_bytes = (
                b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
                b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
                b"\x00\x00\x00\rIDATx\x9cc\xf8\xcf\xc0\x00\x00\x00\x03"
                b"\x00\x01\xd3\x10\x0b\xb5\x00\x00\x00\x00IEND\xaeB`\x82"
            )
            files = {"file": ("test.png", png_bytes, "image/png")}
            r = requests.post(f"{API}/device-templates/{tid}/image",
                              files=files, headers=admin_headers, timeout=15)
            assert r.status_code == 200, r.text
            assert r.json().get("ok") is True

            # Verify image serves
            r = requests.get(f"{API}/device-templates/{tid}/image", timeout=15)
            assert r.status_code == 200
            assert r.headers.get("content-type", "").startswith("image/png")

            # Update with new port
            update_body = dict(create_body)
            update_body["ports"] = create_body["ports"] + [
                {"id": "p2", "label": "2", "type": "SFP+",
                 "x": 30.0, "y": 40.0, "width": 6.0, "height": 25.0}
            ]
            r = requests.put(f"{API}/device-templates/{tid}", json=update_body,
                             headers=admin_headers, timeout=15)
            assert r.status_code == 200, r.text
            assert len(r.json()["ports"]) == 2
        finally:
            r = requests.delete(f"{API}/device-templates/{tid}",
                                headers=admin_headers, timeout=15)
            assert r.status_code == 200

        # Verify deletion
        r = requests.get(f"{API}/device-templates/{tid}",
                         headers=admin_headers, timeout=15)
        assert r.status_code == 404

    def test_unauth_cannot_write(self):
        # No auth header at all should be blocked from create
        r = requests.post(f"{API}/device-templates",
                         json={"vendor": "X", "model": "Y"}, timeout=10)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"


# --------------------------- Zabbix Integration ------------------------------
class TestZabbix:
    def test_get_config_configured(self, admin_headers):
        r = requests.get(f"{API}/zabbix/config", headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("configured") is True, f"expected configured=true, got {data}"
        assert data.get("url"), "url should be set"

    def test_put_config_preserves_token_when_blank(self, admin_headers):
        # First fetch current
        r = requests.get(f"{API}/zabbix/config", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        cur = r.json()

        payload = {
            "url": cur["url"],
            "api_token": "",  # empty → preserve
            "verify_ssl": cur.get("verify_ssl", True),
            "timeout": cur.get("timeout", 15),
        }
        r = requests.put(f"{API}/zabbix/config", json=payload,
                         headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("configured") is True, "token should have been preserved"

    def test_test_connection(self, admin_headers):
        r = requests.post(f"{API}/zabbix/test-connection",
                          headers=admin_headers, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("ok") is True, f"connection failed: {data}"
        assert data.get("version"), f"no version returned: {data}"
        # Accept any 7.x version
        assert str(data["version"]).startswith("7."), \
            f"expected 7.x, got {data['version']}"

    def test_hosts_list(self, admin_headers):
        r = requests.get(f"{API}/zabbix/hosts", headers=admin_headers, timeout=60)
        assert r.status_code == 200, r.text
        items = r.json().get("items", [])
        assert len(items) >= 1, "expected at least 1 zabbix host"

    def test_device_graphs(self, admin_headers):
        # find MT-CORE-BALI-01
        r = requests.get(f"{API}/devices", headers=admin_headers, timeout=15)
        devices = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
        dev = next((d for d in devices
                    if d.get("hostname") == "MT-CORE-BALI-01"
                    or d.get("name") == "MT-CORE-BALI-01"
                    or (d.get("zabbix_host") == "Core1.Bali.Artamedia")), None)
        assert dev, "MT-CORE-BALI-01 not found"

        r = requests.get(f"{API}/zabbix/device/{dev['id']}/graphs",
                         params={"range": "24h"},
                         headers=admin_headers, timeout=120)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("configured") is True
        assert data.get("matched") is True, f"host not matched: {data}"
        cats = data.get("categories", {})
        # Verify presence of expected categories
        wanted = ["cpu", "memory", "temperature", "availability", "rx", "tx"]
        found = [c for c in wanted if c in cats and cats[c]]
        assert len(found) >= 4, f"missing categories, only found: {found} / {list(cats.keys())}"
        # Confirm datapoints exist in at least one series
        total_points = 0
        for cat, series_list in cats.items():
            for s in series_list:
                total_points += len(s.get("points") or [])
        assert total_points > 0, "no datapoints returned across any series"


# --------------------------- Device Schema Extensions -----------------------
class TestDeviceSchemaExtensions:
    def test_create_device_with_new_fields(self, admin_headers):
        # Grab a rack first (device requires rack_id likely)
        r = requests.get(f"{API}/racks", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        racks = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
        rack_id = racks[0]["id"] if racks else None

        body = {
            "name": "TEST_DEV_EXT_1",
            "hostname": "TEST_DEV_EXT_1",
            "brand": "MikroTik",
            "model": "CRS354-48G-4S+2Q+",
            "monitoring_source": "zabbix",
            "snmp_version": "v2c",
            "snmp_port": 161,
            "zabbix_host": "TEST_HOST",
            "device_role": "Core",
            "ru_position": 3,
        }
        if rack_id:
            body["rack_id"] = rack_id

        r = requests.post(f"{API}/devices", json=body,
                          headers=admin_headers, timeout=15)
        # Accept 200 or 201
        assert r.status_code in (200, 201), r.text
        dev = r.json()
        did = dev["id"]

        try:
            # GET back and verify fields
            r = requests.get(f"{API}/devices/{did}", headers=admin_headers, timeout=15)
            assert r.status_code == 200
            data = r.json()
            assert data.get("monitoring_source") == "zabbix"
            assert data.get("snmp_version") == "v2c"
            assert data.get("snmp_port") == 161
            assert data.get("zabbix_host") == "TEST_HOST"
            assert data.get("device_role") == "Core"
            assert data.get("ru_position") == 3
        finally:
            requests.delete(f"{API}/devices/{did}",
                            headers=admin_headers, timeout=15)
