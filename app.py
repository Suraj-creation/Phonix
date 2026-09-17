"""
Phoenix Club Management Platform & Backend API
Flask 3.1 Web Application & REST API
"""

import os
import io
import csv
import re
import random
import string
from datetime import datetime, date
from flask import (
    Flask, request, jsonify, render_template, send_from_directory,
    session, redirect, url_for, send_file
)
from werkzeug.security import generate_password_hash, check_password_hash
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

import db
from auth import login_required, role_required, get_current_admin, log_activity

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")
STATIC_DIR = BASE_DIR

app = Flask(__name__, template_folder=TEMPLATES_DIR, static_folder=STATIC_DIR)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "phoenix-nuv-secure-session-key-2026-flame-council")
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"

# Initialize DB on start
with app.app_context():
    db.init_db()
    db.seed_default_data()


# ==============================================================================
# Helper Functions
# ==============================================================================

def generate_reg_code():
    """Generate unique readable registration code: PHX-2026-XXXXX"""
    chars = string.ascii_uppercase + string.digits
    suffix = "".join(random.choices(chars, k=5))
    return f"PHX-2026-{suffix}"


def is_valid_email(email):
    """Validate email format with regex."""
    pattern = r"^[\w\.-]+@[\w\.-]+\.\w+$"
    return re.match(pattern, email.strip()) is not None


# ==============================================================================
# Public Website & Frontend Routes
# ==============================================================================

@app.route("/")
def home():
    """Serve home page index.html."""
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/<path:path>")
def static_proxy(path):
    """Serve any static html, css, js, image file directly from project root."""
    if os.path.exists(os.path.join(BASE_DIR, path)):
        return send_from_directory(BASE_DIR, path)
    return "Page Not Found", 404


@app.route("/admin/login")
def admin_login_page():
    """Serve dedicated admin login UI."""
    admin = get_current_admin()
    if admin:
        return redirect(url_for("admin_dashboard_page"))
    return render_template("admin_login.html")


@app.route("/admin/dashboard")
@login_required
def admin_dashboard_page():
    """Serve protected admin dashboard UI."""
    admin = get_current_admin()
    return render_template("admin_dashboard.html", admin=admin)


# ==============================================================================
# Public API Endpoints
# ==============================================================================

@app.route("/api/events/active", methods=["GET"])
def get_active_events():
    """List active events for registration dropdown and display."""
    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT 
        e.*,
        COUNT(r.id) as registered_count
    FROM events e
    LEFT JOIN registrations r ON e.id = r.event_id AND r.is_archived = 0
    WHERE e.is_active = 1 AND e.is_archived = 0
    GROUP BY e.id
    ORDER BY e.event_date ASC
    """)
    rows = cursor.fetchall()
    conn.close()

    events = []
    for r in rows:
        d = dict(r)
        capacity = d["capacity"]
        reg_count = d["registered_count"]
        d["is_full"] = (capacity > 0 and reg_count >= capacity)
        d["available_spots"] = max(0, capacity - reg_count) if capacity > 0 else None
        events.append(d)

    return jsonify({"events": events})


@app.route("/api/register", methods=["POST"])
def submit_public_registration():
    """Public registration submission with strict validation and duplicate prevention."""
    data = request.get_json() or {}

    full_name = (data.get("full_name") or "").strip()
    enrollment_id = (data.get("enrollment_id") or "").strip().upper()
    department = (data.get("department") or "").strip()
    academic_year = (data.get("academic_year") or "").strip()
    email = (data.get("email") or "").strip().lower()
    phone = (data.get("phone") or "").strip()
    event_id = data.get("event_id")
    event_name = (data.get("event_name") or "").strip()
    additional_info = (data.get("additional_info") or "").strip()

    # Input validations
    errors = []
    if not full_name:
        errors.append("Full Name is required.")
    if not enrollment_id:
        errors.append("University Enrollment / Roll No. is required.")
    if not department:
        errors.append("School / Department is required.")
    if not academic_year:
        errors.append("Academic Year is required.")
    if not email or not is_valid_email(email):
        errors.append("A valid University or Personal Email address is required.")
    if not phone or len(re.sub(r"\D", "", phone)) < 10:
        errors.append("A valid WhatsApp/Phone number (at least 10 digits) is required.")

    if errors:
        return jsonify({"error": "Validation Error", "messages": errors}), 400

    conn = db.get_db()
    cursor = conn.cursor()

    # Resolve event
    event = None
    if event_id:
        cursor.execute("SELECT * FROM events WHERE id = ? AND is_active = 1 AND is_archived = 0", (event_id,))
        event = cursor.fetchone()
    elif event_name:
        cursor.execute("SELECT * FROM events WHERE (title = ? OR title LIKE ?) AND is_active = 1 AND is_archived = 0",
                       (event_name, f"%{event_name}%"))
        event = cursor.fetchone()

    if not event:
        conn.close()
        return jsonify({"error": "Event Not Found", "messages": ["The selected event is either inactive, closed, or does not exist."]}), 404

    event = dict(event)

    # Check capacity
    cursor.execute("SELECT COUNT(*) as count FROM registrations WHERE event_id = ? AND is_archived = 0", (event["id"],))
    count_row = cursor.fetchone()
    current_regs = count_row["count"] if count_row else 0
    if event["capacity"] > 0 and current_regs >= event["capacity"]:
        conn.close()
        return jsonify({
            "error": "Capacity Reached",
            "messages": [f"Registration for '{event['title']}' is currently closed because it has reached maximum capacity ({event['capacity']} attendees)."]
        }), 400

    # Prevent accidental duplicate registration (Requirement 2 & 4)
    cursor.execute("""
    SELECT reg_code, created_at FROM registrations
    WHERE enrollment_id = ? AND event_id = ? AND is_archived = 0
    """, (enrollment_id, event["id"]))
    duplicate = cursor.fetchone()
    if duplicate:
        conn.close()
        return jsonify({
            "error": "Duplicate Registration",
            "message": f"Student with Enrollment ID '{enrollment_id}' has already registered for '{event['title']}'. Registration Pass: {duplicate['reg_code']}",
            "reg_code": duplicate["reg_code"]
        }), 409

    # Upsert student profile
    cursor.execute("SELECT id FROM students WHERE enrollment_id = ?", (enrollment_id,))
    st_row = cursor.fetchone()
    if st_row:
        student_id = st_row["id"]
        cursor.execute("""
        UPDATE students
        SET full_name = ?, email = ?, phone = ?, department = ?, academic_year = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """, (full_name, email, phone, department, academic_year, student_id))
    else:
        cursor.execute("""
        INSERT INTO students (enrollment_id, full_name, email, phone, department, academic_year)
        VALUES (?, ?, ?, ?, ?, ?)
        """, (enrollment_id, full_name, email, phone, department, academic_year))
        student_id = cursor.lastrowid

    # Generate unique Registration ID
    while True:
        reg_code = generate_reg_code()
        cursor.execute("SELECT id FROM registrations WHERE reg_code = ?", (reg_code,))
        if not cursor.fetchone():
            break

    cursor.execute("""
    INSERT INTO registrations (
        reg_code, student_id, event_id, enrollment_id, full_name, email,
        phone, department, academic_year, event_name, attendance_status,
        payment_status, status, additional_info, is_demo
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'free', 'confirmed', ?, 0)
    """, (
        reg_code, student_id, event["id"], enrollment_id, full_name, email,
        phone, department, academic_year, event["title"], additional_info
    ))
    reg_id = cursor.lastrowid

    # Activity Log
    cursor.execute("""
    INSERT INTO activity_logs (admin_name, action, record_type, record_id, details, ip_address)
    VALUES ('Student Form', 'PUBLIC_REGISTRATION', 'registration', ?, ?, ?)
    """, (str(reg_id), f"{full_name} ({enrollment_id}) registered for {event['title']}", request.remote_addr))

    conn.commit()
    conn.close()

    return jsonify({
        "success": True,
        "message": "Registration completed successfully!",
        "registration": {
            "id": reg_id,
            "reg_code": reg_code,
            "full_name": full_name,
            "enrollment_id": enrollment_id,
            "department": department,
            "academic_year": academic_year,
            "email": email,
            "phone": phone,
            "event_name": event["title"],
            "event_date": event["event_date"],
            "event_time": event["event_time"],
            "venue": event["venue"],
            "status": "confirmed",
            "attendance_status": "pending",
            "created_at": datetime.now().strftime("%d %b %Y, %I:%M %p")
        }
    }), 201


@app.route("/api/check-registration", methods=["GET"])
def check_registration():
    """Check registration status by enrollment ID or registration code."""
    query = (request.args.get("q") or "").strip()
    if not query:
        return jsonify({"error": "Search query parameter 'q' is required."}), 400

    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT r.*, e.event_date, e.event_time, e.venue
    FROM registrations r
    JOIN events e ON r.event_id = e.id
    WHERE (r.enrollment_id = ? OR r.reg_code = ? OR r.email = ?) AND r.is_archived = 0
    ORDER BY r.created_at DESC
    """, (query.upper(), query.upper(), query.lower()))
    rows = cursor.fetchall()
    conn.close()

    results = [dict(r) for r in rows]
    return jsonify({"results": results, "count": len(results)})


