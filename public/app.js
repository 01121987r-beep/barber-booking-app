const FALLBACK_ANDROID_API = 'http://10.0.2.2:3000';
const isCapacitorRuntime = Boolean(
  window.Capacitor?.isNativePlatform?.()
  || (window.location.hostname === 'localhost' && window.location.port === '')
  || window.location.protocol === 'capacitor:'
  || window.location.protocol === 'file:'
);
const isAndroidEmulator = /sdk_gphone|emulator|android sdk built for/i.test(window.navigator.userAgent || '');
const runtimeConfig = window.APP_CONFIG || {};
const API_BASE = runtimeConfig.API_BASE
  || (isAndroidEmulator
    ? (runtimeConfig.API_BASE_EMULATOR || FALLBACK_ANDROID_API)
    : (runtimeConfig.API_BASE_DEVICE || runtimeConfig.API_BASE_LOCAL))
  || window.BARBER_API_BASE
  || (isCapacitorRuntime ? FALLBACK_ANDROID_API : '');

const apiBaseCandidates = [];

if (isAndroidEmulator) {
  apiBaseCandidates.push(
    runtimeConfig.API_BASE_EMULATOR,
    FALLBACK_ANDROID_API,
    runtimeConfig.API_BASE_LOCAL,
    runtimeConfig.API_BASE_DEVICE
  );
} else if (isCapacitorRuntime) {
  apiBaseCandidates.push(
    runtimeConfig.API_BASE_DEVICE,
    'http://192.168.1.21:3000',
    runtimeConfig.API_BASE_LOCAL,
    'http://localhost:3000'
  );
} else {
  apiBaseCandidates.push(
    API_BASE,
    runtimeConfig.API_BASE_LOCAL,
    runtimeConfig.API_BASE_DEVICE,
    runtimeConfig.API_BASE_EMULATOR
  );
}

const API_BASE_CANDIDATES = Array.from(new Set(apiBaseCandidates.filter(Boolean)));
const STORAGE_KEY = 'barberBookingTokens';

const state = {
  settings: null,
  services: [],
  specialists: [],
  bookingLocked: false,
  selection: {
    serviceId: null,
    specialistId: null,
    bookingDate: null,
    bookingTime: null,
    customerName: '',
    customerPhone: '',
    customerEmail: '',
    notes: ''
  },
  availableDates: [],
  availableSlots: [],
  customerArea: {
    bookings: [],
    activeBookingToken: null,
    selectedDate: null,
    selectedTime: null,
    slots: []
  }
};

const dom = {
  bookingServices: document.querySelector('[data-booking-services]'),
  bookingSpecialists: document.querySelector('[data-booking-specialists]'),
  dateGrid: document.querySelector('[data-date-grid]'),
  slotsGrid: document.querySelector('[data-slots-grid]'),
  slotsHelper: document.querySelector('[data-slots-helper]'),
  bookingForm: document.querySelector('[data-booking-form]'),
  bookingSummary: document.querySelector('[data-booking-summary]'),
  bookingStatus: document.querySelector('[data-booking-status]'),
  confirmButton: document.querySelector('[data-confirm-booking]'),
  stepButtons: [...document.querySelectorAll('[data-step]')],
  stepPanels: [...document.querySelectorAll('[data-step-panel]')],
  successCopy: document.querySelector('[data-success-copy]'),
  successSummary: document.querySelector('[data-success-summary]'),
  newBooking: document.querySelector('[data-new-booking]'),
  manageAfterBooking: document.querySelector('[data-manage-after-booking]'),
  metaAddress: document.querySelector('[data-meta-address]'),
  metaPhoneLink: document.querySelector('[data-meta-phone-link]'),
  metaEmailLink: document.querySelector('[data-meta-email-link]'),
  openManageBooking: document.querySelector('[data-open-manage-booking]'),
  manageModal: document.querySelector('[data-manage-modal]'),
  manageStatus: document.querySelector('[data-manage-status]'),
  manageBookings: document.querySelector('[data-manage-bookings]'),
  manageSuccess: document.querySelector('[data-manage-success]'),
  manageSuccessCopy: document.querySelector('[data-manage-success-copy]'),
  manageSuccessClose: document.querySelector('[data-manage-success-close]'),
  closeManageButtons: [...document.querySelectorAll('[data-close-manage-modal]')]
};

