"""Regression tests for Android smoke evidence; no emulator or user session required."""
import importlib.util
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest.mock import patch


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).parent / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


smoke = load("android_smoke", "android-smoke-login.py")
runtime = load("android_runtime", "check-android-runtime-errors.py")
PACKAGE = "com.timestarry.duallane"


def log(pid, tag, message):
    return f"11-18 01:00:00.123 {pid:5} {pid:5} E {tag}: {message}\n"


def entry_tree(button=True):
    return ET.fromstring(f'''<hierarchy><node package="{PACKAGE}" text="DualLane">
      <node package="{PACKAGE}" text="共享空间"/>
      <node package="{PACKAGE}" class="android.widget.Button" text="使用 GitHub 登录"
        bounds="[10,20][210,70]" clickable="{'true' if button else 'false'}" enabled="{'true' if button else 'false'}"/>
      </node></hierarchy>''')


class RuntimeEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.evidence = [{"pid": 100, "kind": "app", "name": PACKAGE}]

    def classify(self, text, extra=None):
        return runtime.classify_runtime(text, self.evidence + (extra or []), PACKAGE)

    def test_real_app_fatal_fails_even_if_thread_is_named_uiautomation(self):
        result = self.classify(log(100, "AndroidRuntime", "FATAL EXCEPTION: UiAutomation"))
        self.assertEqual(result["status"], "FAIL")
        self.assertEqual(result["failures"][0]["kind"], "app_crash")

    def test_uiautomation_fault_requires_independent_pid_identity(self):
        text = log(3151, "AndroidRuntime", "FATAL EXCEPTION: UiAutomation") + log(3151, "AndroidRuntime", "java.lang.RuntimeException: Bad file descriptor")
        self.assertEqual(self.classify(text)["status"], "FAIL")
        result = self.classify(text, [{"pid": 3151, "kind": "automation", "name": "/system/bin/app_process com.android.commands.uiautomator.Launcher"}])
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["externalCrashes"][0]["pid"], 3151)

    def test_process_metadata_finds_app_crash_before_observed_pid(self):
        text = log(200, "AndroidRuntime", "FATAL EXCEPTION: main") + log(200, "AndroidRuntime", f"Process: {PACKAGE}, PID: 200")
        self.assertEqual(self.classify(text)["status"], "FAIL")

    def test_activity_manager_start_metadata_finds_child_crash(self):
        text = log(80, "ActivityManager", f"Start proc 200:{PACKAGE}:worker/u0a123 for service") + log(200, "AndroidRuntime", "FATAL EXCEPTION: main")
        self.assertEqual(self.classify(text)["status"], "FAIL")

    def test_app_native_crash_and_anr_fail(self):
        self.assertEqual(self.classify(log(100, "libc", "Fatal signal 11 (SIGSEGV)"))["status"], "FAIL")
        self.assertEqual(self.classify(log(900, "DEBUG", f">>> {PACKAGE} <<<"))["status"], "FAIL")
        self.assertEqual(self.classify(log(80, "ActivityManager", f"ANR in {PACKAGE}"))["status"], "FAIL")
        self.assertEqual(self.classify(log(80, "am_anr", f"[0,100,{PACKAGE},0,Input dispatching timed out]"))["status"], "FAIL")

    def test_no_process_evidence_fails_even_with_no_error_lines(self):
        self.assertEqual(runtime.classify_runtime("", [], PACKAGE)["status"], "FAIL")

    def test_other_named_process_crash_is_reported_not_misclassified_as_app(self):
        text = log(333, "AndroidRuntime", "FATAL EXCEPTION: main") + log(333, "AndroidRuntime", "Process: android.other, PID: 333")
        result = self.classify(text)
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["externalCrashes"][0]["process"], "android.other")


class SmokeWindowTests(unittest.TestCase):
    def test_blank_webview_is_not_ready(self):
        tree = ET.fromstring(f'<hierarchy><node package="{PACKAGE}" class="android.webkit.WebView"/></hierarchy>')
        self.assertFalse(smoke.app_window_ready(tree))
        self.assertFalse(smoke.app_window_ready(entry_tree(button=False)))
        self.assertTrue(smoke.app_window_ready(entry_tree()))
        hidden = entry_tree()
        hidden.find('.//node[@class="android.widget.Button"]').set("bounds", "[0,0][0,0]")
        self.assertFalse(smoke.app_window_ready(hidden))

    def test_anr_is_a_failure_not_a_wait_button_to_dismiss(self):
        tree = ET.fromstring('<hierarchy><node resource-id="android:id/aerr_wait" text="Wait"/></hierarchy>')
        self.assertTrue(smoke.app_failure_dialog(tree))

    def test_failed_adb_dumps_retry_three_times_then_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ui.xml"
            path.write_text(ET.tostring(entry_tree(), encoding="unicode"), encoding="utf-8")
            failed = subprocess.CompletedProcess([], 1, "", "uiautomator failed")
            with patch.object(smoke.subprocess, "run", return_value=failed) as run, patch.object(smoke.time, "sleep"):
                with self.assertRaisesRegex(RuntimeError, "after 3 attempts"):
                    smoke.dump(path, "cold")
            self.assertEqual(run.call_count, 3)

    def test_pid_change_during_smoke_fails(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(smoke, "EVIDENCE", Path(directory)), \
             patch.object(smoke, "app_pid", side_effect=[100, 200]), patch.object(smoke.sys, "argv", ["smoke", "cold"]):
            with self.assertRaisesRegex(RuntimeError, "restarted unexpectedly"):
                smoke.main()

    def test_entry_requires_two_stable_observations(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(smoke, "EVIDENCE", Path(directory)), \
             patch.object(smoke, "app_pid", return_value=100), patch.object(smoke, "dump", return_value=entry_tree()) as dump, \
             patch.object(smoke.time, "sleep"), patch.object(smoke.sys, "argv", ["smoke", "cold"]):
            self.assertEqual(smoke.main(), 0)
            self.assertEqual(dump.call_count, 2)
            self.assertTrue((Path(directory) / "cold-ready.json").is_file())


if __name__ == "__main__":
    unittest.main()
