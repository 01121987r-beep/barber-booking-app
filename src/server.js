import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, initializeDatabase, getAvailableStartSlots, getSpecialistAvailabilityForDate, toTime, toMinutes, getSpecialistSlotInterval, getBlockedSlotsForWeekday, createBookingToken } from './db.js';
import { generateToken, verifyPassword } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, '..', 'public');
const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

initializeDatabase();

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});
app.use(express.static(publicDir));

app.get('/healthz', (req, res) => {
  res.status(200).json({ ok: true });
});

function respondError(res, status, message) {
  return res.status(status).json({ error: message });
}

function weekdaysMap() {
  return ['Domenica', 'Lunedi', 'Martedi', 'Mercoledi', 'Giovedi', 'Venerdi', 'Sabato'];
}

function getSettings() {
  return db.prepare('SELECT * FROM shop_settings WHERE id = 1').get();
}

function getTodayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatDisplayDate(dateString) {
  const [year, month, day] = `${dateString}`.split('-');
  if (!year || !month || !day) return dateString;
  return `${day}/${month}/${year}`;
}

function buildWhatsAppConfirmationMessage({ customerName, bookingDate, bookingTime, serviceName, specialistName }) {
  return [
    `Ciao ${customerName}!`,
    `Confermiamo la tua prenotazione per il giorno ${formatDisplayDate(bookingDate)} alle ${bookingTime} per ${serviceName} con ${specialistName}.`,
    `Ti ricordiamo che puoi modificare la prenotazione accedendo all'area riservata.`
  ].join('\n');
}

async function sendWhatsAppConfirmation(payload) {
  const webhookUrl = process.env.WHATSAPP_WEBHOOK_URL;
  if (!webhookUrl) return { sent: false, mode: 'disabled' };

  const message = buildWhatsAppConfirmationMessage(payload);

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: payload.customerPhone,
        name: payload.customerName,
        message,
        booking: {
          service: payload.serviceName,
          specialist: payload.specialistName,
          date: payload.bookingDate,
          time: payload.bookingTime
        }
      })
    });

    if (!response.ok) {
      return { sent: false, mode: 'webhook', error: `Webhook responded with ${response.status}` };
    }

    return { sent: true, mode: 'webhook' };
  } catch (error) {
    return { sent: false, mode: 'webhook', error: error.message };
  }
}

function filterPastSlots(date, slots) {
  if (date !== getTodayIso()) return slots;
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  return slots.filter((slot) => toMinutes(slot) > currentMinutes);
}

function getAuthToken(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}

function requireAdmin(req, res, next) {
  const token = getAuthToken(req);
  if (!token) return respondError(res, 401, 'Unauthorized');
  const session = db.prepare(`
    SELECT admin_sessions.*, admin_users.username, admin_users.display_name
    FROM admin_sessions
    JOIN admin_users ON admin_users.id = admin_sessions.admin_id
    WHERE token = ?
  `).get(token);
  if (!session) return respondError(res, 401, 'Unauthorized');
  if (new Date(session.expires_at) < new Date()) {
    db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(token);
    return respondError(res, 401, 'Session expired');
  }
  req.admin = session;
  next();
}

function withSpecialistAvailability(specialist) {
  const weekdayMap = weekdaysMap();
  const rows = db.prepare(`
    SELECT weekday, start_time, end_time FROM weekly_availability
    WHERE specialist_id = ?
    ORDER BY weekday, start_time
  `).all(specialist.id);
  const grouped = rows.reduce((acc, row) => {
    const label = weekdayMap[row.weekday];
    acc[label] ||= [];
    acc[label].push(`${row.start_time} - ${row.end_time}`);
    return acc;
  }, {});
  const blockedSlots = weekdayMap.reduce((acc, label, weekday) => {
    if (weekday === 0) return acc;
    acc[label] = getBlockedSlotsForWeekday(specialist.id, weekday);
    return acc;
  }, {});
  return { ...specialist, availability: grouped, blocked_slots: blockedSlots };
}

