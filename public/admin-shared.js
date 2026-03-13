export const storageKey = 'barber-admin-token';

export function getToken() {
  return localStorage.getItem(storageKey);
}

export function clearToken() {
  localStorage.removeItem(storageKey);
}

export async function logoutToLogin() {
  try {
    await request('/api/admin/logout', { method: 'POST' });
  } catch {
    // ignore logout errors
  }
  clearToken();
  window.location.href = '/admin';
}

export async function request(url, options = {}, includeAuth = true) {
  const headers = { ...(options.headers || {}) };
  let body = options.body;

  if (body && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob) && !(body instanceof ArrayBuffer)) {
    headers['Content-Type'] ||= 'application/json';
    body = JSON.stringify(body);
  }

  if (includeAuth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(url, { ...options, headers, body });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Errore di rete');
  }
  return response.json();
}

export function setupReveal() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) entry.target.classList.add('is-visible');
    });
  }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach((element) => observer.observe(element));
}

export function ensureAuthenticated() {
  const token = getToken();
  if (!token) {
    window.location.href = '/admin';
    return false;
  }
  return true;
}