# ==============================================================================
# Admin Authentication Endpoints
# ==============================================================================

@app.route("/api/admin/login", methods=["POST"])
def admin_login():
    """Admin login with session token and security verification."""
    data = request.get_json() or {}
    username_or_email = (data.get("username") or "").strip()
    password = data.get("password") or ""

    if not username_or_email or not password:
        return jsonify({"error": "Username/Email and Password are required."}), 400

    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT * FROM admins
    WHERE (username = ? OR email = ?) AND is_active = 1
    """, (username_or_email, username_or_email.lower()))
    admin = cursor.fetchone()

    if not admin or not check_password_hash(admin["password_hash"], password):
        conn.close()
        log_activity("Anonymous", "FAILED_LOGIN_ATTEMPT", "auth", f"Attempt for: {username_or_email}", ip_address=request.remote_addr)
        return jsonify({"error": "Invalid credentials. Please verify your email/username and password."}), 401

    admin = dict(admin)
    # Update last login timestamp
    cursor.execute("UPDATE admins SET last_login = CURRENT_TIMESTAMP WHERE id = ?", (admin["id"],))
    conn.commit()
    conn.close()

    # Set secure session
    session["admin_id"] = admin["id"]
    session["username"] = admin["username"]
    session["role"] = admin["role"]
    session["full_name"] = admin["full_name"]
    session["login_time"] = datetime.now().isoformat()

    log_activity(admin["username"], "ADMIN_LOGIN", "auth", f"Admin '{admin['username']}' logged in successfully.", record_id=admin["id"])

    return jsonify({
        "success": True,
        "admin": {
            "id": admin["id"],
            "username": admin["username"],
            "email": admin["email"],
            "role": admin["role"],
            "full_name": admin["full_name"]
        }
    })


@app.route("/api/admin/logout", methods=["POST"])
def admin_logout():
    """Log out admin and terminate session."""
    username = session.get("username", "Unknown")
    log_activity(username, "ADMIN_LOGOUT", "auth", f"Admin '{username}' logged out.")
    session.clear()
    return jsonify({"success": True, "message": "Logged out successfully."})


@app.route("/api/admin/me", methods=["GET"])
@login_required
def admin_me():
    """Get profile of the currently logged-in administrator."""
    admin = get_current_admin()
    return jsonify({"admin": admin})


@app.route("/api/admin/change-password", methods=["POST"])
@login_required
def admin_change_password():
    """Change password for current administrator."""
    data = request.get_json() or {}
    current_pass = data.get("current_password") or ""
    new_pass = data.get("new_password") or ""

    if len(new_pass) < 6:
        return jsonify({"error": "New password must be at least 6 characters."}), 400

    admin = get_current_admin()
    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT password_hash FROM admins WHERE id = ?", (admin["id"],))
    row = cursor.fetchone()

    if not row or not check_password_hash(row["password_hash"], current_pass):
        conn.close()
        return jsonify({"error": "Current password is incorrect."}), 400

    cursor.execute("UPDATE admins SET password_hash = ? WHERE id = ?", (generate_password_hash(new_pass), admin["id"]))
    conn.commit()
    conn.close()

    log_activity(admin["username"], "CHANGE_PASSWORD", "admin", "Admin changed their password.", record_id=admin["id"])
    return jsonify({"success": True, "message": "Password changed successfully."})


# ==============================================================================
# Admin Analytics Endpoints
# ==============================================================================

@app.route("/api/admin/analytics/overview", methods=["GET"])
@login_required
def analytics_overview():
    """Retrieve all real-time dashboard KPIs, charts data, and distributions."""
    conn = db.get_db()
    cursor = conn.cursor()

    # 1. Total registrations & stats
    cursor.execute("SELECT COUNT(*) as total FROM registrations WHERE is_archived = 0")
    total_regs = cursor.fetchone()["total"]

    today_str = date.today().isoformat()
    cursor.execute("SELECT COUNT(*) as today FROM registrations WHERE date(created_at) = date(?) AND is_archived = 0", (today_str,))
    regs_today = cursor.fetchone()["today"]

    cursor.execute("SELECT COUNT(*) as total FROM events WHERE is_archived = 0")
    total_events = cursor.fetchone()["total"]

    cursor.execute("SELECT COUNT(*) as active FROM events WHERE is_active = 1 AND is_archived = 0")
    active_events = cursor.fetchone()["active"]

    cursor.execute("SELECT COUNT(*) as total FROM students")
    total_students = cursor.fetchone()["total"]

    cursor.execute("SELECT COUNT(*) as present FROM registrations WHERE attendance_status = 'present' AND is_archived = 0")
    total_present = cursor.fetchone()["present"]

    cursor.execute("SELECT COUNT(*) as absent FROM registrations WHERE attendance_status = 'absent' AND is_archived = 0")
    total_absent = cursor.fetchone()["absent"]

    cursor.execute("SELECT COUNT(*) as pending FROM registrations WHERE attendance_status = 'pending' AND is_archived = 0")
    total_pending = cursor.fetchone()["pending"]

    attendance_rate = round((total_present / total_regs * 100), 1) if total_regs > 0 else 0.0

    # 2. Registrations over time (last 14 days timeline)
    cursor.execute("""
    SELECT date(created_at) as reg_date, COUNT(*) as count
    FROM registrations
    WHERE is_archived = 0
    GROUP BY date(created_at)
    ORDER BY reg_date ASC
    LIMIT 30
    """)
    timeline = [dict(r) for r in cursor.fetchall()]

    # 3. Event-wise distribution
    cursor.execute("""
    SELECT 
        e.id, e.title, e.capacity,
        COUNT(r.id) as reg_count,
        SUM(CASE WHEN r.attendance_status = 'present' THEN 1 ELSE 0 END) as present_count
    FROM events e
    LEFT JOIN registrations r ON e.id = r.event_id AND r.is_archived = 0
    WHERE e.is_archived = 0
    GROUP BY e.id
    ORDER BY reg_count DESC
    """)
    event_distribution = [dict(r) for r in cursor.fetchall()]

    # 4. Department distribution
    cursor.execute("""
    SELECT department, COUNT(*) as count
    FROM registrations
    WHERE is_archived = 0
    GROUP BY department
    ORDER BY count DESC
    """)
    dept_distribution = [dict(r) for r in cursor.fetchall()]

    # 5. Academic Year distribution
    cursor.execute("""
    SELECT academic_year, COUNT(*) as count
    FROM registrations
    WHERE is_archived = 0
    GROUP BY academic_year
    ORDER BY count DESC
    """)
    year_distribution = [dict(r) for r in cursor.fetchall()]

    conn.close()

    return jsonify({
        "kpis": {
            "total_registrations": total_regs,
            "registrations_today": regs_today,
            "total_events": total_events,
            "active_events": active_events,
            "total_students": total_students,
            "total_present": total_present,
            "total_absent": total_absent,
            "total_pending": total_pending,
            "attendance_rate": attendance_rate
        },
        "charts": {
            "timeline": timeline,
            "event_distribution": event_distribution,
            "dept_distribution": dept_distribution,
            "year_distribution": year_distribution,
            "attendance_stats": {
                "present": total_present,
                "absent": total_absent,
                "pending": total_pending
            }
        }
    })


@app.route("/api/admin/analytics/event/<int:event_id>", methods=["GET"])
@login_required
def analytics_event_detail(event_id):
    """Event-specific deep drill-down analytics (Requirement 8)."""
    conn = db.get_db()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM events WHERE id = ?", (event_id,))
    event = cursor.fetchone()
    if not event:
        conn.close()
        return jsonify({"error": "Event not found"}), 404

    event = dict(event)

    # Event metrics
    cursor.execute("SELECT COUNT(*) as count FROM registrations WHERE event_id = ? AND is_archived = 0", (event_id,))
    total_reg = cursor.fetchone()["count"]

    cursor.execute("SELECT COUNT(*) as count FROM registrations WHERE event_id = ? AND attendance_status = 'present' AND is_archived = 0", (event_id,))
    present = cursor.fetchone()["count"]

    cursor.execute("SELECT COUNT(*) as count FROM registrations WHERE event_id = ? AND attendance_status = 'absent' AND is_archived = 0", (event_id,))
    absent = cursor.fetchone()["count"]

    cursor.execute("SELECT COUNT(*) as count FROM registrations WHERE event_id = ? AND attendance_status = 'pending' AND is_archived = 0", (event_id,))
    pending = cursor.fetchone()["count"]

    # Dept breakdown for this event
    cursor.execute("""
    SELECT department, COUNT(*) as count
    FROM registrations
    WHERE event_id = ? AND is_archived = 0
    GROUP BY department
    ORDER BY count DESC
    """, (event_id,))
    departments = [dict(r) for r in cursor.fetchall()]

    # Year breakdown for this event
    cursor.execute("""
    SELECT academic_year, COUNT(*) as count
    FROM registrations
    WHERE event_id = ? AND is_archived = 0
    GROUP BY academic_year
    ORDER BY count DESC
    """, (event_id,))
    years = [dict(r) for r in cursor.fetchall()]

    # Timeline for this event
    cursor.execute("""
    SELECT date(created_at) as reg_date, COUNT(*) as count
    FROM registrations
    WHERE event_id = ? AND is_archived = 0
    GROUP BY date(created_at)
    ORDER BY reg_date ASC
    """, (event_id,))
    timeline = [dict(r) for r in cursor.fetchall()]

    conn.close()

    return jsonify({
        "event": event,
        "kpis": {
            "total_registered": total_reg,
            "present": present,
            "absent": absent,
            "pending": pending,
            "attendance_rate": round((present / total_reg * 100), 1) if total_reg > 0 else 0.0,
            "capacity": event["capacity"],
            "capacity_percentage": round((total_reg / event["capacity"] * 100), 1) if event["capacity"] > 0 else None
        },
        "charts": {
            "departments": departments,
            "years": years,
            "timeline": timeline
        }
    })


# ==============================================================================
# Admin Events Management Endpoints
# ==============================================================================

@app.route("/api/admin/events", methods=["GET"])
@login_required
def admin_list_events():
    """List all events with live metrics."""
    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("""
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
    """)
    events = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return jsonify({"events": events})


@app.route("/api/admin/events", methods=["POST"])
@login_required
@role_required("Super Admin", "Admin")
def admin_create_event():
    """Create a new event."""
    data = request.get_json() or {}
    title = (data.get("title") or "").strip()
    category = (data.get("category") or "Campus Event").strip()
    description = (data.get("description") or "").strip()
    event_date = (data.get("event_date") or "").strip()
    event_time = (data.get("event_time") or "").strip()
    venue = (data.get("venue") or "").strip()
    capacity = int(data.get("capacity") or 0)
    is_active = 1 if data.get("is_active", True) else 0
    reg_open_date = data.get("reg_open_date")
    reg_close_date = data.get("reg_close_date")

    if not title or not event_date or not venue:
        return jsonify({"error": "Event Title, Date, and Venue are required."}), 400

    # Auto generate code
    code = data.get("code")
    if not code:
        code_slug = re.sub(r"[^A-Za-z0-9]", "-", title.upper())[:15]
        code = f"EVT-{code_slug}-{random.randint(100, 999)}"

    conn = db.get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("""
        INSERT INTO events (
            code, title, category, description, event_date, event_time,
            venue, capacity, is_active, reg_open_date, reg_close_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            code, title, category, description, event_date, event_time,
            venue, capacity, is_active, reg_open_date, reg_close_date
        ))
        event_id = cursor.lastrowid
        conn.commit()
    except Exception as e:
        conn.close()
        return jsonify({"error": f"Failed to create event: {str(e)}"}), 400

    conn.close()
    admin = get_current_admin()
    log_activity(admin["username"], "CREATE_EVENT", "event", f"Created event '{title}' ({code})", record_id=event_id)

    return jsonify({"success": True, "message": "Event created successfully.", "event_id": event_id}), 201


