#!/usr/bin/env python3
"""Real source-built cnp-engine process smoke on a native OS runner.
No API key/provider call is performed. Fail on transport mismatch/timeouts.
"""
import json
import os
import queue
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path


def smoke(exe):
    with tempfile.TemporaryDirectory(prefix="canopi-rpc-smoke-") as temp:
        root = Path(temp)
        (root / "project").mkdir()
        (root / "agent").mkdir()
        # The engine refuses to start with an empty model catalog (rc=1 before
        # ready). Stage a zero-cost local fixture provider so this transport
        # smoke runs on a clean profile. No provider call is ever made.
        (root / "agent" / "models.yml").write_text(
            "providers:\n"
            "  canopi-smoke:\n"
            "    baseUrl: http://127.0.0.1:9/v1\n"
            "    apiKey: canopi-smoke-not-a-real-key\n"
            "    api: openai-completions\n"
            "    models:\n"
            "      - id: canopi-smoke-model\n"
            "        name: canoPi smoke model\n"
            "        api: openai-completions\n"
            "        input: [text]\n"
            "        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }\n"
            "        contextWindow: 8000\n"
            "        maxTokens: 1000\n",
            encoding="utf-8",
        )
        env = os.environ.copy()
        for key in ("OMP_PROFILE", "PI_PROFILE", "PI_CONFIG_FILES", "PI_CODING_AGENT_SESSION_DIR"):
            env.pop(key, None)
        env["PI_CODING_AGENT_DIR"] = str(root / "agent")
        env["PI_CONFIG_DIR"] = ".canopi-ci-smoke"
        proc = subprocess.Popen([exe, "--mode", "rpc-ui"], cwd=root / "project", env=env,
                                stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, bufsize=0)
        received = queue.Queue(maxsize=500)

        def read():
            try:
                for raw in iter(proc.stdout.readline, b""):
                    received.put(json.loads(raw))
            except Exception as exc:
                received.put({"type": "transport-error", "error": str(exc)})
            finally:
                received.put({"type": "EOF"})

        threading.Thread(target=read, daemon=True).start()

        def until(test, seconds=30):
            end = time.monotonic() + seconds
            while time.monotonic() < end:
                try:
                    f = received.get(timeout=max(0.01, end - time.monotonic()))
                except queue.Empty:
                    break
                if f["type"] in ("EOF", "transport-error"):
                    raise RuntimeError(f"RPC ended: {f['type']}")
                if test(f):
                    return f
            raise TimeoutError("Timed out waiting for matching RPC response")

        def req(tag, command):
            command = {"id": tag, **command}
            proc.stdin.write((json.dumps(command) + "\n").encode())
            proc.stdin.flush()
            result = until(lambda f: f.get("type") == "response" and f.get("id") == tag)
            if not result.get("success"):
                raise RuntimeError(f"{tag} failed: {result.get('error', 'unknown error')}")
            return result.get("data")

        try:
            ready = until(lambda f: f.get("type") == "ready", seconds=12)
            assert 2 in ready.get("supportedProtocolVersions", []), ready
            req("n-1", {"type": "negotiate_protocol", "protocolVersion": 2})
            data = req("o-1", {"type": "open_session", "sessionDir": str(root / "sessions")})
            state = req("s-1", {"type": "get_state"})
            if not isinstance(state, dict):
                raise RuntimeError("get_state returned invalid data shape")
            print("PASS: ready, protocol v2, open_session, get_state; no fake provider turn")
            print("Session ID present:", bool(data and data.get("sessionId")))
        finally:
            try:
                proc.stdin.close()
                proc.wait(timeout=8)
            except Exception:
                proc.kill()
                proc.wait(timeout=5)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python scripts/rpc-smoke.py <source-built-cnp-engine>")
    smoke(str(Path(sys.argv[1]).resolve()))
