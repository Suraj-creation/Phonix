/**
 * Phoenix Club — Google Sheets mirror (Node/Express backend).
 *
 * Mirrors every confirmed registration into the club Google Sheet through an
 * Apps Script Web App. See google-sheets-webapp.gs for the deploy steps.
 *
 * SQLite remains the source of truth; this is a committee-facing mirror. A push
 * never blocks and never fails a registration. Unreachable pushes are appended
 * to sheets_sync_failed.jsonl so nothing is lost.
 *
 * Environment:
 *   SHEETS_WEBHOOK_URL     the /exec URL of the deployed Apps Script Web App
 *   SHEETS_WEBHOOK_SECRET  must match SHARED_SECRET inside that script
 */

import fs from "fs";
import path from "path";

// process.cwd() to match server.ts:12. import.meta.url would break the
// `npm run build` bundle, which esbuild emits as CJS.
const BASE_DIR = process.cwd();
const FAILED_LOG = path.join(BASE_DIR, "sheets_sync_failed.jsonl");
const TIMEOUT_MS = 10000;

export interface SheetPayload {
  reg_code: string;
  full_name: string;
  enrollment_id: string;
  email: string;
  phone: string;
  department: string;
  academic_year: string;
  event_name: string;
  event_date?: string;
  event_time?: string;
  venue?: string;
  event_type?: string;
  status?: string;
  attendance_status?: string;
  payment_status?: string;
  additional_info?: string;
  source?: string;
  db_id?: number | string;
}

export function isEnabled(): boolean {
  return Boolean((process.env.SHEETS_WEBHOOK_URL || "").trim());
}

export function buildPayload(
  registration: Record<string, any>,
  event: Record<string, any>,
  additionalInfo = ""
): SheetPayload {
  return {
    reg_code: registration.reg_code ?? "",
    full_name: registration.full_name ?? "",
    enrollment_id: registration.enrollment_id ?? "",
    email: registration.email ?? "",
    phone: registration.phone ?? "",
    department: registration.department ?? "",
    academic_year: registration.academic_year ?? "",
    event_name: event.title ?? registration.event_name ?? "",
    event_date: event.event_date ?? "",
    event_time: event.event_time ?? "",
    venue: event.venue ?? "",
    event_type: event.event_type ?? event.category ?? "",
    status: registration.status ?? "confirmed",
    attendance_status: registration.attendance_status ?? "pending",
    payment_status: registration.payment_status ?? "free",
    additional_info: additionalInfo,
    source: "Website Form",
    db_id: registration.id ?? "",
  };
}

async function post(payload: SheetPayload): Promise<{ ok: boolean; detail: string }> {
  const url = (process.env.SHEETS_WEBHOOK_URL || "").trim();
  const secret = (process.env.SHEETS_WEBHOOK_SECRET || "").trim();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, secret }),
      signal: controller.signal,
    });
    const raw = await resp.text();
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, detail: `non-JSON response: ${raw.slice(0, 200)}` };
    }
    if (parsed.ok) return { ok: true, detail: parsed.action ?? "ok" };
    return { ok: false, detail: parsed.error ?? "unknown error" };
  } catch (err) {
    return { ok: false, detail: String(err) };
  } finally {
    clearTimeout(timer);
  }
}

function recordFailure(payload: SheetPayload, detail: string): void {
  try {
    fs.appendFileSync(FAILED_LOG, JSON.stringify({ payload, error: detail }) + "\n", "utf-8");
  } catch {
    /* logging must never throw */
  }
}

/** Mirror one registration without blocking the response. */
export function pushAsync(payload: SheetPayload): void {
  if (!isEnabled()) return;
  void post(payload).then(({ ok, detail }) => {
    if (ok) {
      console.log(`[sheets] ${payload.reg_code} ${detail}`);
    } else {
      console.warn(`[sheets] FAILED ${payload.reg_code}: ${detail}`);
      recordFailure(payload, detail);
    }
  });
}

/** Replay everything in the failure log. */
export async function retryFailed(): Promise<{ sent: number; remaining: number }> {
  if (!fs.existsSync(FAILED_LOG) || !isEnabled()) return { sent: 0, remaining: 0 };
  const entries = fs
    .readFileSync(FAILED_LOG, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

  let sent = 0;
  const remaining: any[] = [];
  for (const entry of entries) {
    const { ok, detail } = await post(entry.payload);
    if (ok) sent++;
    else remaining.push({ ...entry, error: detail });
  }
  fs.writeFileSync(FAILED_LOG, remaining.map((e) => JSON.stringify(e)).join("\n") + (remaining.length ? "\n" : ""), "utf-8");
  return { sent, remaining: remaining.length };
}