@app.route("/api/admin/events/<int:event_id>", methods=["PUT"])
@login_required
@role_required("Super Admin", "Admin")
def admin_update_event(event_id):
    """Edit an existing event."""
    data = request.get_json() or {}
    conn = db.get_db()
    cursor = conn.cursor()

    cursor.execute("SELECT id, title FROM events WHERE id = ?", (event_id,))
    existing = cursor.fetchone()
    if not existing:
        conn.close()
        return jsonify({"error": "Event not found."}), 404

    cursor.execute("""
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
    """, (
        data.get("title"), data.get("category"), data.get("description"),
        data.get("event_date"), data.get("event_time"), data.get("venue"),
        data.get("capacity"), data.get("is_active"), data.get("reg_open_date"),
        data.get("reg_close_date"), event_id
    ))
    conn.commit()
    conn.close()

    admin = get_current_admin()
    log_activity(admin["username"], "UPDATE_EVENT", "event", f"Updated event ID {event_id}", record_id=event_id)
    return jsonify({"success": True, "message": "Event updated successfully."})


@app.route("/api/admin/events/<int:event_id>", methods=["DELETE"])
@login_required
@role_required("Super Admin", "Admin")
def admin_delete_event(event_id):
    """Archive an event (Soft-delete)."""
    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("UPDATE events SET is_archived = 1, is_active = 0 WHERE id = ?", (event_id,))
    conn.commit()
    conn.close()

    admin = get_current_admin()
    log_activity(admin["username"], "ARCHIVE_EVENT", "event", f"Archived event ID {event_id}", record_id=event_id)
    return jsonify({"success": True, "message": "Event archived successfully."})