const weekdayNames = ['Domenica', 'Lunedi', 'Martedi', 'Mercoledi', 'Giovedi', 'Venerdi', 'Sabato'];

init().catch((error) => {
  console.error(error);
  if (dom.bookingServices) {
    dom.bookingServices.innerHTML = `<p class="helper-text">${error.message || 'Errore nel caricamento dei servizi.'}</p>`;
  }
});

async function init() {
  setupEvents();
  let services;
  try {
    services = await request('/api/services');
  } catch (error) {
    throw new Error(`Servizi non caricati: ${error.message}`);
  }
  state.services = services;
  renderBookingServices();
  updateSummary();

  const meta = await request('/api/meta');
  state.settings = meta.settings;
  populateMeta();

  const specialists = await request('/api/specialists');
  state.specialists = specialists;

  renderBookingSpecialists();
  await renderDateChoices();
  updateSummary();
}

function setupEvents() {
  dom.stepButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const targetStep = Number(button.dataset.step);
      if (isStepAvailable(targetStep)) goToStep(targetStep);
    });
  });

  dom.bookingForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(dom.bookingForm);
    state.selection.customerName = `${formData.get('customerName') || ''}`.trim();
    state.selection.customerPhone = `${formData.get('customerPhone') || ''}`.trim();
    state.selection.customerEmail = '';
    state.selection.notes = `${formData.get('notes') || ''}`.trim();
    updateSummary();
    goToStep(6);
  });

  dom.confirmButton.addEventListener('click', confirmBooking);
  dom.newBooking.addEventListener('click', resetBookingFlow);
  dom.manageAfterBooking?.addEventListener('click', openManageModal);

  dom.openManageBooking.addEventListener('click', openManageModal);
  dom.closeManageButtons.forEach((button) => button.addEventListener('click', closeManageModal));
  dom.manageSuccessClose.addEventListener('click', () => {
    dom.manageSuccess.classList.add('is-hidden');
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !dom.manageModal.classList.contains('is-hidden')) {
      closeManageModal();
    }
  });
}

function populateMeta() {
  if (!state.settings) return;
  if (dom.metaAddress) {
    dom.metaAddress.textContent = state.settings.address;
  }
  if (dom.metaPhoneLink) {
    dom.metaPhoneLink.textContent = state.settings.phone;
    dom.metaPhoneLink.href = `tel:${state.settings.phone.replace(/\s+/g, '')}`;
  }
  if (dom.metaEmailLink) {
    dom.metaEmailLink.textContent = state.settings.email;
    dom.metaEmailLink.href = `mailto:${state.settings.email}`;
  }
}

function renderBookingServices() {
  dom.bookingServices.innerHTML = state.services.map((service) => `
    <button class="service-pill ${state.selection.serviceId === service.id ? 'is-selected' : ''}" type="button" data-select-service="${service.id}">
      <div class="service-pill-top">
        <span class="service-pill-title">${service.name}</span>
        <span class="service-pill-price">€ ${Number(service.price).toFixed(0)}</span>
      </div>
      <p>${service.description}</p>
      <div class="service-pill-meta">
        <span>${service.duration_minutes} min</span>
        <span>Slot da 30 min</span>
      </div>
    </button>
  `).join('');

  dom.bookingServices.querySelectorAll('[data-select-service]').forEach((button) => {
    button.addEventListener('click', async () => {
      state.selection.serviceId = Number(button.dataset.selectService);
      state.selection.specialistId = null;
      state.selection.bookingDate = null;
      state.selection.bookingTime = null;
      state.availableSlots = [];
      renderBookingServices();
      renderBookingSpecialists();
      try {
        await renderDateChoices();
      } catch (error) {
        dom.dateGrid.innerHTML = `<p class="helper-text">${error.message || 'Impossibile caricare le date disponibili.'}</p>`;
      }
      renderSlots();
      updateSummary();
      goToStep(2);
    });
  });
}