function getActiveBookingByToken(token) {
  return db.prepare(`
    SELECT bookings.*, services.name AS service_name, services.duration_minutes, specialists.name AS specialist_name
    FROM bookings
    JOIN services ON services.id = bookings.service_id
    JOIN specialists ON specialists.id = bookings.specialist_id
    WHERE bookings.booking_token = ?
      AND bookings.status = 'confirmed'
      AND datetime(bookings.booking_date || ' ' || bookings.booking_time, '+60 minutes') >= datetime('now')
  `).get(token);
}

app.get('/api/meta', (req, res) => {
  res.json({ settings: getSettings() });
});

app.get('/api/services', (req, res) => {
  const items = db.prepare('SELECT * FROM services ORDER BY sort_order, id').all();
  res.json(items);
});

app.get('/api/specialists', (req, res) => {
  const items = db.prepare('SELECT * FROM specialists WHERE active = 1 ORDER BY name').all();
  res.json(items.map(withSpecialistAvailability));
});

app.get('/api/availability', (req, res) => {
  const specialistId = Number(req.query.specialistId);
  const serviceId = Number(req.query.serviceId);
  const date = req.query.date;
  if (!specialistId || !serviceId || !date) return respondError(res, 400, 'specialistId, serviceId and date are required');

  const service = db.prepare('SELECT * FROM services WHERE id = ?').get(serviceId);
  if (!service) return respondError(res, 404, 'Service not found');

  const slots = filterPastSlots(date, getAvailableStartSlots(specialistId, date, service.duration_minutes));
  res.json({
    slots,
    baseSlots: getSpecialistAvailabilityForDate(specialistId, date),
    duration: service.duration_minutes,
    interval: getSpecialistSlotInterval(specialistId)
  });
});

app.get('/api/customer/bookings', (req, res) => {
  const phone = `${req.query.phone || ''}`.trim();
  const name = `${req.query.name || ''}`.trim();
  if (!phone || !name) return respondError(res, 400, 'Nome e numero di telefono richiesti');

  const rows = db.prepare(`
    SELECT bookings.*, services.name AS service_name, services.duration_minutes, specialists.name AS specialist_name
    FROM bookings
    JOIN services ON services.id = bookings.service_id
    JOIN specialists ON specialists.id = bookings.specialist_id
    WHERE customer_phone = ?
      AND lower(trim(customer_name)) = lower(trim(?))
      AND bookings.status = 'confirmed'
      AND datetime(bookings.booking_date || ' ' || bookings.booking_time, '+60 minutes') >= datetime('now')
    ORDER BY booking_date, booking_time
  `).all(phone, name);

  res.json({ bookings: rows });
});

app.get('/api/customer/booking/:token', (req, res) => {
  const token = `${req.params.token || ''}`.trim();
  if (!token) return respondError(res, 400, 'Token richiesto');
  const booking = getActiveBookingByToken(token);
  if (!booking) return respondError(res, 404, 'Prenotazione non trovata');
  res.json({ booking });
});

app.patch('/api/customer/bookings/:id/cancel', (req, res) => {
  const id = Number(req.params.id);
  const phone = `${req.body.phone || ''}`.trim();
  const name = `${req.body.name || ''}`.trim();
  if (!id || !phone || !name) return respondError(res, 400, 'Dati mancanti');

  const booking = db.prepare(`
    SELECT * FROM bookings
    WHERE id = ? AND customer_phone = ? AND lower(trim(customer_name)) = lower(trim(?))
  `).get(id, phone, name);
  if (!booking) return respondError(res, 404, 'Prenotazione non trovata');
  db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run('cancelled', id);
  res.json({ ok: true });
});

app.patch('/api/customer/booking/:token/cancel', (req, res) => {
  const token = `${req.params.token || ''}`.trim();
  if (!token) return respondError(res, 400, 'Token richiesto');
  const booking = getActiveBookingByToken(token);
  if (!booking) return respondError(res, 404, 'Prenotazione non trovata');
  db.prepare('UPDATE bookings SET status = ? WHERE booking_token = ?').run('cancelled', token);
  res.json({ ok: true });
});

