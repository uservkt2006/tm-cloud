// i18n — vi/en, hook useT(key)
import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'tmc_lang';
const translations = {
  vi: {
    // App
    'app.title': 'TM Cloud',
    'app.logout': 'Đăng xuất',
    'app.search': 'Tìm kiếm…',

    // Sidebar
    'nav.dashboard': 'Dashboard',
    'nav.accounts': 'Accounts',
    'nav.activities': 'Hoạt động',
    'nav.conflicts': 'Xung đột',
    'nav.logs': 'Logs',
    'nav.settings': 'Cài đặt',
    'nav.soon': 'sắp có',

    // Top bar
    'top.search_accounts': 'Tìm account…',
    'top.notifications': 'Thông báo',

    // Dashboard
    'dash.title': 'Dashboard',
    'dash.providers': 'Providers',
    'dash.storage_used': 'Storage dùng',
    'dash.syncing': 'Đang đồng bộ',
    'dash.sync_24h': 'Sync 24h',
    'dash.cloud_accounts': 'Cloud accounts',
    'dash.total': 'tổng',
    'dash.recent_activity': 'Hoạt động gần đây',
    'dash.no_activity': 'Chưa có hoạt động',
    'dash.idle': 'rảnh',
    'dash.view_activities': 'xem Activities',
    'dash.jobs_run': 'job đã chạy',
    'dash.mounted': 'mounted',

    // Status
    'status.mounted': '● mounted',
    'status.unmounted': '○ unmounted',
    'status.syncing': 'syncing',
    'status.error': 'error',
    'status.idle': 'rảnh',

    // Actions
    'act.sync': 'Sync',
    'act.mount': 'Mount',
    'act.unmount': 'Unmount',
    'act.open_files': 'Mở Files',
    'act.sync_now': 'Đồng bộ ngay',
    'act.delete': 'Xoá',
    'act.cancel': 'Huỷ',
    'act.save': 'Lưu',
    'act.close': 'Đóng',
    'act.ok': 'OK',
    'act.retry': 'Thử lại',

    // Accounts
    'acc.title': 'Accounts',
    'acc.filter.all': 'Tất cả',
    'acc.filter.mounted': 'Mounted',
    'acc.filter.unmounted': 'Unmounted',
    'acc.filter.error': 'Lỗi',
    'acc.add_cloud': 'Thêm cloud',
    'acc.add_first': 'Chưa có cloud account nào',
    'acc.add_first_cta': 'Thêm OneDrive / Google Drive',
    'acc.quota_loading': 'Quota chưa load',
    'acc.details': 'Chi tiết',
    'acc.state': 'Trạng thái',
    'acc.capacity': 'Dung lượng',
    'acc.mount_path': 'Mount path',
    'acc.actions': 'Hành động',
    'acc.deleting_confirm': 'Xoá provider {label}?',

    // Activities
    'act_tab.empty': 'Chưa có hoạt động',
    'act_tab.count': 'Activity log ({n})',

    // Settings
    'set.account': 'Tài khoản',
    'set.sync': 'Đồng bộ',
    'set.preferences': 'Giao diện',
    'set.about': 'Giới thiệu',
    'set.change_password': 'Đổi mật khẩu',
    'set.current_pw': 'Mật khẩu hiện tại',
    'set.new_pw': 'Mật khẩu mới',
    'set.min_6': 'Mật khẩu mới (tối thiểu 6 ký tự)',
    'set.automount': 'Auto-mount khi mở app',
    'set.sync_interval': 'Khoảng đồng bộ nền',
    'set.theme': 'Theme',
    'set.theme.dark': 'Tối (Codex)',
    'set.theme.light': 'Sáng',
    'set.excludes': 'Folder loại trừ',
    'set.about_version': 'Phiên bản',
    'set.about_backend': 'Backend',
    'set.about_mountroot': 'Mount root',
    'set.about_engine': 'Sync engine',
    'set.about_tokens': 'OAuth tokens',

    // Add Provider Dialog
    'add.title': 'Thêm cloud account',
    'add.connecting': 'Đang xác thực...',
    'add.done': '✓ Hoàn tất',
    'add.error': '✗ Lỗi',
    'add.onedrive_hint': 'App sẽ tự mở trình duyệt Microsoft login. Không cần client_id.',
    'add.gdrive_hint': 'Cần OAuth Desktop app riêng. Tạo tại Google Cloud Console → copy client_id + client_secret.',
    'add.client_id': 'Google OAuth client_id',
    'add.client_secret': 'Google OAuth client_secret',
    'add.connect_onedrive': 'Kết nối OneDrive',
    'add.connect_gdrive': 'Kết nối Google Drive →',
    'add.steps_intro': 'Các bước OAuth:',
    'add.step_sudo': 'Yêu cầu mật khẩu sudo (nếu hệ thống hỏi)',
    'add.step_browser': 'Trình duyệt mở → login tài khoản',
    'add.step_login': 'Cho phép app truy cập → đợi token lưu xong',
    'add.done_msg': 'đã kết nối!',
    'add.error_retry': 'Không thể kết nối',

    // Notifications
    'notif.empty': 'Chưa có thông báo',

    // Add provider button (placeholder card)
    'add_card.title': 'Thêm cloud account',
    'add_card.types': 'OneDrive, Google Drive, Dropbox, S3…',

    // Misc
    'misc.and': 'trên',
    'misc.km_ago': 'giờ trước',
    'misc.min_ago': 'phút',
    'misc.day_ago': 'ngày',
    'misc.just_now': 'vừa xong',
    'misc.account': 'Tài khoản admin local',
  },
  en: {
    'app.title': 'TM Cloud',
    'app.logout': 'Log out',
    'app.search': 'Search…',

    'nav.dashboard': 'Dashboard',
    'nav.accounts': 'Accounts',
    'nav.activities': 'Activities',
    'nav.conflicts': 'Conflicts',
    'nav.logs': 'Logs',
    'nav.settings': 'Settings',
    'nav.soon': 'coming soon',

    'top.search_accounts': 'Search accounts…',
    'top.notifications': 'Notifications',

    'dash.title': 'Dashboard',
    'dash.providers': 'Providers',
    'dash.storage_used': 'Storage used',
    'dash.syncing': 'Syncing',
    'dash.sync_24h': 'Sync 24h',
    'dash.cloud_accounts': 'Cloud accounts',
    'dash.total': 'total',
    'dash.recent_activity': 'Recent activity',
    'dash.no_activity': 'No activity yet',
    'dash.idle': 'idle',
    'dash.view_activities': 'see Activities',
    'dash.jobs_run': 'jobs run',
    'dash.mounted': 'mounted',

    'status.mounted': '● mounted',
    'status.unmounted': '○ unmounted',
    'status.syncing': 'syncing',
    'status.error': 'error',
    'status.idle': 'idle',

    'act.sync': 'Sync',
    'act.mount': 'Mount',
    'act.unmount': 'Unmount',
    'act.open_files': 'Open Files',
    'act.sync_now': 'Sync now',
    'act.delete': 'Delete',
    'act.cancel': 'Cancel',
    'act.save': 'Save',
    'act.close': 'Close',
    'act.ok': 'OK',
    'act.retry': 'Retry',

    'acc.title': 'Accounts',
    'acc.filter.all': 'All',
    'acc.filter.mounted': 'Mounted',
    'acc.filter.unmounted': 'Unmounted',
    'acc.filter.error': 'Error',
    'acc.add_cloud': 'Add cloud',
    'acc.add_first': 'No cloud accounts yet',
    'acc.add_first_cta': 'Add OneDrive / Google Drive',
    'acc.quota_loading': 'Quota loading',
    'acc.details': 'Details',
    'acc.state': 'Status',
    'acc.capacity': 'Storage',
    'acc.mount_path': 'Mount path',
    'acc.actions': 'Actions',
    'acc.deleting_confirm': 'Delete provider {label}?',

    'act_tab.empty': 'No activity yet',
    'act_tab.count': 'Activity log ({n})',

    'set.account': 'Account',
    'set.sync': 'Sync',
    'set.preferences': 'Preferences',
    'set.about': 'About',
    'set.change_password': 'Change password',
    'set.current_pw': 'Current password',
    'set.new_pw': 'New password',
    'set.min_6': 'New password (min 6 chars)',
    'set.automount': 'Auto-mount on launch',
    'set.sync_interval': 'Background sync interval',
    'set.theme': 'Theme',
    'set.theme.dark': 'Dark (Codex)',
    'set.theme.light': 'Light',
    'set.excludes': 'Excluded folders',
    'set.about_version': 'Version',
    'set.about_backend': 'Backend',
    'set.about_mountroot': 'Mount root',
    'set.about_engine': 'Sync engine',
    'set.about_tokens': 'OAuth tokens',

    'add.title': 'Add cloud account',
    'add.connecting': 'Authenticating...',
    'add.done': '✓ Done',
    'add.error': '✗ Error',
    'add.onedrive_hint': 'App opens Microsoft browser login automatically. No client_id needed.',
    'add.gdrive_hint': 'Requires a Desktop OAuth app. Create at Google Cloud Console → paste client_id + client_secret.',
    'add.client_id': 'Google OAuth client_id',
    'add.client_secret': 'Google OAuth client_secret',
    'add.connect_onedrive': 'Connect OneDrive',
    'add.connect_gdrive': 'Connect Google Drive →',
    'add.steps_intro': 'OAuth steps:',
    'add.step_sudo': 'Enter sudo password if prompted',
    'add.step_browser': 'Browser opens → log into account',
    'add.step_login': 'Grant app access → wait for token',
    'add.done_msg': 'connected!',
    'add.error_retry': 'Could not connect',

    'notif.empty': 'No notifications',

    'add_card.title': 'Add cloud account',
    'add_card.types': 'OneDrive, Google Drive, Dropbox, S3…',

    'misc.and': 'of',
    'misc.km_ago': 'h ago',
    'misc.min_ago': 'm',
    'misc.day_ago': 'd ago',
    'misc.just_now': 'just now',
    'misc.account': 'Local admin account',
  },
};

