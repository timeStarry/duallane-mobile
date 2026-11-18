#!/usr/bin/env python3
"""Verify a rendered entry screen and stable Android app process, not a blank WebView."""
from __future__ import annotations

import json
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

PACKAGE = "com.timestarry.duallane"
EVIDENCE = Path("artifacts/android-test")


def record_process(pid: int, kind: str, name: str, phase: str) -> None:
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    with (EVIDENCE / "process-evidence.jsonl").open("a", encoding="utf-8") as output:
        output.write(json.dumps({"pid": pid, "kind": kind, "name": name, "phase": phase}) + "\n")


def app_pid(phase: str) -> int:
    result = subprocess.run(
        ["adb", "shell", "pidof", "-s", PACKAGE], check=True,
        capture_output=True, text=True, timeout=10,
    )
    raw = result.stdout.strip()
    if not raw.isdecimal() or int(raw) <= 0:
        raise RuntimeError("DualLane process is missing or ambiguous")
    pid = int(raw)
    record_process(pid, "app", PACKAGE, phase)
    return pid


def app_failure_dialog(root: ET.Element) -> bool:
    return any(node.attrib.get("resource-id") in {"android:id/aerr_wait", "android:id/aerr_close"}
               for node in root.iter())


def app_window_ready(root: ET.Element) -> bool:
    app_nodes = [node for node in root.iter() if node.attrib.get("package") == PACKAGE]
    labels = " ".join(f"{node.attrib.get('text', '')} {node.attrib.get('content-desc', '')}" for node in app_nodes)
    has_login_action = any(
        node.attrib.get("enabled", "true") == "true"
        and visible_bounds(node.attrib.get("bounds", ""))
        and (node.attrib.get("clickable") == "true" or node.attrib.get("class") == "android.widget.Button")
        and "GitHub" in " ".join(f"{child.attrib.get('text', '')} {child.attrib.get('content-desc', '')}" for child in node.iter())
        for node in app_nodes
    )
    return "DualLane" in labels and ("共享空间" in labels or "Workspace" in labels) and has_login_action


def visible_bounds(bounds: str) -> bool:
    match = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", bounds)
    return bool(match and int(match[3]) > int(match[1]) and int(match[4]) > int(match[2]))


def dump(path: Path, phase: str) -> ET.Element:
    last_error: Exception | None = None
    for attempt in range(1, 4):
        remote = f"/sdcard/duallane-ui-{phase}-{attempt}.xml"
        # uiautomator is an exec-based app_process launcher. Record its PID and
        # /proc identity to distinguish a teardown crash from the actual app.
        command = (
            f"rm -f {remote}; uiautomator dump {remote} & dump_pid=$!; "
            "printf 'DUALLANE_AUTOMATION_PID:%s\\n' \"$dump_pid\"; "
            "printf 'DUALLANE_AUTOMATION_CMD:'; tr '\\000' ' ' < /proc/$dump_pid/cmdline; "
            "printf '\\n'; wait $dump_pid"
        )
        try:
            result = subprocess.run(["adb", "shell", command], capture_output=True, text=True, timeout=20)
            (path.parent / f"{phase}-dump-{attempt}.log").write_text(result.stdout + result.stderr, encoding="utf-8")
            pid_match = re.search(r"DUALLANE_AUTOMATION_PID:(\d+)", result.stdout)
            command_match = re.search(r"DUALLANE_AUTOMATION_CMD:([^\r\n]*)", result.stdout)
            if pid_match and command_match and "uiautomator" in command_match[1]:
                record_process(int(pid_match[1]), "automation", command_match[1].strip(), phase)
            result.check_returncode()
            subprocess.run(["adb", "pull", remote, str(path)], check=True, capture_output=True, text=True, timeout=10)
            root = ET.parse(path).getroot()
            if root.tag != "hierarchy":
                raise ET.ParseError("expected Android UI hierarchy")
            return root
        except (subprocess.SubprocessError, ET.ParseError, OSError) as error:
            last_error = error
            if attempt < 3:
                time.sleep(2)
    raise RuntimeError(f"uiautomator dump failed after 3 attempts: {last_error}")


def main() -> int:
    phase = sys.argv[1] if len(sys.argv) > 1 else "ui"
    if not re.fullmatch(r"[a-z][a-z0-9-]{0,30}", phase):
        raise SystemExit("invalid smoke phase")
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    path = EVIDENCE / f"{phase}-ui.xml"
    expected_pid = app_pid(phase)
    deadline = time.monotonic() + 75
    ready_observations = 0
    while time.monotonic() < deadline:
        if app_pid(phase) != expected_pid:
            raise RuntimeError(f"DualLane restarted unexpectedly during {phase}")
        root = dump(path, phase)
        if app_failure_dialog(root):
            raise RuntimeError(f"Android crash/ANR dialog appeared during {phase}")
        if app_pid(phase) != expected_pid:
            raise RuntimeError(f"DualLane exited or restarted during {phase}")
        ready_observations = ready_observations + 1 if app_window_ready(root) else 0
        if ready_observations >= 2:
            (EVIDENCE / f"{phase}-ready.json").write_text(json.dumps({
                "phase": phase, "appPid": expected_pid, "entryActionVisible": True,
                "stableObservations": ready_observations,
            }, indent=2) + "\n", encoding="utf-8")
            return 0
        time.sleep(2)
    raise RuntimeError(f"DualLane entry controls did not become stable during {phase}")


if __name__ == "__main__":
    raise SystemExit(main())
