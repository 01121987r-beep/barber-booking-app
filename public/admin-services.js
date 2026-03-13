import { ensureAuthenticated, logoutToLogin, request, setupReveal } from '/admin-shared.js';

if (ensureAuthenticated()) {
  setupReveal();
  const form = document.querySelector('[data-service-form]');
  const table = document.querySelector('[data-services-table]');
  document.querySelector('[data-logout]')?.addEventListener('click', logoutToLogin);
  document.querySelector('[data-reset-service]').addEventListener('click', () => form.reset());
  form.addEventListener('submit', saveService);
  loadServices();

  async function loadServices() {
    const dashboard = await request('/api/admin/dashboard');
    table.innerHTML = dashboard.services.map((service) => `
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

    table.querySelectorAll('[data-edit-service]').forEach((button) => {
      button.addEventListener('click', () => {
        const service = dashboard.services.find((item) => item.id === Number(button.dataset.editService));
        form.elements.id.value = service.id;
        form.elements.name.value = service.name;
        form.elements.price.value = service.price;
        form.elements.duration_minutes.value = service.duration_minutes;
        form.elements.description.value = service.description;
        form.elements.featured.checked = Boolean(service.featured);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });

    table.querySelectorAll('[data-delete-service]').forEach((button) => {
      button.addEventListener('click', async () => {
        await request(`/api/admin/services/${button.dataset.deleteService}`, { method: 'DELETE' });
        await loadServices();
      });
    });
  }

  async function saveService(event) {
    event.preventDefault();
    const formData = new FormData(form);
    const payload = {
      name: formData.get('name').trim(),
      price: Number(formData.get('price')),
      duration_minutes: Number(formData.get('duration_minutes')),
      description: formData.get('description').trim(),
      featured: form.elements.featured.checked
    };
    const id = formData.get('id');
    if (id) {
      await request(`/api/admin/services/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    } else {
      await request('/api/admin/services', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    }
    form.reset();
    await loadServices();
  }
}