# ==============================================================================
# Admin Registrations Management Endpoints
# ==============================================================================

@app.route("/api/admin/registrations", methods=["GET"])
@login_required
def admin_list_registrations():
    """List, search, filter, and paginate registrations."""
    search = (request.args.get("search") or "").strip()
    event_id = request.args.get("event_id")
    department = request.args.get("department")
    academic_year = request.args.get("academic_year")
    status = request.args.get("status")
    attendance = request.args.get("attendance")
    date_from = request.args.get("date_from")
    date_to = request.args.get("date_to")
    archived = request.args.get("archived", "false").lower() == "true"
    sort_by = request.args.get("sort_by", "date_desc")

    page = max(1, int(request.args.get("page", 1)))
    limit = max(5, min(100, int(request.args.get("limit", 20))))
    offset = (page - 1) * limit

    # Build WHERE conditions
    conditions = ["r.is_archived = ?"]
    params = [1 if archived else 0]

    if search:
        s = f"%{search}%"
        conditions.append("(r.full_name LIKE ? OR r.enrollment_id LIKE ? OR r.email LIKE ? OR r.phone LIKE ? OR r.reg_code LIKE ?)")
        params.extend([s, s, s, s, s])

    if event_id:
        conditions.append("r.event_id = ?")
        params.append(event_id)

    if department:
        conditions.append("r.department = ?")
        params.append(department)

    if academic_year:
        conditions.append("r.academic_year = ?")
        params.append(academic_year)

    if status:
        conditions.append("r.status = ?")
        params.append(status)

    if attendance:
        conditions.append("r.attendance_status = ?")
        params.append(attendance)

    if date_from:
        conditions.append("date(r.created_at) >= date(?)")
        params.append(date_from)

    if date_to:
        conditions.append("date(r.created_at) <= date(?)")
        params.append(date_to)

    where_clause = " AND ".join(conditions)

    # Sort order
    order_map = {
        "date_desc": "r.created_at DESC",
        "date_asc": "r.created_at ASC",
        "name_asc": "r.full_name ASC",
        "name_desc": "r.full_name DESC",
        "event_asc": "r.event_name ASC"
    }
    order_clause = order_map.get(sort_by, "r.created_at DESC")

    conn = db.get_db()
    cursor = conn.cursor()

    # Get total count
    cursor.execute(f"SELECT COUNT(*) as total FROM registrations r WHERE {where_clause}", params)
    total_records = cursor.fetchone()["total"]

    # Fetch paginated items
    query = f"""
    SELECT 
        r.*,
        e.code as event_code,
        e.venue as event_venue,
        e.event_date as event_date
    FROM registrations r
    JOIN events e ON r.event_id = e.id
    WHERE {where_clause}
    ORDER BY {order_clause}
    LIMIT ? OFFSET ?
    """
    cursor.execute(query, params + [limit, offset])
    items = [dict(row) for row in cursor.fetchall()]
    conn.close()

    return jsonify({
        "items": items,
        "total": total_records,
        "page": page,
        "limit": limit,
        "pages": (total_records + limit - 1) // limit
    })


