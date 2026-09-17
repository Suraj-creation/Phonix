"""
Phoenix Club Authentication & Security Module
Role-Based Access Control (RBAC), Session Protection, and Audit Logging.
"""

from functools import wraps
from datetime import datetime, timedelta
from flask import session, request, jsonify, redirect, url_for
from werkzeug.security import generate_password_hash, check_password_hash
from db import get_db

SESSION_LIFETIME_HOURS = 8


def log_activity(admin_name, action, record_type, details="", record_id=None, ip_address=None):
    """Write an event to the audit activity logs."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("""
        INSERT INTO activity_logs (admin_name, action, record_type, record_id, details, ip_address)
        VALUES (?, ?, ?, ?, ?, ?)
        """, (
            admin_name or "Anonymous",
            action,
            record_type,
            str(record_id) if record_id else None,
            details,
            ip_address or request.remote_addr
        ))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Error logging activity: {e}")


def get_current_admin():
    """Retrieve currently authenticated admin record from session if valid."""
    admin_id = session.get("admin_id")
    if not admin_id:
        return None

    # Check session expiration
    login_time_str = session.get("login_time")
    if login_time_str:
        try:
            login_time = datetime.fromisoformat(login_time_str)
            if datetime.now() - login_time > timedelta(hours=SESSION_LIFETIME_HOURS):
                session.clear()
                return None
        except Exception:
            session.clear()
            return None

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, username, email, role, full_name, is_active FROM admins WHERE id = ? AND is_active = 1", (admin_id,))
    admin = cursor.fetchone()
    conn.close()

    if not admin:
        session.clear()
        return None

    return dict(admin)


def login_required(f):
    """Decorator to enforce admin authentication."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        admin = get_current_admin()
        if not admin:
            if request.path.startswith("/api/"):
                return jsonify({"error": "Unauthorized. Please log in to access this resource."}), 401
            return redirect(url_for("admin_login_page", next=request.url))
        return f(*args, **kwargs)
    return decorated_function


def role_required(*allowed_roles):
    """Decorator to enforce role-based permissions (Super Admin, Admin, Viewer)."""
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            admin = get_current_admin()
            if not admin:
                if request.path.startswith("/api/"):
                    return jsonify({"error": "Unauthorized. Please log in."}), 401
                return redirect(url_for("admin_login_page"))

            if admin["role"] not in allowed_roles:
                if request.path.startswith("/api/"):
                    return jsonify({
                        "error": f"Permission denied. This action requires one of the following roles: {', '.join(allowed_roles)}. Your current role is '{admin['role']}'."
                    }), 403
                return render_unauthorized_page(admin)

            return f(*args, **kwargs)
        return decorated_function
    return decorator


def render_unauthorized_page(admin):
    """Render friendly unauthorized message if accessed from browser."""
    return f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Access Denied — Phoenix Club</title>
      <link rel="stylesheet" href="/styles.css">
      <style>
        body {{ display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #0f172a; color: #fff; font-family: sans-serif; text-align: center; margin: 0; }}
        .card {{ background: #1e293b; padding: 40px; border-radius: 16px; max-width: 480px; border: 1px solid #334155; }}
        .btn {{ display: inline-block; margin-top: 20px; padding: 10px 20px; background: #f97316; color: #fff; text-decoration: none; border-radius: 8px; font-weight: bold; }}
      </style>
    </head>
    <body>
      <div class="card">
        <div style="margin-bottom: 16px;">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
        </div>
        <h2 style="color: #ef4444; margin-top: 0; font-size: 1.4rem;">Permission Restricted</h2>
        <p style="color: #94a3b8; font-size: 0.95rem; line-height: 1.6;">Your current account (<strong>{admin['username']}</strong> — {admin['role']}) does not have permission to access this administrative feature.</p>
        <a href="/admin/dashboard" class="btn">Return to Dashboard</a>
      </div>
    </body>
    </html>
    """, 403
