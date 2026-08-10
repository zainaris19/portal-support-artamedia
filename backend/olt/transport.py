"""Blocking Telnet transport for OLT CLI, wrapped for asyncio via to_thread.

Read-only usage. Handles: login (Username/Password), optional `enable` mode,
disabling terminal paging, running a queue of commands over a single session,
and `--More--` pagination. Every public method has a hard timeout.

SSH is declared but not yet implemented (user OLT uses Telnet). Adding SSH later
is a drop-in: implement SSHTransport with the same run_commands() contract.
"""
from __future__ import annotations
import asyncio
import re
import time
from typing import Dict, List, Optional

try:  # telnetlib is deprecated in 3.11 but present; guard for future removal.
    import telnetlib  # type: ignore
    TELNET_AVAILABLE = True
except Exception:  # pragma: no cover
    telnetlib = None  # type: ignore
    TELNET_AVAILABLE = False

PROMPT_RE = re.compile(rb"[\r\n][\w.\-]+[>#]\s*$")
MORE_RE = re.compile(rb"-+\s*more\s*-+", re.IGNORECASE)


class OLTConnectionError(Exception):
    pass


class TelnetTransport:
    def __init__(self, host: str, port: int = 23, username: str = "", password: str = "",
                 enable_password: Optional[str] = None, needs_enable: bool = False,
                 timeout: int = 15, paging_off_cmds: Optional[List[str]] = None):
        self.host = host
        self.port = int(port or 23)
        self.username = username or ""
        self.password = password or ""
        self.enable_password = enable_password
        self.needs_enable = needs_enable
        self.timeout = int(timeout or 15)
        self.paging_off_cmds = paging_off_cmds or ["terminal length 0", "screen-rows per-page 0"]
        self._tn = None
        self._prompt = None

    # ---- sync core (run inside to_thread) ------------------------------------
    def _read_until_prompt(self, extra_timeout: Optional[int] = None) -> str:
        tn = self._tn
        deadline = time.time() + (extra_timeout or self.timeout)
        buf = b""
        while time.time() < deadline:
            try:
                chunk = tn.read_very_eager()
            except EOFError:
                break
            if chunk:
                buf += chunk
                if MORE_RE.search(buf[-64:]):
                    tn.write(b" ")  # advance pager
                    buf = MORE_RE.sub(b"", buf)
                    continue
                if PROMPT_RE.search(buf[-96:]) or buf.rstrip().endswith((b"#", b">")):
                    break
            else:
                time.sleep(0.15)
        return buf.decode(errors="replace")

    def _login_sync(self):
        if not TELNET_AVAILABLE:
            raise OLTConnectionError("Telnet tidak tersedia di server ini")
        try:
            self._tn = telnetlib.Telnet(self.host, self.port, timeout=self.timeout)
        except Exception as e:  # noqa: BLE001
            raise OLTConnectionError(f"Tidak dapat terhubung ke {self.host}:{self.port} ({e})")
        tn = self._tn
        try:
            idx, _, _ = tn.expect([rb"[Uu]ser\s*name\s*:", rb"[Ll]ogin\s*:"], self.timeout)
            tn.write(self.username.encode() + b"\n")
            tn.expect([rb"[Pp]ass\s*word\s*:"], self.timeout)
            tn.write(self.password.encode() + b"\n")
            time.sleep(0.6)
            banner = self._read_until_prompt()
            if re.search(r"(fail|incorrect|denied|invalid)", banner, re.IGNORECASE):
                raise OLTConnectionError("Login gagal: username/password salah")
            if self.needs_enable:
                tn.write(b"enable\n")
                pi, _, _ = tn.expect([rb"[Pp]ass\s*word\s*:", PROMPT_RE], self.timeout)
                if pi == 0:
                    tn.write(((self.enable_password or self.password) + "\n").encode())
                    en = self._read_until_prompt()
                    if re.search(r"(fail|incorrect|denied|invalid)", en, re.IGNORECASE):
                        raise OLTConnectionError("Enable gagal: enable password salah")
            for cmd in self.paging_off_cmds:
                tn.write(cmd.encode() + b"\n")
                self._read_until_prompt(4)
        except OLTConnectionError:
            raise
        except Exception as e:  # noqa: BLE001
            raise OLTConnectionError(f"Kesalahan saat login: {e}")

    def _run_sync(self, commands: List[str]) -> Dict[str, str]:
        out: Dict[str, str] = {}
        tn = self._tn
        for cmd in commands:
            try:
                tn.read_very_eager()  # drain
            except Exception:
                pass
            tn.write(cmd.encode() + b"\n")
            raw = self._read_until_prompt()
            out[cmd] = _strip_echo_and_prompt(raw, cmd)
        return out

    def _run_script_sync(self, commands: List[str]) -> str:
        """Run a sequence of (write) commands over one session, returning the
        FULL concatenated output. Auto-answers common confirmation prompts
        (e.g. ZTE 'Confirm to ...? [yes/no]') with 'y'."""
        tn = self._tn
        chunks: List[str] = []
        confirm_re = re.compile(rb"(confirm|are you sure|\[yes/no\]|\(y/n\)|continue\?)", re.IGNORECASE)
        for cmd in commands:
            try:
                tn.read_very_eager()  # drain
            except Exception:
                pass
            tn.write(cmd.encode() + b"\n")
            raw = self._read_until_prompt()
            # auto-confirm interactive prompts
            tries = 0
            while confirm_re.search(raw.encode(errors="replace")[-160:]) and tries < 2:
                tn.write(b"y\n")
                raw += self._read_until_prompt(6)
                tries += 1
            chunks.append(f"{cmd}\n{_strip_echo_and_prompt(raw, cmd)}")
        return "\n".join(chunks)

    def _close_sync(self):
        try:
            if self._tn is not None:
                self._tn.write(b"exit\n")
                self._tn.close()
        except Exception:
            pass
        finally:
            self._tn = None

    # ---- async wrappers ------------------------------------------------------
    async def login(self):
        await asyncio.wait_for(asyncio.to_thread(self._login_sync), timeout=self.timeout + 8)

    async def run_commands(self, commands: List[str]) -> Dict[str, str]:
        # generous timeout: per-command timeout * count
        tmo = self.timeout * max(1, len(commands)) + 10
        return await asyncio.wait_for(asyncio.to_thread(self._run_sync, commands), timeout=tmo)

    async def run_script(self, commands: List[str]) -> str:
        tmo = self.timeout * max(1, len(commands)) + 20
        return await asyncio.wait_for(asyncio.to_thread(self._run_script_sync, commands), timeout=tmo)

    async def close(self):
        await asyncio.to_thread(self._close_sync)

    async def __aenter__(self):
        await self.login()
        return self

    async def __aexit__(self, *exc):
        await self.close()


