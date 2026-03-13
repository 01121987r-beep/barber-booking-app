const storageKey = 'barber-admin-token';
const adminState = {
  token: localStorage.getItem(storageKey),
  dashboard: null
};

const dom = {
  loginView: document.querySelector('[data-admin-login-view]'),
  dashboardView: document.querySelector('[data-admin-dashboard]'),
  loginForm: document.querySelector('[data-login-form]'),
  loginStatus: document.querySelector('[data-login-status]'),
  overview: document.querySelector('[data-admin-overview]'),
  refresh: document.querySelector('[data-refresh-dashboard]'),
  logout: document.querySelector('[data-logout]'),
  servicesTable: document.querySelector('[data-services-table]'),
  serviceForm: document.querySelector('[data-service-form]'),
  specialistsTable: document.querySelector('[data-specialists-table]'),
  specialistForm: document.querySelector('[data-specialist-form]'),
  availabilitySpecialist: document.querySelector('[data-availability-specialist]'),
  availabilityEditor: document.querySelector('[data-availability-editor]'),
  availabilityForm: document.querySelector('[data-availability-form]'),
  availabilityStatus: document.querySelector('[data-availability-status]'),
  filterSpecialist: document.querySelector('[data-filter-specialist]'),
  bookingFilters: document.querySelector('[data-booking-filters]'),
  bookingsTable: document.querySelector('[data-bookings-table]')
};

const weekdays = [
  { value: 1, label: 'Lunedi' },
  { value: 2, label: 'Martedi' },
  { value: 3, label: 'Mercoledi' },
  { value: 4, label: 'Giovedi' },
  { value: 5, label: 'Venerdi' },
  { value: 6, label: 'Sabato' }
];

setupEvents();
setupReveal();
if (adminState.token) {
  loadDashboard().catch(handleAuthFailure);
}

function setupReveal() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) entry.target.classList.add('is-visible');
    });
  }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach((element) => observer.observe(element));
}

function setupEvents() {
  dom.loginForm.addEventListener('submit', login);
  dom.refresh.addEventListener('click', () => loadDashboard().catch(handleAuthFailure));
  dom.logout.addEventListener('click', logout);
  dom.serviceForm.addEventListener('submit', saveService);
  dom.specialistForm.addEventListener('submit', saveSpecialist);
  dom.availabilityForm.addEventListener('submit', saveAvailability);
  dom.bookingFilters.addEventListener('submit', applyBookingFilters);
  document.querySelector('[data-reset-service]').addEventListener('click', () => dom.serviceForm.reset());
  document.querySelector('[data-reset-specialist]').addEventListener('click', () => dom.specialistForm.reset());
  dom.availabilitySpecialist.addEventListener('change', renderAvailabilityEditor);
}

async function login(event) {
  event.preventDefault();
  const formData = new FormData(dom.loginForm);
  dom.loginStatus.textContent = '';
  try {
    const response = await request('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: formData.get('username'),
        password: formData.get('password')
      })
    }, false);
    adminState.token = response.token;
    localStorage.setItem(storageKey, response.token);
    await loadDashboard();
  } catch (error) {
    dom.loginStatus.textContent = error.message;
    dom.loginStatus.classList.add('is-error');
  }
}

async function loadDashboard() {
  adminState.dashboard = await request('/api/admin/dashboard');
  dom.loginView.classList.add('is-hidden');
  dom.dashboardView.classList.remove('is-hidden');
  renderOverview();
  renderServicesTable();
  renderSpecialistsTable();
  populateSpecialistSelects();
  renderAvailabilityEditor();
  renderBookingsTable(adminState.dashboard.bookings);
}

function renderOverview() {
  const { services, specialists, bookings } = adminState.dashboard;
  const confirmed = bookings.filter((item) => item.status === 'confirmed').length;
  const cards = [
    ['Servizi attivi', String(services.length)],
    ['Specialisti attivi', String(specialists.filter((item) => item.active).length)],
    ['Prenotazioni future', String(bookings.length)],
    ['Confermate', String(confirmed)]
  ];
  dom.overview.innerHTML = cards.map(([label, value]) => `
    <article class="admin-overview-card card-surface reveal is-visible">
      <span class="section-kicker">Overview</span>
      <strong>${value}</strong>
      <p>${label}</p>
    </article>
  `).join('');
}

