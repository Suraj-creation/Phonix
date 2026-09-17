/**
 * Phoenix Club — Google Sheet as the registration database (Vercel deployment).
 *
 * On Vercel there is no persistent filesystem, so the Sheet itself is the
 * source of truth for registrations: every request reads the current rows
 * before deciding duplicate/capacity, then appends through the same Apps
 * Script Web App used by the self-hosted Flask/Node backends
 * (see /google-sheets-webapp.gs).
 *
 * Configure via environment variables (Vercel Project Settings):
 *   SHEETS_WEBHOOK_URL     the deployed Apps Script /exec URL
 *   SHEETS_WEBHOOK_SECRET  must match SHARED_SECRET in that script
 */

export interface SheetRow {
  "Timestamp": string;
  "Registration Code": string;
  "Full Name": string;
  "Enrollment / Roll No.": string;
  "Email": string;
  "Phone": string;
  "School / Department": string;
  "Academic Year": string;
  "Event Name": string;
  "Event Date": string;
  "Event Time": string;
  "Venue": string;
  "Event Type": string;
  "Registration Status": string;
  "Attendance Status": string;
  "Payment Status": string;
  "Motivation / Notes": string;
  "Source": string;
  "DB Record ID": string;
}

export interface RegistrationInput {
  reg_code: string;
  full_name: string;
  enrollment_id: string;
  email: string;
  phone: string;
  department: string;
  academic_year: string;
  event_name: string;
  event_date: string;
  event_time: string;
  venue: string;
  event_type: string;
  additional_info: string;
}

function config() {
  const url = (process.env.SHEETS_WEBHOOK_URL || "").trim();
  const secret = (process.env.SHEETS_WEBHOOK_SECRET || "").trim();
  if (!url) {
    throw new Error(
      "SHEETS_WEBHOOK_URL is not set. Deploy google-sheets-webapp.gs as a Web App " +
      "and add its /exec URL to the project's environment variables."
    );
  }
  return { url, secret };
}

/** Fetches every registration row currently in the sheet. */
export async function fetchAllRows(): Promise<SheetRow[]> {
  const { url, secret } = config();
  const sep = url.includes("?") ? "&" : "?";
  const resp = await fetch(`${url}${sep}action=rows&secret=${encodeURIComponent(secret)}`, {
    method: "GET",
  });
  const data = (await resp.json()) as { ok: boolean; error?: string; rows?: SheetRow[] };
  if (!data.ok) throw new Error(`Sheet read failed: ${data.error || "unknown error"}`);
  return data.rows as SheetRow[];
}

/** Appends (or updates, if the registration code already exists) one row. */
export async function appendRow(reg: RegistrationInput): Promise<void> {
  const { url, secret } = config();
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...reg, source: "Website Form", secret }),
  });
  const data = (await resp.json()) as { ok: boolean; error?: string };
  if (!data.ok) throw new Error(`Sheet write failed: ${data.error || "unknown error"}`);
}

/** Generates a registration code not already present among the given rows. */
export function generateUniqueRegCode(existingRows: SheetRow[]): string {
  const taken = new Set(existingRows.map((r) => r["Registration Code"]));
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  for (let attempt = 0; attempt < 20; attempt++) {
    let suffix = "";
    for (let i = 0; i < 5; i++) {
      suffix += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const code = `PHX-2026-${suffix}`;
    if (!taken.has(code)) return code;
  }
  // Astronomically unlikely with a 36^5 keyspace, but never loop forever.
  return `PHX-2026-${Date.now().toString(36).toUpperCase()}`;
}
