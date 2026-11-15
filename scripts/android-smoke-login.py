#!/usr/bin/env python3
"""Verify DualLane Android host cold-launch and entry screen hierarchy."""
from __future__ import annotations

import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

ANR_WAIT_IDS = ("android:id/aerr_wait",)
ANR_WAIT_TEXT = ("Wait", "等待")


def bounds_center(bounds: str) -> tuple[int, int] | None:
    match = re.findall(r"\[(\d+),(\d+)\]", bounds)
    if len(match) != 2:
        return None
    left, top = (int(value) for value in match[0])
    right, bottom = (int(value) for value in match[1])
    return (left + right) // 2, (top + bottom) // 2


def anr_wait_tap(root: ET.Element) -> tuple[int, int] | None:
    for node in root.iter():
        resource = node.attrib.get("resource-id", "")
        text = node.attrib.get("text", "")
        if resource in ANR_WAIT_IDS or (
            node.attrib.get("class") == "android.widget.Button" and text in ANR_WAIT_TEXT
        ):
            return bounds_center(node.attrib.get("bounds", ""))
    return None


def app_window_ready(root: ET.Element) -> bool:
    packages = {node.attrib.get("package", "") for node in root.iter()}
    if "com.timestarry.duallane" not in packages:
        return False

    all_text = " ".join(
        f"{node.attrib.get('text', '')} {node.attrib.get('content-desc', '')}"
        for node in root.iter()
    )
    if "DualLane" in all_text and "GitHub" in all_text:
        return True

    has_webview = any(
        node.attrib.get("package") == "com.timestarry.duallane"
        and "WebView" in node.attrib.get("class", "")
        for node in root.iter()
    )
    return has_webview


def dump(path: Path) -> ET.Element:
    last_error: Exception | None = None
    for _ in range(3):
        try:
            subprocess.check_call(
                ["adb", "shell", "uiautomator", "dump", "/sdcard/duallane-ui.xml"]
            )
            subprocess.check_call(["adb", "pull", "/sdcard/duallane-ui.xml", str(path)])
            return ET.parse(path).getroot()
        except (subprocess.CalledProcessError, ET.ParseError) as error:
            last_error = error
            time.sleep(2)
    raise RuntimeError(f"uiautomator dump failed: {last_error}")


def main() -> int:
    name = sys.argv[1] if len(sys.argv) > 1 else "ui"
    path = Path(f"artifacts/android-test/{name}-ui.xml")
    path.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.time() + 40
    while time.time() < deadline:
        root = dump(path)
        tap = anr_wait_tap(root)
        if tap:
            subprocess.check_call(["adb", "shell", "input", "tap", str(tap[0]), str(tap[1])])
            time.sleep(2)
            continue
        if app_window_ready(root):
            return 0
        time.sleep(2)
    raise SystemExit(f"DualLane window hierarchy not ready for {name}")


if __name__ == "__main__":
    raise SystemExit(main())