@app.route("/api/admin/registrations", methods=["POST"])
@login_required
@role_required("Super Admin", "Admin")
def admin_manual_registration():
    """Manually add a student registration from within admin dashboard."""
    data = request.get_json() or {}
    full_name = (data.get("full_name") or "").strip()
    enrollment_id = (data.get("enrollment_id") or "").strip().upper()
    department = (data.get("department") or "").strip()
    academic_year = (data.get("academic_year") or "").strip()
    email = (data.get("email") or "").strip().lower()
    phone = (data.get("phone") or "").strip()
    event_id = data.get("event_id")
    attendance_status = data.get("attendance_status", "pending")
    status = data.get("status", "confirmed")
    notes = (data.get("additional_info") or "").strip()

    if not full_name or not enrollment_id or not email or not event_id:
        return jsonify({"error": "Full name, enrollment ID, email, and event are required."}), 400

    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM events WHERE id = ?", (event_id,))
    event = cursor.fetchone()
    if not event:
        conn.close()
        return jsonify({"error": "Event not found"}), 404

    # Upsert student
    cursor.execute("SELECT id FROM students WHERE enrollment_id = ?", (enrollment_id,))
    st = cursor.fetchone()
    if st:
        student_id = st["id"]
    else:
        cursor.execute("""
        INSERT INTO students (enrollment_id, full_name, email, phone, department, academic_year)
        VALUES (?, ?, ?, ?, ?, ?)
        """, (enrollment_id, full_name, email, phone, department, academic_year))
        student_id = cursor.lastrowid

    # Check duplicate
    cursor.execute("SELECT id FROM registrations WHERE enrollment_id = ? AND event_id = ? AND is_archived = 0", (enrollment_id, event_id))
    if cursor.fetchone():
        conn.close()
        return jsonify({"error": "This student is already registered for this event."}), 409

    reg_code = generate_reg_code()
    cursor.execute("""
    INSERT INTO registrations (
        reg_code, student_id, event_id, enrollment_id, full_name, email,
        phone, department, academic_year, event_name, attendance_status,
        payment_status, status, additional_info
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'free', ?, ?)
    """, (
        reg_code, student_id, event["id"], enrollment_id, full_name, email,
        phone, department, academic_year, event["title"], attendance_status, status, notes
    ))
    reg_id = cursor.lastrowid
    conn.commit()
    conn.close()

    admin = get_current_admin()
    log_activity(admin["username"], "ADD_REGISTRATION_MANUAL", "registration", f"Admin created registration {reg_code} for {full_name}", record_id=reg_id)

    return jsonify({"success": True, "message": "Registration created successfully.", "reg_code": reg_code}), 201


@app.route("/api/admin/registrations/<int:reg_id>", methods=["PUT"])
@login_required
@role_required("Super Admin", "Admin")
def admin_edit_registration(reg_id):
    """Edit student registration details."""
    data = request.get_json() or {}
    conn = db.get_db()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM registrations WHERE id = ?", (reg_id,))
    existing = cursor.fetchone()
    if not existing:
        conn.close()
        return jsonify({"error": "Registration not found"}), 404

    cursor.execute("""
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
    """, (
        data.get("full_name"), data.get("department"), data.get("academic_year"),
        data.get("email"), data.get("phone"), data.get("status"),
        data.get("attendance_status"), data.get("additional_info"), reg_id
    ))
    conn.commit()
    conn.close()

    admin = get_current_admin()
    log_activity(admin["username"], "EDIT_REGISTRATION", "registration", f"Updated registration ID {reg_id}", record_id=reg_id)
    return jsonify({"success": True, "message": "Registration updated successfully."})