app.get('/api/customer/bookings/:id/availability', (req, res) => {
  const id = Number(req.params.id);
  const phone = `${req.query.phone || ''}`.trim();
  const name = `${req.query.name || ''}`.trim();
  const date = `${req.query.date || ''}`.trim();
  if (!id || !phone || !name || !date) return respondError(res, 400, 'Dati mancanti');

  const booking = db.prepare(`
    SELECT bookings.*, services.duration_minutes
    FROM bookings
    JOIN services ON services.id = bookings.service_id
    WHERE bookings.id = ? AND bookings.customer_phone = ? AND lower(trim(bookings.customer_name)) = lower(trim(?))
  `).get(id, phone, name);
  if (!booking) return respondError(res, 404, 'Prenotazione non trovata');

  const slots = filterPastSlots(
    date,
    getAvailableStartSlots(booking.specialist_id, date, booking.duration_minutes, booking.id)
  );

  res.json({ slots });
});

app.get('/api/customer/booking/:token/availability', (req, res) => {
  const token = `${req.params.token || ''}`.trim();
  const date = `${req.query.date || ''}`.trim();
  if (!token || !date) return respondError(res, 400, 'Dati mancanti');

  const booking = db.prepare(`
    SELECT bookings.*, services.duration_minutes
    FROM bookings
    JOIN services ON services.id = bookings.service_id
    WHERE bookings.booking_token = ?
      AND bookings.status = 'confirmed'
  `).get(token);
  if (!booking) return respondError(res, 404, 'Prenotazione non trovata');

  const slots = filterPastSlots(
    date,
    getAvailableStartSlots(booking.specialist_id, date, booking.duration_minutes, booking.id)
  );

  res.json({ slots });
});

app.patch('/api/customer/bookings/:id/reschedule', (req, res) => {
  const id = Number(req.params.id);
  const phone = `${req.body.phone || ''}`.trim();
  const name = `${req.body.name || ''}`.trim();
  const bookingDate = `${req.body.bookingDate || ''}`.trim();
  const bookingTime = `${req.body.bookingTime || ''}`.trim();
  if (!id || !phone || !name || !bookingDate || !bookingTime) return respondError(res, 400, 'Dati mancanti');

  const booking = db.prepare(`
    SELECT bookings.*, services.duration_minutes
    FROM bookings
    JOIN services ON services.id = bookings.service_id
    WHERE bookings.id = ? AND bookings.customer_phone = ? AND lower(trim(bookings.customer_name)) = lower(trim(?))
  `).get(id, phone, name);
  if (!booking) return respondError(res, 404, 'Prenotazione non trovata');

  const allowedSlots = filterPastSlots(
    bookingDate,
    getAvailableStartSlots(booking.specialist_id, bookingDate, booking.duration_minutes, booking.id)
  );
  if (!allowedSlots.includes(bookingTime)) {
    return respondError(res, 409, 'Lo slot selezionato non è disponibile');
  }

  const endTime = toTime(toMinutes(bookingTime) + booking.duration_minutes);
  db.prepare(`
    UPDATE bookings
    SET booking_date = ?, booking_time = ?, end_time = ?, status = 'confirmed'
    WHERE id = ?
  `).run(bookingDate, bookingTime, endTime, id);

  res.json({ ok: true, bookingDate, bookingTime, endTime });
});

