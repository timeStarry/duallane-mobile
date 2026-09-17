"""Exercise the published binary; never retain OAuth URLs, cookies, or UI dumps."""

import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.request
import xml.etree.ElementTree as ET
import zipfile


PACKAGE = 'com.timestarry.duallane'
ORIGIN = 'https://duallane.tsio.top'
EXPECTED_SHA = 'ae50ee357ea73205080a0fa44304442398911969537b4d4ee307bfe588706dda'
WORK = Path(os.environ['RUNNER_TEMP']) / 'connection'
REPORT = Path('artifacts/published-connection/summary.json')
checks = []
seen_known_labels = set()


def adb(*args, timeout=30):
    result = subprocess.run(['adb', *args], capture_output=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError('adb_command_failed')
    return result.stdout


def require(ok, label):
    if not ok:
        raise RuntimeError(label)
    checks.append(label)


def ui():
    adb('shell', 'uiautomator', 'dump', '/sdcard/connection-ui.xml')
    raw = adb('exec-out', 'cat', '/sdcard/connection-ui.xml')
    adb('shell', 'rm', '/sdcard/connection-ui.xml')
    return list(ET.fromstring(raw).iter('node'))


def labels(node):
    return [node.attrib.get('text', ''), node.attrib.get('content-desc', '')]


def tap(node):
    bounds = [int(value) for value in re.findall(r'\d+', node.attrib['bounds'])]
    require(len(bounds) == 4, 'ui_target_bounds_valid')
    adb('shell', 'input', 'tap', str((bounds[0] + bounds[2]) // 2), str((bounds[1] + bounds[3]) // 2))


report = {
    'origin': ORIGIN,
    'apkSha256': EXPECTED_SHA,
    'serverVersionExpected': '0.20.0',
    'accountLogin': 'not_performed',
    'chatAndFiles': 'not_performed',
}
try:
    probe = urllib.request.Request(ORIGIN + '/api/health', headers={'X-DualLane-Client': 'android'})
    with urllib.request.urlopen(probe, timeout=25) as response:
        raw = response.read(65536)
        report['networkProbe'] = {'httpStatus': response.status,
                                  'icpInterception': b'Non-compliance ICP Filing' in raw,
                                  'jsonContentType': 'application/json' in response.headers.get('Content-Type', '')}
        try:
            health = json.loads(raw)
            report['networkProbe']['productionVersionMatched'] = health.get('appVersion') == '0.20.0'
        except (ValueError, AttributeError):
            report['networkProbe']['productionVersionMatched'] = False
except Exception:
    report['networkProbe'] = {'requestFailed': True}
try:
    apk = WORK / 'published.apk'
    require(hashlib.sha256(apk.read_bytes()).hexdigest() == EXPECTED_SHA, 'exact_published_apk')
    with zipfile.ZipFile(apk) as archive:
        config = json.loads(archive.read('assets/app.config'))
    require(config['extra']['apiOrigin'] == ORIGIN, 'embedded_production_origin')
    adb('install', str(apk), timeout=120)
    adb('logcat', '-c')
    adb('shell', 'am', 'start', '-W', '-n', PACKAGE + '/.MainActivity')

    deadline = time.monotonic() + 60
    login = None
    while time.monotonic() < deadline:
        nodes = ui()
        login = next((node for node in nodes if '使用 GitHub 登录' in labels(node)
                      and node.attrib.get('enabled') == 'true'), None)
        if login is not None:
            break
        time.sleep(1)
    require(login is not None, 'native_login_button_ready')
    require(not any('服务地址或邀请链接' in labels(node) for node in nodes), 'no_server_selection_required')
    tap(login)

    # Only act on currently observed first-run browser buttons. No credentials
    # are entered and no GitHub authorization is submitted.
    dismissible = {'Use without an account', 'Accept & continue', 'No thanks', 'Not now', 'Got it', 'Continue without an account'}
    known_errors = {'无法连接服务', '网络请求失败', '登录失败', 'Something went wrong', 'This site can’t be reached', 'Your connection is not private',
                    '连接或数据暂时不可用，请重试', '操作未完成，请重试', '服务器尚未开放 Android 登录',
                    '暂时无法检查更新，请稍后重试', '共享空间暂未开放'}
    deadline = time.monotonic() + 120
    github_page = False
    browser_seen = False
    report['loginBusyObserved'] = False
    report['appErrorObserved'] = False
    while time.monotonic() < deadline:
        nodes = ui()
        visible = {label for node in nodes for label in labels(node) if label}
        browser_seen = browser_seen or any(node.attrib.get('package') == 'com.android.chrome' for node in nodes)
        seen_known_labels.update(visible & known_errors)
        report['loginBusyObserved'] |= '正在登录…' in visible
        report['appErrorObserved'] |= bool(visible & known_errors)
        github_origin = any(node.attrib.get('package') == 'com.android.chrome'
                            and node.attrib.get('resource-id', '').endswith(('/url_bar', '/origin', '/toolbar_url'))
                            and any(re.match(r'^(?:https://)?github\.com(?:[/:]|$)', label) for label in labels(node))
                            for node in nodes)
        github_signin = any('Sign in to GitHub' in label for label in visible)
        if github_origin and github_signin:
            github_page = True
            break
        button = next((node for node in nodes if any(label in dismissible for label in labels(node))
                       and node.attrib.get('enabled') == 'true'), None)
        if button is not None:
            tap(button)
        time.sleep(1)
    report['systemBrowserOpened'] = browser_seen
    report['knownErrorLabels'] = sorted(seen_known_labels)
    require(github_page, 'apk_to_production_to_github_login_page')
    with urllib.request.urlopen(ORIGIN + '/api/health', timeout=25) as response:
        health = json.loads(response.read(65536))
        require(response.status == 200 and health.get('ok') is True
                and health.get('appVersion') == '0.20.0', 'production_version_confirmed')
    require(bool(adb('shell', 'pidof', PACKAGE).strip()), 'app_still_running')
    report['status'] = 'passed'
except Exception as error:
    code = str(error)
    report['status'] = 'failed'
    report['failure'] = code if re.fullmatch('[a-z_]+', code) else 'verification_runtime_error'
finally:
    report['checks'] = list(dict.fromkeys(checks))
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))
    # The disposable device holds the pending, expiring OAuth flow only until
    # this job's unconditional emulator cleanup. Do not collect its raw logs.

raise SystemExit(0 if report['status'] == 'passed' else 1)