def _strip_echo_and_prompt(raw: str, cmd: str) -> str:
    lines = raw.replace("\r", "").split("\n")
    # drop the first line if it echoes the command
    if lines and cmd.strip() and cmd.strip() in lines[0]:
        lines = lines[1:]
    # drop trailing prompt line (ends with # or >)
    while lines and re.search(r"[>#]\s*$", lines[-1]) and len(lines[-1]) < 64:
        lines.pop()
    return "\n".join(lines).strip("\n")


# Prompt for interactive SSH CLIs (e.g. VSOL): matches `gpon-olt>`, `gpon-olt#`,
# `gpon-olt(config)#`, `gpon-olt(config-pon-0/1)#`.
SSH_PROMPT_RE = re.compile(r"[\w.\-]+(\([\w\-/:]+\))?\s*[>#]\s*$")
SSH_MORE_RE = re.compile(r"-+\s*more\s*-+|<space>|press any key", re.IGNORECASE)
SSH_PW_RE = re.compile(r"pass\s*word\s*:", re.IGNORECASE)
SSH_LOGIN_RE = re.compile(r"(login|user\s*name)\s*:\s*$", re.IGNORECASE)
SSH_FAIL_RE = re.compile(r"(login failed|authentication fail|access denied|incorrect|bad\s*user|bad\s*password)", re.IGNORECASE)
_ANSI_CSI_RE = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")


def clean_cli_output(s: str) -> str:
    """Normalize interactive-CLI output that uses ANSI cursor-positioning
    escapes (e.g. VSOL ``GPON0/1:1\\x1b[12Cenable...``) for column alignment.
    Each CSI escape and stray CR is turned into a single space so downstream
    parsers can split on whitespace; other control chars are dropped."""
    s = _ANSI_CSI_RE.sub(" ", s)
    s = s.replace("\r\n", "\n").replace("\r", " ")
    s = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", s)
    return s


