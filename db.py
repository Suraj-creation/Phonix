"""
Phoenix Club Database Layer
Relational SQLite Database with WAL mode, foreign key enforcement,
indexing, and audit support.
"""

import sqlite3
import os
import shutil
from datetime import datetime
from werkzeug.security import generate_password_hash

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "phoenix_club.db")


def get_db():
    """Return a configured sqlite3 connection with Row factory and foreign keys."""
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    return conn


def init_db():
    """Initialize database tables, indexes, and constraints."""
    conn = get_db()
    cursor = conn.cursor()

    # 1. Admins table
    cursor.execute("""
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
    """)

    # 2. Events table
    cursor.execute("""
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
    """)

    # 3. Students table
    cursor.execute("""
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
    """)

    # 4. Registrations table
    cursor.execute("""
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
    """)

    # 5. Attendance Records table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS attendance_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        registration_id INTEGER NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        marked_by_admin TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('present', 'absent', 'pending')),
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        notes TEXT
    );
    """)

    # 6. Activity Logs table
    cursor.execute("""
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
    """)

    # 7. System Settings table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # Indexes for lightning-fast queries
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_reg_enrollment ON registrations(enrollment_id);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_reg_event ON registrations(event_id);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_reg_status ON registrations(status);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_reg_attendance ON registrations(attendance_status);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_reg_archived ON registrations(is_archived);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_students_enrollment ON students(enrollment_id);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity_logs(timestamp);")

    conn.commit()
    conn.close()


def seed_default_data():
    """Seed initial administrator accounts and flagship university events."""
    conn = get_db()
    cursor = conn.cursor()

    # 1. Super Admin Account
    cursor.execute("SELECT id FROM admins WHERE username = 'admin'")
    if not cursor.fetchone():
        cursor.execute("""
        INSERT INTO admins (username, email, password_hash, role, full_name)
        VALUES (?, ?, ?, ?, ?)
        """, (
            "admin",
            "admin@phoenixnuv.ac.in",
            generate_password_hash("Admin@Phoenix2026"),
            "Super Admin",
            "Phoenix Club Super Administrator"
        ))

    # 2. Staff Admin Account (Event Coordinator)
    cursor.execute("SELECT id FROM admins WHERE username = 'phoenix_lead'")
    if not cursor.fetchone():
        cursor.execute("""
        INSERT INTO admins (username, email, password_hash, role, full_name)
        VALUES (?, ?, ?, ?, ?)
        """, (
            "phoenix_lead",
            "lead@phoenixnuv.ac.in",
            generate_password_hash("Lead@Phoenix2026"),
            "Admin",
            "Club Secretary / Event Coordinator"
        ))

    # 3. Viewer Account (Faculty Mentor / Auditor)
    cursor.execute("SELECT id FROM admins WHERE username = 'faculty_viewer'")
    if not cursor.fetchone():
        cursor.execute("""
        INSERT INTO admins (username, email, password_hash, role, full_name)
        VALUES (?, ?, ?, ?, ?)
        """, (
            "faculty_viewer",
            "viewer@phoenixnuv.ac.in",
            generate_password_hash("Viewer@Phoenix2026"),
            "Viewer",
            "Faculty Mentor (Read-Only Viewer)"
        ))

    # 4. Standard Phoenix Club University Events
    events_seed = [
        (
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
        ),
        (
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
        ),
        (
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
        ),
        (
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
        ),
        (
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
        ),
        (
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
        ),
        (
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
        )
    ]

    for ev in events_seed:
        cursor.execute("SELECT id FROM events WHERE code = ?", (ev[0],))
        if not cursor.fetchone():
            cursor.execute("""
            INSERT INTO events (code, title, category, description, event_date, event_time, venue, capacity, is_active, reg_open_date, reg_close_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, ev)

    # 5. Default Settings
    settings_seed = [
        ("club_name", "Phoenix Club — Navrachana University"),
        ("university_name", "Navrachana University, Vadodara"),
        ("contact_email", "phoenixclub@nuv.ac.in"),
        ("registrations_open", "true"),
        ("allow_cancellations", "false"),
        ("system_notice", "Welcome to the Phoenix Club Management Portal. Academic Term 2026.")
    ]
    for k, v in settings_seed:
        cursor.execute("""
        INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)
        """, (k, v))

    conn.commit()
    conn.close()