let currentLang = localStorage.getItem(STORAGE_KEY) || 'vi';

export function setLang(l) {
  currentLang = l;
  localStorage.setItem(STORAGE_KEY, l);
  // emit event để các component re-render
  window.dispatchEvent(new CustomEvent('tmc-lang-change'));
}

export function getLang() { return currentLang; }

// Simple translation function with {var} interpolation
export function t(key, vars = {}) {
  const dict = translations[currentLang] || translations.vi;
  let s = dict[key] || translations.vi[key] || key;
  for (const [k, v] of Object.entries(vars)) {
    s = s.replaceAll('{' + k + '}', v);
  }
  return s;
}

// React hook — re-render khi lang đổi
export function useT(key, vars) {
  const [, force] = useState(0);
  useEffect(() => {
    const handler = () => force(x => x + 1);
    window.addEventListener('tmc-lang-change', handler);
    return () => window.removeEventListener('tmc-lang-change', handler);
  }, []);
  return t(key, vars);
}

// fmt helpers dùng translations
export function fmtRelI18n(iso) {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return t('misc.just_now');
  if (diff < 3600) return `${Math.floor(diff/60)}${t('misc.min_ago')}`;
  if (diff < 86400) return `${Math.floor(diff/3600)}${t('misc.km_ago')}`;
  return `${Math.floor(diff/86400)}${t('misc.day_ago')}`;
}
