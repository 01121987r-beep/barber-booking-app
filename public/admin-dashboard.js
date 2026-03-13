import { clearToken, logoutToLogin, request, setupReveal, storageKey } from './admin-shared.js';

const dom = {
  loginPanel: document.querySelector('[data-login-panel]'),
  dashboardPanel: document.querySelector('[data-dashboard-panel]'),
  loginForm: document.querySelector('[data-admin-login]'),
  loginError: document.querySelector('[data-login-error]'),
  bookingFilter: document.querySelector('[data-booking-filter]'),
  bookingStatusFilter: document.querySelector('[data-booking-status-filter]'),
  bookingRows: document.querySelector('[data-booking-rows]'),
  specialistSelect: document.querySelector('[data-specialist-select]'),
  slotInterval: document.querySelector('[data-slot-interval]'),
  availabilityEditor: document.querySelector('[data-availability-editor]'),
  exceptionForm: document.querySelector('[data-exception-form]'),
  exceptionList: document.querySelector('[data-exception-list]'),
  availabilitySave: document.querySelector('[data-save-availability]'),
  availabilityStatus: document.querySelector('[data-availability-status]'),
  slotModal: document.querySelector('[data-slot-modal]'),
  closeSlotModal: document.querySelectorAll('[data-close-slot-modal]'),
  slotModalTitle: document.querySelector('[data-slot-modal-title]'),
  slotModalCopy: document.querySelector('[data-slot-modal-copy]'),
  slotModalPills: document.querySelector('[data-slot-modal-pills]'),
  slotToggle: document.querySelector('[data-slot-toggle]'),
  logout: document.querySelector('[data-logout]')
};

const weekdays = [
  { value: 1, label: 'Lunedi' },
  { value: 2, label: 'Martedi' },
  { value: 3, label: 'Mercoledi' },
  { value: 4, label: 'Giovedi' },
  { value: 5, label: 'Venerdi' },
  { value: 6, label: 'Sabato' }
];

let token = localStorage.getItem(storageKey);
let specialists = [];
let bookings = [];
let availabilityPayload = { weekly: {}, exceptions: [] };
const slotState = {
  specialistId: null,
  blockedByWeekday: {},
  modalWeekday: null,
  selectedSlot: null
};