function renderBookingSpecialists() {
  dom.bookingSpecialists.innerHTML = state.specialists.map((specialist) => `
    <button class="specialist-card booking-specialist-card ${state.selection.specialistId === specialist.id ? 'is-selected' : ''}" type="button" data-select-specialist="${specialist.id}">
      <img src="${specialist.avatar}" alt="${specialist.name}" />
      <strong>${specialist.name}</strong>
      <p>${specialist.bio}</p>
      <div class="option-meta">
        <span>${specialist.role}</span>
        <span>${specialist.specialization}</span>
      </div>
    </button>
  `).join('');

  dom.bookingSpecialists.querySelectorAll('[data-select-specialist]').forEach((button) => {
    button.addEventListener('click', async () => {
      state.selection.specialistId = Number(button.dataset.selectSpecialist);
      state.selection.bookingDate = null;
      state.selection.bookingTime = null;
      renderBookingSpecialists();
      try {
        await renderDateChoices();
      } catch (error) {
        dom.dateGrid.innerHTML = `<p class="helper-text">${error.message || 'Impossibile caricare le date disponibili.'}</p>`;
      }
      renderSlots();
      updateSummary();
      goToStep(3);
    });
  });
}

async function renderDateChoices() {
  const dates = await buildDateCandidates();
  state.availableDates = dates;
  if (!dates.length) {
    dom.dateGrid.innerHTML = '<p class="helper-text">Nessuna data disponibile per questo specialista nella finestra prenotabile.</p>';
    return;
  }
  dom.dateGrid.innerHTML = dates.map((date) => `
    <button type="button" class="date-pill ${state.selection.bookingDate === date.value ? 'is-selected' : ''}" data-date="${date.value}">
      ${date.label}
    </button>
  `).join('');

  dom.dateGrid.querySelectorAll('[data-date]').forEach((button) => {
    button.addEventListener('click', async () => {
      state.selection.bookingDate = button.dataset.date;
      state.selection.bookingTime = null;
      await renderDateChoices();
      await loadAvailableSlots();
      updateSummary();
      goToStep(4);
    });
  });
}

async function buildDateCandidates() {
  const items = currentWeekDates();
  if (!state.selection.serviceId || !state.selection.specialistId) return items;

  const checks = await Promise.all(items.map(async (item) => {
    try {
      const response = await request(`/api/availability?serviceId=${state.selection.serviceId}&specialistId=${state.selection.specialistId}&date=${item.value}`);
      return response.slots?.length ? item : null;
    } catch {
      return null;
    }
  }));

  return checks.filter(Boolean);
}

async function loadAvailableSlots() {
  const { serviceId, specialistId, bookingDate } = state.selection;
  if (!serviceId || !specialistId || !bookingDate) return;
  const response = await request(`/api/availability?serviceId=${serviceId}&specialistId=${specialistId}&date=${bookingDate}`);
  state.availableSlots = response.slots || [];
  renderSlots();
}

function renderSlots() {
  if (!state.selection.bookingDate) {
    dom.slotsGrid.innerHTML = '';
    dom.slotsHelper.textContent = 'Seleziona una data per vedere gli slot disponibili.';
    return;
  }

  if (!state.availableSlots.length) {
    dom.slotsGrid.innerHTML = '';
    dom.slotsHelper.textContent = 'Nessuno slot disponibile in questa data. Scegli un altro giorno.';
    return;
  }

  const hasPastSlots = state.availableSlots.some((slot) => isPastSlot(state.selection.bookingDate, slot));
  dom.slotsHelper.textContent = hasPastSlots
    ? 'Per la data di oggi gli orari già trascorsi non sono più prenotabili.'
    : 'Gli orari mostrati sono realmente prenotabili per il servizio selezionato.';

  dom.slotsGrid.innerHTML = state.availableSlots.map((slot) => {
    const disabled = isPastSlot(state.selection.bookingDate, slot);
    return `
      <button type="button" class="slot-pill ${state.selection.bookingTime === slot ? 'is-selected' : ''}" data-slot="${slot}" ${disabled ? 'disabled' : ''}>
        ${slot}
      </button>
    `;
  }).join('');

  dom.slotsGrid.querySelectorAll('[data-slot]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.disabled) return;
      state.selection.bookingTime = button.dataset.slot;
      renderSlots();
      updateSummary();
      goToStep(5);
    });
  });
}

