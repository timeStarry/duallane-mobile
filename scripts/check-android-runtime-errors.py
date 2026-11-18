#!/usr/bin/env python3
"""Classify smoke-run app crashes/ANRs using logcat PID and process evidence."""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

LOG_LINE = re.compile(r"^\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\s+(\d+)\s+\d+\s+[VDIWEF]\s+([^:]+):\s?(.*)$")


def classify_runtime(log: str, evidence: list[dict[str, object]], package: str) -> dict[str, object]:
    app_pids = {int(item["pid"]) for item in evidence if item.get("kind") == "app" and item.get("name") == package}
    process_names: dict[int, str] = {}
    for item in evidence:
        if item.get("kind") == "automation" and "uiautomator" in str(item.get("name", "")):
            process_names[int(item["pid"])] = str(item["name"])
    records: list[tuple[int, str, str]] = []
    for line in log.splitlines():
        match = LOG_LINE.match(line)
        if not match:
            continue
        pid, tag, message = int(match[1]), match[2].strip(), match[3]
        records.append((pid, tag, message))
        process = re.search(r"\bProcess:\s*([^,\s]+),\s*PID:\s*(\d+)", message)
        started = re.search(r"\bStart proc\s+(\d+):([^/\s]+)", message)
        if process and tag == "AndroidRuntime":
            process_names[int(process[2])] = process[1]
        if started and tag == "ActivityManager":
            process_names[int(started[1])] = started[2]
    failures: list[dict[str, object]] = []
    external: list[dict[str, object]] = []
    package_pattern = re.escape(package) + r"(?=[:\s,\]\}>]|$)"
    for pid, tag, message in records:
        name = process_names.get(pid, "")
        is_app = pid in app_pids or name == package or name.startswith(package + ":")
        fatal = tag == "AndroidRuntime" and "FATAL EXCEPTION" in message
        native_crash = (tag in {"libc", "DEBUG", "crash_dump32", "crash_dump64"} and
                        ("Fatal signal" in message or (">>>" in message and re.search(package_pattern, message))))
        app_anr = (tag in {"ActivityManager", "ActivityTaskManager", "am_anr", "am_crash"} and
                   re.search(package_pattern, message) and
                   ("ANR in " in message or tag in {"am_anr", "am_crash"}))
        if app_anr:
            failures.append({"kind": "app_crash" if tag == "am_crash" else "app_anr", "pid": pid, "tag": tag})
        elif native_crash and (is_app or re.search(package_pattern, message)):
            failures.append({"kind": "app_native_crash", "pid": pid, "tag": tag})
        elif fatal:
            if is_app:
                failures.append({"kind": "app_crash", "pid": pid, "tag": tag})
            elif name:
                external.append({"kind": "other_process_crash", "pid": pid, "process": name})
            else:
                # A missing Process line is not evidence that the app was safe.
                failures.append({"kind": "unattributed_crash", "pid": pid, "tag": tag})
    if not app_pids:
        failures.append({"kind": "missing_app_process_evidence"})
    return {"status": "FAIL" if failures else "PASS", "failures": failures, "externalCrashes": external,
            "observedAppPids": sorted(app_pids)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--log", type=Path, required=True)
    parser.add_argument("--process-evidence", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--package", default="com.timestarry.duallane")
    args = parser.parse_args()
    evidence = [json.loads(line) for line in args.process_evidence.read_text(encoding="utf-8").splitlines() if line.strip()]
    result = classify_runtime(args.log.read_text(encoding="utf-8", errors="replace"), evidence, args.package)
    args.report.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result))
    return 0 if result["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