app.patch('/api/customer/booking/:token/reschedule', (req, res) => {
  const token = `${req.params.token || ''}`.trim();
  const bookingDate = `${req.body.bookingDate || ''}`.trim();
  const bookingTime = `${req.body.bookingTime || ''}`.trim();
  if (!token || !bookingDate || !bookingTime) return respondError(res, 400, 'Dati mancanti');

  const booking = db.prepare(`
    SELECT bookings.*, services.duration_minutes
    FROM bookings
    JOIN services ON services.id = bookings.service_id
    WHERE bookings.booking_token = ?
      AND bookings.status = 'confirmed'
  `).get(token);
  if (!booking) return respondError(res, 404, 'Prenotazione non trovata');

  const allowedSlots = filterPastSlots(
    bookingDate,
    getAvailableStartSlots(booking.specialist_id, bookingDate, booking.duration_minutes, booking.id)
  );
  if (!allowedSlots.includes(bookingTime)) {
    return respondError(res, 409, 'Lo slot selezionato non è disponibile');
  }

  const endTime = toTime(toMinutes(bookingTime) + booking.duration_minutes);
  db.prepare(`
    UPDATE bookings
    SET booking_date = ?, booking_time = ?, end_time = ?, status = 'confirmed'
    WHERE booking_token = ?
  `).run(bookingDate, bookingTime, endTime, token);

  res.json({ ok: true, bookingDate, bookingTime, endTime });
});

app.post('/api/bookings', async (req, res) => {
  const { serviceId, specialistId, bookingDate, bookingTime, customerName, customerPhone, customerEmail, notes } = req.body;
  if (!serviceId || !specialistId || !bookingDate || !bookingTime || !customerName || !customerPhone) {
    return respondError(res, 400, 'Missing required booking fields');
  }

  const service = db.prepare('SELECT * FROM services WHERE id = ?').get(serviceId);
  const specialist = db.prepare('SELECT * FROM specialists WHERE id = ?').get(specialistId);
  if (!service || !specialist) return respondError(res, 404, 'Service or specialist not found');

  const available = getAvailableStartSlots(Number(specialistId), bookingDate, service.duration_minutes);
  if (!available.includes(bookingTime)) {
    return respondError(res, 409, 'Selected slot is no longer available');
  }

  const endTime = toTime(toMinutes(bookingTime) + service.duration_minutes);
  const bookingToken = createBookingToken();
  const result = db.prepare(`
    INSERT INTO bookings (booking_token, service_id, specialist_id, booking_date, booking_time, end_time, customer_name, customer_phone, customer_email, notes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')
  `).run(bookingToken, serviceId, specialistId, bookingDate, bookingTime, endTime, customerName, customerPhone, customerEmail || '', notes || '');

  const whatsapp = await sendWhatsAppConfirmation({
    customerName,
    customerPhone,
    bookingDate,
    bookingTime,
    serviceName: service.name,
    specialistName: specialist.name
  });

  res.status(201).json({
    id: result.lastInsertRowid,
    message: 'Prenotazione confermata',
    booking: {
      bookingToken,
      service: service.name,
      specialist: specialist.name,
      bookingDate,
      bookingTime,
      endTime,
      customerName
    },
    whatsapp
  });
});

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return respondError(res, 400, 'Username and password are required');

  const admin = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
  if (!admin || !verifyPassword(password, admin.password_hash)) {
    return respondError(res, 401, 'Credenziali non valide');
  }

  const token = generateToken();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString();
  db.prepare('INSERT INTO admin_sessions (token, admin_id, expires_at) VALUES (?, ?, ?)').run(token, admin.id, expiresAt);

  res.json({ token, admin: { username: admin.username, displayName: admin.display_name } });
});

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(getAuthToken(req));
  res.json({ ok: true });
});

app.get('/api/admin/dashboard', requireAdmin, (req, res) => {
  const upcoming = db.prepare(`
    SELECT bookings.*, services.name AS service_name, specialists.name AS specialist_name
    FROM bookings
    JOIN services ON services.id = bookings.service_id
    JOIN specialists ON specialists.id = bookings.specialist_id
    WHERE booking_date >= date('now')
    ORDER BY booking_date, booking_time
  `).all();

  res.json({
    settings: getSettings(),
    services: db.prepare('SELECT * FROM services ORDER BY sort_order, id').all(),
    specialists: db.prepare('SELECT * FROM specialists ORDER BY name').all().map(withSpecialistAvailability),
    bookings: upcoming,
    exceptions: db.prepare('SELECT * FROM availability_exceptions ORDER BY date').all()
  });
});