function updateSummary() {
  const service = state.services.find((item) => item.id === state.selection.serviceId);
  const specialist = state.specialists.find((item) => item.id === state.selection.specialistId);
  const summaryRows = [
    ['Servizio', service ? service.name : 'Da selezionare'],
    ['Specialista', specialist ? specialist.name : 'Da selezionare'],
    ['Data', state.selection.bookingDate ? formatDisplayDate(state.selection.bookingDate) : 'Da selezionare'],
    ['Orario', state.selection.bookingTime || 'Da selezionare'],
    ['Cliente', state.selection.customerName || 'Non ancora inserito'],
    ['Telefono', state.selection.customerPhone || 'Non ancora inserito']
  ];
  const html = summaryRows.map(([label, value]) => `<div class="summary-row"><span>${label}</span><span>${value}</span></div>`).join('');
  dom.bookingSummary.innerHTML = html;
  updateStepAvailability();
}

function goToStep(stepNumber) {
  dom.stepButtons.forEach((button) => button.classList.toggle('is-active', Number(button.dataset.step) === stepNumber));
  dom.stepPanels.forEach((panel) => panel.classList.toggle('is-hidden', Number(panel.dataset.stepPanel) !== stepNumber));
  updateStepAvailability();
}

async function confirmBooking() {
  dom.bookingStatus.textContent = '';
  dom.bookingStatus.className = 'form-status';
  try {
    const response = await request('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...state.selection })
    });

    storeBookingToken(response.booking.bookingToken);
    state.bookingLocked = true;
    dom.successCopy.textContent = `Ti aspettiamo il ${formatDisplayDate(response.booking.bookingDate)} alle ${response.booking.bookingTime} con ${response.booking.specialist}.`;
    dom.successSummary.innerHTML = dom.bookingSummary.innerHTML;
    goToStep(7);
  } catch (error) {
    dom.bookingStatus.textContent = error.message;
    dom.bookingStatus.classList.add('is-error');
  }
}

function resetBookingFlow() {
  state.bookingLocked = false;
  state.selection = {
    serviceId: null,
    specialistId: null,
    bookingDate: null,
    bookingTime: null,
    customerName: '',
    customerPhone: '',
    customerEmail: '',
    notes: ''
  };
  state.availableDates = [];
  state.availableSlots = [];
  dom.bookingForm.reset();
  renderBookingServices();
  renderBookingSpecialists();
  renderDateChoices();
  renderSlots();
  updateSummary();
  goToStep(1);
}

function isStepAvailable(stepNumber) {
  if (state.bookingLocked) return false;
  const { serviceId, specialistId, bookingDate, bookingTime, customerName, customerPhone } = state.selection;
  const rules = {
    1: true,
    2: Boolean(serviceId),
    3: Boolean(serviceId && specialistId),
    4: Boolean(serviceId && specialistId && bookingDate),
    5: Boolean(serviceId && specialistId && bookingDate && bookingTime),
    6: Boolean(serviceId && specialistId && bookingDate && bookingTime && customerName && customerPhone)
  };
  return Boolean(rules[stepNumber]);
}

function updateStepAvailability() {
  dom.stepButtons.forEach((button) => {
    const step = Number(button.dataset.step);
    const available = !state.bookingLocked && isStepAvailable(step);
    button.disabled = !available;
    button.classList.toggle('is-disabled', !available);
  });
}

function getStoredBookingTokens() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function setStoredBookingTokens(tokens) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...new Set(tokens)]));
}

function storeBookingToken(token) {
  if (!token) return;
  const tokens = getStoredBookingTokens();
  if (!tokens.includes(token)) {
    tokens.unshift(token);
    setStoredBookingTokens(tokens);
  }
}

function removeStoredBookingToken(token) {
  setStoredBookingTokens(getStoredBookingTokens().filter((item) => item !== token));
}

function openManageModal() {
  dom.manageModal.classList.remove('is-hidden');
  document.body.classList.add('modal-open');
  dom.manageStatus.textContent = 'Caricamento prenotazioni salvate su questo dispositivo...';
  dom.manageStatus.className = 'form-status';
  dom.manageSuccess.classList.add('is-hidden');
  loadStoredBookings();
}

function closeManageModal() {
  dom.manageModal.classList.add('is-hidden');
  document.body.classList.remove('modal-open');
  state.customerArea.activeBookingToken = null;
  state.customerArea.selectedDate = null;
  state.customerArea.selectedTime = null;
  state.customerArea.slots = [];
}

