"""
Phoenix Club — Google Sheets mirror.

Every confirmed registration is also appended to the club's Google Sheet via an
Apps Script Web App (see google-sheets-webapp.gs for the deploy steps).

Design notes:
  * SQLite stays the source of truth. The sheet is a mirror for the committee.
  * Pushing happens on a daemon thread so a slow Google round-trip never adds
    latency to the student's registration request.
  * A push can never fail a registration. If Google is unreachable the payload
    is written to sheets_sync_failed.jsonl so nothing is lost, and
    `python sheets_sync.py --retry` replays the backlog.

Configure with two environment variables:
    SHEETS_WEBHOOK_URL     the /exec URL of the deployed Apps Script Web App
    SHEETS_WEBHOOK_SECRET  must match SHARED_SECRET inside that script
"""

import json
import os
import threading
import urllib.error
import urllib.request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FAILED_LOG = os.path.join(BASE_DIR, "sheets_sync_failed.jsonl")
TIMEOUT_SECONDS = 10


def _url():
    return (os.environ.get("SHEETS_WEBHOOK_URL") or "").strip()


def _secret():
    return (os.environ.get("SHEETS_WEBHOOK_SECRET") or "").strip()


def is_enabled():
    """True when a webhook URL is configured."""
    return bool(_url())


def build_payload(registration, event, additional_info=""):
    """Flatten a registration + its event into the sheet's column contract."""
    return {
        "reg_code": registration.get("reg_code", ""),
        "full_name": registration.get("full_name", ""),
        "enrollment_id": registration.get("enrollment_id", ""),
        "email": registration.get("email", ""),
        "phone": registration.get("phone", ""),
        "department": registration.get("department", ""),
        "academic_year": registration.get("academic_year", ""),
        "event_name": event.get("title", "") or registration.get("event_name", ""),
        "event_date": event.get("event_date", ""),
        "event_time": event.get("event_time", ""),
        "venue": event.get("venue", ""),
        "event_type": event.get("event_type", "") or event.get("category", ""),
        "status": registration.get("status", "confirmed"),
        "attendance_status": registration.get("attendance_status", "pending"),
        "payment_status": registration.get("payment_status", "free"),
        "additional_info": additional_info,
        "source": "Website Form",
        "db_id": registration.get("id", ""),
    }


def _post(payload):
    """Blocking POST. Returns (ok, detail)."""
    body = dict(payload)
    body["secret"] = _secret()
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        _url(),
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
            raw = resp.read().decode("utf-8", "replace")
        try:
            parsed = json.loads(raw)
        except ValueError:
            return False, f"non-JSON response: {raw[:200]}"
        if parsed.get("ok"):
            return True, parsed.get("action", "ok")
        return False, parsed.get("error", "unknown error")
    except (urllib.error.URLError, OSError) as exc:
        return False, str(exc)


def _record_failure(payload, detail):
    try:
        with open(FAILED_LOG, "a", encoding="utf-8") as fh:
            fh.write(json.dumps({"payload": payload, "error": detail}) + "\n")
    except OSError:
        pass


def _worker(payload):
    ok, detail = _post(payload)
    if ok:
        print(f"[sheets] {payload.get('reg_code')} {detail}")
    else:
        print(f"[sheets] FAILED {payload.get('reg_code')}: {detail}")
        _record_failure(payload, detail)


def push_async(payload):
    """Mirror one registration to the sheet without blocking the request."""
    if not is_enabled():
        return
    threading.Thread(target=_worker, args=(payload,), daemon=True).start()


def retry_failed():
    """Replay everything in the failure log. Returns (sent, still_failing)."""
    if not os.path.exists(FAILED_LOG):
        print("[sheets] nothing to retry")
        return 0, 0
    if not is_enabled():
        print("[sheets] SHEETS_WEBHOOK_URL is not set")
        return 0, 0

    with open(FAILED_LOG, encoding="utf-8") as fh:
        entries = [json.loads(line) for line in fh if line.strip()]

    sent, remaining = 0, []
    for entry in entries:
        ok, detail = _post(entry["payload"])
        if ok:
            sent += 1
        else:
            entry["error"] = detail
            remaining.append(entry)

    with open(FAILED_LOG, "w", encoding="utf-8") as fh:
        for entry in remaining:
            fh.write(json.dumps(entry) + "\n")

    print(f"[sheets] retried {len(entries)}: {sent} sent, {len(remaining)} still failing")
    return sent, len(remaining)


if __name__ == "__main__":
    import sys

    if "--retry" in sys.argv:
        retry_failed()
    elif "--test" in sys.argv:
        if not is_enabled():
            print("SHEETS_WEBHOOK_URL is not set.")
            sys.exit(1)
        ok, detail = _post({
            "reg_code": "PHX-2026-TEST1",
            "full_name": "Connection Test",
            "enrollment_id": "TEST000",
            "email": "test@nuv.ac.in",
            "phone": "+91 00000 00000",
            "department": "School of Science",
            "academic_year": "1st Year (Freshman)",
            "event_name": "Connection Test",
            "additional_info": "Delete this row; written by sheets_sync.py --test",
            "source": "Connection Test",
        })
        print("OK:" if ok else "FAILED:", detail)
        sys.exit(0 if ok else 1)
    else:
        print(__doc__)