app.get('/api/admin/bookings', requireAdmin, (req, res) => {
  const specialistId = Number(req.query.specialistId || 0);
  const date = req.query.date;

  const clauses = ["datetime(bookings.booking_date || ' ' || bookings.end_time) >= datetime('now')"];
  const params = [];

  if (specialistId) {
    clauses.push('bookings.specialist_id = ?');
    params.push(specialistId);
  }
  if (date) {
    clauses.push('bookings.booking_date = ?');
    params.push(date);
  }
  clauses.push("bookings.status IN ('confirmed', 'cancelled')");

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT bookings.*, services.name AS service_name, specialists.name AS specialist_name
    FROM bookings
    JOIN services ON services.id = bookings.service_id
    JOIN specialists ON specialists.id = bookings.specialist_id
    ${where}
    ORDER BY booking_date DESC, booking_time DESC
  `).all(...params);
  res.json(rows);
});

app.get('/api/admin/availability/:specialistId', requireAdmin, (req, res) => {
  const specialistId = Number(req.params.specialistId);
  if (!specialistId) return respondError(res, 400, 'Specialist not found');

  const specialist = db.prepare('SELECT * FROM specialists WHERE id = ?').get(specialistId);
  if (!specialist) return respondError(res, 404, 'Specialist not found');

  const weeklyRows = db.prepare(`
    SELECT weekday, start_time, end_time
    FROM weekly_availability
    WHERE specialist_id = ?
    ORDER BY weekday, start_time
  `).all(specialistId);

  const weekly = weekdaysMap().reduce((acc, label) => {
    acc[label] = { enabled: false, ranges: [] };
    return acc;
  }, {});

  weeklyRows.forEach((row) => {
    const label = weekdaysMap()[row.weekday];
    if (!label) return;
    weekly[label].enabled = true;
    weekly[label].ranges.push({ start: row.start_time, end: row.end_time });
  });

  const exceptions = db.prepare(`
    SELECT date, start_time, end_time, is_closed, note
    FROM availability_exceptions
    WHERE specialist_id = ?
    ORDER BY date
  `).all(specialistId).map((item) => ({
    date: item.date,
    start: item.start_time || '',
    end: item.end_time || '',
    closed: Boolean(item.is_closed),
    note: item.note || ''
  }));

  const blocked_slots = weekdaysMap().reduce((acc, label, weekday) => {
    if (weekday === 0) return acc;
    acc[label] = getBlockedSlotsForWeekday(specialistId, weekday);
    return acc;
  }, {});

  res.json({
    availability: weekly,
    exceptions,
    blocked_slots,
    slot_interval_minutes: specialist.slot_interval_minutes || 30
  });
});

app.patch('/api/admin/bookings/:id/status', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body;
  if (!['confirmed', 'cancelled'].includes(status)) return respondError(res, 400, 'Invalid status');
  db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, id);
  res.json({ ok: true });
});

app.delete('/api/admin/bookings/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return respondError(res, 400, 'Booking not found');
  db.prepare('DELETE FROM bookings WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.post('/api/admin/services', requireAdmin, (req, res) => {
  const { name, price, duration_minutes, description, featured = 1 } = req.body;
  if (!name || !price || !duration_minutes || !description) return respondError(res, 400, 'Missing service fields');
  const sortOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM services').get().next;
  const result = db.prepare(`
    INSERT INTO services (name, price, duration_minutes, description, featured, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, price, duration_minutes, description, featured ? 1 : 0, sortOrder);
  res.status(201).json(db.prepare('SELECT * FROM services WHERE id = ?').get(result.lastInsertRowid));
});

app.put('/api/admin/services/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { name, price, duration_minutes, description, featured = 1 } = req.body;
  db.prepare(`
    UPDATE services SET name = ?, price = ?, duration_minutes = ?, description = ?, featured = ?
    WHERE id = ?
  `).run(name, price, duration_minutes, description, featured ? 1 : 0, id);
  res.json(db.prepare('SELECT * FROM services WHERE id = ?').get(id));
});

