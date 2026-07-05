#!/usr/bin/env python3
"""Enjoy team – web + rezervační API (pouze Python 3, bez závislostí)."""

import csv
import io
import json
import os
import re
import sqlite3
import time
from datetime import date
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse

PORT = int(os.environ.get("PORT", 3000))
ADMIN_PIN = os.environ.get("ADMIN_PIN", "enjoy2026")
MAX_BOOKINGS_PER_HOUR = int(os.environ.get("MAX_BOOKINGS_PER_HOUR", "3"))
MAX_BOOKINGS_PER_LESSON = int(os.environ.get("MAX_BOOKINGS_PER_LESSON", "3"))
MIN_BOOKING_DELAY_SEC = 2
MAX_BOOKING_FORM_AGE_SEC = 30 * 60
NAME_PATTERN = re.compile(
    r"^[a-zA-ZáčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ0-9 .'\-]{2,40}$"
)
SPAM_PATTERN = re.compile(r"https?://|www\.|@", re.IGNORECASE)
ROOT = Path(__file__).parent / "docs"
DATA_DIR = Path(__file__).parent / "data"
DB_PATH = DATA_DIR / "rezervace.db"


def init_db():
    DATA_DIR.mkdir(exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS lessons (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            branch TEXT NOT NULL,
            date TEXT NOT NULL,
            title TEXT DEFAULT 'Lekce',
            time_from TEXT,
            time_to TEXT,
            max_slots INTEGER DEFAULT 20,
            price INTEGER DEFAULT 200,
            UNIQUE(branch, date)
        );
        CREATE TABLE IF NOT EXISTS bookings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lesson_id INTEGER NOT NULL,
            slot INTEGER NOT NULL CHECK(slot >= 1),
            name TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(lesson_id, slot),
            FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS contacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            phone TEXT NOT NULL,
            first_seen_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );
    """)
    cols = {row[1] for row in conn.execute("PRAGMA table_info(lessons)")}
    if "time_from" not in cols:
        conn.execute("ALTER TABLE lessons ADD COLUMN time_from TEXT")
    if "time_to" not in cols:
        conn.execute("ALTER TABLE lessons ADD COLUMN time_to TEXT")
    if "max_slots" not in cols:
        conn.execute("ALTER TABLE lessons ADD COLUMN max_slots INTEGER DEFAULT 20")
    if "price" not in cols:
        conn.execute("ALTER TABLE lessons ADD COLUMN price INTEGER DEFAULT 200")
        conn.execute("UPDATE lessons SET price = 200 WHERE price IS NULL")

    booking_cols = {row[1] for row in conn.execute("PRAGMA table_info(bookings)")}
    if "client_ip" not in booking_cols:
        conn.execute("ALTER TABLE bookings ADD COLUMN client_ip TEXT")
    if "email" not in booking_cols:
        conn.execute("ALTER TABLE bookings ADD COLUMN email TEXT")
    if "phone" not in booking_cols:
        conn.execute("ALTER TABLE bookings ADD COLUMN phone TEXT")
    if "gdpr_consent_at" not in booking_cols:
        conn.execute("ALTER TABLE bookings ADD COLUMN gdpr_consent_at TEXT")

    contact_cols = {row[1] for row in conn.execute("PRAGMA table_info(contacts)")}
    if "gdpr_consent_at" not in contact_cols:
        conn.execute("ALTER TABLE contacts ADD COLUMN gdpr_consent_at TEXT")

    row = conn.execute("SELECT sql FROM sqlite_master WHERE name='bookings'").fetchone()
    if row and row[0] and "slot <= 20" in row[0]:
        conn.executescript("""
            CREATE TABLE bookings_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lesson_id INTEGER NOT NULL,
                slot INTEGER NOT NULL CHECK(slot >= 1),
                name TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now')),
                UNIQUE(lesson_id, slot),
                FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE
            );
            INSERT INTO bookings_new SELECT * FROM bookings;
            DROP TABLE bookings;
            ALTER TABLE bookings_new RENAME TO bookings;
        """)
    sync_contacts_from_bookings(conn)
    conn.commit()
    conn.close()


def upsert_contact(conn, name, email, phone, gdpr_consent_at=None):
    if gdpr_consent_at:
        conn.execute(
            """
            INSERT INTO contacts (name, email, phone, first_seen_at, updated_at, gdpr_consent_at)
            VALUES (?, ?, ?, datetime('now'), datetime('now'), ?)
            ON CONFLICT(email) DO UPDATE SET
                name = excluded.name,
                phone = excluded.phone,
                updated_at = datetime('now'),
                gdpr_consent_at = COALESCE(contacts.gdpr_consent_at, excluded.gdpr_consent_at)
            """,
            (name, email, phone, gdpr_consent_at),
        )
        return

    conn.execute(
        """
        INSERT INTO contacts (name, email, phone, first_seen_at, updated_at)
        VALUES (?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(email) DO UPDATE SET
            name = excluded.name,
            phone = excluded.phone,
            updated_at = datetime('now')
        """,
        (name, email, phone),
    )


def sync_contacts_from_bookings(conn):
    rows = conn.execute(
        """
        SELECT email,
               (SELECT name FROM bookings b2
                WHERE b2.email = b.email AND b2.name IS NOT NULL
                ORDER BY b2.created_at DESC LIMIT 1) AS name,
               (SELECT phone FROM bookings b3
                WHERE b3.email = b.email AND b3.phone IS NOT NULL
                ORDER BY b3.created_at DESC LIMIT 1) AS phone,
               MIN(created_at) AS first_seen_at,
               MAX(created_at) AS updated_at
        FROM bookings b
        WHERE email IS NOT NULL AND TRIM(email) != ''
        GROUP BY email
        """
    ).fetchall()
    for row in rows:
        email, name, phone, first_seen_at, updated_at = row
        if not name or not phone:
            continue
        conn.execute(
            """
            INSERT INTO contacts (name, email, phone, first_seen_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(email) DO UPDATE SET
                name = excluded.name,
                phone = excluded.phone,
                updated_at = CASE
                    WHEN excluded.updated_at > contacts.updated_at THEN excluded.updated_at
                    ELSE contacts.updated_at
                END,
                first_seen_at = CASE
                    WHEN excluded.first_seen_at < contacts.first_seen_at THEN excluded.first_seen_at
                    ELSE contacts.first_seen_at
                END
            """,
            (name, email, phone, first_seen_at, updated_at),
        )


def validate_time(value, label):
    if value is None or value == "":
        return None
    if not isinstance(value, str) or len(value) != 5 or value[2] != ":":
        raise ValueError(f"{label} musí být ve formátu HH:MM")
    hour, minute = value.split(":")
    if not hour.isdigit() or not minute.isdigit():
        raise ValueError(f"{label} musí být ve formátu HH:MM")
    h, m = int(hour), int(minute)
    if h < 0 or h > 23 or m < 0 or m > 59:
        raise ValueError(f"{label} není platný čas")
    return f"{h:02d}:{m:02d}"


def validate_max_slots(value):
    try:
        slots = int(value)
    except (TypeError, ValueError):
        raise ValueError("Počet míst musí být celé číslo")
    if slots < 1 or slots > 100:
        raise ValueError("Počet míst musí být mezi 1 a 100")
    return slots


def validate_price(value):
    try:
        price = int(value)
    except (TypeError, ValueError):
        raise ValueError("Cena musí být celé číslo")
    if price < 0 or price > 100_000:
        raise ValueError("Cena musí být mezi 0 a 100 000 Kč")
    return price


def validate_booking_name(name):
    name = (name or "").strip()
    if not NAME_PATTERN.match(name):
        raise ValueError("Zadejte platné jméno (2–40 znaků, bez odkazů)")
    if SPAM_PATTERN.search(name):
        raise ValueError("Zadejte platné jméno (2–40 znaků, bez odkazů)")
    return name


def validate_email(value):
    email = (value or "").strip().lower()
    if not email or len(email) > 120:
        raise ValueError("Zadejte platný e-mail")
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise ValueError("Zadejte platný e-mail")
    return email


def normalize_phone(value):
    digits = re.sub(r"\D", "", value or "")
    if digits.startswith("420") and len(digits) == 12:
        digits = digits[3:]
    if len(digits) == 9 and digits[0] in "23456789":
        return digits
    raise ValueError("Zadejte platné číslo mobilu (9 číslic)")


def validate_gdpr_consent(data):
    consent = data.get("gdpr_consent")
    if consent is True or consent == "true" or consent == 1 or consent == "1":
        return
    raise ValueError("Pro rezervaci je nutný souhlas se zpracováním osobních údajů")


def lesson_is_bookable(lesson):
    try:
        lesson_date = date.fromisoformat(lesson["date"])
    except ValueError:
        return False
    return lesson_date >= date.today()


def db_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        print(f"[{self.log_date_time_string()}] {fmt % args}")

    def send_json(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_csv(self, filename, rows):
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(["Jméno", "E-mail", "Telefon", "První kontakt", "Naposledy aktualizován"])
        for row in rows:
            writer.writerow([
                row["name"],
                row["email"],
                row["phone"],
                row["first_seen_at"],
                row["updated_at"],
            ])
        body = buf.getvalue().encode("utf-8-sig")
        self.send_response(200)
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        if not length:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def is_admin(self):
        return self.headers.get("X-Admin-Pin") == ADMIN_PIN

    def client_ip(self):
        forwarded = self.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return self.client_address[0]

    def check_booking_spam(self, data):
        honeypot = (data.get("website") or data.get("hp") or "").strip()
        if honeypot:
            raise ValueError("Rezervaci se nepodařilo ověřit")

        opened_at = data.get("opened_at")
        try:
            opened_ms = int(opened_at)
        except (TypeError, ValueError):
            raise ValueError("Rezervaci se nepodařilo ověřit")

        now_ms = int(time.time() * 1000)
        age_sec = (now_ms - opened_ms) / 1000
        if age_sec < MIN_BOOKING_DELAY_SEC:
            raise ValueError("Počkejte chvilku a zkuste to znovu")
        if age_sec > MAX_BOOKING_FORM_AGE_SEC:
            raise ValueError("Formulář vypršel, otevřete lekci znovu")

    def check_booking_limits(self, conn, ip, lesson_id):
        per_lesson = conn.execute(
            """
            SELECT COUNT(*) AS count
            FROM bookings
            WHERE client_ip = ? AND lesson_id = ?
            """,
            (ip, lesson_id),
        ).fetchone()["count"]
        if per_lesson >= MAX_BOOKINGS_PER_LESSON:
            raise ValueError(
                f"Na tuto lekci už máte {MAX_BOOKINGS_PER_LESSON} rezervace. "
                f"Zrušte jednu, nebo vyberte jiný termín lekce."
            )

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/contacts":
            return self.get_contacts()

        if path == "/api/contacts/export":
            return self.export_contacts()

        if path.startswith("/api/lessons/") and path.endswith("/bookings"):
            lesson_id = path.split("/")[3]
            return self.get_bookings(lesson_id)

        if path.startswith("/api/lessons/"):
            branch = path.split("/")[3]
            month = parse_qs(parsed.query).get("month", [None])[0]
            return self.get_lessons(branch, month)

        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/lessons":
            return self.create_lesson()

        if path.endswith("/bookings/cancel"):
            lesson_id = path.split("/")[3]
            return self.cancel_booking(lesson_id)

        if path.startswith("/api/lessons/") and path.endswith("/bookings"):
            lesson_id = path.split("/")[3]
            return self.create_booking(lesson_id)

        parts = path.strip("/").split("/")
        if len(parts) == 4 and parts[0] == "api" and parts[1] == "lessons" and parts[3] == "update":
            return self.update_lesson(parts[2])

        self.send_json(404, {"error": "Nenalezeno"})

    def do_PATCH(self):
        parsed = urlparse(self.path)
        parts = parsed.path.strip("/").split("/")

        if parts[:2] == ["api", "lessons"] and len(parts) == 3:
            return self.update_lesson(parts[2])

        self.send_json(404, {"error": "Nenalezeno"})

    def do_DELETE(self):
        parsed = urlparse(self.path)
        parts = parsed.path.strip("/").split("/")

        if parts[:2] == ["api", "lessons"] and len(parts) == 3:
            return self.delete_lesson(parts[2])

        if parts[:2] == ["api", "lessons"] and len(parts) == 5 and parts[3] == "bookings":
            return self.delete_booking(parts[2], parts[4])

        self.send_json(404, {"error": "Nenalezeno"})

    def get_lessons(self, branch, month):
        if not month or len(month) != 7:
            return self.send_json(400, {"error": "Parametr month musí být YYYY-MM"})

        conn = db_conn()
        rows = conn.execute("""
            SELECT l.id, l.branch, l.date, l.title, l.time_from, l.time_to, l.max_slots, l.price,
                   (SELECT COUNT(*) FROM bookings b WHERE b.lesson_id = l.id) AS booked_count
            FROM lessons l
            WHERE l.branch = ? AND l.date LIKE ?
            ORDER BY l.date
        """, (branch, f"{month}%")).fetchall()
        conn.close()
        return self.send_json(200, [dict(r) for r in rows])

    def create_lesson(self):
        if not self.is_admin():
            return self.send_json(401, {"error": "Neplatný admin PIN"})

        data = self.read_json()
        branch = data.get("branch")
        date = data.get("date")
        title = (data.get("title") or "").strip()

        try:
            time_from = validate_time(data.get("time_from"), "Čas od")
            time_to = validate_time(data.get("time_to"), "Čas do")
            max_slots = validate_max_slots(data.get("max_slots", 20))
            price = validate_price(data.get("price", 200))
        except ValueError as exc:
            return self.send_json(400, {"error": str(exc)})

        if not branch or not date or len(date) != 10:
            return self.send_json(400, {"error": "Vyplňte pobočku a datum YYYY-MM-DD"})

        if len(title) < 2:
            return self.send_json(400, {"error": "Vyplňte typ cvičení (min. 2 znaky)"})

        if not time_from or not time_to:
            return self.send_json(400, {"error": "Vyplňte čas začátku i konce lekce"})

        if time_from >= time_to:
            return self.send_json(400, {"error": "Čas začátku musí být před časem konce"})

        conn = db_conn()
        try:
            cur = conn.execute(
                "INSERT INTO lessons (branch, date, title, time_from, time_to, max_slots, price) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (branch, date, title, time_from, time_to, max_slots, price),
            )
            conn.commit()
            return self.send_json(200, {
                "id": cur.lastrowid,
                "branch": branch,
                "date": date,
                "title": title,
                "time_from": time_from,
                "time_to": time_to,
                "max_slots": max_slots,
                "price": price,
            })
        except sqlite3.IntegrityError:
            return self.send_json(409, {"error": "Lekce v tento den už existuje"})
        finally:
            conn.close()

    def update_lesson(self, lesson_id):
        if not self.is_admin():
            return self.send_json(401, {"error": "Neplatný admin PIN"})

        data = self.read_json()
        title = (data.get("title") or "").strip()
        try:
            time_from = validate_time(data.get("time_from"), "Čas od")
            time_to = validate_time(data.get("time_to"), "Čas do")
            max_slots = validate_max_slots(data.get("max_slots", 20))
            price = validate_price(data.get("price", 200))
        except ValueError as exc:
            return self.send_json(400, {"error": str(exc)})

        if len(title) < 2:
            return self.send_json(400, {"error": "Vyplňte typ cvičení (min. 2 znaky)"})

        if not time_from or not time_to:
            return self.send_json(400, {"error": "Vyplňte čas začátku i konce lekce"})

        if time_from >= time_to:
            return self.send_json(400, {"error": "Čas začátku musí být před časem konce"})

        conn = db_conn()
        lesson = conn.execute(
            "SELECT id, (SELECT COUNT(*) FROM bookings WHERE lesson_id = ?) AS booked_count FROM lessons WHERE id = ?",
            (lesson_id, lesson_id),
        ).fetchone()
        if not lesson:
            conn.close()
            return self.send_json(404, {"error": "Lekce nenalezena"})

        if lesson["booked_count"] > max_slots:
            conn.close()
            return self.send_json(400, {"error": f"Počet míst nemůže být menší než počet rezervací ({lesson['booked_count']})"})

        conn.execute(
            "UPDATE lessons SET title = ?, time_from = ?, time_to = ?, max_slots = ?, price = ? WHERE id = ?",
            (title, time_from, time_to, max_slots, price, lesson_id),
        )
        conn.commit()
        updated = conn.execute("SELECT * FROM lessons WHERE id = ?", (lesson_id,)).fetchone()
        conn.close()
        return self.send_json(200, dict(updated))

    def delete_lesson(self, lesson_id):
        if not self.is_admin():
            return self.send_json(401, {"error": "Neplatný admin PIN"})

        conn = db_conn()
        conn.execute("DELETE FROM lessons WHERE id = ?", (lesson_id,))
        conn.commit()
        conn.close()
        return self.send_json(200, {"ok": True})

    def get_bookings(self, lesson_id):
        conn = db_conn()
        lesson = conn.execute("SELECT * FROM lessons WHERE id = ?", (lesson_id,)).fetchone()
        if not lesson:
            conn.close()
            return self.send_json(404, {"error": "Lekce nenalezena"})

        bookings = conn.execute(
            "SELECT slot, name, email, phone FROM bookings WHERE lesson_id = ? ORDER BY slot",
            (lesson_id,),
        ).fetchall()
        conn.close()
        if self.is_admin():
            payload = [dict(b) for b in bookings]
        else:
            payload = [{"slot": b["slot"]} for b in bookings]
        return self.send_json(200, {"lesson": dict(lesson), "bookings": payload})

    def create_booking(self, lesson_id):
        conn = db_conn()
        lesson = conn.execute("SELECT * FROM lessons WHERE id = ?", (lesson_id,)).fetchone()
        if not lesson:
            conn.close()
            return self.send_json(404, {"error": "Lekce nenalezena"})

        if not lesson_is_bookable(lesson):
            conn.close()
            return self.send_json(400, {"error": "Na tuto lekci už nelze rezervovat"})

        data = self.read_json()
        slot = data.get("slot")
        ip = self.client_ip()
        is_admin = self.is_admin()

        try:
            name = validate_booking_name(data.get("name"))
            email = validate_email(data.get("email"))
            phone = normalize_phone(data.get("phone"))
            if not is_admin:
                self.check_booking_spam(data)
                validate_gdpr_consent(data)
        except ValueError as exc:
            conn.close()
            return self.send_json(400, {"error": str(exc)})

        try:
            slot = int(slot)
        except (TypeError, ValueError):
            conn.close()
            return self.send_json(400, {"error": "Neplatné číslo místa"})

        if slot < 1:
            conn.close()
            return self.send_json(400, {"error": "Neplatné číslo místa"})

        max_slots = lesson["max_slots"] or 20
        if slot > max_slots:
            conn.close()
            return self.send_json(400, {"error": f"Neplatné číslo místa (1–{max_slots})"})

        if not is_admin:
            try:
                self.check_booking_limits(conn, ip, lesson_id)
            except ValueError as exc:
                conn.close()
                return self.send_json(429, {"error": str(exc)})

        existing = conn.execute(
            "SELECT slot FROM bookings WHERE lesson_id = ? AND slot = ?",
            (lesson_id, slot),
        ).fetchone()
        if existing:
            conn.close()
            return self.send_json(409, {"error": "Toto místo je už obsazené"})

        consent_at = None if is_admin else conn.execute("SELECT datetime('now')").fetchone()[0]
        conn.execute(
            """
            INSERT INTO bookings (lesson_id, slot, name, email, phone, client_ip, gdpr_consent_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (lesson_id, slot, name, email, phone, ip, consent_at),
        )
        upsert_contact(conn, name, email, phone, consent_at)
        conn.commit()
        conn.close()
        return self.send_json(200, {"ok": True, "slot": slot, "name": name})

    def cancel_booking(self, lesson_id):
        conn = db_conn()
        lesson = conn.execute("SELECT id FROM lessons WHERE id = ?", (lesson_id,)).fetchone()
        if not lesson:
            conn.close()
            return self.send_json(404, {"error": "Lekce nenalezena"})

        data = self.read_json()
        try:
            self.check_booking_spam(data)
            email = validate_email(data.get("email"))
            phone = normalize_phone(data.get("phone"))
            slot = int(data.get("slot"))
        except ValueError as exc:
            conn.close()
            return self.send_json(400, {"error": str(exc)})

        if slot < 1:
            conn.close()
            return self.send_json(400, {"error": "Neplatné číslo místa"})

        booking = conn.execute(
            """
            SELECT id FROM bookings
            WHERE lesson_id = ? AND slot = ? AND email = ? AND phone = ?
            """,
            (lesson_id, slot, email, phone),
        ).fetchone()
        if not booking:
            conn.close()
            return self.send_json(
                404,
                {"error": "Rezervaci se nepodařilo najít. Zkontrolujte číslo místa, e-mail a telefon."},
            )

        conn.execute("DELETE FROM bookings WHERE id = ?", (booking["id"],))
        conn.commit()
        conn.close()
        return self.send_json(200, {"ok": True})

    def get_contacts(self):
        if not self.is_admin():
            return self.send_json(401, {"error": "Neplatný admin PIN"})

        conn = db_conn()
        rows = conn.execute(
            """
            SELECT name, email, phone, first_seen_at, updated_at
            FROM contacts
            ORDER BY updated_at DESC, name COLLATE NOCASE
            """
        ).fetchall()
        conn.close()
        return self.send_json(200, [dict(r) for r in rows])

    def export_contacts(self):
        if not self.is_admin():
            return self.send_json(401, {"error": "Neplatný admin PIN"})

        conn = db_conn()
        rows = conn.execute(
            """
            SELECT name, email, phone, first_seen_at, updated_at
            FROM contacts
            ORDER BY name COLLATE NOCASE
            """
        ).fetchall()
        conn.close()
        return self.send_csv("kontakty-enjoy-team.csv", rows)

    def delete_booking(self, lesson_id, slot):
        if not self.is_admin():
            return self.send_json(401, {"error": "Neplatný admin PIN"})

        conn = db_conn()
        conn.execute(
            "DELETE FROM bookings WHERE lesson_id = ? AND slot = ?",
            (lesson_id, slot),
        )
        conn.commit()
        conn.close()
        return self.send_json(200, {"ok": True})


def main():
    init_db()
    server = HTTPServer(("", PORT), Handler)
    print(f"Enjoy team běží na http://localhost:{PORT}")
    print(f"Rezervace Frýdlant: http://localhost:{PORT}/rezervace/frydlant.html")
    print(f"Rezervace Krmelín:   http://localhost:{PORT}/rezervace/krmelin.html")
    print(f"Admin PIN: {ADMIN_PIN}")
    print(f"Limit rezervací: max {MAX_BOOKINGS_PER_LESSON} místa na jednu lekci (ze stejné sítě)")
    server.serve_forever()


if __name__ == "__main__":
    main()
