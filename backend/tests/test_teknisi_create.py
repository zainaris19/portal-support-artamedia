"""Test creating a user with role=teknisi via admin and verifying RBAC."""
import os
import time
import requests
import pytest

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://portal-support.preview.emergentagent.com').rstrip('/')
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": "admin@noc.local", "password": "Admin@123"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def created_teknisi(admin_token):
    ts = int(time.time())
    email = f"test_teknisi_{ts}@noc.local"
    password = "Teknisi@123"
    payload = {"email": email, "password": password, "name": "TEST Teknisi Lapangan", "role": "teknisi"}
    r = requests.post(f"{API}/users", json=payload, headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code in (200, 201), f"create failed: {r.status_code} {r.text}"
    data = r.json()
    assert data["role"] == "teknisi"
    assert data["email"] == email
    yield {"email": email, "password": password, "id": data.get("id")}
    # cleanup
    if data.get("id"):
        requests.delete(f"{API}/users/{data['id']}", headers={"Authorization": f"Bearer {admin_token}"})


def test_admin_login_and_list_users(admin_token):
    r = requests.get(f"{API}/users", headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_create_teknisi_persists(admin_token, created_teknisi):
    r = requests.get(f"{API}/users", headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    matches = [u for u in r.json() if u["email"] == created_teknisi["email"]]
    assert len(matches) == 1
    assert matches[0]["role"] == "teknisi"


def test_new_teknisi_can_login(created_teknisi):
    r = requests.post(f"{API}/auth/login", json={"email": created_teknisi["email"], "password": created_teknisi["password"]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user"]["role"] == "teknisi"


def test_new_teknisi_rbac_blocked_from_users(created_teknisi):
    r = requests.post(f"{API}/auth/login", json={"email": created_teknisi["email"], "password": created_teknisi["password"]})
    tok = r.json()["token"]
    r2 = requests.get(f"{API}/users", headers={"Authorization": f"Bearer {tok}"})
    assert r2.status_code == 403


def test_new_teknisi_can_access_crm(created_teknisi):
    r = requests.post(f"{API}/auth/login", json={"email": created_teknisi["email"], "password": created_teknisi["password"]})
    tok = r.json()["token"]
    r2 = requests.get(f"{API}/crm/tickets", headers={"Authorization": f"Bearer {tok}"})
    assert r2.status_code == 200
