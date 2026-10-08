/**
 * CORE API CLIENT MODULE
 * -----------------------------------------------------------------------------
 * What this module does:
 *   Centralized HTTP client and API endpoint registry for all backend communication.
 *   Enforces cookie credentials, JSON headers, and consistent error handling.
 *
 * Screen(s) owned:
 *   Supports all features calling backend endpoints (/api/*).
 *
 * Depends on:
 *   None (standard fetch API).
 * -----------------------------------------------------------------------------
 */

export const ENDPOINTS = {
  ME: '/api/me',
  LOGIN: '/api/auth/login',
  REGISTER: '/api/auth/register',
  LOGOUT: '/api/auth/logout',
  PROFILE: '/api/profile',
  LOG_DATE: (date) => `/api/log/${encodeURIComponent(date)}`,
  LOG_WATER: '/api/log/today/water',
  LOG_ENTRY: '/api/log/today/entry',
  PANTRY: '/api/pantry',
  RECIPES: '/api/recipes',
  RECIPE_BY_ID: (id) => `/api/recipes/${encodeURIComponent(id)}`,
  SCAN_IMAGE: '/api/scan-image',
  MEAL_PREP: '/api/mealprep',
  CLEANER_ALTERNATIVES: '/api/cleaner-alternatives',
  ADMIN_USERS: '/api/admin/users',
  ADMIN_USER_BY_ID: (id) => `/api/admin/users/${encodeURIComponent(id)}`,
  ADMIN_RESET_PASSWORD: (id) => `/api/admin/users/${encodeURIComponent(id)}/reset-password`,
  ADMIN_USER_STATUS: (id) => `/api/admin/users/${encodeURIComponent(id)}`
};

export async function apiFetch(url, options = {}) {
  const defaultOptions = {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  };

  const merged = { ...defaultOptions, ...options };
  // If no body and method is GET/HEAD, delete Content-Type header
  if (!merged.body && (!merged.method || merged.method.toUpperCase() === 'GET')) {
    delete merged.headers['Content-Type'];
  }

  const response = await fetch(url, merged);
  return response;
}

// Concrete endpoint helpers
export const api = {
  getMe: () => apiFetch(ENDPOINTS.ME),
  login: (credentials) => apiFetch(ENDPOINTS.LOGIN, { method: 'POST', body: JSON.stringify(credentials) }),
  register: (payload) => apiFetch(ENDPOINTS.REGISTER, { method: 'POST', body: JSON.stringify(payload) }),
  logout: () => apiFetch(ENDPOINTS.LOGOUT, { method: 'POST' }),
  getProfile: () => apiFetch(ENDPOINTS.PROFILE),
  updateProfile: (profile) => apiFetch(ENDPOINTS.PROFILE, { method: 'PUT', body: JSON.stringify(profile) }),
  getDailyLog: (date) => apiFetch(ENDPOINTS.LOG_DATE(date)),
  logWater: (water) => apiFetch(ENDPOINTS.LOG_WATER, { method: 'POST', body: JSON.stringify({ water }) }),
  logMealEntry: (entry) => apiFetch(ENDPOINTS.LOG_ENTRY, { method: 'POST', body: JSON.stringify(entry) }),
  getPantry: () => apiFetch(ENDPOINTS.PANTRY),
  updatePantry: (items) => apiFetch(ENDPOINTS.PANTRY, { method: 'PUT', body: JSON.stringify({ items }) }),
  getRecipes: () => apiFetch(ENDPOINTS.RECIPES),
  createRecipe: (recipe) => apiFetch(ENDPOINTS.RECIPES, { method: 'POST', body: JSON.stringify(recipe) }),
  deleteRecipe: (id) => apiFetch(ENDPOINTS.RECIPE_BY_ID(id), { method: 'DELETE' }),
  scanMealImage: (image, userNote = '') => apiFetch(ENDPOINTS.SCAN_IMAGE, {
    method: 'POST',
    body: JSON.stringify({ image, userNote })
  }),
  generateMealPrep: (payload) => apiFetch(ENDPOINTS.MEAL_PREP, {
    method: 'POST',
    body: JSON.stringify(payload)
  }),
  getCleanerAlternatives: (payload) => apiFetch(ENDPOINTS.CLEANER_ALTERNATIVES, {
    method: 'POST',
    body: JSON.stringify(payload)
  }),
  getAdminUsers: () => apiFetch(ENDPOINTS.ADMIN_USERS),
  resetAdminUserPassword: (id) => apiFetch(ENDPOINTS.ADMIN_RESET_PASSWORD(id), { method: 'POST' }),
  setAdminUserStatus: (id, status) => apiFetch(ENDPOINTS.ADMIN_USER_STATUS(id), {
    method: 'PUT',
    body: JSON.stringify({ status })
  })
};

export default api;
