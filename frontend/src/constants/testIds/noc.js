export const AUTH = {
  emailInput: 'login-email-input',
  passwordInput: 'login-password-input',
  submitBtn: 'login-submit-button',
  errorMsg: 'login-error-message',
  logoutBtn: 'logout-button',
};

export const APP = {
  themeToggle: 'theme-toggle-button',
  sidebarToggle: 'sidebar-toggle-button',
  sidebarLink: (key) => `sidebar-link-${key}`,
  globalSearch: 'header-global-search',
  userMenu: 'header-user-menu',
  notifBell: 'header-notifications',
};

export const DASHBOARD = {
  root: 'dashboard-root',
  statCard: (key) => `dashboard-stat-${key}`,
  chart: 'dashboard-chart',
  recent: 'dashboard-recent',
};

export const CRUD = {
  addBtn: (mod) => `${mod}-add-button`,
  editBtn: (mod, id) => `${mod}-edit-${id}`,
  deleteBtn: (mod, id) => `${mod}-delete-${id}`,
  viewBtn: (mod, id) => `${mod}-view-${id}`,
  saveBtn: (mod) => `${mod}-save-button`,
  cancelBtn: (mod) => `${mod}-cancel-button`,
  confirmDelete: (mod) => `${mod}-confirm-delete-button`,
  search: (mod) => `${mod}-search`,
  export: (mod) => `${mod}-export`,
  row: (mod, id) => `${mod}-row-${id}`,
  filterCategory: (mod) => `${mod}-filter-category`,
  filterStatus: (mod) => `${mod}-filter-status`,
  pageNext: (mod) => `${mod}-page-next`,
  pagePrev: (mod) => `${mod}-page-prev`,
  table: (mod) => `${mod}-table`,
};