@app.route("/api/admin/registrations/<int:reg_id>/attendance", methods=["PATCH"])
@login_required
@role_required("Super Admin", "Admin")
def admin_toggle_attendance(reg_id):
    """Quick 1-click attendance toggle (present / absent / pending)."""
    data = request.get_json() or {}
    status = data.get("status")
    if status not in ("present", "absent", "pending"):
        return jsonify({"error": "Invalid attendance status. Must be present, absent, or pending."}), 400

    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, event_id, full_name, enrollment_id FROM registrations WHERE id = ?", (reg_id,))
    reg = cursor.fetchone()
    if not reg:
        conn.close()
        return jsonify({"error": "Registration not found"}), 404

    cursor.execute("UPDATE registrations SET attendance_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (status, reg_id))

    # Log in attendance records
    admin = get_current_admin()
    cursor.execute("""
    INSERT INTO attendance_records (registration_id, event_id, marked_by_admin, status, notes)
    VALUES (?, ?, ?, ?, ?)
    """, (reg_id, reg["event_id"], admin["username"], status, data.get("notes", "Attendance status update")))

    conn.commit()
    conn.close()

    log_activity(admin["username"], "UPDATE_ATTENDANCE", "attendance", f"Marked {reg['full_name']} ({reg['enrollment_id']}) as {status}", record_id=reg_id)
    return jsonify({"success": True, "message": f"Attendance marked as {status}.", "status": status})


@app.route("/api/admin/registrations/<int:reg_id>/status", methods=["PATCH"])
@login_required
@role_required("Super Admin", "Admin")
def admin_update_reg_status(reg_id):
    """Update registration status (registered / confirmed / cancelled / waitlist)."""
    data = request.get_json() or {}
    status = data.get("status")
    if status not in ("registered", "confirmed", "cancelled", "waitlist"):
        return jsonify({"error": "Invalid status."}), 400

    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("UPDATE registrations SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (status, reg_id))
    conn.commit()
    conn.close()

    admin = get_current_admin()
    log_activity(admin["username"], "CHANGE_STATUS", "registration", f"Changed status to '{status}' for reg ID {reg_id}", record_id=reg_id)
    return jsonify({"success": True, "message": f"Status changed to {status}."})


@app.route("/api/admin/registrations/<int:reg_id>", methods=["DELETE"])
@login_required
@role_required("Super Admin", "Admin")
def admin_delete_registration(reg_id):
    """Soft delete / archive registration (or permanent delete if permanent=true)."""
    permanent = request.args.get("permanent", "false").lower() == "true"
    admin = get_current_admin()

    conn = db.get_db()
    cursor = conn.cursor()

    if permanent:
        if admin["role"] != "Super Admin":
            conn.close()
            return jsonify({"error": "Only Super Admin can permanently delete registrations."}), 403
        cursor.execute("DELETE FROM registrations WHERE id = ?", (reg_id,))
        log_activity(admin["username"], "PERMANENT_DELETE_REGISTRATION", "registration", f"Permanently deleted registration ID {reg_id}", record_id=reg_id)
        msg = "Registration permanently deleted."
    else:
        cursor.execute("UPDATE registrations SET is_archived = 1 WHERE id = ?", (reg_id,))
        log_activity(admin["username"], "ARCHIVE_REGISTRATION", "registration", f"Soft-archived registration ID {reg_id}", record_id=reg_id)
        msg = "Registration archived. You can recover it from the Archived tab."

    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": msg})


@app.route("/api/admin/registrations/<int:reg_id>/restore", methods=["POST"])
@login_required
@role_required("Super Admin", "Admin")
def admin_restore_registration(reg_id):
    """Restore soft-archived registration."""
    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("UPDATE registrations SET is_archived = 0 WHERE id = ?", (reg_id,))
    conn.commit()
    conn.close()

    admin = get_current_admin()
    log_activity(admin["username"], "RESTORE_REGISTRATION", "registration", f"Restored registration ID {reg_id}", record_id=reg_id)
    return jsonify({"success": True, "message": "Registration restored successfully."})


# ==============================================================================
# Admin Student Records Endpoints (Requirement 12)
# ==============================================================================

@app.route("/api/admin/students", methods=["GET"])
@login_required
def admin_list_students():
    """List all students aggregated with event participation history."""
    search = (request.args.get("search") or "").strip()
    conn = db.get_db()
    cursor = conn.cursor()

    conditions = ["1=1"]
    params = []
    if search:
        s = f"%{search}%"
        conditions.append("(s.full_name LIKE ? OR s.enrollment_id LIKE ? OR s.email LIKE ? OR s.phone LIKE ?)")
        params.extend([s, s, s, s])

    query = f"""
    SELECT 
        s.*,
        COUNT(r.id) as total_events_registered,
        SUM(CASE WHEN r.attendance_status = 'present' THEN 1 ELSE 0 END) as total_events_attended
    FROM students s
    LEFT JOIN registrations r ON s.id = r.student_id AND r.is_archived = 0
    WHERE {" AND ".join(conditions)}
    GROUP BY s.id
    ORDER BY total_events_registered DESC, s.full_name ASC
    """
    cursor.execute(query, params)
    students = [dict(row) for row in cursor.fetchall()]
    conn.close()

    return jsonify({"students": students, "total": len(students)})


@app.route("/api/admin/students/<int:student_id>", methods=["GET"])
@login_required
def admin_student_detail(student_id):
    """Detailed student profile with complete Phoenix Club event participation history."""
    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM students WHERE id = ?", (student_id,))
    student = cursor.fetchone()
    if not student:
        conn.close()
        return jsonify({"error": "Student not found"}), 404

    cursor.execute("""
    SELECT 
        r.*,
        e.code as event_code,
        e.event_date,
        e.venue
    FROM registrations r
    JOIN events e ON r.event_id = e.id
    WHERE r.student_id = ?
    ORDER BY r.created_at DESC
    """, (student_id,))
    history = [dict(r) for r in cursor.fetchall()]
    conn.close()

    return jsonify({
        "student": dict(student),
        "history": history,
        "total_registered": len(history),
        "total_attended": sum(1 for h in history if h["attendance_status"] == "present")
    })


# ==============================================================================
# Admin Activity Log Endpoints (Requirement 13)
# ==============================================================================

@app.route("/api/admin/activity-logs", methods=["GET"])
@login_required
def admin_activity_logs():
    """Retrieve audit activity logs with optional search."""
    search = (request.args.get("search") or "").strip()
    limit = min(200, int(request.args.get("limit", 100)))

    conn = db.get_db()
    cursor = conn.cursor()

    if search:
        s = f"%{search}%"
        cursor.execute("""
        SELECT * FROM activity_logs
        WHERE admin_name LIKE ? OR action LIKE ? OR details LIKE ?
        ORDER BY timestamp DESC LIMIT ?
        """, (s, s, s, limit))
    else:
        cursor.execute("SELECT * FROM activity_logs ORDER BY timestamp DESC LIMIT ?", (limit,))

    logs = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return jsonify({"logs": logs})


# ==============================================================================
# Data Export Endpoints (Requirement 9: CSV & Excel .xlsx)
# ==============================================================================

@app.route("/api/admin/export/csv", methods=["GET"])
@login_required
def export_csv():
    """Export registrations to CSV file with UTF-8 BOM."""
    event_id = request.args.get("event_id")
    attendance = request.args.get("attendance")
    department = request.args.get("department")

    conn = db.get_db()
    cursor = conn.cursor()

    conditions = ["r.is_archived = 0"]
    params = []
    if event_id:
        conditions.append("r.event_id = ?")
        params.append(event_id)
    if attendance:
        conditions.append("r.attendance_status = ?")
        params.append(attendance)
    if department:
        conditions.append("r.department = ?")
        params.append(department)

    query = f"""
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
    WHERE {" AND ".join(conditions)}
    ORDER BY r.created_at DESC
    """
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()

    output = io.StringIO()
    # Write UTF-8 BOM for Excel compatibility
    output.write("\ufeff")
    writer = csv.writer(output)

    if rows:
        headers = [col[0] for col in cursor.description]
        writer.writerow(headers)
        for r in rows:
            writer.writerow(list(r))
    else:
        writer.writerow(["No registrations found matching the export filter criteria."])

    mem = io.BytesIO()
    mem.write(output.getvalue().encode("utf-8"))
    mem.seek(0)

    admin = get_current_admin()
    log_activity(admin["username"], "EXPORT_DATA", "export", f"Exported CSV ({len(rows)} records)")

    filename = f"Phoenix_Club_Registrations_{datetime.now().strftime('%Y%m%d_%H%M')}.csv"
    return send_file(mem, mimetype="text/csv", as_attachment=True, download_name=filename)


@app.route("/api/admin/export/excel", methods=["GET"])
@login_required
def export_excel():
    """Export registrations to a formatted Microsoft Excel (.xlsx) workbook."""
    event_id = request.args.get("event_id")
    attendance = request.args.get("attendance")
    department = request.args.get("department")

    conn = db.get_db()
    cursor = conn.cursor()

    conditions = ["r.is_archived = 0"]
    params = []
    if event_id:
        conditions.append("r.event_id = ?")
        params.append(event_id)
    if attendance:
        conditions.append("r.attendance_status = ?")
        params.append(attendance)
    if department:
        conditions.append("r.department = ?")
        params.append(department)

    query = f"""
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
    WHERE {" AND ".join(conditions)}
    ORDER BY r.created_at DESC
    """
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()

    # Create Workbook with openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Registrations"

    # Title Banner
    ws.merge_cells("A1:K1")
    title_cell = ws["A1"]
    title_cell.value = "Phoenix Club — Navrachana University | Official Registration Export"
    title_cell.font = Font(name="Calibri", size=14, bold=True, color="FFFFFF")
    title_cell.fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
    title_cell.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 36

    # Subtitle
    ws.merge_cells("A2:K2")
    sub_cell = ws["A2"]
    sub_cell.value = f"Exported on: {datetime.now().strftime('%d %B %Y, %I:%M %p')} | Total Records: {len(rows)}"
    sub_cell.font = Font(name="Calibri", size=10, italic=True, color="475569")
    sub_cell.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[2].height = 20

    # Table Headers
    headers = [
        "Registration ID", "Full Name", "Enrollment ID", "Department / School",
        "Academic Year", "Email", "Phone", "Event Name", "Status", "Attendance", "Registration Date"
    ]
    header_fill = PatternFill(start_color="EA580C", end_color="EA580C", fill_type="solid")
    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    thin_border = Border(
        left=Side(style="thin", color="CBD5E1"),
        right=Side(style="thin", color="CBD5E1"),
        top=Side(style="thin", color="CBD5E1"),
        bottom=Side(style="thin", color="CBD5E1")
    )

    ws.row_dimensions[4].height = 26
    for col_idx, header in enumerate(headers, start=1):
        cell = ws.cell(row=4, column=col_idx, value=header)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = thin_border

    # Data Rows
    row_idx = 5
    for r in rows:
        ws.row_dimensions[row_idx].height = 22
        for col_idx, val in enumerate(r, start=1):
            cell = ws.cell(row=row_idx, column=col_idx, value=val)
            cell.border = thin_border
            cell.font = Font(name="Calibri", size=10)

            # Special column alignments & colors
            if col_idx in (1, 3, 5, 7, 9, 10, 11):
                cell.alignment = Alignment(horizontal="center", vertical="center")
            else:
                cell.alignment = Alignment(horizontal="left", vertical="center")

            if col_idx == 10:  # Attendance
                if val == "present":
                    cell.fill = PatternFill(start_color="DCFCE7", fill_type="solid")
                    cell.font = Font(name="Calibri", size=10, bold=True, color="166534")
                elif val == "absent":
                    cell.fill = PatternFill(start_color="FEE2E2", fill_type="solid")
                    cell.font = Font(name="Calibri", size=10, bold=True, color="991B1B")

        row_idx += 1

    # Auto adjust column widths safely
    from openpyxl.utils import get_column_letter
    for col_idx in range(1, len(headers) + 1):
        max_len = 0
        for r_idx in range(4, row_idx):
            val_str = str(ws.cell(row=r_idx, column=col_idx).value or "")
            if len(val_str) > max_len:
                max_len = len(val_str)
        col_letter = get_column_letter(col_idx)
        ws.column_dimensions[col_letter].width = max(max_len + 4, 14)

    # Save to memory
    file_stream = io.BytesIO()
    wb.save(file_stream)
    file_stream.seek(0)

    admin = get_current_admin()
    log_activity(admin["username"], "EXPORT_EXCEL", "export", f"Exported Excel spreadsheet ({len(rows)} records)")

    filename = f"Phoenix_Club_Registrations_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"
    return send_file(
        file_stream,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name=filename
    )


# ==============================================================================
# Admin User Management & System Settings Endpoints (Super Admin Only)
# ==============================================================================

@app.route("/api/admin/users", methods=["GET"])
@login_required
@role_required("Super Admin")
def admin_list_users():
    """List all administrators (Super Admin only)."""
    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, username, email, role, full_name, is_active, created_at, last_login FROM admins ORDER BY id ASC")
    admins = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return jsonify({"users": admins})


@app.route("/api/admin/users", methods=["POST"])
@login_required
@role_required("Super Admin")
def admin_create_user():
    """Create a new administrator account (Super Admin only)."""
    data = request.get_json() or {}
    username = (data.get("username") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    role = data.get("role") or "Admin"
    full_name = (data.get("full_name") or "").strip()

    if not username or not email or not password or not full_name:
        return jsonify({"error": "All fields are required."}), 400

    if role not in ("Super Admin", "Admin", "Viewer"):
        return jsonify({"error": "Invalid role. Must be Super Admin, Admin, or Viewer."}), 400

    conn = db.get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("""
        INSERT INTO admins (username, email, password_hash, role, full_name)
        VALUES (?, ?, ?, ?, ?)
        """, (username, email, generate_password_hash(password), role, full_name))
        new_id = cursor.lastrowid
        conn.commit()
    except Exception as e:
        conn.close()
        return jsonify({"error": f"Failed to create admin: {str(e)}"}), 400

    conn.close()
    admin = get_current_admin()
    log_activity(admin["username"], "CREATE_ADMIN_USER", "admin", f"Created admin '{username}' with role '{role}'", record_id=new_id)
    return jsonify({"success": True, "message": f"Administrator account '{username}' created."}), 201


@app.route("/api/admin/users/<int:user_id>/role", methods=["PATCH"])
@login_required
@role_required("Super Admin")
def admin_change_role(user_id):
    """Change role or active status of an admin."""
    data = request.get_json() or {}
    role = data.get("role")
    is_active = data.get("is_active")

    admin = get_current_admin()
    if user_id == admin["id"] and is_active == 0:
        return jsonify({"error": "You cannot deactivate your own Super Admin account."}), 400

    conn = db.get_db()
    cursor = conn.cursor()
    if role:
        cursor.execute("UPDATE admins SET role = ? WHERE id = ?", (role, user_id))
    if is_active is not None:
        cursor.execute("UPDATE admins SET is_active = ? WHERE id = ?", (1 if is_active else 0, user_id))
    conn.commit()
    conn.close()

    log_activity(admin["username"], "UPDATE_ADMIN_ROLE", "admin", f"Updated user ID {user_id}", record_id=user_id)
    return jsonify({"success": True, "message": "Admin permissions updated."})


@app.route("/api/admin/users/<int:user_id>", methods=["DELETE"])
@login_required
@role_required("Super Admin")
def admin_delete_user(user_id):
    """Deactivate or remove administrator."""
    admin = get_current_admin()
    if user_id == admin["id"]:
        return jsonify({"error": "You cannot delete your own account."}), 400

    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM admins WHERE id = ?", (user_id,))
    conn.commit()
    conn.close()

    log_activity(admin["username"], "DELETE_ADMIN_USER", "admin", f"Deleted admin user ID {user_id}", record_id=user_id)
    return jsonify({"success": True, "message": "Admin user deleted."})


@app.route("/api/admin/settings", methods=["GET"])
@login_required
def admin_get_settings():
    """Retrieve system settings."""
    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT key, value FROM settings")
    rows = cursor.fetchall()
    conn.close()
    return jsonify({"settings": {r["key"]: r["value"] for r in rows}})


@app.route("/api/admin/settings", methods=["POST"])
@login_required
@role_required("Super Admin")
def admin_save_settings():
    """Update system settings (Super Admin only)."""
    data = request.get_json() or {}
    conn = db.get_db()
    cursor = conn.cursor()
    for k, v in data.items():
        cursor.execute("""
        INSERT INTO settings (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
        """, (k, str(v)))
    conn.commit()
    conn.close()

    admin = get_current_admin()
    log_activity(admin["username"], "UPDATE_SETTINGS", "settings", "Updated system configurations.")
    return jsonify({"success": True, "message": "Settings saved successfully."})


@app.route("/api/admin/seed-demo", methods=["POST"])
@login_required
@role_required("Super Admin")
def admin_seed_demo():
    """Seed demo registrations for testing (Requirement 23)."""
    db.seed_demo_registrations()
    admin = get_current_admin()
    log_activity(admin["username"], "SEED_DEMO_DATA", "database", "Triggered demo data seeding")
    return jsonify({"success": True, "message": "Demo registrations seeded successfully."})


@app.route("/api/admin/clear-demo", methods=["POST"])
@login_required
@role_required("Super Admin")
def admin_clear_demo():
    """Clear demo registrations (Requirement 23)."""
    db.clear_demo_data()
    admin = get_current_admin()
    log_activity(admin["username"], "CLEAR_DEMO_DATA", "database", "Cleared all demo registrations")
    return jsonify({"success": True, "message": "Demo data cleared successfully."})


@app.route("/api/admin/backup-db", methods=["GET"])
@login_required
@role_required("Super Admin")
def admin_download_backup():
    """Create and download database snapshot file."""
    backup_path, filename = db.create_database_backup()
    admin = get_current_admin()
    log_activity(admin["username"], "BACKUP_DATABASE", "database", f"Created snapshot {filename}")
    return send_file(backup_path, as_attachment=True, download_name=filename)


# ==============================================================================
# Error Handlers
# ==============================================================================

@app.errorhandler(404)
def handle_404(e):
    if request.path.startswith("/api/"):
        return jsonify({"error": "Endpoint not found."}), 404
    return "Page Not Found", 404


@app.errorhandler(500)
def handle_500(e):
    if request.path.startswith("/api/"):
        return jsonify({"error": "An internal server error occurred."}), 500
    return "Server Error", 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"Starting Phoenix Club Server at http://127.0.0.1:{port}")
    print(f"Admin Login: http://127.0.0.1:{port}/admin/login")
    print(f"Default Super Admin: admin / Admin@Phoenix2026")
    app.run(host="0.0.0.0", port=port, debug=True)