async function loadStoredBookings() {
  const tokens = getStoredBookingTokens();
  if (!tokens.length) {
    state.customerArea.bookings = [];
    dom.manageStatus.textContent = '';
    renderManageBookings();
    return;
  }

  const results = await Promise.all(tokens.map(async (token) => {
    try {
      const response = await request(`/api/customer/booking/${token}`);
      return response.booking;
    } catch {
      return null;
    }
  }));

  state.customerArea.bookings = results.filter(Boolean).sort((left, right) => {
    const leftStamp = `${left.booking_date} ${left.booking_time}`;
    const rightStamp = `${right.booking_date} ${right.booking_time}`;
    return leftStamp.localeCompare(rightStamp);
  });

  setStoredBookingTokens(state.customerArea.bookings.map((booking) => booking.booking_token));
  dom.manageStatus.textContent = state.customerArea.bookings.length ? '' : '';
  renderManageBookings();
}

function renderManageBookings() {
  if (!state.customerArea.bookings.length) {
    dom.manageBookings.innerHTML = `
      <div class="manage-empty">
        <strong>Nessuna prenotazione salvata.</strong>
        <p>Quando confermi un appuntamento da questa app, la prenotazione viene memorizzata sul dispositivo e potrai gestirla qui.</p>
      </div>
    `;
    return;
  }

  dom.manageBookings.innerHTML = state.customerArea.bookings.map((booking) => {
    const managing = state.customerArea.activeBookingToken === booking.booking_token;
    return `
      <article class="manage-booking-card">
        <div class="manage-booking-top">
          <div>
            <span class="section-kicker">Prenotazione salvata</span>
            <h3>${booking.service_name}</h3>
          </div>
          <span class="status-chip">Confermata</span>
        </div>
        <div class="summary-card manage-summary">
          <div class="summary-row"><span>Specialista</span><span>${booking.specialist_name}</span></div>
          <div class="summary-row"><span>Data</span><span>${formatDisplayDate(booking.booking_date)}</span></div>
          <div class="summary-row"><span>Orario</span><span>${booking.booking_time}</span></div>
          <div class="summary-row"><span>Cliente</span><span>${booking.customer_name}</span></div>
        </div>
        <div class="inline-actions manage-actions">
          <button class="btn btn-secondary" type="button" data-manage-booking-action="manage" data-booking-token="${booking.booking_token}">
            Gestisci
          </button>
          <button class="btn btn-primary" type="button" data-manage-booking-action="cancel" data-booking-token="${booking.booking_token}">
            Annulla
          </button>
        </div>
        ${managing ? renderManageEditor(booking) : ''}
      </article>
    `;
  }).join('');

  bindManageBookingEvents();
}

function renderManageEditor(booking) {
  const dateOptions = buildRescheduleDateMarkup(booking.booking_token);
  const slotButtons = renderManageSlotButtons();
  return `
    <div class="manage-editor">
      <div class="section-head compact-head">
        <span class="section-kicker">Cambio appuntamento</span>
        <h3>Seleziona nuovo giorno e orario</h3>
      </div>
      <div class="date-grid manage-date-grid">${dateOptions}</div>
      <div class="slots-grid manage-slots-grid">${slotButtons}</div>
      <div class="inline-actions manage-actions">
        <button class="btn btn-primary" type="button" data-manage-booking-action="confirm-reschedule" data-booking-token="${booking.booking_token}" ${state.customerArea.selectedTime ? '' : 'disabled'}>
          Conferma
        </button>
      </div>
    </div>
  `;
}

function buildRescheduleDateMarkup(token) {
  return currentWeekDates().map((item) => `
    <button type="button" class="date-pill ${state.customerArea.selectedDate === item.value ? 'is-selected' : ''}" data-manage-date="${item.value}" data-booking-token="${token}">
      ${item.label}
    </button>
  `).join('');
}

function renderManageSlotButtons() {
  if (!state.customerArea.selectedDate) {
    return '<p class="helper-text manage-helper">Seleziona prima un giorno.</p>';
  }
  if (!state.customerArea.slots.length) {
    return '<p class="helper-text manage-helper">Nessuno slot disponibile in questa data.</p>';
  }
  return state.customerArea.slots.map((slot) => `
    <button type="button" class="slot-pill ${state.customerArea.selectedTime === slot ? 'is-selected' : ''}" data-manage-time="${slot}">
      ${slot}
    </button>
  `).join('');
}