app.delete('/api/admin/services/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM services WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.post('/api/admin/specialists', requireAdmin, (req, res) => {
  const { name, role, specialization, avatar, bio, active = 1 } = req.body;
  if (!name || !role || !specialization || !avatar || !bio) return respondError(res, 400, 'Missing specialist fields');
  const result = db.prepare(`
    INSERT INTO specialists (name, role, specialization, avatar, bio, active)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, role, specialization, avatar, bio, active ? 1 : 0);
  res.status(201).json(db.prepare('SELECT * FROM specialists WHERE id = ?').get(result.lastInsertRowid));
});

app.put('/api/admin/specialists/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { name, role, specialization, avatar, bio, active = 1 } = req.body;
  db.prepare(`
    UPDATE specialists SET name = ?, role = ?, specialization = ?, avatar = ?, bio = ?, active = ?
    WHERE id = ?
  `).run(name, role, specialization, avatar, bio, active ? 1 : 0, id);
  res.json(db.prepare('SELECT * FROM specialists WHERE id = ?').get(id));
});

app.delete('/api/admin/specialists/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM specialists WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.put('/api/admin/availability/:specialistId', requireAdmin, (req, res) => {
  const specialistId = Number(req.params.specialistId);
  const { weekly = [], exceptions = [], blocked_slots = [], slot_interval_minutes = 30 } = req.body;
  const transaction = db.transaction(() => {
    db.prepare('UPDATE specialists SET slot_interval_minutes = ? WHERE id = ?').run(slot_interval_minutes, specialistId);
    db.prepare('DELETE FROM weekly_availability WHERE specialist_id = ?').run(specialistId);
    db.prepare('DELETE FROM availability_exceptions WHERE specialist_id = ?').run(specialistId);
    db.prepare('DELETE FROM weekly_slot_blocks WHERE specialist_id = ?').run(specialistId);

    const weeklyStmt = db.prepare(`
      INSERT INTO weekly_availability (specialist_id, weekday, start_time, end_time)
      VALUES (?, ?, ?, ?)
    `);
    weekly.forEach((item) => weeklyStmt.run(specialistId, item.weekday, item.start_time, item.end_time));

    const exceptionStmt = db.prepare(`
      INSERT INTO availability_exceptions (specialist_id, date, start_time, end_time, is_closed, note)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    exceptions.forEach((item) => exceptionStmt.run(specialistId, item.date, item.start_time || null, item.end_time || null, item.is_closed ? 1 : 0, item.note || ''));

    const blockStmt = db.prepare(`
      INSERT INTO weekly_slot_blocks (specialist_id, weekday, slot_time)
      VALUES (?, ?, ?)
    `);
    blocked_slots.forEach((item) => blockStmt.run(specialistId, item.weekday, item.slot_time));
  });
  transaction();
  res.json({ ok: true });
});

app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const { shop_name, phone, email, address, opening_time, closing_time, break_start, break_end } = req.body;
  db.prepare(`
    UPDATE shop_settings
    SET shop_name = ?, phone = ?, email = ?, address = ?, opening_time = ?, closing_time = ?, break_start = ?, break_end = ?
    WHERE id = 1
  `).run(shop_name, phone, email, address, opening_time, closing_time, break_start || null, break_end || null);
  res.json(getSettings());
});

app.get('*', (req, res) => {
  if (req.path === '/admin/services') {
    return res.sendFile(path.join(publicDir, 'admin-services.html'));
  }
  if (req.path === '/admin/specialists') {
    return res.sendFile(path.join(publicDir, 'admin-specialists.html'));
  }
  if (req.path.startsWith('/admin')) {
    return res.sendFile(path.join(publicDir, 'admin.html'));
  }
  return res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Barber booking app running on http://${HOST}:${PORT}`);
  console.log('Admin login: admin / barber123');
});
