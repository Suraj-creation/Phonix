/**
 * GET /api/events/active — Vercel serverless function.
 *
 * Progressive enhancement for registration.html: on success it replaces the
 * static <select> with this live list (adding live "FULL" state from the
 * Sheet's row counts); on any failure the page already falls back to its
 * static options, so this endpoint can degrade without breaking the form.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { listActiveEvents } from "../_lib/events.js";
import { fetchAllRows } from "../_lib/sheetDb.js";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const events = listActiveEvents();

  let rows: Awaited<ReturnType<typeof fetchAllRows>> = [];
  try {
    rows = await fetchAllRows();
  } catch {
    // Capacity becomes unknown, not fatal — every event just reports not full.
  }

  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row["Registration Status"] === "cancelled") continue;
    const key = row["Event Name"];
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  res.status(200).json({
    events: events.map((e) => ({
      id: e.id,
      title: e.title,
      category: e.category,
      event_date: e.event_date,
      event_time: e.event_time,
      venue: e.venue,
      is_full: e.capacity > 0 && (counts.get(e.title) || 0) >= e.capacity,
    })),
  });
}
