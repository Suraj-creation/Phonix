# Phoenix Club — University Admin Dashboard & Registration Management System
**Navrachana University, Vadodara** &bull; Accredited with Grade 'A' by NAAC

A production-ready, secure, relational database-driven web platform and administrative control center for the Phoenix Club student community.

---

## 🌟 Overview & Key Highlights

- **Vibrant Site Visuals**: Deep cosmic dark theme with luminous Phoenix flame gradients (`#f97316`, `#e11d48`, `#f59e0b`, `#7c3aed`), glowing accents, branded social buttons, and quick Admin Portal access across all site footers.
- **Relational Persistent Database**: Powered by SQLite 3 with Write-Ahead Logging (WAL mode), foreign key constraints, indexes, and full relational integrity.
- **Role-Based Access Control (RBAC)**:
  - 👑 **Super Admin**: Complete control (full CRUD, user account management, settings, demo data controls, database snapshot backups).
  - 📋 **Admin**: Manage events, student registrations, attendance, and data exports.
  - 👁️ **Viewer**: Read-only oversight for faculty mentors, council advisors, or auditors.
- **Interactive Analytics**: Live KPI stat counters and responsive Chart.js visual charts for daily registration timelines, capacity tracking, school/department representation, and attendance ratios.
- **Duplicate Prevention**: Immediate verification prevents students from accidentally registering twice for the same event (HTTP 409 Conflict with registered pass reference).
- **Event-Specific Drill-Down**: Dedicated dashboards for individual events (e.g. Wildlife Week, Investiture Ceremony, Guest Lectures) with isolated KPI cards and distribution charts.
- **Student Participation History**: Master student directory showing each student's complete participation timeline across all Phoenix Club events.
- **Event-Day Attendance Kiosk**: 1-click fast-track check-in tool to mark attendees as *Present*, *Absent*, or *Pending*.
- **Data Exporting**: 1-click exports to standard **CSV** (with UTF-8 BOM) and styled **Microsoft Excel (.xlsx)** workbooks with formatted headers and status highlights.
- **Comprehensive Audit Trail**: Real-time activity logs recording all logins, event updates, registration changes, and exports.

---

## 🚀 Quick Start (Run Locally)

### 1. Requirements
- Python 3.10+ (Tested and certified on Python 3.13)
- `pip` package manager

### 2. Install Dependencies
```bash
pip install -r requirements.txt
```

### 3. Launch the Server
```bash
python app.py
```

The server will automatically initialize the database schema (`phoenix_club.db`) and seed default university events and administrators.

