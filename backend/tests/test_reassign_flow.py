"""Backend tests for CRM Ticket Helpdesk 'Alihkan Troubleshooter' (reassign) flow."""
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://support-portal-169.preview.emergentagent.com').rstrip('/')

CREDS = {
    'admin':      ('admin@noc.local',      'Admin@123'),
    'supervisor': ('supervisor@noc.local', 'Password@123'),
    'engineer':   ('engineer@noc.local',   'Password@123'),
    'teknisi':    ('teknisi@noc.local',    'Teknisi@123'),
    'viewer':     ('viewer@noc.local',     'Viewer@123'),
}

ENGINEER_ID = '18191d42-6b37-4dab-aec2-7e3f75e175a9'
TEKNISI_ID  = 'a6b968d5-408c-4756-97e2-00a6b0aab2d6'
VIEWER_ID   = 'b6ea8dfa-1e36-4362-b2a9-f19d97d73746'
ADMIN_ID    = '0c8b3a89-4379-439e-aaa8-4c568db1dc4e'

FORBIDDEN_MSG = 'Anda tidak memiliki hak untuk mengalihkan tiket ini.'


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={'email': email, 'password': password}, timeout=15)
    if r.status_code != 200:
        return None
    return r.json().get('access_token') or r.json().get('token')


@pytest.fixture(scope='module')
def tokens():
    out = {}
    for k, (e, p) in CREDS.items():
        t = _login(e, p)
        if t:
            out[k] = t
    assert 'admin' in out, 'admin login must succeed'
    return out


def _h(tok):
    return {'Authorization': f'Bearer {tok}', 'Content-Type': 'application/json'}


def _create_ticket(admin_tok, name_suffix=''):
    r = requests.post(
        f"{BASE_URL}/api/crm/tickets",
        headers=_h(admin_tok),
        json={'customer_name': f'TEST_reassign_{name_suffix}', 'description': 'test reassign', 'priority': 'Medium'},
        timeout=15,
    )
    assert r.status_code in (200, 201), r.text
    return r.json()


def _process(tok, tid):
    r = requests.post(f"{BASE_URL}/api/crm/tickets/{tid}/process", headers=_h(tok), timeout=15)
    return r


def _delete(admin_tok, tid):
    try:
        requests.delete(f"{BASE_URL}/api/crm/tickets/{tid}", headers=_h(admin_tok), timeout=10)
    except Exception:
        pass


# ----- Technicians endpoint -----
def test_technicians_endpoint_only_engineer_teknisi(tokens):
    r = requests.get(f"{BASE_URL}/api/crm/technicians", headers=_h(tokens['admin']), timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list) and len(data) > 0
    roles = {u['role'] for u in data}
    assert roles.issubset({'engineer', 'teknisi'}), f"Unexpected roles: {roles}"
    # No admin/supervisor/viewer
    ids = {u['id'] for u in data}
    assert ADMIN_ID not in ids
    assert VIEWER_ID not in ids