function bindManageBookingEvents() {
  dom.manageBookings.querySelectorAll('[data-manage-booking-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = button.dataset.manageBookingAction;
      const token = button.dataset.bookingToken;
      if (action === 'cancel') await cancelStoredBooking(token);
      if (action === 'manage') {
        state.customerArea.activeBookingToken = token;
        state.customerArea.selectedDate = null;
        state.customerArea.selectedTime = null;
        state.customerArea.slots = [];
        renderManageBookings();
      }
      if (action === 'confirm-reschedule') await submitReschedule(token);
    });
  });

  dom.manageBookings.querySelectorAll('[data-manage-date]').forEach((button) => {
    button.addEventListener('click', async () => {
      state.customerArea.activeBookingToken = button.dataset.bookingToken;
      state.customerArea.selectedDate = button.dataset.manageDate;
      state.customerArea.selectedTime = null;
      await loadRescheduleSlots(state.customerArea.activeBookingToken, state.customerArea.selectedDate);
      renderManageBookings();
    });
  });

  dom.manageBookings.querySelectorAll('[data-manage-time]').forEach((button) => {
    button.addEventListener('click', () => {
      state.customerArea.selectedTime = button.dataset.manageTime;
      renderManageBookings();
    });
  });
}

async function cancelStoredBooking(token) {
  dom.manageStatus.textContent = '';
  dom.manageStatus.className = 'form-status';
  try {
    await request(`/api/customer/booking/${token}/cancel`, { method: 'PATCH' });
    removeStoredBookingToken(token);
    showManageSuccess('Prenotazione annullata correttamente.');
    await loadStoredBookings();
  } catch (error) {
    dom.manageStatus.textContent = error.message;
    dom.manageStatus.classList.add('is-error');
  }
}

async function loadRescheduleSlots(token, date) {
  const response = await request(`/api/customer/booking/${token}/availability?date=${date}`);
  state.customerArea.slots = response.slots || [];
}

async function submitReschedule(token) {
  dom.manageStatus.textContent = '';
  dom.manageStatus.className = 'form-status';
  try {
    await request(`/api/customer/booking/${token}/reschedule`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookingDate: state.customerArea.selectedDate,
        bookingTime: state.customerArea.selectedTime
      })
    });

    showManageSuccess(`Prenotazione aggiornata. Nuovo appuntamento: ${formatDisplayDate(state.customerArea.selectedDate)} alle ${state.customerArea.selectedTime}.`);
    state.customerArea.activeBookingToken = null;
    state.customerArea.selectedDate = null;
    state.customerArea.selectedTime = null;
    state.customerArea.slots = [];
    await loadStoredBookings();
  } catch (error) {
    dom.manageStatus.textContent = error.message;
    dom.manageStatus.classList.add('is-error');
  }
}

function showManageSuccess(message) {
  dom.manageSuccessCopy.textContent = message;
  dom.manageSuccess.classList.remove('is-hidden');
}

function currentWeekDates() {
  const items = [];
  const today = new Date();
  const currentWeekday = today.getDay() === 0 ? 7 : today.getDay();
  const remainingDays = 7 - currentWeekday;
  const includeNextWeek = currentWeekday >= 5;
  const totalDays = includeNextWeek ? remainingDays + 7 : remainingDays;

  for (let offset = 0; offset <= totalDays; offset += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() + offset);
    items.push({
      value: date.toISOString().slice(0, 10),
      label: `${weekdayNames[date.getDay()]} ${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`
    });
  }
  return items;
}

function formatDisplayDate(dateString) {
  const [year, month, day] = `${dateString}`.split('-');
  if (!year || !month || !day) return dateString;
  return `${day}/${month}/${year}`;
}

function getTodayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function getCurrentTimeMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function toMinutes(time) {
  const [hours, minutes] = `${time}`.split(':').map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

function isPastSlot(date, slot) {
  if (date !== getTodayISO()) return false;
  return toMinutes(slot) <= getCurrentTimeMinutes();
}

async function request(url, options = {}) {
  if (url.startsWith('http')) {
    const response = await fetch(url, options);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'Errore di rete');
    }
    return response.json();
  }

  let lastError = null;
  const failures = [];
  for (const base of API_BASE_CANDIDATES) {
    try {
      const response = await fetch(`${base}${url}`, options);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Errore di rete');
      }
      return response.json();
    } catch (error) {
      lastError = error;
      failures.push(`${base}${url} -> ${error.message}`);
    }
  }

  throw new Error(failures.length ? failures.join(' | ') : (lastError?.message || 'Errore di rete'));
}