def seed_demo_registrations():
    """Seed realistic, labeled demo registrations for testing the dashboard."""
    conn = get_db()
    cursor = conn.cursor()

    demo_students = [
        ("240101001", "Aarav Sharma", "aarav.sharma@nuv.ac.in", "+91 98250 11223", "School of Science", "1st Year (Freshman)"),
        ("230202045", "Diya Patel", "diya.patel@nuv.ac.in", "+91 98795 44332", "School of Engineering & Technology", "2nd Year (Sophomore)"),
        ("220303089", "Rohan Mehta", "rohan.mehta@nuv.ac.in", "+91 97240 88990", "School of Environmental Design & Architecture", "3rd Year (Junior)"),
        ("210404012", "Ananya Joshi", "ananya.joshi@nuv.ac.in", "+91 99099 55667", "School of Business & Law", "4th Year (Senior)"),
        ("240101015", "Kavya Desai", "kavya.desai@nuv.ac.in", "+91 94280 33445", "School of Science", "1st Year (Freshman)"),
        ("230202078", "Vivek Shah", "vivek.shah@nuv.ac.in", "+91 98240 66778", "School of Engineering & Technology", "2nd Year (Sophomore)"),
        ("220505023", "Pooja Trivedi", "pooja.trivedi@nuv.ac.in", "+91 98980 12345", "School of Liberal Arts & Education", "3rd Year (Junior)"),
        ("240101034", "Neil Bhatt", "neil.bhatt@nuv.ac.in", "+91 97120 45678", "School of Science", "Postgraduate / Masters"),
        ("230202090", "Tanvi Dave", "tanvi.dave@nuv.ac.in", "+91 98255 78901", "School of Engineering & Technology", "2nd Year (Sophomore)"),
        ("240101056", "Siddharth Verma", "siddharth.verma@nuv.ac.in", "+91 98765 43210", "School of Science", "1st Year (Freshman)")
    ]

    # Insert students
    student_ids = {}
    for roll, name, email, phone, dept, year in demo_students:
        cursor.execute("SELECT id FROM students WHERE enrollment_id = ?", (roll,))
        row = cursor.fetchone()
        if row:
            student_ids[roll] = row["id"]
        else:
            cursor.execute("""
            INSERT INTO students (enrollment_id, full_name, email, phone, department, academic_year)
            VALUES (?, ?, ?, ?, ?, ?)
            """, (roll, name, email, phone, dept, year))
            student_ids[roll] = cursor.lastrowid

    # Fetch events
    cursor.execute("SELECT id, code, title FROM events")
    events = {row["title"]: row for row in cursor.fetchall()}

    demo_registrations = [
        ("PHX-2026-1001", "240101001", "Investiture Ceremony 2026", "present", "confirmed", "Excited to meet the leadership council!"),
        ("PHX-2026-1002", "230202045", "Investiture Ceremony 2026", "present", "confirmed", "Attending with engineering cohort."),
        ("PHX-2026-1003", "220303089", "Wildlife Week Celebration 2026", "present", "confirmed", "Submitting wildlife photography series."),
        ("PHX-2026-1004", "210404012", "Wildlife Week Celebration 2026", "absent", "registered", "Interested in biodiversity panel."),
        ("PHX-2026-1005", "240101015", "Wildlife Week Celebration 2026", "present", "confirmed", "Volunteer coordinator for nature quiz."),
        ("PHX-2026-1006", "230202078", "Distinguished Guest Lecture: Modern Biotechnology", "present", "confirmed", "Keen on learning about CRISPR."),
        ("PHX-2026-1007", "220505023", "Distinguished Guest Lecture: Modern Biotechnology", "pending", "registered", "Liberal arts science elective."),
        ("PHX-2026-1008", "240101034", "Science & Innovation Hands-On Workshop", "present", "confirmed", "Bringing sensor prototype."),
        ("PHX-2026-1009", "230202090", "Science & Innovation Hands-On Workshop", "pending", "registered", "Interested in IoT microcontroller kit."),
        ("PHX-2026-1010", "240101056", "Phoenix Community Mixer & Orientation", "present", "confirmed", "New student seeking science mentors."),
        ("PHX-2026-1011", "240101001", "Annual General Club Membership 2026", "present", "confirmed", "All-access annual membership."),
        ("PHX-2026-1012", "230202045", "Annual General Club Membership 2026", "present", "confirmed", "Renewal of annual club pass."),
        ("PHX-2026-1013", "240101001", "Wildlife Week Celebration 2026", "present", "confirmed", "Participating in photography contest.")
    ]

    for reg_code, roll, ev_title, att_status, reg_status, notes in demo_registrations:
        cursor.execute("SELECT id FROM registrations WHERE reg_code = ?", (reg_code,))
        if not cursor.fetchone() and ev_title in events and roll in student_ids:
            ev = events[ev_title]
            st_id = student_ids[roll]
            # Fetch student details
            cursor.execute("SELECT * FROM students WHERE id = ?", (st_id,))
            st = cursor.fetchone()

            cursor.execute("""
            INSERT INTO registrations (
                reg_code, student_id, event_id, enrollment_id, full_name, email,
                phone, department, academic_year, event_name, attendance_status,
                payment_status, status, additional_info, is_demo
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'free', ?, ?, 1)
            """, (
                reg_code, st_id, ev["id"], roll, st["full_name"], st["email"],
                st["phone"], st["department"], st["academic_year"], ev["title"],
                att_status, reg_status, notes
            ))
            reg_id = cursor.lastrowid

            # Also log attendance if present/absent
            if att_status != 'pending':
                cursor.execute("""
                INSERT INTO attendance_records (registration_id, event_id, marked_by_admin, status, notes)
                VALUES (?, ?, 'Super Admin', ?, 'Demo check-in entry')
                """, (reg_id, ev["id"], att_status))

    # Activity log entry
    cursor.execute("""
    INSERT INTO activity_logs (admin_name, action, record_type, details, ip_address)
    VALUES ('System', 'SEED_DEMO', 'database', 'Seeded demo students and registrations', '127.0.0.1')
    """)

    conn.commit()
    conn.close()


def clear_demo_data():
    """Remove only demo registrations and students without touching user registrations."""
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("DELETE FROM attendance_records WHERE registration_id IN (SELECT id FROM registrations WHERE is_demo = 1)")
    cursor.execute("DELETE FROM registrations WHERE is_demo = 1")
    # Clean up orphan demo students
    cursor.execute("""
    DELETE FROM students WHERE id NOT IN (SELECT DISTINCT student_id FROM registrations)
    """)

    cursor.execute("""
    INSERT INTO activity_logs (admin_name, action, record_type, details, ip_address)
    VALUES ('Super Admin', 'CLEAR_DEMO', 'database', 'Cleared all demo registrations', '127.0.0.1')
    """)

    conn.commit()
    conn.close()


def create_database_backup():
    """Create a timestamped backup copy of phoenix_club.db in a backups folder."""
    backup_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backups")
    os.makedirs(backup_dir, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_filename = f"phoenix_club_backup_{timestamp}.db"
    backup_path = os.path.join(backup_dir, backup_filename)
    shutil.copy2(DB_PATH, backup_path)
    return backup_path, backup_filename
