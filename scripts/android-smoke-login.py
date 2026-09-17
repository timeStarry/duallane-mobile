#!/usr/bin/env python3
"""Wait for the DualLane login hierarchy on an Android emulator.

Pixel Launcher ANR dialogs can sit on top of a healthy app window. Dismiss
them and retry instead of treating the system dialog as the login screen.
"""
from __future__ import annotations

import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

LOGIN_LABELS = ('DualLane', '空间邀请链接（可选）', '使用 GitHub 登录')
FORBIDDEN_LABELS = ('服务地址或邀请链接',)
ANR_WAIT_IDS = ('android:id/aerr_wait',)
ANR_WAIT_TEXT = ('Wait', '等待')


def labels(root: ET.Element) -> set[str]:
    return {node.attrib.get(key, '') for node in root.iter() for key in ('text', 'content-desc')}


def bounds_center(bounds: str) -> tuple[int, int] | None:
    match = re.findall(r'\[(\d+),(\d+)\]', bounds)
    if len(match) != 2:
        return None
    left, top = (int(value) for value in match[0])
    right, bottom = (int(value) for value in match[1])
    return (left + right) // 2, (top + bottom) // 2


def anr_wait_tap(root: ET.Element) -> tuple[int, int] | None:
    for node in root.iter():
        resource = node.attrib.get('resource-id', '')
        text = node.attrib.get('text', '')
        if resource in ANR_WAIT_IDS or (node.attrib.get('class') == 'android.widget.Button' and text in ANR_WAIT_TEXT):
            return bounds_center(node.attrib.get('bounds', ''))
    return None


def login_ready(root: ET.Element) -> bool:
    found = labels(root)
    if any(label in found for label in FORBIDDEN_LABELS):
        return False
    if not all(label in found for label in LOGIN_LABELS):
        return False
    buttons = [
        node for node in root.iter()
        if node.attrib.get('class') == 'android.widget.Button' and node.attrib.get('content-desc') == '使用 GitHub 登录'
    ]
    return len(buttons) == 1 and buttons[0].attrib.get('enabled') == 'true'


def dump(path: Path) -> ET.Element:
    last_error: Exception | None = None
    for _ in range(3):
        try:
            subprocess.check_call(['adb', 'shell', 'uiautomator', 'dump', '/sdcard/duallane-ui.xml'])
            subprocess.check_call(['adb', 'pull', '/sdcard/duallane-ui.xml', str(path)])
            return ET.parse(path).getroot()
        except (subprocess.CalledProcessError, ET.ParseError) as error:
            last_error = error
            time.sleep(2)
    raise RuntimeError(f'uiautomator dump failed: {last_error}')


def main() -> int:
    name = sys.argv[1] if len(sys.argv) > 1 else 'ui'
    path = Path(f'artifacts/android-test/{name}-ui.xml')
    path.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.time() + 40
    last: set[str] = set()
    while time.time() < deadline:
        root = dump(path)
        last = labels(root)
        if login_ready(root):
            return 0
        tap = anr_wait_tap(root)
        if tap:
            subprocess.check_call(['adb', 'shell', 'input', 'tap', str(tap[0]), str(tap[1])])
        time.sleep(2)
    raise SystemExit(f'login hierarchy not ready: {sorted(last)}')


if __name__ == '__main__':
    raise SystemExit(main())