# ----- CASE 1: admin can reassign; client-sent name is ignored -----
def test_case1_admin_reassign(tokens):
    t = _create_ticket(tokens['admin'], 'case1')
    tid = t['id']
    try:
        r = _process(tokens['engineer'], tid)
        assert r.status_code == 200, r.text
        before = r.json()
        created_at, processed_at = before['created_at'], before['processed_at']

        # Admin reassigns to teknisi, with a bogus name to prove server ignores it
        r = requests.post(
            f"{BASE_URL}/api/crm/tickets/{tid}/reassign",
            headers=_h(tokens['admin']),
            json={'new_troubleshooter_id': TEKNISI_ID, 'new_troubleshooter_name': 'BOGUS_CLIENT_NAME', 'reason': 'admin test'},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        after = r.json()
        assert after['troubleshooter_id'] == TEKNISI_ID
        assert after['troubleshooter_name'] != 'BOGUS_CLIENT_NAME'
        assert after['troubleshooter_name'] == 'Teknisi Lapangan'
        assert len(after.get('reassign_history') or []) == 1
        # timers not reset
        assert after['created_at'] == created_at
        assert after['processed_at'] == processed_at
    finally:
        _delete(tokens['admin'], tid)


# ----- CASE 2: holder (engineer) can reassign -----
def test_case2_holder_reassign(tokens):
    t = _create_ticket(tokens['admin'], 'case2')
    tid = t['id']
    try:
        r = _process(tokens['engineer'], tid)
        assert r.status_code == 200
        r = requests.post(
            f"{BASE_URL}/api/crm/tickets/{tid}/reassign",
            headers=_h(tokens['engineer']),
            json={'new_troubleshooter_id': TEKNISI_ID, 'new_troubleshooter_name': 'x', 'reason': 'holder test'},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        after = r.json()
        assert after['troubleshooter_id'] == TEKNISI_ID
    finally:
        _delete(tokens['admin'], tid)


# ----- CASE 3: non-holder forbidden with exact message -----
def test_case3_supervisor_non_holder_forbidden(tokens):
    if 'supervisor' not in tokens:
        pytest.skip('supervisor not available')
    t = _create_ticket(tokens['admin'], 'case3sup')
    tid = t['id']
    try:
        _process(tokens['engineer'], tid)
        r = requests.post(
            f"{BASE_URL}/api/crm/tickets/{tid}/reassign",
            headers=_h(tokens['supervisor']),
            json={'new_troubleshooter_id': TEKNISI_ID, 'new_troubleshooter_name': 'x'},
            timeout=15,
        )
        assert r.status_code == 403
        assert r.json().get('detail') == FORBIDDEN_MSG
    finally:
        _delete(tokens['admin'], tid)


def test_case3_teknisi_non_holder_forbidden(tokens):
    t = _create_ticket(tokens['admin'], 'case3tek')
    tid = t['id']
    try:
        _process(tokens['engineer'], tid)  # engineer becomes holder
        r = requests.post(
            f"{BASE_URL}/api/crm/tickets/{tid}/reassign",
            headers=_h(tokens['teknisi']),
            json={'new_troubleshooter_id': TEKNISI_ID, 'new_troubleshooter_name': 'x'},
            timeout=15,
        )
        assert r.status_code == 403
        assert r.json().get('detail') == FORBIDDEN_MSG
    finally:
        _delete(tokens['admin'], tid)


# ----- Target validation -----
@pytest.mark.parametrize('target_id,label', [
    (VIEWER_ID, 'viewer'),
    (ADMIN_ID, 'admin'),
])
def test_reassign_invalid_role_target(tokens, target_id, label):
    t = _create_ticket(tokens['admin'], f'invtgt_{label}')
    tid = t['id']
    try:
        _process(tokens['engineer'], tid)
        r = requests.post(
            f"{BASE_URL}/api/crm/tickets/{tid}/reassign",
            headers=_h(tokens['admin']),
            json={'new_troubleshooter_id': target_id, 'new_troubleshooter_name': 'x'},
            timeout=15,
        )
        assert r.status_code == 400, f'{label}: {r.status_code} {r.text}'
    finally:
        _delete(tokens['admin'], tid)


def test_reassign_same_current(tokens):
    t = _create_ticket(tokens['admin'], 'same')
    tid = t['id']
    try:
        _process(tokens['engineer'], tid)  # engineer is current holder
        r = requests.post(
            f"{BASE_URL}/api/crm/tickets/{tid}/reassign",
            headers=_h(tokens['admin']),
            json={'new_troubleshooter_id': ENGINEER_ID, 'new_troubleshooter_name': 'x'},
            timeout=15,
        )
        assert r.status_code == 400
    finally:
        _delete(tokens['admin'], tid)


def test_reassign_wrong_status_masuk(tokens):
    t = _create_ticket(tokens['admin'], 'status')
    tid = t['id']
    try:
        # ticket still MASUK
        r = requests.post(
            f"{BASE_URL}/api/crm/tickets/{tid}/reassign",
            headers=_h(tokens['admin']),
            json={'new_troubleshooter_id': TEKNISI_ID, 'new_troubleshooter_name': 'x'},
            timeout=15,
        )
        assert r.status_code == 400
    finally:
        _delete(tokens['admin'], tid)


# ----- History appending + segments across multiple reassigns -----
def test_history_appending_and_segments(tokens):
    t = _create_ticket(tokens['admin'], 'hist')
    tid = t['id']
    try:
        _process(tokens['engineer'], tid)
        # 1st: engineer -> teknisi
        r1 = requests.post(f"{BASE_URL}/api/crm/tickets/{tid}/reassign",
                           headers=_h(tokens['admin']),
                           json={'new_troubleshooter_id': TEKNISI_ID, 'new_troubleshooter_name': 'x', 'reason': 'r1'}, timeout=15)
        assert r1.status_code == 200
        # 2nd: teknisi -> engineer
        r2 = requests.post(f"{BASE_URL}/api/crm/tickets/{tid}/reassign",
                           headers=_h(tokens['admin']),
                           json={'new_troubleshooter_id': ENGINEER_ID, 'new_troubleshooter_name': 'x', 'reason': 'r2'}, timeout=15)
        assert r2.status_code == 200
        final = r2.json()
        assert len(final['reassign_history']) == 2
        segs = final.get('assignment_history') or []
        assert len(segs) >= 3
        # only the last segment has to=None
        assert segs[-1]['to'] is None
        for s in segs[:-1]:
            assert s['to'] is not None
        # audit_log has 2 reassign entries
        reassign_audits = [a for a in final.get('audit_log', []) if a.get('action') == 'troubleshooter_reassigned']
        assert len(reassign_audits) == 2
    finally:
        _delete(tokens['admin'], tid)
