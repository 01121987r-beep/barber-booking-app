import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { hashPassword } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultDbPath = path.join(__dirname, '..', 'barber-shop.sqlite');
const dataDir = process.env.DATA_DIR || '';
const dbPath = process.env.DB_PATH || (dataDir ? path.join(dataDir, 'barber-shop.sqlite') : defaultDbPath);

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      token TEXT PRIMARY KEY,
      admin_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      duration_minutes INTEGER NOT NULL,
      description TEXT NOT NULL,
      featured INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS specialists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      specialization TEXT NOT NULL,
      avatar TEXT NOT NULL,
      bio TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      slot_interval_minutes INTEGER DEFAULT 30
    );

    CREATE TABLE IF NOT EXISTS weekly_availability (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      specialist_id INTEGER NOT NULL,
      weekday INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      FOREIGN KEY (specialist_id) REFERENCES specialists(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS availability_exceptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      specialist_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      start_time TEXT,
      end_time TEXT,
      is_closed INTEGER DEFAULT 0,
      note TEXT,
      FOREIGN KEY (specialist_id) REFERENCES specialists(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS weekly_slot_blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      specialist_id INTEGER NOT NULL,
      weekday INTEGER NOT NULL,
      slot_time TEXT NOT NULL,
      FOREIGN KEY (specialist_id) REFERENCES specialists(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_token TEXT UNIQUE,
      service_id INTEGER NOT NULL,
      specialist_id INTEGER NOT NULL,
      booking_date TEXT NOT NULL,
      booking_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      customer_email TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'confirmed',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (service_id) REFERENCES services(id),
      FOREIGN KEY (specialist_id) REFERENCES specialists(id)
    );

    CREATE TABLE IF NOT EXISTS shop_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      shop_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      address TEXT NOT NULL,
      opening_time TEXT NOT NULL,
      closing_time TEXT NOT NULL,
      break_start TEXT,
      break_end TEXT
    );
  `);

  seedAdmin();
  migrateSpecialistsSchema();
  migrateBookingsSchema();
  seedSettings();
  seedServices();
  seedSpecialists();
  seedAvailability();
  seedBookings();
}

function seedAdmin() {
  const count = db.prepare('SELECT COUNT(*) AS count FROM admin_users').get().count;
  if (count > 0) return;

  db.prepare(
    'INSERT INTO admin_users (username, password_hash, display_name) VALUES (?, ?, ?)'
  ).run('admin', hashPassword('barber123'), 'Owner Barber Club');
}

function seedSettings() {
  const row = db.prepare('SELECT id FROM shop_settings WHERE id = 1').get();
  if (row) return;

  db.prepare(`
    INSERT INTO shop_settings (id, shop_name, phone, email, address, opening_time, closing_time, break_start, break_end)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'Atelier Barber Club',
    '+39 045 1234567',
    'booking@atelierbarberclub.it',
    'Via del Rasoio 18, Verona',
    '09:00',
    '19:30',
    '13:00',
    '14:30'
  );
}