class SSHTransport:
    """Interactive SSH CLI transport (paramiko invoke_shell). Same public
    contract as TelnetTransport: login / run_commands / run_script / close.

    Handles: login banner, optional `enable` + enable password, paging-off,
    and prompt-terminated command reads. Read-only friendly.
    """

    def __init__(self, host: str, port: int = 22, username: str = "", password: str = "",
                 enable_password: Optional[str] = None, needs_enable: bool = False,
                 timeout: int = 15, paging_off_cmds: Optional[List[str]] = None):
        self.host = host
        self.port = int(port or 22)
        self.username = username or ""
        self.password = password or ""
        self.enable_password = enable_password
        self.needs_enable = needs_enable
        self.timeout = int(timeout or 15)
        self.paging_off_cmds = paging_off_cmds or ["terminal length 0"]
        self._client = None
        self._chan = None

    # ---- sync core (run inside to_thread) ------------------------------------
    def _read_until_prompt(self, extra_timeout: Optional[int] = None) -> str:
        chan = self._chan
        deadline = time.time() + (extra_timeout or self.timeout)
        buf = ""
        while time.time() < deadline:
            if chan.recv_ready():
                try:
                    data = chan.recv(65535).decode(errors="replace")
                except Exception:
                    break
                if data:
                    buf += data
                    tail = buf[-160:]
                    if SSH_MORE_RE.search(tail):
                        chan.send(" ")
                        buf = SSH_MORE_RE.sub("", buf)
                        continue
                    if SSH_PROMPT_RE.search(tail) or SSH_PW_RE.search(tail):
                        break
                    continue
            if chan.exit_status_ready() and not chan.recv_ready():
                break
            time.sleep(0.1)
        return buf

    def _expect(self, patterns: List[re.Pattern], timeout: Optional[int] = None) -> tuple:
        """Read until one of ``patterns`` matches the tail. Returns
        (index, buffer). index=-1 on timeout. Auto-advances pagers."""
        chan = self._chan
        deadline = time.time() + (timeout or self.timeout)
        buf = ""
        while time.time() < deadline:
            if chan.recv_ready():
                try:
                    data = chan.recv(65535).decode(errors="replace")
                except Exception:
                    break
                if data:
                    buf += data
                    tail = buf[-240:]
                    if SSH_MORE_RE.search(tail):
                        chan.send(" ")
                        buf = SSH_MORE_RE.sub("", buf)
                        continue
                    for i, p in enumerate(patterns):
                        if p.search(tail):
                            return i, buf
                    continue
            if chan.closed or chan.eof_received:
                break
            time.sleep(0.1)
        return -1, buf

    def _login_sync(self):
        try:
            import paramiko  # local import: only needed for SSH devices
        except Exception as e:  # pragma: no cover
            raise OLTConnectionError(f"Library SSH (paramiko) tidak tersedia: {e}")
        try:
            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            client.connect(
                self.host, port=self.port, username=self.username, password=self.password,
                timeout=self.timeout, banner_timeout=self.timeout, auth_timeout=self.timeout,
                look_for_keys=False, allow_agent=False,
                # Many OLTs only offer legacy ssh-rsa host keys; keep them enabled.
                disabled_algorithms={"pubkeys": ["rsa-sha2-512", "rsa-sha2-256"]},
            )
        except Exception as e:  # noqa: BLE001
            raise OLTConnectionError(f"SSH gagal ke {self.host}:{self.port} ({e})")
        self._client = client
        try:
            self._chan = client.invoke_shell(width=240, height=100000)
            self._chan.settimeout(0.0)
            time.sleep(0.6)
            # ---- interactive in-shell login (VSOL: Login: / Password:) --------
            reached_shell = False
            for _ in range(10):
                idx, buf = self._expect([SSH_LOGIN_RE, SSH_PW_RE, SSH_PROMPT_RE, SSH_FAIL_RE], self.timeout)
                if idx == 3:
                    raise OLTConnectionError("Login perangkat ditolak: cek username/password")
                if idx == 2:  # shell prompt reached
                    reached_shell = True
                    last = buf
                    break
                if idx == 0:  # Login: / Username:
                    self._chan.send(self.username + "\n")
                    continue
                if idx == 1:  # Password:
                    self._chan.send(self.password + "\n")
                    continue
                raise OLTConnectionError("Tidak menerima prompt login dari perangkat (timeout)")
            else:
                raise OLTConnectionError("Gagal menyelesaikan login SSH (loop)")

            # ---- enable mode (privileged) -------------------------------------
            if self.needs_enable and not last.rstrip().endswith("#"):
                self._chan.send("enable\n")
                idx, buf = self._expect([SSH_PW_RE, SSH_PROMPT_RE, SSH_FAIL_RE], self.timeout)
                if idx == 0:  # enable password required (fallback to login pw)
                    self._chan.send((self.enable_password or self.password) + "\n")
                    idx2, buf2 = self._expect([SSH_PROMPT_RE, SSH_FAIL_RE, SSH_PW_RE], self.timeout)
                    if idx2 != 0:
                        raise OLTConnectionError("Enable gagal: enable password salah")
                elif idx == 2:
                    raise OLTConnectionError("Enable gagal / prompt tidak dikenali")

            for cmd in self.paging_off_cmds:
                self._chan.send(cmd + "\n")
                self._read_until_prompt(6)
        except OLTConnectionError:
            raise
        except Exception as e:  # noqa: BLE001
            raise OLTConnectionError(f"Kesalahan saat login SSH: {e}")

    def _run_sync(self, commands: List[str]) -> Dict[str, str]:
        out: Dict[str, str] = {}
        for cmd in commands:
            self._chan.send(cmd + "\n")
            raw = self._read_until_prompt()
            out[cmd] = clean_cli_output(_strip_echo_and_prompt(raw, cmd))
        return out

    def _read_until_prompt_or_confirm(self, confirm_re: re.Pattern, extra_timeout: Optional[int] = None) -> str:
        """Like _read_until_prompt but also returns when a write-confirmation
        prompt (e.g. 'Are you sure? [yes/no]') appears. Used by run_script."""
        chan = self._chan
        deadline = time.time() + (extra_timeout or self.timeout)
        buf = ""
        while time.time() < deadline:
            if chan.recv_ready():
                try:
                    data = chan.recv(65535).decode(errors="replace")
                except Exception:
                    break
                if data:
                    buf += data
                    tail = buf[-200:]
                    if SSH_MORE_RE.search(tail):
                        chan.send(" ")
                        buf = SSH_MORE_RE.sub("", buf)
                        continue
                    if confirm_re.search(tail) or SSH_PROMPT_RE.search(tail):
                        break
                    continue
            if chan.closed or chan.eof_received:
                break
            time.sleep(0.1)
        return buf

    def _run_script_sync(self, commands: List[str]) -> str:
        chunks: List[str] = []
        confirm_re = re.compile(
            r"(confirm|are you sure|\[yes/no\]|\(y/n\)|\[y/n\]|continue\s*\?|\[confirm\])",
            re.IGNORECASE)
        for cmd in commands:
            self._chan.send(cmd + "\n")
            raw = self._read_until_prompt_or_confirm(confirm_re)
            # auto-answer interactive confirmation prompts with 'y'
            tries = 0
            while confirm_re.search(raw[-200:]) and tries < 3:
                self._chan.send("y\n")
                raw += self._read_until_prompt_or_confirm(confirm_re, 8)
                tries += 1
            chunks.append(f"{cmd}\n{clean_cli_output(_strip_echo_and_prompt(raw, cmd))}")
        return "\n".join(chunks)

    def _close_sync(self):
        try:
            if self._chan is not None:
                self._chan.close()
        except Exception:
            pass
        try:
            if self._client is not None:
                self._client.close()
        except Exception:
            pass
        finally:
            self._chan = None
            self._client = None

    # ---- async wrappers ------------------------------------------------------
    async def login(self):
        await asyncio.wait_for(asyncio.to_thread(self._login_sync), timeout=self.timeout + 12)

    async def run_commands(self, commands: List[str]) -> Dict[str, str]:
        tmo = self.timeout * max(1, len(commands)) + 10
        return await asyncio.wait_for(asyncio.to_thread(self._run_sync, commands), timeout=tmo)

    async def run_script(self, commands: List[str]) -> str:
        tmo = self.timeout * max(1, len(commands)) + 20
        return await asyncio.wait_for(asyncio.to_thread(self._run_script_sync, commands), timeout=tmo)

    async def close(self):
        await asyncio.to_thread(self._close_sync)

    async def __aenter__(self):
        await self.login()
        return self

    async def __aexit__(self, *exc):
        await self.close()


def build_transport(device: dict, password: str, enable_password: Optional[str], needs_enable: bool):
    """Factory: returns a transport instance based on device['protocol']."""
    proto = (device.get("protocol") or "telnet").lower()
    if proto == "telnet":
        return TelnetTransport(
            host=device.get("host"), port=device.get("port") or 23,
            username=device.get("username", ""), password=password,
            enable_password=enable_password, needs_enable=needs_enable,
            timeout=device.get("timeout") or 15,
        )
    if proto == "ssh":
        return SSHTransport(
            host=device.get("host"), port=device.get("port") or 22,
            username=device.get("username", ""), password=password,
            enable_password=enable_password, needs_enable=needs_enable,
            timeout=device.get("timeout") or 15,
        )
    raise OLTConnectionError(f"Protokol '{proto}' belum didukung (saat ini: Telnet, SSH)")