### 4. Access the Platform
- **Public Website**: [http://127.0.0.1:5000/](http://127.0.0.1:5000/)
- **Student Registration**: [http://127.0.0.1:5000/registration.html](http://127.0.0.1:5000/registration.html)
- **Admin Portal Login**: [http://127.0.0.1:5000/admin/login](http://127.0.0.1:5000/admin/login)
- **Admin Dashboard**: [http://127.0.0.1:5000/admin/dashboard](http://127.0.0.1:5000/admin/dashboard)

---

## 🔐 Default Administrator Accounts

During initial database setup, three pre-configured role accounts are created:

| Role | Username | University Email | Default Password | Access Level |
| :--- | :--- | :--- | :--- | :--- |
| **Super Admin** | `admin` | `admin@phoenixnuv.ac.in` | `Admin@Phoenix2026` | Complete administrative authority |
| **Admin** | `phoenix_lead` | `lead@phoenixnuv.ac.in` | `Lead@Phoenix2026` | Manage registrations & events |
| **Viewer** | `faculty_viewer` | `viewer@phoenixnuv.ac.in` | `Viewer@Phoenix2026` | Read-only dashboards & reports |

> [!TIP]
> On the login page ([/admin/login](http://127.0.0.1:5000/admin/login)), use the **Quick-Fill** buttons to instantly test any of the three roles with a single click!
> Passwords can be changed anytime in the **Settings & Admins** section of the dashboard.

---

## 🗄️ Database Architecture

The SQLite database file `phoenix_club.db` contains 7 relational tables:

```
+----------------+       +-------------------+       +-----------------------+
|    students    | 1---* |   registrations   | *---1 |        events         |
+----------------+       +-------------------+       +-----------------------+
| id             |       | id                |       | id                    |
| enrollment_id  |       | reg_code          |       | code                  |
| full_name      |       | student_id (FK)   |       | title                 |
| email          |       | event_id (FK)     |       | category              |
| phone          |       | full_name         |       | event_date            |
| department     |       | enrollment_id     |       | event_time            |
| academic_year  |       | attendance_status |       | venue                 |
+----------------+       | payment_status    |       | capacity              |
                         | status            |       | is_active             |
                         | is_archived       |       | is_archived           |
                         +-------------------+       +-----------------------+
                                  |                             |
                                  +--------------+--------------+
                                                 |
                                     +-----------------------+
                                     |  attendance_records   |
                                     +-----------------------+
                                     | id                    |
                                     | registration_id (FK)  |
                                     | event_id (FK)         |
                                     | marked_by_admin       |
                                     | status                |
                                     | timestamp             |
                                     +-----------------------+
```

### Supporting Tables:
- **`admins`**: Stores encrypted credentials (`password_hash`), user roles (`Super Admin`, `Admin`, `Viewer`), active flags, and timestamps.
- **`activity_logs`**: Tamper-evident audit trail capturing admin username, action performed, record affected, IP address, and datetime.
- **`settings`**: System-wide configuration key-value store.

---

## 📋 Features Walkthrough

### 1. Public Registration Experience
- Students choose an event from the dynamic list of active university initiatives.
- Instant client-side & server-side validation checks roll number, university email format, and phone number.
- **Duplicate Prevention**: If a student is already registered, a friendly banner alerts them with their existing Registration Pass ID.
- Upon submission, the verified **Digital Pass Card** displays the student's unique `PHX-2026-XXXXX` registration code, event date, venue, and a 1-click **Print / Save Pass** button.

### 2. Admin Dashboard & Analytics
- **Live KPI Counter**: Real-time counts for Total Registrations, Registrations Today, Active Events, Total Students, Attendance Rate, and Pending Entries.
- **Charts**:
  - *Registrations Timeline*: Visual trend over dates.
  - *Event Distribution*: Bar comparison of registrations vs maximum capacity.
  - *Department Distribution*: Polar area chart showing student shares across Schools (Science, Engineering, Design, Business, Liberal Arts).
  - *Attendance Breakdown*: Real-time doughnut chart.

### 3. Events Management
- Create, edit, and soft-archive events.
- Set capacity ceilings, event venues, dates, and categories.
- Direct link to inspect event-specific metrics.

### 4. Registrations Table
- **Multi-Filter Toolbar**: Search by student name, enrollment number, email, phone, or registration code.
- Filter by Event, School/Department, Academic Year, and Attendance Status (*Present*, *Absent*, *Pending*).
- **1-Click Inline Attendance**: Change a student's attendance with one click directly in the table.
- **Soft Delete / Archive**: Move records to the archive tab so accidental deletions can be safely recovered.

### 5. Event-Specific Drill-Down
- Select any event (e.g. Wildlife Week 2026) to see its isolated capacity meter, present/absent counts, department representation pie chart, and year distribution.

### 6. Student Directory & Participation History
- Aggregated directory of all students.
- Click **View History** on any student to open a modal with their full chronological record of every Phoenix Club event they signed up for and whether they attended.

### 7. Fast-Track Attendance Kiosk
- For check-in desks on event day: select the event, scan or type a student's Enrollment ID or Pass Code, and click **Mark Present** or **Mark Absent**.

### 8. Data Export (CSV & Excel)
- Export all or filtered registrations with one click.
- Native `.xlsx` export built with `openpyxl` features title banners, column formatting, and colored attendance badges.

### 9. Demo Data & Backups
- **Seed Demo Data**: Injects realistic student registrations for quick testing.
- **Clear Demo Data**: Safely clears test entries without touching authentic student registrations.
- **Download Database Backup**: Generates an immediate snapshot file `phoenix_club_backup_<timestamp>.db`.

---

## 🧪 Automated Testing

A complete automated unit test suite is included in `tests/test_system.py`:

```bash
python tests/test_system.py
```

All 11 verification suites test:
1. Database schema and table constraints
2. Super Admin authentication
3. Failed login rejection (401)
4. Role-based access control (RBAC 403 Forbidden enforcement)
5. Public active events API
6. Registration creation and duplicate rejection (409 Conflict)
7. Real-time analytics calculation
8. 1-click attendance toggle
9. Student participation history compilation
10. CSV and native Excel (.xlsx) export generation
11. Activity audit logging

---

## 🌐 Production Deployment Guide

### Option A: Deploying on Render / Railway
1. Push this repository to GitHub.
2. In [Render](https://render.com) or [Railway](https://railway.app), create a new **Web Service**.
3. Set the build and start commands:
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `gunicorn -w 2 -b 0.0.0.0:$PORT app:app`
4. Set Environment Variables:
   - `FLASK_SECRET_KEY`: `<Generate a random 32-character secret>`
   - `FLASK_ENV`: `production`

### Option B: Deploying on PythonAnywhere
1. Create a Python 3.10+ Web App on [PythonAnywhere](https://www.pythonanywhere.com).
2. Open Bash console and clone your repository or upload files.
3. Install dependencies: `pip install -r requirements.txt`.
4. In the Web configuration tab, point the WSGI file to `app.py`:
   ```python
   import sys
   path = '/home/yourusername/final'
   if path not in sys.path:
       sys.path.append(path)
   from app import app as application
   ```

### Option C: Ubuntu Linux VPS (Nginx + Gunicorn + Systemd)
1. Install Gunicorn: `pip install gunicorn`.
2. Create systemd service `/etc/systemd/system/phoenix.service`:
   ```ini
   [Unit]
   Description=Phoenix Club Flask Web Service
   After=network.target

   [Service]
   User=www-data
   WorkingDirectory=/var/www/phoenix
   Environment="PATH=/var/www/phoenix/venv/bin"
   ExecStart=/var/www/phoenix/venv/bin/gunicorn --workers 3 --bind 127.0.0.1:5000 app:app

   [Install]
   WantedBy=multi-user.target
   ```
3. Configure Nginx reverse proxy to proxy requests to `http://127.0.0.1:5000`.

---

## 💾 Database Backups & Maintenance

### Automatic Backups via Dashboard
A Super Admin can download a complete SQLite database snapshot anytime from **Settings & Admins &rarr; Download SQLite Database Backup (.db)**.

### Manual Command-Line Backup
```bash
python -c "import db; print(db.create_database_backup())"
```
Backups are saved with timestamped filenames in the `backups/` folder.

---

&copy; 2026 Phoenix Club, Navrachana University, Vadodara. All rights reserved.
