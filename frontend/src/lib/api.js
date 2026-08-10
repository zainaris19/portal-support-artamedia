import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API_BASE = `${BACKEND_URL}/api`;

const api = axios.create({
  baseURL: API_BASE,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('noc_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401 && !err.config?.url?.includes('/auth/login')) {
      localStorage.removeItem('noc_token');
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

export function formatApiError(err) {
  const detail = err?.response?.data?.detail;
  if (!detail) return err?.message || 'Terjadi kesalahan';
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail))
    return detail.map((e) => (e && typeof e.msg === 'string' ? e.msg : JSON.stringify(e))).join(' ');
  return String(detail);
}

export default api;
