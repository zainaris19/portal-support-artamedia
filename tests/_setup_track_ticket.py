"""Create a ticket with initial+progress+completion evidence, return token+id.
Used only to set up a public /track/{token} page for the Playwright test."""
import io, os, re, time, uuid, struct, zlib, requests, sys, json

BASE=""
with open("/app/frontend/.env") as f:
    for line in f:
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE=line.split("=",1)[1].strip().rstrip("/"); break
API=f"{BASE}/api"

def png():
    def chk(t,d):
        return (struct.pack(">I",len(d))+t+d+struct.pack(">I",zlib.crc32(t+d)&0xffffffff))
    sig=b"\x89PNG\r\n\x1a\n"
    ihdr=struct.pack(">IIBBBBB",1,1,8,2,0,0,0)
    raw=b"\x00\xff\x00\x00"
    idat=zlib.compress(raw)
    return sig+chk(b"IHDR",ihdr)+chk(b"IDAT",idat)+chk(b"IEND",b"")

r=requests.post(f"{API}/auth/login",json={"email":"admin@noc.local","password":"Admin@123"},timeout=15)
tok=r.json().get("access_token") or r.json().get("token")
H={"Authorization":f"Bearer {tok}"}

# Ensure settings
requests.put(f"{API}/notifications/settings",json={
    "provider":"fonnte","enabled":True,"api_token":"DUMMYTOKEN","sender":"628",
    "default_group":"120363430088957368@g.us","main_group":"120363408836731773@g.us",
    "send_closing_resume":True},headers=H,timeout=15)

payload={"customer_name":f"TEST_UITrack_{uuid.uuid4().hex[:6]}","description":"UI track test",
         "priority":"High","location":"Jakarta","pic_contact":"+6280000000",
         "category_name":"Internet","outage_started_at":"2026-01-10T00:00:00Z"}
r=requests.post(f"{API}/crm/tickets",json=payload,headers=H,timeout=20); t=r.json(); tid=t["id"]

def up(et,name):
    files={"files":(name,io.BytesIO(png()),"application/octet-stream")}
    r=requests.post(f"{API}/crm/tickets/{tid}/files",headers=H,files=files,data={"evidence_type":et},timeout=20)
    j=r.json(); return (j.get("files") or j.get("items") or j)[0]

init=up("CUSTOMER_INITIAL_EVIDENCE","init.png")
requests.post(f"{API}/crm/tickets/{tid}/process",headers=H,timeout=15)
prog=up("TECHNICIAN_PROGRESS","prog.png")
requests.post(f"{API}/crm/tickets/{tid}/progress",json={"note":"progress with photo","file_ids":[prog["id"]]},headers=H,timeout=15)
comp=up("COMPLETION_EVIDENCE","done.png")
requests.post(f"{API}/crm/tickets/{tid}/resolve",json={
    "service_restored_at":"2026-01-10T01:30:00Z","root_cause":"cable cut",
    "action_taken":"splice","final_solution":"restored","service_final_status":"Normal"},headers=H,timeout=25)
time.sleep(1.5)

logs=requests.get(f"{API}/notifications/logs?limit=100",headers=H,timeout=15).json()["items"]
log=next(l for l in logs if l.get("event")=="closing_resume" and l.get("ref_id")==tid)
m=re.search(r"/track/([A-Za-z0-9_\-]+)",log["message"])
token=m.group(1)
print(json.dumps({"ticket_id":tid,"token":token,"ticket_number":t.get("ticket_number")}))
