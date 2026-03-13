import { ensureAuthenticated, logoutToLogin, request, setupReveal } from '/admin-shared.js';

if (ensureAuthenticated()) {
  setupReveal();
  const form = document.querySelector('[data-specialist-form]');
  const table = document.querySelector('[data-specialists-table]');
  document.querySelector('[data-logout]')?.addEventListener('click', logoutToLogin);
  document.querySelector('[data-reset-specialist]').addEventListener('click', () => form.reset());
  form.addEventListener('submit', saveSpecialist);
  loadSpecialists();

  async function loadSpecialists() {
    const dashboard = await request('/api/admin/dashboard');
    table.innerHTML = dashboard.specialists.map((specialist) => `
      <tr>
        <td><strong>${specialist.name}</strong><br><small>${specialist.specialization}</small></td>
        <td>${specialist.role}</td>
        <td>${specialist.slot_interval_minutes || 30} min</td>
        <td>${specialist.active ? 'Attivo' : 'Pausa'}</td>
        <td class="table-actions">
          <button class="icon-btn" type="button" data-edit-specialist="${specialist.id}">Modifica</button>
          <button class="icon-btn danger" type="button" data-delete-specialist="${specialist.id}">Elimina</button>
        </td>
      </tr>
    `).join('');

    table.querySelectorAll('[data-edit-specialist]').forEach((button) => {
      button.addEventListener('click', () => {
        const specialist = dashboard.specialists.find((item) => item.id === Number(button.dataset.editSpecialist));
        form.elements.id.value = specialist.id;
        form.elements.name.value = specialist.name;
        form.elements.role.value = specialist.role;
        form.elements.specialization.value = specialist.specialization;
        form.elements.avatar.value = specialist.avatar;
        form.elements.bio.value = specialist.bio;
        form.elements.active.checked = Boolean(specialist.active);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });

    table.querySelectorAll('[data-delete-specialist]').forEach((button) => {
      button.addEventListener('click', async () => {
        await request(`/api/admin/specialists/${button.dataset.deleteSpecialist}`, { method: 'DELETE' });
        await loadSpecialists();
      });
    });
  }

  async function saveSpecialist(event) {
    event.preventDefault();
    const formData = new FormData(form);
    const payload = {
      name: formData.get('name').trim(),
      role: formData.get('role').trim(),
      specialization: formData.get('specialization').trim(),
      avatar: formData.get('avatar').trim(),
      bio: formData.get('bio').trim(),
      active: form.elements.active.checked
    };
    const id = formData.get('id');
    if (id) {
      await request(`/api/admin/specialists/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    } else {
      await request('/api/admin/specialists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    }
    form.reset();
    await loadSpecialists();
  }
}