function seedServices() {
  const count = db.prepare('SELECT COUNT(*) AS count FROM services').get().count;
  if (count > 0) return;

  const services = [
    ['Taglio', 28, 30, 'Taglio sartoriale con consulenza rapida e finishing curato.', 1, 1],
    ['Taglio + Shampoo', 35, 45, 'Servizio completo con lavaggio rilassante e styling finale.', 1, 2],
    ['Taglio Bambino', 24, 30, 'Taglio dedicato ai più piccoli, rapido e preciso.', 1, 3],
    ['Rasatura barba', 22, 30, 'Rituale barba con panni caldi, rasatura e definizione finale.', 1, 4],
    ['Taglio + Barba', 48, 60, 'Pacchetto completo per immagine curata e tempi ottimizzati.', 1, 5],
    ['Trattamento premium', 62, 90, 'Esperienza premium con consulenza, trattamento cute e grooming avanzato.', 1, 6]
  ];

  const stmt = db.prepare(`
    INSERT INTO services (name, price, duration_minutes, description, featured, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertMany = db.transaction((items) => items.forEach((item) => stmt.run(...item)));
  insertMany(services);
}

function seedSpecialists() {
  const count = db.prepare('SELECT COUNT(*) AS count FROM specialists').get().count;
  if (count > 0) return;

  const specialists = [
    ['Marco Bianchi', 'Senior Barber', 'Skin fade e tagli classici contemporanei', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=900&q=80', 'Esperto in sfumature pulite, linee precise e consulenza d immagine.', 1, 30],
    ['Luca Ferretti', 'Beard Specialist', 'Barba, rasature e grooming premium', 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=900&q=80', 'Specialista nei rituali barba e nei servizi premium con panni caldi.', 1, 30],
    ['Andrea Rizzo', 'Style Barber', 'Tagli texture, crop e look moderni', 'https://images.unsplash.com/photo-1504593811423-6dd665756598?auto=format&fit=crop&w=900&q=80', 'Segue look contemporanei, texture naturali e styling su misura.', 1, 45]
  ];

  const stmt = db.prepare(`
    INSERT INTO specialists (name, role, specialization, avatar, bio, active, slot_interval_minutes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMany = db.transaction((items) => items.forEach((item) => stmt.run(...item)));
  insertMany(specialists);
}

function seedAvailability() {
  const count = db.prepare('SELECT COUNT(*) AS count FROM weekly_availability').get().count;
  if (count > 0) return;

  const specialists = db.prepare('SELECT id, name FROM specialists').all();
  const schedule = [];

  for (const specialist of specialists) {
    if (specialist.name === 'Marco Bianchi') {
      schedule.push([specialist.id, 1, '09:00', '13:00']);
      schedule.push([specialist.id, 1, '14:30', '19:00']);
      schedule.push([specialist.id, 3, '09:00', '13:00']);
      schedule.push([specialist.id, 3, '14:30', '19:00']);
      schedule.push([specialist.id, 5, '10:00', '19:30']);
    }
    if (specialist.name === 'Luca Ferretti') {
      schedule.push([specialist.id, 2, '10:00', '13:00']);
      schedule.push([specialist.id, 2, '14:30', '19:30']);
      schedule.push([specialist.id, 4, '10:00', '13:00']);
      schedule.push([specialist.id, 4, '14:30', '19:30']);
      schedule.push([specialist.id, 6, '09:30', '17:30']);
    }
    if (specialist.name === 'Andrea Rizzo') {
      schedule.push([specialist.id, 1, '11:00', '19:30']);
      schedule.push([specialist.id, 2, '09:00', '13:00']);
      schedule.push([specialist.id, 2, '14:30', '19:00']);
      schedule.push([specialist.id, 4, '09:00', '13:00']);
      schedule.push([specialist.id, 4, '14:30', '19:00']);
      schedule.push([specialist.id, 6, '09:00', '14:00']);
    }
  }

  const stmt = db.prepare(`
    INSERT INTO weekly_availability (specialist_id, weekday, start_time, end_time)
    VALUES (?, ?, ?, ?)
  `);
  const insertMany = db.transaction((items) => items.forEach((item) => stmt.run(...item)));
  insertMany(schedule);

  const exceptionStmt = db.prepare(`
    INSERT INTO availability_exceptions (specialist_id, date, start_time, end_time, is_closed, note)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const today = new Date();
  const nextMonthDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7).toISOString().slice(0, 10);
  const marco = specialists.find((s) => s.name === 'Marco Bianchi');
  if (marco) {
    exceptionStmt.run(marco.id, nextMonthDay, null, null, 1, 'Indisponibile per formazione');
  }
}

function migrateSpecialistsSchema() {
  const columns = db.prepare(`PRAGMA table_info(specialists)`).all();
  const hasSlotInterval = columns.some((column) => column.name === 'slot_interval_minutes');
  if (!hasSlotInterval) {
    db.exec(`ALTER TABLE specialists ADD COLUMN slot_interval_minutes INTEGER DEFAULT 30`);
  }
}

function generateBookingToken() {
  return randomBytes(16).toString('hex');
}

function migrateBookingsSchema() {
  const columns = db.prepare(`PRAGMA table_info(bookings)`).all();
  const hasBookingToken = columns.some((column) => column.name === 'booking_token');
  if (!hasBookingToken) {
    db.exec(`ALTER TABLE bookings ADD COLUMN booking_token TEXT`);
  }

  const rows = db.prepare("SELECT id FROM bookings WHERE booking_token IS NULL OR booking_token = ''").all();
  const updateStmt = db.prepare('UPDATE bookings SET booking_token = ? WHERE id = ?');
  rows.forEach((row) => {
    let token = generateBookingToken();
    while (db.prepare('SELECT id FROM bookings WHERE booking_token = ?').get(token)) {
      token = generateBookingToken();
    }
    updateStmt.run(token, row.id);
  });
}

export function createBookingToken() {
  let token = generateBookingToken();
  while (db.prepare('SELECT id FROM bookings WHERE booking_token = ?').get(token)) {
    token = generateBookingToken();
  }
  return token;
}

function seedBookings() {
  const count = db.prepare('SELECT COUNT(*) AS count FROM bookings').get().count;
  if (count > 0) return;

  const service = db.prepare('SELECT * FROM services WHERE name = ?').get('Taglio + Barba');
  const specialist = db.prepare('SELECT * FROM specialists WHERE name = ?').get('Marco Bianchi');
  if (!service || !specialist) return;

  const target = nextWeekday(new Date(), 5);
  const bookingDate = target.toISOString().slice(0, 10);
  db.prepare(`
    INSERT INTO bookings (booking_token, service_id, specialist_id, booking_date, booking_time, end_time, customer_name, customer_phone, customer_email, notes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(createBookingToken(), service.id, specialist.id, bookingDate, '10:00', '11:00', 'Cliente Demo', '+39 333 1234567', 'demo@example.com', 'Prenotazione seed', 'confirmed');
}

function nextWeekday(fromDate, targetWeekday) {
  const date = new Date(fromDate);
  date.setDate(date.getDate() + ((targetWeekday + 7 - date.getDay()) % 7 || 7));
  return date;
}

export function getSpecialistSlotInterval(specialistId) {
  const specialist = db.prepare('SELECT slot_interval_minutes FROM specialists WHERE id = ?').get(specialistId);
  return specialist?.slot_interval_minutes || 30;
}

export function getBlockedSlotsForWeekday(specialistId, weekday) {
  return db.prepare(`
    SELECT slot_time
    FROM weekly_slot_blocks
    WHERE specialist_id = ? AND weekday = ?
    ORDER BY slot_time
  `).all(specialistId, weekday).map((row) => row.slot_time);
}

export function toMinutes(timeString) {
  const [hours, minutes] = timeString.split(':').map(Number);
  return hours * 60 + minutes;
}

export function toTime(minutes) {
  const hrs = Math.floor(minutes / 60).toString().padStart(2, '0');
  const mins = (minutes % 60).toString().padStart(2, '0');
  return `${hrs}:${mins}`;
}

export function buildSlotsForRange(startTime, endTime, interval = 30) {
  const slots = [];
  for (let value = toMinutes(startTime); value + interval <= toMinutes(endTime); value += interval) {
    slots.push(toTime(value));
  }
  return slots;
}

export function getAvailabilityWindowsForDate(specialistId, dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  const weekday = date.getDay();
  const weekly = db.prepare(`
    SELECT start_time, end_time FROM weekly_availability
    WHERE specialist_id = ? AND weekday = ?
    ORDER BY start_time
  `).all(specialistId, weekday);

  const exceptions = db.prepare(`
    SELECT start_time, end_time, is_closed, note FROM availability_exceptions
    WHERE specialist_id = ? AND date = ?
  `).all(specialistId, dateString);

  if (exceptions.some((item) => item.is_closed)) {
    return [];
  }

  const windows = exceptions.length
    ? exceptions.filter((item) => item.start_time && item.end_time)
    : weekly;

  return windows;
}

export function getSpecialistAvailabilityForDate(specialistId, dateString) {
  const interval = getSpecialistSlotInterval(specialistId);
  const weekday = new Date(`${dateString}T12:00:00`).getDay();
  const blocked = new Set(getBlockedSlotsForWeekday(specialistId, weekday));
  return getAvailabilityWindowsForDate(specialistId, dateString)
    .flatMap((window) => buildSlotsForRange(window.start_time, window.end_time, interval))
    .filter((slot) => !blocked.has(slot));
}

export function getBusyRanges(specialistId, bookingDate, excludeCancelled = true) {
  const statuses = excludeCancelled ? ['confirmed', 'pending'] : ['confirmed', 'pending', 'cancelled'];
  const placeholders = statuses.map(() => '?').join(',');
  return db.prepare(`
    SELECT booking_time, end_time, id FROM bookings
    WHERE specialist_id = ? AND booking_date = ? AND status IN (${placeholders})
  `).all(specialistId, bookingDate, ...statuses);
}

export function isSlotSequenceFree(specialistId, bookingDate, startTime, durationMinutes, ignoreBookingId = null) {
  const start = toMinutes(startTime);
  const end = start + durationMinutes;
  const busyRanges = getBusyRanges(specialistId, bookingDate).filter((booking) => booking.id !== ignoreBookingId);
  return !busyRanges.some((booking) => {
    const bookingStart = toMinutes(booking.booking_time);
    const bookingEnd = toMinutes(booking.end_time);
    return start < bookingEnd && end > bookingStart;
  });
}

export function getAvailableStartSlots(specialistId, bookingDate, durationMinutes, ignoreBookingId = null) {
  const interval = getSpecialistSlotInterval(specialistId);
  const windows = getAvailabilityWindowsForDate(specialistId, bookingDate);
  const candidates = windows.flatMap((window) => buildSlotsForRange(window.start_time, window.end_time, interval));

  return candidates.filter((slot) => {
    const start = toMinutes(slot);
    const end = start + durationMinutes;
    const fitsWindow = windows.some((window) => start >= toMinutes(window.start_time) && end <= toMinutes(window.end_time));
    return fitsWindow && isSlotSequenceFree(specialistId, bookingDate, slot, durationMinutes, ignoreBookingId);
  });
}