function renderServicesTable() {
  dom.servicesTable.innerHTML = adminState.dashboard.services.map((service) => `
    <tr>
      <td><strong>${service.name}</strong><br><small>${service.description}</small></td>
      <td>€ ${Number(service.price).toFixed(0)}</td>
      <td>${service.duration_minutes} min</td>
      <td class="table-actions">
        <button class="icon-btn" type="button" data-edit-service="${service.id}">Modifica</button>
        <button class="icon-btn danger" type="button" data-delete-service="${service.id}">Elimina</button>
      </td>
    </tr>
  `).join('');

  dom.servicesTable.querySelectorAll('[data-edit-service]').forEach((button) => {
    button.addEventListener('click', () => {
      const service = adminState.dashboard.services.find((item) => item.id === Number(button.dataset.editService));
      if (!service) return;
      dom.serviceForm.elements.id.value = service.id;
      dom.serviceForm.elements.name.value = service.name;
      dom.serviceForm.elements.price.value = service.price;
      dom.serviceForm.elements.duration_minutes.value = service.duration_minutes;
      dom.serviceForm.elements.description.value = service.description;
      dom.serviceForm.elements.featured.checked = Boolean(service.featured);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  dom.servicesTable.querySelectorAll('[data-delete-service]').forEach((button) => {
    button.addEventListener('click', async () => {
      await request(`/api/admin/services/${button.dataset.deleteService}`, { method: 'DELETE' });
      await loadDashboard();
    });
  });
}

function renderSpecialistsTable() {
  dom.specialistsTable.innerHTML = adminState.dashboard.specialists.map((specialist) => `
    <tr>
      <td><strong>${specialist.name}</strong><br><small>${specialist.specialization}</small></td>
      <td>${specialist.role}</td>
      <td>${specialist.active ? 'Attivo' : 'Pausa'}</td>
      <td class="table-actions">
        <button class="icon-btn" type="button" data-edit-specialist="${specialist.id}">Modifica</button>
        <button class="icon-btn danger" type="button" data-delete-specialist="${specialist.id}">Elimina</button>
      </td>
    </tr>
  `).join('');

  dom.specialistsTable.querySelectorAll('[data-edit-specialist]').forEach((button) => {
    button.addEventListener('click', () => {
      const specialist = adminState.dashboard.specialists.find((item) => item.id === Number(button.dataset.editSpecialist));
      if (!specialist) return;
      dom.specialistForm.elements.id.value = specialist.id;
      dom.specialistForm.elements.name.value = specialist.name;
      dom.specialistForm.elements.role.value = specialist.role;
      dom.specialistForm.elements.specialization.value = specialist.specialization;
      dom.specialistForm.elements.avatar.value = specialist.avatar;
      dom.specialistForm.elements.bio.value = specialist.bio;
      dom.specialistForm.elements.active.checked = Boolean(specialist.active);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  dom.specialistsTable.querySelectorAll('[data-delete-specialist]').forEach((button) => {
    button.addEventListener('click', async () => {
      await request(`/api/admin/specialists/${button.dataset.deleteSpecialist}`, { method: 'DELETE' });
      await loadDashboard();
    });
  });
}

function populateSpecialistSelects() {
  const options = adminState.dashboard.specialists.map((specialist) => `<option value="${specialist.id}">${specialist.name}</option>`).join('');
  dom.availabilitySpecialist.innerHTML = options;
  dom.filterSpecialist.innerHTML = `<option value="">Tutti gli specialisti</option>${options}`;
}

function renderAvailabilityEditor() {
  const specialistId = Number(dom.availabilitySpecialist.value || adminState.dashboard?.specialists?.[0]?.id || 0);
  const specialist = adminState.dashboard.specialists.find((item) => item.id === specialistId);
  if (!specialist) return;
  dom.availabilitySpecialist.value = specialist.id;
  const availability = specialist.availability || {};
  dom.availabilityEditor.innerHTML = weekdays.map((day) => {
    const ranges = availability[day.label] || [];
    const firstRange = ranges[0] || '';
    const secondRange = ranges[1] || '';
    const [firstStart = '', firstEnd = ''] = firstRange.split(' - ');
    const [secondStart = '', secondEnd = ''] = secondRange.split(' - ');
    return `
      <div class="day-row" data-weekday="${day.value}">
        <div class="day-row-head">
          <strong>${day.label}</strong>
          <label class="inline-checkbox"><input type="checkbox" data-day-enabled ${ranges.length ? 'checked' : ''} /><span>Disponibile</span></label>
        </div>
        <div class="day-row-fields">
          <label><span>Fascia 1 inizio</span><input type="time" data-start-one value="${firstStart}" /></label>
          <label><span>Fascia 1 fine</span><input type="time" data-end-one value="${firstEnd}" /></label>
          <label><span>Fascia 2 inizio</span><input type="time" data-start-two value="${secondStart}" /></label>
          <label><span>Fascia 2 fine</span><input type="time" data-end-two value="${secondEnd}" /></label>
        </div>
      </div>
    `;
  }).join('');
}

function renderBookingsTable(rows) {
  dom.bookingsTable.innerHTML = rows.map((booking) => `
    <tr>
      <td><strong>${booking.customer_name}</strong><br><small>${booking.customer_phone}</small></td>
      <td>${booking.service_name}</td>
      <td>${booking.specialist_name}</td>
      <td>${booking.booking_date}</td>
      <td>${booking.booking_time} - ${booking.end_time}</td>
      <td><span class="status-chip">${booking.status}</span></td>
      <td class="table-actions">
        <button class="icon-btn" type="button" data-status-booking="${booking.id}" data-status-value="confirmed">Conferma</button>
        <button class="icon-btn danger" type="button" data-status-booking="${booking.id}" data-status-value="cancelled">Annulla</button>
      </td>
    </tr>
  `).join('');

  dom.bookingsTable.querySelectorAll('[data-status-booking]').forEach((button) => {
    button.addEventListener('click', async () => {
      await request(`/api/admin/bookings/${button.dataset.statusBooking}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: button.dataset.statusValue })
      });
      await loadDashboard();
    });
  });
}

async function saveService(event) {
  event.preventDefault();
  const form = new FormData(dom.serviceForm);
  const payload = {
    name: form.get('name').trim(),
    price: Number(form.get('price')),
    duration_minutes: Number(form.get('duration_minutes')),
    description: form.get('description').trim(),
    featured: dom.serviceForm.elements.featured.checked
  };
  const id = form.get('id');
  if (id) {
    await request(`/api/admin/services/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  } else {
    await request('/api/admin/services', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  }
  dom.serviceForm.reset();
  await loadDashboard();
}

async function saveSpecialist(event) {
  event.preventDefault();
  const form = new FormData(dom.specialistForm);
  const payload = {
    name: form.get('name').trim(),
    role: form.get('role').trim(),
    specialization: form.get('specialization').trim(),
    avatar: form.get('avatar').trim(),
    bio: form.get('bio').trim(),
    active: dom.specialistForm.elements.active.checked
  };
  const id = form.get('id');
  if (id) {
    await request(`/api/admin/specialists/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  } else {
    await request('/api/admin/specialists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  }
  dom.specialistForm.reset();
  await loadDashboard();
}

async function saveAvailability(event) {
  event.preventDefault();
  const specialistId = Number(dom.availabilitySpecialist.value);
  const weekly = [];
  dom.availabilityEditor.querySelectorAll('[data-weekday]').forEach((row) => {
    const weekday = Number(row.dataset.weekday);
    const enabled = row.querySelector('[data-day-enabled]').checked;
    if (!enabled) return;
    const entries = [
      [row.querySelector('[data-start-one]').value, row.querySelector('[data-end-one]').value],
      [row.querySelector('[data-start-two]').value, row.querySelector('[data-end-two]').value]
    ];
    entries.forEach(([start, end]) => {
      if (start && end) weekly.push({ weekday, start_time: start, end_time: end });
    });
  });

  const form = new FormData(dom.availabilityForm);
  const exceptions = [];
  if (form.get('exceptionDate')) {
    exceptions.push({
      date: form.get('exceptionDate'),
      start_time: form.get('exceptionStart') || null,
      end_time: form.get('exceptionEnd') || null,
      is_closed: Boolean(form.get('exceptionClosed')),
      note: form.get('exceptionNote') || ''
    });
  }

  await request(`/api/admin/availability/${specialistId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weekly, exceptions })
  });
  dom.availabilityStatus.textContent = 'Disponibilità aggiornata.';
  dom.availabilityStatus.className = 'form-status is-success';
  await loadDashboard();
}

async function applyBookingFilters(event) {
  event.preventDefault();
  const form = new FormData(dom.bookingFilters);
  const params = new URLSearchParams();
  ['specialistId', 'date', 'status'].forEach((key) => {
    const value = form.get(key);
    if (value) params.append(key, value);
  });
  const rows = await request(`/api/admin/bookings?${params.toString()}`);
  renderBookingsTable(rows);
}

async function logout() {
  try {
    await request('/api/admin/logout', { method: 'POST' });
  } catch {
    // ignore logout errors
  }
  adminState.token = null;
  localStorage.removeItem(storageKey);
  dom.dashboardView.classList.add('is-hidden');
  dom.loginView.classList.remove('is-hidden');
}

function handleAuthFailure(error) {
  console.error(error);
  logout();
  dom.loginStatus.textContent = 'Sessione non valida o scaduta.';
}

async function request(url, options = {}, includeAuth = true) {
  const headers = { ...(options.headers || {}) };
  if (includeAuth && adminState.token) headers.Authorization = `Bearer ${adminState.token}`;
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Errore di rete');
  }
  return response.json();
}