const toMinutes = (time) => {
  if (!time) return null;
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

const toTime = (total) => {
  const hours = Math.floor(total / 60)
    .toString()
    .padStart(2, '0');
  const minutes = (total % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}`;
};

const buildSlots = (start, end, interval) => {
  const startMinutes = toMinutes(start);
  const endMinutes = toMinutes(end);
  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
    return [];
  }

  const slots = [];
  for (let cursor = startMinutes; cursor + interval <= endMinutes; cursor += interval) {
    slots.push(toTime(cursor));
  }
  return slots;
};

const getSelectedSpecialistId = () => Number(dom.specialistSelect?.value || 0);
const getCurrentInterval = () => Number(dom.slotInterval?.value || 30);

const getBlockedSet = (weekdayLabel) => {
  const list = slotState.blockedByWeekday[weekdayLabel] || [];
  return new Set(list);
};

const setBlockedSlots = (weekdayLabel, blockedSet) => {
  slotState.blockedByWeekday[weekdayLabel] = Array.from(blockedSet).sort();
};

const getRowByLabel = (weekdayLabel) =>
  dom.availabilityEditor?.querySelector(`[data-day-row="${weekdayLabel}"]`);

function getDaySlots(weekdayLabel) {
  const row = getRowByLabel(weekdayLabel);
  if (!row) return [];

  const enabled = row.querySelector('[data-day-enabled]')?.checked;
  if (!enabled) return [];

  const interval = getCurrentInterval();
  const slots = new Set();

  row.querySelectorAll('[data-range]').forEach((range) => {
    const start = range.querySelector('[data-range-start]')?.value;
    const end = range.querySelector('[data-range-end]')?.value;
    buildSlots(start, end, interval).forEach((slot) => slots.add(slot));
  });

  return Array.from(slots).sort();
}

function updateSlotCounter(weekdayLabel) {
  const row = getRowByLabel(weekdayLabel);
  if (!row) return;
  const counter = row.querySelector('[data-slot-counter]');
  if (!counter) return;
  const blockedCount = (slotState.blockedByWeekday[weekdayLabel] || []).length;
  counter.textContent = blockedCount
    ? `${blockedCount} slot gestiti`
    : 'Nessuna modifica slot';
}

function renderAllSlotCounters() {
  weekdays.forEach((day) => updateSlotCounter(day.label));
}

function closeSlotModal() {
  slotState.modalWeekday = null;
  slotState.selectedSlot = null;
  dom.slotModal?.classList.add('is-hidden');
  dom.slotModal?.setAttribute('hidden', 'hidden');
}

function renderSlotModal() {
  const weekdayLabel = slotState.modalWeekday;
  if (!weekdayLabel) return;

  const slots = getDaySlots(weekdayLabel);
  const blockedSet = getBlockedSet(weekdayLabel);
  const selected = slotState.selectedSlot;

  dom.slotModalTitle.textContent = `Gestisci slot orari · ${weekdayLabel}`;
  dom.slotModalCopy.textContent = slots.length
    ? 'Seleziona uno slot per eliminarlo o ripristinarlo. Gli slot derivano automaticamente dalle fasce orarie impostate.'
    : 'Attiva il giorno e imposta almeno una fascia oraria valida per generare gli slot.';

  dom.slotModalPills.innerHTML = '';

  if (!slots.length) {
    const empty = document.createElement('p');
    empty.className = 'muted-text';
    empty.textContent = 'Nessuno slot disponibile per questo giorno.';
    dom.slotModalPills.appendChild(empty);
    dom.slotToggle.disabled = true;
    dom.slotToggle.textContent = 'Elimina';
    return;
  }

  slots.forEach((slot) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'slot-toggle-pill';
    button.textContent = slot;
    button.dataset.slotValue = slot;

    if (blockedSet.has(slot)) {
      button.classList.add('is-blocked');
    }

    if (selected === slot) {
      button.classList.add('is-selected');
    }

    button.addEventListener('click', () => {
      slotState.selectedSlot = slotState.selectedSlot === slot ? null : slot;
      renderSlotModal();
    });

    dom.slotModalPills.appendChild(button);
  });

  if (!selected) {
    dom.slotToggle.disabled = true;
    dom.slotToggle.textContent = 'Elimina';
    return;
  }

  dom.slotToggle.disabled = false;
  dom.slotToggle.textContent = blockedSet.has(selected) ? 'Ripristina' : 'Elimina';
}

function openSlotModal(weekdayLabel) {
  slotState.modalWeekday = weekdayLabel;
  slotState.selectedSlot = null;
  dom.slotModal?.classList.remove('is-hidden');
  dom.slotModal?.removeAttribute('hidden');
  renderSlotModal();
}

function toggleSelectedSlotState() {
  const weekdayLabel = slotState.modalWeekday;
  const slot = slotState.selectedSlot;
  if (!weekdayLabel || !slot) return;

  const blockedSet = getBlockedSet(weekdayLabel);
  if (blockedSet.has(slot)) {
    blockedSet.delete(slot);
  } else {
    blockedSet.add(slot);
  }
  setBlockedSlots(weekdayLabel, blockedSet);
  updateSlotCounter(weekdayLabel);
  slotState.selectedSlot = null;
  renderSlotModal();
}

function groupBlockedSlots(payload = {}) {
  const grouped = {};
  weekdays.forEach((day) => {
    grouped[day.label] = Array.isArray(payload[day.label]) ? [...payload[day.label]].sort() : [];
  });
  return grouped;
}

function getBookingStatusLabel(status) {
  return {
    confirmed: 'Confermata',
    cancelled: 'Annullata'
  }[status] || status;
}

function formatDisplayDate(value) {
  if (!value) return '';
  const [year, month, day] = value.split('-');
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year.slice(-2)}`;
}

function getTodayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function expandDateRange(startDate, endDate) {
  if (!startDate) return [];
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${(endDate || startDate)}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];

  const result = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    result.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

function renderBookingRows(filter = 'all') {
  const normalizedFilter = filter || 'all';
  const statusFilter = dom.bookingStatusFilter?.value || 'all';
  const rows = bookings.filter((booking) => {
    const matchesSpecialist =
      normalizedFilter === 'all'
        ? true
        : (booking.specialistName || booking.specialist_name) === normalizedFilter;
    const matchesStatus =
      statusFilter === 'all'
        ? true
        : booking.status === statusFilter;
    return matchesSpecialist && matchesStatus;
  });

  if (!rows.length) {
    dom.bookingRows.innerHTML = '<tr><td colspan="8">Nessuna prenotazione per il filtro selezionato.</td></tr>';
    return;
  }

  dom.bookingRows.innerHTML = rows
    .map(
      (booking) => `
        <tr class="${booking.status === 'cancelled' ? 'booking-row-cancelled' : ''}">
          <td>${booking.customerName || booking.customer_name}</td>
          <td>${booking.customerPhone || booking.customer_phone}</td>
          <td>${booking.serviceName || booking.service_name}</td>
          <td>${booking.specialistName || booking.specialist_name}</td>
          <td>${formatDisplayDate(booking.date || booking.booking_date)}</td>
          <td>${booking.time || booking.booking_time}</td>
          <td>${getBookingStatusLabel(booking.status)}</td>
          <td>
            <select data-booking-status="${booking.id}">
              <option value="confirmed" ${booking.status === 'confirmed' ? 'selected' : ''}>Confermata</option>
              <option value="cancelled" ${booking.status === 'cancelled' ? 'selected' : ''}>Annullata</option>
              <option value="delete">Cancella</option>
            </select>
          </td>
        </tr>
      `
    )
    .join('');
}

function buildRangeMarkup(range = {}) {
  return `
    <div class="time-range" data-range>
      <label>
        <span>Inizio</span>
        <input type="time" data-range-start value="${range.start || ''}" />
      </label>
      <label>
        <span>Fine</span>
        <input type="time" data-range-end value="${range.end || ''}" />
      </label>
    </div>
  `;
}

function renderAvailabilityEditor() {
  dom.availabilityEditor.innerHTML = weekdays
    .map((day) => {
      const current = availabilityPayload.weekly?.[day.label] || { enabled: false, ranges: [] };
      const ranges = current.ranges?.length ? current.ranges : [{ start: '', end: '' }];
      const isEnabled = Boolean(current.enabled);
      return `
        <article class="availability-day ${isEnabled ? 'is-enabled' : 'is-disabled'}" data-day-row="${day.label}">
          <div class="availability-day-head">
            <label class="availability-day-toggle">
              <input class="day-checkbox" type="checkbox" data-day-enabled ${isEnabled ? 'checked' : ''} />
              <span class="availability-day-name">${day.label}</span>
            </label>
            <small>Fasce attive: ${isEnabled ? ranges.filter((range) => range.start && range.end).length : 0}</small>
          </div>
          <div class="time-range-list">
            ${Array.from({ length: 2 })
              .map((_, index) => {
                const label = index === 0 ? 'Fascia mattina' : 'Fascia pomeriggio';
                return `
                  <div class="range-group">
                    <p class="range-title">${label}</p>
                    ${buildRangeMarkup(ranges[index] || { start: '', end: '' })}
                  </div>
                `;
              })
              .join('')}
          </div>
          <div class="day-row-footer">
            <span class="slot-counter" data-slot-counter>Nessuna modifica slot</span>
            <button type="button" class="btn btn-secondary btn-compact" data-manage-slots="${day.label}" ${isEnabled ? '' : 'disabled'}>
              Gestisci slot orari
            </button>
          </div>
        </article>
      `;
    })
    .join('');

  renderAllSlotCounters();

  dom.availabilityEditor.querySelectorAll('[data-day-row]').forEach((row) => {
    const dayLabel = row.dataset.dayRow;
    const enabledInput = row.querySelector('[data-day-enabled]');
    const rangeInputs = row.querySelectorAll('input[type="time"]');
    const slotButton = row.querySelector('[data-manage-slots]');

    rangeInputs.forEach((input) => {
      input.disabled = !enabledInput?.checked;
    });

    enabledInput?.addEventListener('change', () => {
      if (!availabilityPayload.weekly[dayLabel]) {
        availabilityPayload.weekly[dayLabel] = { enabled: false, ranges: [] };
      }
      availabilityPayload.weekly[dayLabel].enabled = enabledInput.checked;
      renderAvailabilityEditor();
      if (slotState.modalWeekday === dayLabel) {
        renderSlotModal();
      }
    });

    rangeInputs.forEach((input) => {
      input.addEventListener('change', () => {
        availabilityPayload.weekly[dayLabel] = {
          enabled: enabledInput?.checked || false,
          ranges: Array.from(row.querySelectorAll('[data-range]')).map((range) => ({
            start: range.querySelector('[data-range-start]')?.value || '',
            end: range.querySelector('[data-range-end]')?.value || ''
          }))
        };
        if (slotState.modalWeekday === dayLabel) {
          renderSlotModal();
        }
      });
    });

    slotButton?.addEventListener('click', () => openSlotModal(dayLabel));
  });
}

function renderExceptions() {
  dom.exceptionList.innerHTML = availabilityPayload.exceptions?.length
    ? availabilityPayload.exceptions
        .map(
          (exception, index) => `
            <li class="exception-row">
              <div>
                <strong>${exception.date}</strong>
                <span>
                  ${exception.closed ? 'Giornata esclusa' : `${exception.start || '--:--'} - ${exception.end || '--:--'}`}
                </span>
              </div>
              <button type="button" class="ghost-button" data-remove-exception="${index}">Rimuovi</button>
            </li>
          `
        )
        .join('')
    : '<li class="muted-text">Nessuna eccezione impostata.</li>';

  dom.exceptionList.querySelectorAll('[data-remove-exception]').forEach((button) => {
    button.addEventListener('click', () => {
      availabilityPayload.exceptions.splice(Number(button.dataset.removeException), 1);
      renderExceptions();
    });
  });
}

function populateSpecialistSelect() {
  dom.specialistSelect.innerHTML = specialists
    .map((specialist) => `<option value="${specialist.id}">${specialist.name}</option>`)
    .join('');

  if (specialists.length && !getSelectedSpecialistId()) {
    dom.specialistSelect.value = specialists[0].id;
  }
}

function populateBookingFilter() {
  const selected = dom.bookingFilter.value || 'all';
  dom.bookingFilter.innerHTML = [
    '<option value="all">Tutti</option>',
    ...specialists.map((specialist) => `<option value="${specialist.name}">${specialist.name}</option>`)
  ].join('');
  dom.bookingFilter.value = selected;
}

async function loadDashboardData() {
  const specialistData = await request('/api/specialists');

  specialists = specialistData.specialists || specialistData;

  populateSpecialistSelect();
  populateBookingFilter();
  await loadBookings();
  await loadAvailabilityForSelectedSpecialist();
}

async function loadBookings() {
  const query = new URLSearchParams();
  const specialistName = dom.bookingFilter.value || 'all';

  if (specialistName !== 'all') {
    const specialist = specialists.find((item) => item.name === specialistName);
    if (specialist) query.set('specialistId', String(specialist.id));
  }

  const queryString = query.toString();
  const bookingData = await request(`/api/admin/bookings${queryString ? `?${queryString}` : ''}`);
  bookings = bookingData.bookings || bookingData;
  renderBookingRows(specialistName);
}

async function loadAvailabilityForSelectedSpecialist() {
  const specialistId = getSelectedSpecialistId();
  if (!specialistId) return;

  const payload = await request(`/api/admin/availability/${specialistId}`, { token });
  availabilityPayload = {
    weekly: payload.availability || {},
    exceptions: payload.exceptions || []
  };

  slotState.specialistId = specialistId;
  slotState.blockedByWeekday = groupBlockedSlots(payload.blocked_slots || {});
  slotState.modalWeekday = null;
  slotState.selectedSlot = null;

  dom.slotInterval.value = String(payload.slot_interval_minutes || 30);

  renderAvailabilityEditor();
  renderExceptions();
}

async function saveAvailability() {
  const specialistId = getSelectedSpecialistId();
  if (!specialistId) return;

  dom.availabilitySave.disabled = true;
  dom.availabilityStatus.textContent = 'Salvataggio in corso...';

  const blockedSlots = Object.entries(slotState.blockedByWeekday).flatMap(([weekday, slots]) =>
    slots.map((slot_time) => ({ weekday, slot_time }))
  );

  try {
    await request(`/api/admin/availability/${specialistId}`, {
      method: 'PUT',
      body: {
        weekly: weekdays.flatMap((day) => {
          const config = availabilityPayload.weekly?.[day.label];
          if (!config?.enabled) return [];
          return (config.ranges || [])
            .filter((range) => range.start && range.end)
            .map((range) => ({
              weekday: day.value,
              start_time: range.start,
              end_time: range.end
            }));
        }),
        exceptions: (availabilityPayload.exceptions || []).map((item) => ({
          date: item.date,
          start_time: item.start || '',
          end_time: item.end || '',
          is_closed: item.closed,
          note: item.note || ''
        })),
        blocked_slots: blockedSlots,
        slot_interval_minutes: getCurrentInterval()
      }
    });
    dom.availabilityStatus.textContent = 'Disponibilita aggiornata correttamente.';
  } catch (error) {
    dom.availabilityStatus.textContent = error.message;
  } finally {
    dom.availabilitySave.disabled = false;
  }
}

function attachBookingStatusHandlers() {
  dom.bookingRows.addEventListener('change', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement) || !target.dataset.bookingStatus) return;

    try {
      if (target.value === 'delete') {
        await request(`/api/admin/bookings/${target.dataset.bookingStatus}`, {
          method: 'DELETE'
        });
        bookings = bookings.filter((item) => item.id !== Number(target.dataset.bookingStatus));
        renderBookingRows(dom.bookingFilter.value);
        return;
      }

      await request(`/api/admin/bookings/${target.dataset.bookingStatus}/status`, {
        method: 'PATCH',
        body: { status: target.value }
      });
      const booking = bookings.find((item) => item.id === Number(target.dataset.bookingStatus));
      if (booking) booking.status = target.value;
      renderBookingRows(dom.bookingFilter.value);
    } catch (error) {
      target.value = bookings.find((item) => item.id === Number(target.dataset.bookingStatus))?.status || 'confirmed';
      alert(error.message);
    }
  });
}

