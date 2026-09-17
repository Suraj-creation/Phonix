import express, { Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { DatabaseSync } from "node:sqlite";
import ExcelJS from "exceljs";
import * as sheetsSync from "./sheetsSync.js";

const app = express();
const PORT = 3000;
const BASE_DIR = process.cwd();
const DB_PATH = path.join(BASE_DIR, "phoenix_club.db");

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ==============================================================================
// Database Setup & Helpers
// ==============================================================================
let db: DatabaseSync;

function getDb(): DatabaseSync {
  if (!db) {
    db = new DatabaseSync(DB_PATH);
    db.exec("PRAGMA foreign_keys = ON;");
  }
  return db;
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(12).toString("hex");
  const key = crypto.scryptSync(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 128 * 1024 * 1024,
  });
  return `scrypt:32768:8:1$${salt}$${key.toString("hex")}`;
}

function verifyPassword(password: string, hashStr: string): boolean {
  try {
    if (!hashStr) return false;
    if (hashStr.startsWith("scrypt:")) {
      const parts = hashStr.split("$");
      const method = parts[0];
      const salt = parts[1];
      const hash = parts[2];
      const [, N, r, p] = method.split(":");
      const derivedKey = crypto.scryptSync(password, salt, hash.length / 2, {
        N: parseInt(N, 10),
        r: parseInt(r, 10),
        p: parseInt(p, 10),
        maxmem: 128 * 1024 * 1024,
      });
      return derivedKey.toString("hex") === hash;
    }
    return false;
  } catch (err) {
    console.error("Password verify error:", err);
    return false;
  }
}

function initDb() {
  const conn = getDb();

  conn.exec(`
    CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'Admin' CHECK(role IN ('Super Admin', 'Admin', 'Viewer')),
        full_name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login DATETIME,
        is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT,
        event_date TEXT NOT NULL,
        event_time TEXT NOT NULL,
        venue TEXT NOT NULL,
        capacity INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        reg_open_date TEXT,
        reg_close_date TEXT,
        is_archived INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        enrollment_id TEXT UNIQUE NOT NULL,
        full_name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT NOT NULL,
        department TEXT NOT NULL,
        academic_year TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS registrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reg_code TEXT UNIQUE NOT NULL,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        enrollment_id TEXT NOT NULL,
        full_name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT NOT NULL,
        department TEXT NOT NULL,
        academic_year TEXT NOT NULL,
        event_name TEXT NOT NULL,
        attendance_status TEXT DEFAULT 'pending' CHECK(attendance_status IN ('present', 'absent', 'pending')),
        payment_status TEXT DEFAULT 'free' CHECK(payment_status IN ('free', 'paid', 'exempt', 'pending')),
        status TEXT DEFAULT 'registered' CHECK(status IN ('registered', 'confirmed', 'cancelled', 'waitlist')),
        additional_info TEXT,
        is_demo INTEGER DEFAULT 0,
        is_archived INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS attendance_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        registration_id INTEGER NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        marked_by_admin TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('present', 'absent', 'pending')),
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        notes TEXT
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_id INTEGER,
        admin_name TEXT NOT NULL,
        action TEXT NOT NULL,
        record_type TEXT NOT NULL,
        record_id TEXT,
        details TEXT,
        ip_address TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_reg_enrollment ON registrations(enrollment_id);
    CREATE INDEX IF NOT EXISTS idx_reg_event ON registrations(event_id);
    CREATE INDEX IF NOT EXISTS idx_reg_status ON registrations(status);
    CREATE INDEX IF NOT EXISTS idx_reg_attendance ON registrations(attendance_status);
    CREATE INDEX IF NOT EXISTS idx_reg_archived ON registrations(is_archived);
    CREATE INDEX IF NOT EXISTS idx_students_enrollment ON students(enrollment_id);
    CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity_logs(timestamp);
  `);
}

