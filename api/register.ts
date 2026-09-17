/**
 * POST /api/register — Vercel serverless function.
 *
 * The Google Sheet is the database for this deployment (see /_lib/sheetDb.ts):
 * every submission reads current rows to check for a duplicate and to count
 * the event's capacity, then appends. Response shape matches what
 * registration.html already expects, so the frontend needed no changes.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { findEvent } from "./_lib/events.js";
import { appendRow, fetchAllRows, generateUniqueRegCode } from "./_lib/sheetDb.js";

function isValidEmail(email: string): boolean {
  return /^[\w.-]+@[\w.-]+\.\w+$/.test(email.trim());
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const body = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body) || {};

  const fullName = String(body.full_name || "").trim();
  const enrollmentId = String(body.enrollment_id || "").trim().toUpperCase();
  const department = String(body.department || "").trim();
  const academicYear = String(body.academic_year || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const phone = String(body.phone || "").trim();
  const eventId = body.event_id ? String(body.event_id) : null;
  const eventName = String(body.event_name || "").trim();
  const additionalInfo = String(body.additional_info || "").trim();

  const errors: string[] = [];
  if (!fullName) errors.push("Full Name is required.");
  if (!enrollmentId) errors.push("University Enrollment / Roll No. is required.");
  if (!department) errors.push("School / Department is required.");
  if (!academicYear) errors.push("Academic Year is required.");
  if (!email || !isValidEmail(email)) errors.push("A valid University or Personal Email address is required.");
  if (!phone || digitsOnly(phone).length < 10) errors.push("A valid WhatsApp/Phone number (at least 10 digits) is required.");
  if (errors.length) {
    res.status(400).json({ error: "Validation Error", messages: errors });
    return;
  }

  const event = findEvent(eventId, eventName);
  if (!event) {
    res.status(404).json({
      error: "Event Not Found",
      messages: ["The selected event is either inactive, closed, or does not exist."],
    });
    return;
  }

  let rows;
  try {
    rows = await fetchAllRows();
  } catch (err) {
    res.status(502).json({
      error: "Sheet Unavailable",
      messages: [String((err as Error).message || err)],
    });
    return;
  }

  const eventRows = rows.filter(
    (r) => r["Event Name"] === event.title && r["Registration Status"] !== "cancelled"
  );

  if (event.capacity > 0 && eventRows.length >= event.capacity) {
    res.status(400).json({
      error: "Capacity Reached",
      messages: [
        `Registration for '${event.title}' is currently closed because it has reached maximum capacity (${event.capacity} attendees).`,
      ],
    });
    return;
  }

  const duplicate = eventRows.find((r) => r["Enrollment / Roll No."] === enrollmentId);
  if (duplicate) {
    res.status(409).json({
      error: "Duplicate Registration",
      message: `Student with Enrollment ID '${enrollmentId}' has already registered for '${event.title}'. Registration Pass: ${duplicate["Registration Code"]}`,
      reg_code: duplicate["Registration Code"],
    });
    return;
  }

  const regCode = generateUniqueRegCode(rows);

  try {
    await appendRow({
      reg_code: regCode,
      full_name: fullName,
      enrollment_id: enrollmentId,
      email,
      phone,
      department,
      academic_year: academicYear,
      event_name: event.title,
      event_date: event.event_date,
      event_time: event.event_time,
      venue: event.venue,
      event_type: event.category,
      additional_info: additionalInfo,
    });
  } catch (err) {
    res.status(502).json({
      error: "Sheet Write Failed",
      messages: [String((err as Error).message || err)],
    });
    return;
  }

  res.status(201).json({
    success: true,
    message: "Registration completed successfully!",
    registration: {
      reg_code: regCode,
      full_name: fullName,
      enrollment_id: enrollmentId,
      department,
      academic_year: academicYear,
      email,
      phone,
      event_name: event.title,
      event_date: event.event_date,
      event_time: event.event_time,
      venue: event.venue,
      status: "confirmed",
      attendance_status: "pending",
      created_at: new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
    },
  });
}