function setupEvents() {
  dom.loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(dom.loginForm);

    try {
      const response = await request('/api/admin/login', {
        method: 'POST',
        body: {
          username: formData.get('username'),
          password: formData.get('password')
        }
      });
      token = response.token;
      localStorage.setItem(storageKey, token);
      dom.loginError.textContent = '';
      await initDashboard();
    } catch (error) {
      dom.loginError.textContent = error.message;
    }
  });

  dom.bookingFilter?.addEventListener('change', loadBookings);
  dom.bookingStatusFilter?.addEventListener('change', () => renderBookingRows(dom.bookingFilter.value));
  dom.specialistSelect?.addEventListener('change', loadAvailabilityForSelectedSpecialist);
  dom.slotInterval?.addEventListener('change', () => {
    renderAvailabilityEditor();
    if (slotState.modalWeekday) {
      renderSlotModal();
    }
  });

  dom.exceptionForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(dom.exceptionForm);

    const dates = expandDateRange(
      `${formData.get('exceptionStartDate') || ''}`.trim(),
      `${formData.get('exceptionEndDate') || ''}`.trim()
    );

    const exception = {
      start: formData.get('exceptionStart') || '',
      end: formData.get('exceptionEnd') || '',
      closed: !formData.get('exceptionStart') && !formData.get('exceptionEnd'),
      note: ''
    };

    if (!dates.length) {
      dom.availabilityStatus.textContent = 'Inserisci un giorno o un periodo valido per aggiungere un\'eccezione.';
      return;
    }

    dates.forEach((date) => availabilityPayload.exceptions.push({ ...exception, date }));
    dom.exceptionForm.reset();
    renderExceptions();
    dom.availabilityStatus.textContent = 'Eccezione aggiunta. Ricordati di salvare.';
  });

  dom.availabilitySave?.addEventListener('click', saveAvailability);
  dom.slotToggle?.addEventListener('click', toggleSelectedSlotState);
  dom.logout?.addEventListener('click', logoutToLogin);
  dom.closeSlotModal.forEach((button) => button.addEventListener('click', closeSlotModal));
  dom.slotModal?.addEventListener('click', (event) => {
    if (event.target === dom.slotModal) {
      closeSlotModal();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !dom.slotModal?.hasAttribute('hidden')) {
      closeSlotModal();
    }
  });

  attachBookingStatusHandlers();
}

async function initDashboard() {
  if (!token) {
    dom.loginPanel.hidden = false;
    dom.dashboardPanel.hidden = true;
    dom.loginPanel.classList.remove('is-hidden');
    dom.dashboardPanel.classList.add('is-hidden');
    return;
  }

  try {
    await loadDashboardData();
    dom.loginPanel.hidden = true;
    dom.dashboardPanel.hidden = false;
    dom.loginPanel.classList.add('is-hidden');
    dom.dashboardPanel.classList.remove('is-hidden');
    setupReveal();
  } catch (error) {
    if (error.message === 'Sessione non valida') {
      clearToken();
      token = null;
      dom.loginPanel.hidden = false;
      dom.dashboardPanel.hidden = true;
      dom.loginPanel.classList.remove('is-hidden');
      dom.dashboardPanel.classList.add('is-hidden');
      return;
    }
    throw error;
  }
}

setupEvents();
initDashboard();