function seedDefaultData() {
  const conn = getDb();

  // Super Admin
  const checkAdmin = conn.prepare("SELECT id FROM admins WHERE username = ?").get("admin");
  if (!checkAdmin) {
    conn.prepare(`
      INSERT INTO admins (username, email, password_hash, role, full_name)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      "admin",
      "admin@phoenixnuv.ac.in",
      hashPassword("Admin@Phoenix2026"),
      "Super Admin",
      "Phoenix Club Super Administrator"
    );
  }

  // Admin Lead
  const checkLead = conn.prepare("SELECT id FROM admins WHERE username = ?").get("phoenix_lead");
  if (!checkLead) {
    conn.prepare(`
      INSERT INTO admins (username, email, password_hash, role, full_name)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      "phoenix_lead",
      "lead@phoenixnuv.ac.in",
      hashPassword("Lead@Phoenix2026"),
      "Admin",
      "Club Secretary / Event Coordinator"
    );
  }

  // Viewer
  const checkViewer = conn.prepare("SELECT id FROM admins WHERE username = ?").get("faculty_viewer");
  if (!checkViewer) {
    conn.prepare(`
      INSERT INTO admins (username, email, password_hash, role, full_name)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      "faculty_viewer",
      "viewer@phoenixnuv.ac.in",
      hashPassword("Viewer@Phoenix2026"),
      "Viewer",
      "Faculty Mentor (Read-Only Viewer)"
    );
  }

  // Default Flagship Events
  const events = [
    [
      "EVT-INVESTITURE-2026",
      "Investiture Ceremony 2026",
      "Flagship Ceremony",
      "Official induction of student leadership council and badge pinning ceremony.",
      "2026-09-16",
      "10:00 AM",
      "NUV Main Auditorium",
      250,
      1,
      "2026-08-01",
      "2026-09-16"
    ],
    [
      "EVT-WILDLIFE-2026",
      "Wildlife Week Celebration 2026",
      "Awareness Drive",
      "Biodiversity photo exhibition, wildlife quiz, documentary screening and nature trek.",
      "2026-09-19",
      "11:30 AM",
      "Central Courtyard & Amphitheatre",
      300,
      1,
      "2026-08-15",
      "2026-09-19"
    ],
    [
      "EVT-GUEST-LECTURE-2026",
      "Distinguished Guest Lecture: Modern Biotechnology",
      "Guest Lecture",
      "Keynote address by renowned visiting bio-scientist on CRISPR gene editing and ethical research.",
      "2026-09-22",
      "02:30 PM",
      "Seminar Hall A",
      120,
      1,
      "2026-08-20",
      "2026-09-22"
    ],
    [
      "EVT-WORKSHOP-SCIENCE-2026",
      "Science & Innovation Hands-On Workshop",
      "Workshop",
      "Interactive hardware interfacing, IoT sensor nodes, and scientific modeling laboratory.",
      "2026-09-26",
      "09:30 AM",
      "Innovation Lab 2",
      60,
      1,
      "2026-08-25",
      "2026-09-25"
    ],
    [
      "EVT-TEACHERS-DAY-2026",
      "Teacher's Day Celebration & Felicitation",
      "Community Celebration",
      "Honoring dedicated university professors, mentors, and academic guides.",
      "2026-09-05",
      "02:00 PM",
      "Multi-Purpose Hall",
      150,
      1,
      "2026-08-10",
      "2026-09-05"
    ],
    [
      "EVT-MIXER-2026",
      "Phoenix Community Mixer & Orientation",
      "Student Networking",
      "Welcoming freshers, interdisciplinary networking, and club orientation.",
      "2026-09-28",
      "04:00 PM",
      "Student Center Lounge",
      180,
      1,
      "2026-09-01",
      "2026-09-28"
    ],
    [
      "EVT-MEMBERSHIP-2026",
      "Annual General Club Membership 2026",
      "All-Access Pass",
      "Year-round all-access membership pass to all Phoenix Club initiatives, workshops, and perks.",
      "2026-10-31",
      "11:59 PM",
      "Navrachana University Campus",
      500,
      1,
      "2026-08-01",
      "2026-10-31"
    ]
  ];

  const checkEvt = conn.prepare("SELECT id FROM events WHERE code = ?");
  const insertEvt = conn.prepare(`
    INSERT INTO events (code, title, category, description, event_date, event_time, venue, capacity, is_active, reg_open_date, reg_close_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const ev of events) {
    if (!checkEvt.get(ev[0])) {
      insertEvt.run(...(ev as [string, string, string, string, string, string, string, number, number, string, string]));
    }
  }

  // Settings
  const settingsSeed = [
    ["club_name", "Phoenix Club — Navrachana University"],
    ["university_name", "Navrachana University, Vadodara"],
    ["contact_email", "phoenixclub@nuv.ac.in"],
    ["registrations_open", "true"],
    ["allow_cancellations", "false"],
    ["system_notice", "Welcome to the Phoenix Club Management Portal. Academic Term 2026."]
  ];
  const insertSetting = conn.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
  for (const [k, v] of settingsSeed) {
    insertSetting.run(k, v);
  }
}

initDb();
seedDefaultData();

// ==============================================================================
// Authentication & Sessions
// ==============================================================================
interface AdminUser {
  id: number;
  username: string;
  email: string;
  role: string;
  full_name: string;
  is_active: number;
}

interface SessionData {
  admin: AdminUser;
  loginTime: number;
}

const activeSessions = new Map<string, SessionData>();
const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;

function logActivity(
  adminName: string,
  action: string,
  recordType: string,
  details: string = "",
  recordId?: string | number | null,
  ipAddress?: string
) {
  try {
    const conn = getDb();
    conn.prepare(`
      INSERT INTO activity_logs (admin_name, action, record_type, record_id, details, ip_address)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      adminName || "Anonymous",
      action,
      recordType,
      recordId ? String(recordId) : null,
      details,
      ipAddress || "127.0.0.1"
    );
  } catch (err) {
    console.error("Failed to log activity:", err);
  }
}

function getSessionAdmin(req: Request): AdminUser | null {
  const token = req.cookies?.phoenix_session || req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) return null;

  const session = activeSessions.get(token);
  if (!session) return null;

  if (Date.now() - session.loginTime > SESSION_LIFETIME_MS) {
    activeSessions.delete(token);
    return null;
  }

  // Verify admin is still active in database
  const conn = getDb();
  const row = (conn.prepare("SELECT id, username, email, role, full_name, is_active FROM admins WHERE id = ? AND is_active = 1").get(session.admin.id) as unknown) as AdminUser | undefined;
  if (!row) {
    activeSessions.delete(token);
    return null;
  }

  return row;
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const admin = getSessionAdmin(req);
  if (!admin) {
    if (req.path.startsWith("/api/")) {
      res.status(401).json({ error: "Unauthorized. Please log in to access this resource." });
      return;
    }
    res.redirect("/admin/login");
    return;
  }
  (req as any).admin = admin;
  next();
}

function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const admin = (req as any).admin as AdminUser;
    if (!admin || !roles.includes(admin.role)) {
      if (req.path.startsWith("/api/")) {
        res.status(403).json({
          error: `Permission denied. Required roles: ${roles.join(", ")}. Current role: ${admin?.role || "none"}.`
        });
        return;
      }
      res.redirect("/admin/login");
      return;
    }
    next();
  };
}

function generateRegCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let suffix = "";
  for (let i = 0; i < 5; i++) {
    suffix += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `PHX-2026-${suffix}`;
}

function isValidEmail(email: string): boolean {
  const pattern = /^[\w\.-]+@[\w\.-]+\.\w+$/;
  return pattern.test(email.trim());
}

// ==============================================================================
// Public Website & Frontend Routes
// ==============================================================================

app.get("/admin/login", (req, res) => {
  const admin = getSessionAdmin(req);
  if (admin) {
    res.redirect("/admin/dashboard");
    return;
  }
  const loginHtmlPath = path.join(BASE_DIR, "templates", "admin_login.html");
  if (fs.existsSync(loginHtmlPath)) {
    res.sendFile(loginHtmlPath);
  } else {
    res.status(404).send("Admin login page not found.");
  }
});

app.get("/admin/dashboard", requireAuth, (req, res) => {
  const admin = (req as any).admin as AdminUser;
  const dashboardHtmlPath = path.join(BASE_DIR, "templates", "admin_dashboard.html");
  if (!fs.existsSync(dashboardHtmlPath)) {
    res.status(404).send("Admin dashboard template not found.");
    return;
  }

  let content = fs.readFileSync(dashboardHtmlPath, "utf-8");

  // Interpolate Jinja variables
  const isSuper = admin.role === "Super Admin";
  const isAdminOrSuper = admin.role === "Super Admin" || admin.role === "Admin";

  content = content.replaceAll("{{ admin.full_name or admin.username }}", admin.full_name || admin.username);
  content = content.replaceAll("{{ admin.role }}", admin.role);
  content = content.replaceAll('const currentUserRole = "{{ admin.role }}";', `const currentUserRole = "${admin.role}";`);

  const badgeClass = isSuper ? "role-super" : admin.role === "Admin" ? "role-admin" : "role-viewer";
  content = content.replace(
    /{%\s*if admin\.role == 'Super Admin'\s*%}role-super{%\s*elif admin\.role == 'Admin'\s*%}role-admin{%\s*else\s*%}role-viewer{%\s*endif\s*%}/g,
    badgeClass
  );

  // {% if admin.role in ['Super Admin', 'Admin'] %} ... {% endif %}
  content = content.replace(
    /{%\s*if admin\.role in \['Super Admin', 'Admin'\]\s*%}([\s\S]*?){%\s*endif\s*%}/g,
    (_, body) => (isAdminOrSuper ? body : "")
  );

  // {% if admin.role == 'Super Admin' %} ... {% else %} ... {% endif %}
  content = content.replace(
    /{%\s*if admin\.role == 'Super Admin'\s*%}([\s\S]*?){%\s*else\s*%}([\s\S]*?){%\s*endif\s*%}/g,
    (_, ifBody, elseBody) => (isSuper ? ifBody : elseBody)
  );

  // {% if admin.role == 'Super Admin' %} ... {% endif %}
  content = content.replace(
    /{%\s*if admin\.role == 'Super Admin'\s*%}([\s\S]*?){%\s*endif\s*%}/g,
    (_, body) => (isSuper ? body : "")
  );

  res.send(content);
});

// ==============================================================================
// Public API Endpoints
// ==============================================================================

app.get("/api/events/active", (req, res) => {
  const conn = getDb();
  const rows = conn.prepare(`
    SELECT 
        e.*,
        COUNT(r.id) as registered_count
    FROM events e
    LEFT JOIN registrations r ON e.id = r.event_id AND r.is_archived = 0
    WHERE e.is_active = 1 AND e.is_archived = 0
    GROUP BY e.id
    ORDER BY e.event_date ASC
  `).all() as any[];

  const events = rows.map((d) => {
    const capacity = Number(d.capacity) || 0;
    const regCount = Number(d.registered_count) || 0;
    return {
      ...d,
      is_full: capacity > 0 && regCount >= capacity,
      available_spots: capacity > 0 ? Math.max(0, capacity - regCount) : null
    };
  });

  res.json({ events });
});

app.post("/api/register", (req, res) => {
  const data = req.body || {};

  const fullName = (data.full_name || "").trim();
  const enrollmentId = (data.enrollment_id || "").trim().toUpperCase();
  const department = (data.department || "").trim();
  const academicYear = (data.academic_year || "").trim();
  const email = (data.email || "").trim().toLowerCase();
  const phone = (data.phone || "").trim();
  const eventId = data.event_id;
  const eventName = (data.event_name || "").trim();
  const additionalInfo = (data.additional_info || "").trim();

  const errors: string[] = [];
  if (!fullName) errors.push("Full Name is required.");
  if (!enrollmentId) errors.push("University Enrollment / Roll No. is required.");
  if (!department) errors.push("School / Department is required.");
  if (!academicYear) errors.push("Academic Year is required.");
  if (!email || !isValidEmail(email)) errors.push("A valid University or Personal Email address is required.");
  if (!phone || phone.replace(/\D/g, "").length < 10) errors.push("A valid WhatsApp/Phone number (at least 10 digits) is required.");

  if (errors.length > 0) {
    res.status(400).json({ error: "Validation Error", messages: errors });
    return;
  }

  const conn = getDb();

  // Resolve event
  let event: any = null;
  if (eventId) {
    event = conn.prepare("SELECT * FROM events WHERE id = ? AND is_active = 1 AND is_archived = 0").get(eventId);
  } else if (eventName) {
    event = conn.prepare("SELECT * FROM events WHERE (title = ? OR title LIKE ?) AND is_active = 1 AND is_archived = 0").get(eventName, `%${eventName}%`);
  }

  if (!event) {
    res.status(404).json({
      error: "Event Not Found",
      messages: ["The selected event is either inactive, closed, or does not exist."]
    });
    return;
  }

  // Check capacity
  const countRow = conn.prepare("SELECT COUNT(*) as count FROM registrations WHERE event_id = ? AND is_archived = 0").get(event.id) as any;
  const currentRegs = Number(countRow?.count || 0);
  if (event.capacity > 0 && currentRegs >= event.capacity) {
    res.status(400).json({
      error: "Capacity Reached",
      messages: [`Registration for '${event.title}' is currently closed because it has reached maximum capacity (${event.capacity} attendees).`]
    });
    return;
  }

  // Prevent duplicate registration
  const duplicate = conn.prepare(`
    SELECT reg_code, created_at FROM registrations
    WHERE enrollment_id = ? AND event_id = ? AND is_archived = 0
  `).get(enrollmentId, event.id) as any;

  if (duplicate) {
    res.status(409).json({
      error: "Duplicate Registration",
      message: `Student with Enrollment ID '${enrollmentId}' has already registered for '${event.title}'. Registration Pass: ${duplicate.reg_code}`,
      reg_code: duplicate.reg_code
    });
    return;
  }

  // Upsert student
  const stRow = conn.prepare("SELECT id FROM students WHERE enrollment_id = ?").get(enrollmentId) as any;
  let studentId: number;
  if (stRow) {
    studentId = stRow.id;
    conn.prepare(`
      UPDATE students
      SET full_name = ?, email = ?, phone = ?, department = ?, academic_year = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(fullName, email, phone, department, academicYear, studentId);
  } else {
    const resInsert = conn.prepare(`
      INSERT INTO students (enrollment_id, full_name, email, phone, department, academic_year)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(enrollmentId, fullName, email, phone, department, academicYear);
    studentId = Number(resInsert.lastInsertRowid);
  }

  // Generate unique reg_code
  let regCode = "";
  const checkCode = conn.prepare("SELECT id FROM registrations WHERE reg_code = ?");
  while (true) {
    regCode = generateRegCode();
    if (!checkCode.get(regCode)) break;
  }

  const insertReg = conn.prepare(`
    INSERT INTO registrations (
        reg_code, student_id, event_id, enrollment_id, full_name, email,
        phone, department, academic_year, event_name, attendance_status,
        payment_status, status, additional_info, is_demo
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'free', 'confirmed', ?, 0)
  `).run(
    regCode,
    studentId,
    event.id,
    enrollmentId,
    fullName,
    email,
    phone,
    department,
    academicYear,
    event.title,
    additionalInfo
  );

  const regId = Number(insertReg.lastInsertRowid);

  logActivity(
    "Student Form",
    "PUBLIC_REGISTRATION",
    "registration",
    `${fullName} (${enrollmentId}) registered for ${event.title}`,
    regId,
    req.ip || "127.0.0.1"
  );

  const registration = {
    id: regId,
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
    payment_status: "free",
    created_at: new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
  };

  // Mirror to the club Google Sheet. Fire-and-forget; SQLite above is the
  // source of truth and a Sheets outage can never fail a registration.
  sheetsSync.pushAsync(sheetsSync.buildPayload(registration, event, additionalInfo));

  res.status(201).json({
    success: true,
    message: "Registration completed successfully!",
    registration
  });
});

app.get("/api/check-registration", (req, res) => {
  const query = ((req.query.q as string) || "").trim();
  if (!query) {
    res.status(400).json({ error: "Search query parameter 'q' is required." });
    return;
  }

  const conn = getDb();
  const rows = conn.prepare(`
    SELECT r.*, e.event_date, e.event_time, e.venue
    FROM registrations r
    JOIN events e ON r.event_id = e.id
    WHERE (r.enrollment_id = ? OR r.reg_code = ? OR r.email = ?) AND r.is_archived = 0
    ORDER BY r.created_at DESC
  `).all(query.toUpperCase(), query.toUpperCase(), query.toLowerCase());

  res.json({ results: rows, count: rows.length });
});

// ==============================================================================
// Admin Auth API Endpoints
// ==============================================================================

app.post("/api/admin/login", (req, res) => {
  const data = req.body || {};
  const usernameOrEmail = (data.username || "").trim();
  const password = data.password || "";

  if (!usernameOrEmail || !password) {
    res.status(400).json({ error: "Username/Email and Password are required." });
    return;
  }

  const conn = getDb();
  const admin = (conn.prepare(`
    SELECT * FROM admins
    WHERE (username = ? OR email = ?) AND is_active = 1
  `).get(usernameOrEmail, usernameOrEmail.toLowerCase()) as unknown) as (AdminUser & { password_hash: string }) | undefined;

  if (!admin || !verifyPassword(password, admin.password_hash)) {
    logActivity("Anonymous", "FAILED_LOGIN_ATTEMPT", "auth", `Attempt for: ${usernameOrEmail}`, null, req.ip || "127.0.0.1");
    res.status(401).json({ error: "Invalid credentials. Please verify your email/username and password." });
    return;
  }

  // Update last login
  conn.prepare("UPDATE admins SET last_login = CURRENT_TIMESTAMP WHERE id = ?").run(admin.id);

  // Generate session token
  const token = crypto.randomBytes(32).toString("hex");
  activeSessions.set(token, {
    admin: {
      id: admin.id,
      username: admin.username,
      email: admin.email,
      role: admin.role,
      full_name: admin.full_name,
      is_active: admin.is_active
    },
    loginTime: Date.now()
  });

  res.cookie("phoenix_session", token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: SESSION_LIFETIME_MS
  });

  logActivity(admin.username, "ADMIN_LOGIN", "auth", `Admin '${admin.username}' logged in successfully.`, admin.id);

  res.json({
    success: true,
    token,
    admin: {
      id: admin.id,
      username: admin.username,
      email: admin.email,
      role: admin.role,
      full_name: admin.full_name
    }
  });
});

app.post("/api/admin/logout", (req, res) => {
  const token = req.cookies?.phoenix_session || req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (token) {
    const s = activeSessions.get(token);
    if (s) {
      logActivity(s.admin.username, "ADMIN_LOGOUT", "auth", `Admin '${s.admin.username}' logged out.`, s.admin.id);
    }
    activeSessions.delete(token);
  }
  res.clearCookie("phoenix_session");
  res.json({ success: true, message: "Logged out successfully." });
});

app.get("/api/admin/me", requireAuth, (req, res) => {
  const admin = (req as any).admin as AdminUser;
  res.json({ admin });
});

app.post("/api/admin/change-password", requireAuth, (req, res) => {
  const admin = (req as any).admin as AdminUser;
  const { current_password, new_password } = req.body || {};

  if (!current_password || !new_password) {
    res.status(400).json({ error: "Current password and new password are required." });
    return;
  }
  if (new_password.length < 6) {
    res.status(400).json({ error: "New password must be at least 6 characters long." });
    return;
  }

  const conn = getDb();
  const row = conn.prepare("SELECT password_hash FROM admins WHERE id = ?").get(admin.id) as { password_hash: string } | undefined;
  if (!row || !verifyPassword(current_password, row.password_hash)) {
    res.status(400).json({ error: "Current password does not match our records." });
    return;
  }

  conn.prepare("UPDATE admins SET password_hash = ? WHERE id = ?").run(hashPassword(new_password), admin.id);
  logActivity(admin.username, "CHANGE_PASSWORD", "auth", "Password updated successfully", admin.id);
  res.json({ success: true, message: "Password updated successfully." });
});

// ==============================================================================
// Admin Analytics Endpoints
// ==============================================================================

app.get("/api/admin/analytics/overview", requireAuth, (req, res) => {
  const conn = getDb();

  const totalRegs = (conn.prepare("SELECT COUNT(*) as total FROM registrations WHERE is_archived = 0").get() as any).total;
  const todayStr = new Date().toISOString().split("T")[0];
  const regsToday = (conn.prepare("SELECT COUNT(*) as today FROM registrations WHERE date(created_at) = date(?) AND is_archived = 0").get(todayStr) as any).today;
  const totalEvents = (conn.prepare("SELECT COUNT(*) as total FROM events WHERE is_archived = 0").get() as any).total;
  const activeEvents = (conn.prepare("SELECT COUNT(*) as active FROM events WHERE is_active = 1 AND is_archived = 0").get() as any).active;
  const totalStudents = (conn.prepare("SELECT COUNT(*) as total FROM students").get() as any).total;

  const totalPresent = (conn.prepare("SELECT COUNT(*) as present FROM registrations WHERE attendance_status = 'present' AND is_archived = 0").get() as any).present;
  const totalAbsent = (conn.prepare("SELECT COUNT(*) as absent FROM registrations WHERE attendance_status = 'absent' AND is_archived = 0").get() as any).absent;
  const totalPending = (conn.prepare("SELECT COUNT(*) as pending FROM registrations WHERE attendance_status = 'pending' AND is_archived = 0").get() as any).pending;

  const attendanceRate = totalRegs > 0 ? Number(((totalPresent / totalRegs) * 100).toFixed(1)) : 0.0;

  const timeline = conn.prepare(`
    SELECT date(created_at) as reg_date, COUNT(*) as count
    FROM registrations
    WHERE is_archived = 0
    GROUP BY date(created_at)
    ORDER BY reg_date ASC
    LIMIT 30
  `).all();

  const eventDistribution = conn.prepare(`
    SELECT 
        e.id, e.title, e.capacity,
        COUNT(r.id) as reg_count,
        SUM(CASE WHEN r.attendance_status = 'present' THEN 1 ELSE 0 END) as present_count
    FROM events e
    LEFT JOIN registrations r ON e.id = r.event_id AND r.is_archived = 0
    WHERE e.is_archived = 0
    GROUP BY e.id
    ORDER BY reg_count DESC
  `).all();

  const deptDistribution = conn.prepare(`
    SELECT department, COUNT(*) as count
    FROM registrations
    WHERE is_archived = 0
    GROUP BY department
    ORDER BY count DESC
  `).all();

  const yearDistribution = conn.prepare(`
    SELECT academic_year, COUNT(*) as count
    FROM registrations
    WHERE is_archived = 0
    GROUP BY academic_year
    ORDER BY count DESC
  `).all();

  res.json({
    kpis: {
      total_registrations: totalRegs,
      registrations_today: regsToday,
      total_events: totalEvents,
      active_events: activeEvents,
      total_students: totalStudents,
      total_present: totalPresent,
      total_absent: totalAbsent,
      total_pending: totalPending,
      attendance_rate: attendanceRate
    },
    charts: {
      timeline,
      event_distribution: eventDistribution,
      dept_distribution: deptDistribution,
      year_distribution: yearDistribution,
      attendance_stats: {
        present: totalPresent,
        absent: totalAbsent,
        pending: totalPending
      }
    }
  });
});

app.get("/api/admin/analytics/event/:id", requireAuth, (req, res) => {
  const eventId = Number(req.params.id);
  const conn = getDb();
  const event = conn.prepare("SELECT * FROM events WHERE id = ?").get(eventId) as any;

  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  const totalReg = (conn.prepare("SELECT COUNT(*) as count FROM registrations WHERE event_id = ? AND is_archived = 0").get(eventId) as any).count;
  const present = (conn.prepare("SELECT COUNT(*) as count FROM registrations WHERE event_id = ? AND attendance_status = 'present' AND is_archived = 0").get(eventId) as any).count;
  const absent = (conn.prepare("SELECT COUNT(*) as count FROM registrations WHERE event_id = ? AND attendance_status = 'absent' AND is_archived = 0").get(eventId) as any).count;
  const pending = (conn.prepare("SELECT COUNT(*) as count FROM registrations WHERE event_id = ? AND attendance_status = 'pending' AND is_archived = 0").get(eventId) as any).count;

  const departments = conn.prepare(`
    SELECT department, COUNT(*) as count
    FROM registrations
    WHERE event_id = ? AND is_archived = 0
    GROUP BY department
    ORDER BY count DESC
  `).all(eventId);

  const years = conn.prepare(`
    SELECT academic_year, COUNT(*) as count
    FROM registrations
    WHERE event_id = ? AND is_archived = 0
    GROUP BY academic_year
    ORDER BY count DESC
  `).all(eventId);

  const timeline = conn.prepare(`
    SELECT date(created_at) as reg_date, COUNT(*) as count
    FROM registrations
    WHERE event_id = ? AND is_archived = 0
    GROUP BY date(created_at)
    ORDER BY reg_date ASC
  `).all(eventId);

  res.json({
    event,
    kpis: {
      total_registered: totalReg,
      present,
      absent,
      pending,
      attendance_rate: totalReg > 0 ? Number(((present / totalReg) * 100).toFixed(1)) : 0.0,
      capacity: event.capacity,
      capacity_percentage: event.capacity > 0 ? Number(((totalReg / event.capacity) * 100).toFixed(1)) : null
    },
    charts: {
      departments,
      years,
      timeline
    }
  });
});

// ==============================================================================
// Admin Events API Endpoints
// ==============================================================================

app.get("/api/admin/events", requireAuth, (req, res) => {
  const conn = getDb();
  const events = conn.prepare(`
    SELECT 
        e.*,
        COUNT(r.id) as total_registered,
        SUM(CASE WHEN r.attendance_status = 'present' THEN 1 ELSE 0 END) as present_count,
        SUM(CASE WHEN r.attendance_status = 'absent' THEN 1 ELSE 0 END) as absent_count
    FROM events e
    LEFT JOIN registrations r ON e.id = r.event_id AND r.is_archived = 0
    WHERE e.is_archived = 0
    GROUP BY e.id
    ORDER BY e.event_date DESC
  `).all();
  res.json({ events });
});

app.post("/api/admin/events", requireAuth, requireRole("Super Admin", "Admin"), (req, res) => {
  const data = req.body || {};
  const title = (data.title || "").trim();
  const category = (data.category || "Campus Event").trim();
  const description = (data.description || "").trim();
  const eventDate = (data.event_date || "").trim();
  const eventTime = (data.event_time || "").trim();
  const venue = (data.venue || "").trim();
  const capacity = parseInt(data.capacity || 0, 10);
  const isActive = data.is_active !== false && data.is_active !== 0 ? 1 : 0;
  const regOpenDate = data.reg_open_date || null;
  const regCloseDate = data.reg_close_date || null;

  if (!title || !eventDate || !venue) {
    res.status(400).json({ error: "Event Title, Date, and Venue are required." });
    return;
  }

  let code = data.code;
  if (!code) {
    const slug = title.toUpperCase().replace(/[^A-Z0-9]/g, "-").slice(0, 15);
    code = `EVT-${slug}-${Math.floor(Math.random() * 900 + 100)}`;
  }

  const conn = getDb();
  try {
    const ins = conn.prepare(`
      INSERT INTO events (
          code, title, category, description, event_date, event_time,
          venue, capacity, is_active, reg_open_date, reg_close_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      code,
      title,
      category,
      description,
      eventDate,
      eventTime,
      venue,
      capacity,
      isActive,
      regOpenDate,
      regCloseDate
    );
    const eventId = Number(ins.lastInsertRowid);
    const admin = (req as any).admin as AdminUser;
    logActivity(admin.username, "CREATE_EVENT", "event", `Created event '${title}' (${code})`, eventId);
    res.status(201).json({ success: true, message: "Event created successfully.", event_id: eventId });
  } catch (err: any) {
    res.status(400).json({ error: `Failed to create event: ${err.message}` });
  }
});

app.put("/api/admin/events/:id", requireAuth, requireRole("Super Admin", "Admin"), (req, res) => {
  const eventId = Number(req.params.id);
  const data = req.body || {};
  const conn = getDb();

  const existing = conn.prepare("SELECT id FROM events WHERE id = ?").get(eventId);
  if (!existing) {
    res.status(404).json({ error: "Event not found." });
    return;
  }

  conn.prepare(`
    UPDATE events
    SET title = COALESCE(?, title),
        category = COALESCE(?, category),
        description = COALESCE(?, description),
        event_date = COALESCE(?, event_date),
        event_time = COALESCE(?, event_time),
        venue = COALESCE(?, venue),
        capacity = COALESCE(?, capacity),
        is_active = COALESCE(?, is_active),
        reg_open_date = COALESCE(?, reg_open_date),
        reg_close_date = COALESCE(?, reg_close_date),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    data.title ?? null,
    data.category ?? null,
    data.description ?? null,
    data.event_date ?? null,
    data.event_time ?? null,
    data.venue ?? null,
    data.capacity ?? null,
    data.is_active ?? null,
    data.reg_open_date ?? null,
    data.reg_close_date ?? null,
    eventId
  );

  const admin = (req as any).admin as AdminUser;
  logActivity(admin.username, "UPDATE_EVENT", "event", `Updated event ID ${eventId}`, eventId);
  res.json({ success: true, message: "Event updated successfully." });
});

app.delete("/api/admin/events/:id", requireAuth, requireRole("Super Admin", "Admin"), (req, res) => {
  const eventId = Number(req.params.id);
  const conn = getDb();
  conn.prepare("UPDATE events SET is_archived = 1, is_active = 0 WHERE id = ?").run(eventId);

  const admin = (req as any).admin as AdminUser;
  logActivity(admin.username, "ARCHIVE_EVENT", "event", `Archived event ID ${eventId}`, eventId);
  res.json({ success: true, message: "Event archived successfully." });
});

// ==============================================================================
// Admin Registrations API Endpoints
// ==============================================================================

app.get("/api/admin/registrations", requireAuth, (req, res) => {
  const search = ((req.query.search as string) || "").trim();
  const eventId = req.query.event_id;
  const department = req.query.department;
  const academicYear = req.query.academic_year;
  const status = req.query.status;
  const attendance = req.query.attendance;
  const dateFrom = req.query.date_from;
  const dateTo = req.query.date_to;
  const archived = (req.query.archived as string)?.toLowerCase() === "true";
  const sortBy = (req.query.sort_by as string) || "date_desc";

  const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
  const limit = Math.max(5, Math.min(100, parseInt((req.query.limit as string) || "20", 10)));
  const offset = (page - 1) * limit;

  const conditions: string[] = ["r.is_archived = ?"];
  const params: any[] = [archived ? 1 : 0];

  if (search) {
    const s = `%${search}%`;
    conditions.push("(r.full_name LIKE ? OR r.enrollment_id LIKE ? OR r.email LIKE ? OR r.phone LIKE ? OR r.reg_code LIKE ?)");
    params.push(s, s, s, s, s);
  }
  if (eventId) {
    conditions.push("r.event_id = ?");
    params.push(eventId);
  }
  if (department) {
    conditions.push("r.department = ?");
    params.push(department);
  }
  if (academicYear) {
    conditions.push("r.academic_year = ?");
    params.push(academicYear);
  }
  if (status) {
    conditions.push("r.status = ?");
    params.push(status);
  }
  if (attendance) {
    conditions.push("r.attendance_status = ?");
    params.push(attendance);
  }
  if (dateFrom) {
    conditions.push("date(r.created_at) >= date(?)");
    params.push(dateFrom);
  }
  if (dateTo) {
    conditions.push("date(r.created_at) <= date(?)");
    params.push(dateTo);
  }

  const whereClause = conditions.join(" AND ");
  const orderMap: Record<string, string> = {
    date_desc: "r.created_at DESC",
    date_asc: "r.created_at ASC",
    name_asc: "r.full_name ASC",
    name_desc: "r.full_name DESC",
    event_asc: "r.event_name ASC"
  };
  const orderClause = orderMap[sortBy] || "r.created_at DESC";

  const conn = getDb();
  const countRow = conn.prepare(`SELECT COUNT(*) as total FROM registrations r WHERE ${whereClause}`).get(...params) as any;
  const totalRecords = Number(countRow?.total || 0);

  const query = `
    SELECT 
        r.*,
        e.code as event_code,
        e.venue as event_venue,
        e.event_date as event_date
    FROM registrations r
    JOIN events e ON r.event_id = e.id
    WHERE ${whereClause}
    ORDER BY ${orderClause}
    LIMIT ? OFFSET ?
  `;
  const items = conn.prepare(query).all(...params, limit, offset);

  res.json({
    items,
    total: totalRecords,
    page,
    limit,
    pages: Math.ceil(totalRecords / limit)
  });
});

app.post("/api/admin/registrations", requireAuth, requireRole("Super Admin", "Admin"), (req, res) => {
  const data = req.body || {};
  const fullName = (data.full_name || "").trim();
  const enrollmentId = (data.enrollment_id || "").trim().toUpperCase();
  const department = (data.department || "").trim();
  const academicYear = (data.academic_year || "").trim();
  const email = (data.email || "").trim().toLowerCase();
  const phone = (data.phone || "").trim();
  const eventId = data.event_id;
  const attendanceStatus = data.attendance_status || "pending";
  const status = data.status || "confirmed";
  const notes = (data.additional_info || "").trim();

  if (!fullName || !enrollmentId || !email || !eventId) {
    res.status(400).json({ error: "Full name, enrollment ID, email, and event are required." });
    return;
  }

  const conn = getDb();
  const event = conn.prepare("SELECT * FROM events WHERE id = ?").get(eventId) as any;
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  let studentId: number;
  const st = conn.prepare("SELECT id FROM students WHERE enrollment_id = ?").get(enrollmentId) as any;
  if (st) {
    studentId = st.id;
  } else {
    const insSt = conn.prepare(`
      INSERT INTO students (enrollment_id, full_name, email, phone, department, academic_year)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(enrollmentId, fullName, email, phone, department, academicYear);
    studentId = Number(insSt.lastInsertRowid);
  }

  const dup = conn.prepare("SELECT id FROM registrations WHERE enrollment_id = ? AND event_id = ? AND is_archived = 0").get(enrollmentId, eventId);
  if (dup) {
    res.status(409).json({ error: "This student is already registered for this event." });
    return;
  }

  const regCode = generateRegCode();
  const insReg = conn.prepare(`
    INSERT INTO registrations (
        reg_code, student_id, event_id, enrollment_id, full_name, email,
        phone, department, academic_year, event_name, attendance_status,
        payment_status, status, additional_info
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'free', ?, ?)
  `).run(
    regCode,
    studentId,
    event.id,
    enrollmentId,
    fullName,
    email,
    phone,
    department,
    academicYear,
    event.title,
    attendanceStatus,
    status,
    notes
  );

  const regId = Number(insReg.lastInsertRowid);
  const admin = (req as any).admin as AdminUser;
  logActivity(admin.username, "ADD_REGISTRATION_MANUAL", "registration", `Admin created registration ${regCode} for ${fullName}`, regId);

  res.status(201).json({ success: true, message: "Registration created successfully.", reg_code: regCode });
});

app.put("/api/admin/registrations/:id", requireAuth, requireRole("Super Admin", "Admin"), (req, res) => {
  const regId = Number(req.params.id);
  const data = req.body || {};
  const conn = getDb();

  const existing = conn.prepare("SELECT id FROM registrations WHERE id = ?").get(regId);
  if (!existing) {
    res.status(404).json({ error: "Registration not found" });
    return;
  }

  conn.prepare(`
    UPDATE registrations
    SET full_name = COALESCE(?, full_name),
        department = COALESCE(?, department),
        academic_year = COALESCE(?, academic_year),
        email = COALESCE(?, email),
        phone = COALESCE(?, phone),
        status = COALESCE(?, status),
        attendance_status = COALESCE(?, attendance_status),
        additional_info = COALESCE(?, additional_info),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    data.full_name ?? null,
    data.department ?? null,
    data.academic_year ?? null,
    data.email ?? null,
    data.phone ?? null,
    data.status ?? null,
    data.attendance_status ?? null,
    data.additional_info ?? null,
    regId
  );

  const admin = (req as any).admin as AdminUser;
  logActivity(admin.username, "EDIT_REGISTRATION", "registration", `Updated registration ID ${regId}`, regId);
  res.json({ success: true, message: "Registration updated successfully." });
});

app.patch("/api/admin/registrations/:id/attendance", requireAuth, requireRole("Super Admin", "Admin"), (req, res) => {
  const regId = Number(req.params.id);
  const status = req.body?.status;

  if (!["present", "absent", "pending"].includes(status)) {
    res.status(400).json({ error: "Invalid attendance status. Must be present, absent, or pending." });
    return;
  }

  const conn = getDb();
  const reg = conn.prepare("SELECT id, event_id, full_name, enrollment_id FROM registrations WHERE id = ?").get(regId) as any;
  if (!reg) {
    res.status(404).json({ error: "Registration not found" });
    return;
  }

  conn.prepare("UPDATE registrations SET attendance_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(status, regId);

  const admin = (req as any).admin as AdminUser;
  conn.prepare(`
    INSERT INTO attendance_records (registration_id, event_id, marked_by_admin, status, notes)
    VALUES (?, ?, ?, ?, ?)
  `).run(regId, reg.event_id, admin.username, status, req.body?.notes || "Attendance status update");

  logActivity(admin.username, "UPDATE_ATTENDANCE", "attendance", `Marked ${reg.full_name} (${reg.enrollment_id}) as ${status}`, regId);
  res.json({ success: true, message: `Attendance marked as ${status}.`, status });
});

app.patch("/api/admin/registrations/:id/status", requireAuth, requireRole("Super Admin", "Admin"), (req, res) => {
  const regId = Number(req.params.id);
  const status = req.body?.status;

  if (!["registered", "confirmed", "cancelled", "waitlist"].includes(status)) {
    res.status(400).json({ error: "Invalid status." });
    return;
  }

  const conn = getDb();
  conn.prepare("UPDATE registrations SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(status, regId);

  const admin = (req as any).admin as AdminUser;
  logActivity(admin.username, "CHANGE_STATUS", "registration", `Changed status to '${status}' for reg ID ${regId}`, regId);
  res.json({ success: true, message: `Status changed to ${status}.` });
});

app.delete("/api/admin/registrations/:id", requireAuth, requireRole("Super Admin", "Admin"), (req, res) => {
  const regId = Number(req.params.id);
  const permanent = (req.query.permanent as string)?.toLowerCase() === "true";
  const admin = (req as any).admin as AdminUser;
  const conn = getDb();

  if (permanent) {
    if (admin.role !== "Super Admin") {
      res.status(403).json({ error: "Only Super Admin can permanently delete registrations." });
      return;
    }
    conn.prepare("DELETE FROM registrations WHERE id = ?").run(regId);
    logActivity(admin.username, "PERMANENT_DELETE_REGISTRATION", "registration", `Permanently deleted registration ID ${regId}`, regId);
    res.json({ success: true, message: "Registration permanently deleted." });
  } else {
    conn.prepare("UPDATE registrations SET is_archived = 1 WHERE id = ?").run(regId);
    logActivity(admin.username, "ARCHIVE_REGISTRATION", "registration", `Soft-archived registration ID ${regId}`, regId);
    res.json({ success: true, message: "Registration archived. You can recover it from the Archived tab." });
  }
});

app.post("/api/admin/registrations/:id/restore", requireAuth, requireRole("Super Admin", "Admin"), (req, res) => {
  const regId = Number(req.params.id);
  const conn = getDb();
  conn.prepare("UPDATE registrations SET is_archived = 0 WHERE id = ?").run(regId);

  const admin = (req as any).admin as AdminUser;
  logActivity(admin.username, "RESTORE_REGISTRATION", "registration", `Restored registration ID ${regId}`, regId);
  res.json({ success: true, message: "Registration restored successfully." });
});

// ==============================================================================
// Admin Students API Endpoints
// ==============================================================================

app.get("/api/admin/students", requireAuth, (req, res) => {
  const search = ((req.query.search as string) || "").trim();
  const conn = getDb();

  const conditions = ["1=1"];
  const params: any[] = [];
  if (search) {
    const s = `%${search}%`;
    conditions.push("(s.full_name LIKE ? OR s.enrollment_id LIKE ? OR s.email LIKE ? OR s.phone LIKE ?)");
    params.push(s, s, s, s);
  }

  const query = `
    SELECT 
        s.*,
        COUNT(r.id) as total_events_registered,
        SUM(CASE WHEN r.attendance_status = 'present' THEN 1 ELSE 0 END) as total_events_attended
    FROM students s
    LEFT JOIN registrations r ON s.id = r.student_id AND r.is_archived = 0
    WHERE ${conditions.join(" AND ")}
    GROUP BY s.id
    ORDER BY total_events_registered DESC, s.full_name ASC
  `;
  const students = conn.prepare(query).all(...params);
  res.json({ students, total: students.length });
});

app.get("/api/admin/students/:id", requireAuth, (req, res) => {
  const studentId = Number(req.params.id);
  const conn = getDb();
  const student = conn.prepare("SELECT * FROM students WHERE id = ?").get(studentId);

  if (!student) {
    res.status(404).json({ error: "Student not found" });
    return;
  }

  const history = conn.prepare(`
    SELECT 
        r.*,
        e.code as event_code,
        e.event_date,
        e.venue
    FROM registrations r
    JOIN events e ON r.event_id = e.id
    WHERE r.student_id = ?
    ORDER BY r.created_at DESC
  `).all(studentId) as any[];

  res.json({
    student,
    history,
    total_registered: history.length,
    total_attended: history.filter((h) => h.attendance_status === "present").length
  });
});

// ==============================================================================
// Admin Activity Logs API
// ==============================================================================

app.get("/api/admin/activity-logs", requireAuth, (req, res) => {
  const search = ((req.query.search as string) || "").trim();
  const limit = Math.min(200, parseInt((req.query.limit as string) || "100", 10));
  const conn = getDb();

  let logs: any[];
  if (search) {
    const s = `%${search}%`;
    logs = conn.prepare(`
      SELECT * FROM activity_logs
      WHERE admin_name LIKE ? OR action LIKE ? OR details LIKE ?
      ORDER BY timestamp DESC LIMIT ?
    `).all(s, s, s, limit);
  } else {
    logs = conn.prepare("SELECT * FROM activity_logs ORDER BY timestamp DESC LIMIT ?").all(limit);
  }

  res.json({ logs });
});

// ==============================================================================
// Data Export Endpoints (CSV & Excel)
// ==============================================================================

app.get("/api/admin/export/csv", requireAuth, (req, res) => {
  const eventId = req.query.event_id;
  const attendance = req.query.attendance;
  const department = req.query.department;

  const conn = getDb();
  const conditions = ["r.is_archived = 0"];
  const params: any[] = [];

  if (eventId) {
    conditions.push("r.event_id = ?");
    params.push(eventId);
  }
  if (attendance) {
    conditions.push("r.attendance_status = ?");
    params.push(attendance);
  }
  if (department) {
    conditions.push("r.department = ?");
    params.push(department);
  }

  const query = `
    SELECT 
        r.reg_code as "Registration ID",
        r.full_name as "Full Name",
        r.enrollment_id as "Enrollment ID",
        r.department as "Department / School",
        r.academic_year as "Academic Year",
        r.email as "Email",
        r.phone as "Phone Number",
        r.event_name as "Event Name",
        r.status as "Registration Status",
        r.attendance_status as "Attendance Status",
        r.created_at as "Registration Date"
    FROM registrations r
    WHERE ${conditions.join(" AND ")}
    ORDER BY r.created_at DESC
  `;
  const rows = conn.prepare(query).all(...params) as Record<string, any>[];

  const headers = [
    "Registration ID", "Full Name", "Enrollment ID", "Department / School",
    "Academic Year", "Email", "Phone Number", "Event Name",
    "Registration Status", "Attendance Status", "Registration Date"
  ];

  function escapeCsv(val: any): string {
    if (val === null || val === undefined) return "";
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  }

  let csvContent = headers.map(escapeCsv).join(",") + "\n";
  for (const r of rows) {
    csvContent += headers.map((h) => escapeCsv(r[h])).join(",") + "\n";
  }

  const filename = `Phoenix_Club_Registrations_${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send("\ufeff" + csvContent);
});

app.get("/api/admin/export/excel", requireAuth, async (req, res) => {
  const eventId = req.query.event_id;
  const attendance = req.query.attendance;
  const department = req.query.department;

  const conn = getDb();
  const conditions = ["r.is_archived = 0"];
  const params: any[] = [];

  if (eventId) {
    conditions.push("r.event_id = ?");
    params.push(eventId);
  }
  if (attendance) {
    conditions.push("r.attendance_status = ?");
    params.push(attendance);
  }
  if (department) {
    conditions.push("r.department = ?");
    params.push(department);
  }

  const query = `
    SELECT 
        r.reg_code,
        r.full_name,
        r.enrollment_id,
        r.department,
        r.academic_year,
        r.email,
        r.phone,
        r.event_name,
        r.status,
        r.attendance_status,
        r.created_at
    FROM registrations r
    WHERE ${conditions.join(" AND ")}
    ORDER BY r.created_at DESC
  `;
  const rows = conn.prepare(query).all(...params) as any[];

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Registrations");

  // Title Banner
  worksheet.mergeCells("A1:K1");
  const titleCell = worksheet.getCell("A1");
  titleCell.value = "Phoenix Club — Navrachana University | Official Registration Export";
  titleCell.font = { name: "Calibri", size: 14, bold: true, color: { argb: "FFFFFFFF" } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  worksheet.getRow(1).height = 36;

  // Subtitle
  worksheet.mergeCells("A2:K2");
  const subCell = worksheet.getCell("A2");
  subCell.value = `Exported on: ${new Date().toLocaleString()} | Total Records: ${rows.length}`;
  subCell.font = { name: "Calibri", size: 10, italic: true, color: { argb: "FF475569" } };
  subCell.alignment = { horizontal: "center", vertical: "middle" };
  worksheet.getRow(2).height = 20;

  // Table Headers
  const headers = [
    "Registration ID", "Full Name", "Enrollment ID", "Department / School",
    "Academic Year", "Email", "Phone", "Event Name", "Status", "Attendance", "Registration Date"
  ];
  worksheet.getRow(4).height = 26;

  headers.forEach((header, idx) => {
    const cell = worksheet.getCell(4, idx + 1);
    cell.value = header;
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEA580C" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });

  // Data rows
  rows.forEach((r, rowIdx) => {
    const rowNum = rowIdx + 5;
    const rowValues = [
      r.reg_code, r.full_name, r.enrollment_id, r.department,
      r.academic_year, r.email, r.phone, r.event_name,
      r.status, r.attendance_status, r.created_at
    ];
    worksheet.getRow(rowNum).height = 22;
    rowValues.forEach((val, colIdx) => {
      const cell = worksheet.getCell(rowNum, colIdx + 1);
      cell.value = val;
      cell.font = { name: "Calibri", size: 10 };
      if ([1, 3, 5, 7, 9, 10, 11].includes(colIdx + 1)) {
        cell.alignment = { horizontal: "center", vertical: "middle" };
      } else {
        cell.alignment = { horizontal: "left", vertical: "middle" };
      }

      if (colIdx === 9) {
        if (val === "present") {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCFCE7" } };
          cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF166534" } };
        } else if (val === "absent") {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
          cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF991B1B" } };
        }
      }
    });
  });

  // Auto column widths
  worksheet.columns.forEach((column) => {
    let maxLength = 14;
    column.eachCell?.({ includeEmpty: true }, (cell) => {
      const len = cell.value ? String(cell.value).length : 0;
      if (len > maxLength) maxLength = len;
    });
    column.width = Math.min(maxLength + 4, 35);
  });

  const filename = `Phoenix_Club_Registrations_${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);
  res.end();
});

// ==============================================================================
// Admin User Management & Settings (Super Admin Only)
// ==============================================================================

app.get("/api/admin/users", requireAuth, requireRole("Super Admin"), (req, res) => {
  const conn = getDb();
  const users = conn.prepare("SELECT id, username, email, role, full_name, is_active, created_at, last_login FROM admins ORDER BY id ASC").all();
  res.json({ users });
});

app.post("/api/admin/users", requireAuth, requireRole("Super Admin"), (req, res) => {
  const data = req.body || {};
  const username = (data.username || "").trim();
  const email = (data.email || "").trim().toLowerCase();
  const password = data.password || "";
  const role = data.role || "Admin";
  const fullName = (data.full_name || "").trim();

  if (!username || !email || !password || !fullName) {
    res.status(400).json({ error: "All fields are required." });
    return;
  }
  if (!["Super Admin", "Admin", "Viewer"].includes(role)) {
    res.status(400).json({ error: "Invalid role. Must be Super Admin, Admin, or Viewer." });
    return;
  }

  const conn = getDb();
  try {
    const ins = conn.prepare(`
      INSERT INTO admins (username, email, password_hash, role, full_name)
      VALUES (?, ?, ?, ?, ?)
    `).run(username, email, hashPassword(password), role, fullName);
    const newId = Number(ins.lastInsertRowid);
    const admin = (req as any).admin as AdminUser;
    logActivity(admin.username, "CREATE_ADMIN_USER", "admin", `Created admin '${username}' with role '${role}'`, newId);
    res.status(201).json({ success: true, message: `Administrator account '${username}' created.` });
  } catch (err: any) {
    res.status(400).json({ error: `Failed to create admin: ${err.message}` });
  }
});

app.patch("/api/admin/users/:id/role", requireAuth, requireRole("Super Admin"), (req, res) => {
  const userId = Number(req.params.id);
  const { role, is_active } = req.body || {};
  const admin = (req as any).admin as AdminUser;

  if (userId === admin.id && is_active === 0) {
    res.status(400).json({ error: "You cannot deactivate your own Super Admin account." });
    return;
  }

  const conn = getDb();
  if (role) {
    conn.prepare("UPDATE admins SET role = ? WHERE id = ?").run(role, userId);
  }
  if (is_active !== undefined) {
    conn.prepare("UPDATE admins SET is_active = ? WHERE id = ?").run(is_active ? 1 : 0, userId);
  }

  logActivity(admin.username, "UPDATE_ADMIN_ROLE", "admin", `Updated user ID ${userId}`, userId);
  res.json({ success: true, message: "Admin permissions updated." });
});

app.delete("/api/admin/users/:id", requireAuth, requireRole("Super Admin"), (req, res) => {
  const userId = Number(req.params.id);
  const admin = (req as any).admin as AdminUser;
  if (userId === admin.id) {
    res.status(400).json({ error: "You cannot delete your own account." });
    return;
  }

  const conn = getDb();
  conn.prepare("DELETE FROM admins WHERE id = ?").run(userId);
  logActivity(admin.username, "DELETE_ADMIN_USER", "admin", `Deleted admin user ID ${userId}`, userId);
  res.json({ success: true, message: "Admin user deleted." });
});

app.get("/api/admin/settings", requireAuth, (req, res) => {
  const conn = getDb();
  const rows = conn.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const settings: Record<string, string> = {};
  for (const r of rows) {
    settings[r.key] = r.value;
  }
  res.json({ settings });
});

app.post("/api/admin/settings", requireAuth, requireRole("Super Admin"), (req, res) => {
  const data = req.body || {};
  const conn = getDb();
  const ins = conn.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `);
  for (const [k, v] of Object.entries(data)) {
    ins.run(k, String(v));
  }
  const admin = (req as any).admin as AdminUser;
  logActivity(admin.username, "UPDATE_SETTINGS", "settings", "Updated system configurations.");
  res.json({ success: true, message: "Settings saved successfully." });
});

// Demo Data Seed & Clear
app.post("/api/admin/seed-demo", requireAuth, requireRole("Super Admin"), (req, res) => {
  const conn = getDb();

  const demoStudents = [
    ["240101001", "Aarav Sharma", "aarav.sharma@nuv.ac.in", "+91 98250 11223", "School of Science", "1st Year (Freshman)"],
    ["230202045", "Diya Patel", "diya.patel@nuv.ac.in", "+91 98795 44332", "School of Engineering & Technology", "2nd Year (Sophomore)"],
    ["220303089", "Rohan Mehta", "rohan.mehta@nuv.ac.in", "+91 97240 88990", "School of Environmental Design & Architecture", "3rd Year (Junior)"],
    ["210404012", "Ananya Joshi", "ananya.joshi@nuv.ac.in", "+91 99099 55667", "School of Business & Law", "4th Year (Senior)"],
    ["240101015", "Kavya Desai", "kavya.desai@nuv.ac.in", "+91 94280 33445", "School of Science", "1st Year (Freshman)"],
    ["230202078", "Vivek Shah", "vivek.shah@nuv.ac.in", "+91 98240 66778", "School of Engineering & Technology", "2nd Year (Sophomore)"],
    ["220505023", "Pooja Trivedi", "pooja.trivedi@nuv.ac.in", "+91 98980 12345", "School of Liberal Arts & Education", "3rd Year (Junior)"],
    ["240101034", "Neil Bhatt", "neil.bhatt@nuv.ac.in", "+91 97120 45678", "School of Science", "Postgraduate / Masters"],
    ["230202090", "Tanvi Dave", "tanvi.dave@nuv.ac.in", "+91 98255 78901", "School of Engineering & Technology", "2nd Year (Sophomore)"],
    ["240101056", "Siddharth Verma", "siddharth.verma@nuv.ac.in", "+91 98765 43210", "School of Science", "1st Year (Freshman)"]
  ];

  const studentIds: Record<string, number> = {};
  for (const [roll, name, email, phone, dept, year] of demoStudents) {
    const existing = conn.prepare("SELECT id FROM students WHERE enrollment_id = ?").get(roll) as any;
    if (existing) {
      studentIds[roll] = existing.id;
    } else {
      const ins = conn.prepare(`
        INSERT INTO students (enrollment_id, full_name, email, phone, department, academic_year)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(roll, name, email, phone, dept, year);
      studentIds[roll] = Number(ins.lastInsertRowid);
    }
  }

  const events = (conn.prepare("SELECT id, code, title FROM events").all() as any[]).reduce((acc, ev) => {
    acc[ev.title] = ev;
    return acc;
  }, {} as Record<string, any>);

  const demoRegistrations = [
    ["PHX-2026-1001", "240101001", "Investiture Ceremony 2026", "present", "confirmed", "Excited to meet the leadership council!"],
    ["PHX-2026-1002", "230202045", "Investiture Ceremony 2026", "present", "confirmed", "Attending with engineering cohort."],
    ["PHX-2026-1003", "220303089", "Wildlife Week Celebration 2026", "present", "confirmed", "Submitting wildlife photography series."],
    ["PHX-2026-1004", "210404012", "Wildlife Week Celebration 2026", "absent", "registered", "Interested in biodiversity panel."],
    ["PHX-2026-1005", "240101015", "Wildlife Week Celebration 2026", "present", "confirmed", "Volunteer coordinator for nature quiz."],
    ["PHX-2026-1006", "230202078", "Distinguished Guest Lecture: Modern Biotechnology", "present", "confirmed", "Keen on learning about CRISPR."],
    ["PHX-2026-1007", "220505023", "Distinguished Guest Lecture: Modern Biotechnology", "pending", "registered", "Liberal arts science elective."],
    ["PHX-2026-1008", "240101034", "Science & Innovation Hands-On Workshop", "present", "confirmed", "Bringing sensor prototype."],
    ["PHX-2026-1009", "230202090", "Science & Innovation Hands-On Workshop", "pending", "registered", "Interested in IoT microcontroller kit."],
    ["PHX-2026-1010", "240101056", "Phoenix Community Mixer & Orientation", "present", "confirmed", "New student seeking science mentors."],
    ["PHX-2026-1011", "240101001", "Annual General Club Membership 2026", "present", "confirmed", "All-access annual membership."],
    ["PHX-2026-1012", "230202045", "Annual General Club Membership 2026", "present", "confirmed", "Renewal of annual club pass."],
    ["PHX-2026-1013", "240101001", "Wildlife Week Celebration 2026", "present", "confirmed", "Participating in photography contest."]
  ];

  for (const [regCode, roll, evTitle, attStatus, regStatus, notes] of demoRegistrations) {
    const existing = conn.prepare("SELECT id FROM registrations WHERE reg_code = ?").get(regCode);
    if (!existing && events[evTitle] && studentIds[roll]) {
      const ev = events[evTitle];
      const stId = studentIds[roll];
      const st = conn.prepare("SELECT * FROM students WHERE id = ?").get(stId) as any;

      const insReg = conn.prepare(`
        INSERT INTO registrations (
            reg_code, student_id, event_id, enrollment_id, full_name, email,
            phone, department, academic_year, event_name, attendance_status,
            payment_status, status, additional_info, is_demo
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'free', ?, ?, 1)
      `).run(
        regCode,
        stId,
        ev.id,
        roll,
        st.full_name,
        st.email,
        st.phone,
        st.department,
        st.academic_year,
        ev.title,
        attStatus,
        regStatus,
        notes
      );
      const regId = Number(insReg.lastInsertRowid);

      if (attStatus !== "pending") {
        conn.prepare(`
          INSERT INTO attendance_records (registration_id, event_id, marked_by_admin, status, notes)
          VALUES (?, ?, 'Super Admin', ?, 'Demo check-in entry')
        `).run(regId, ev.id, attStatus);
      }
    }
  }

  const admin = (req as any).admin as AdminUser;
  logActivity(admin.username, "SEED_DEMO_DATA", "database", "Triggered demo data seeding");
  res.json({ success: true, message: "Demo registrations seeded successfully." });
});

app.post("/api/admin/clear-demo", requireAuth, requireRole("Super Admin"), (req, res) => {
  const conn = getDb();
  conn.prepare("DELETE FROM attendance_records WHERE registration_id IN (SELECT id FROM registrations WHERE is_demo = 1)").run();
  conn.prepare("DELETE FROM registrations WHERE is_demo = 1").run();
  conn.prepare("DELETE FROM students WHERE id NOT IN (SELECT DISTINCT student_id FROM registrations)").run();

  const admin = (req as any).admin as AdminUser;
  logActivity(admin.username, "CLEAR_DEMO_DATA", "database", "Cleared all demo registrations");
  res.json({ success: true, message: "Demo data cleared successfully." });
});

app.get("/api/admin/backup-db", requireAuth, requireRole("Super Admin"), (req, res) => {
  const backupDir = path.join(BASE_DIR, "backups");
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const backupFilename = `phoenix_club_backup_${timestamp}.db`;
  const backupPath = path.join(backupDir, backupFilename);

  fs.copyFileSync(DB_PATH, backupPath);

  const admin = (req as any).admin as AdminUser;
  logActivity(admin.username, "BACKUP_DATABASE", "database", `Created snapshot ${backupFilename}`);
  res.download(backupPath, backupFilename);
});

// ==============================================================================
// Static Files Serving & SPA Fallback
// ==============================================================================

app.get("/", (req, res) => {
  res.sendFile(path.join(BASE_DIR, "index.html"));
});

// Serve root static directory (HTML, CSS, JS, images, svgs)
app.use(express.static(BASE_DIR));

// 404 handler
app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    res.status(404).json({ error: "Endpoint not found." });
    return;
  }
  const notFoundHtml = path.join(BASE_DIR, "index.html");
  if (fs.existsSync(notFoundHtml)) {
    res.sendFile(notFoundHtml);
  } else {
    res.status(404).send("Page Not Found");
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Phoenix Club Server running at http://0.0.0.0:${PORT}`);
  console.log(`👉 Public Portal: http://localhost:${PORT}`);
  console.log(`👉 Admin Login: http://localhost:${PORT}/admin/login`);
  console.log(`👉 Default Super Admin: admin / Admin@Phoenix2026`);
});
