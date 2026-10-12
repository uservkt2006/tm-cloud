// Keyboard shortcuts
//   Ctrl+K  — focus search
//   Ctrl+N  — add cloud (emit tmc-shortcut-add event)
//   Ctrl+R  — refresh
//   Ctrl+,  — open settings
//   Ctrl+Q  — quit
//   ?       — show shortcuts help

import { useEffect } from 'react';

const handlers = new Map();

export function useShortcuts(actions) {
  useEffect(() => {
    function onKey(e) {
      const mod = e.ctrlKey || e.metaKey;
      // Ctrl+K — focus search
      if (mod && e.key === 'k') {
        e.preventDefault();
        const input = document.querySelector('input[placeholder*="Tìm"], input[placeholder*="Search"]');
        if (input) input.focus();
      }
      // Ctrl+N — add cloud
      else if (mod && e.key === 'n') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('tmc-shortcut-add'));
      }
      // Ctrl+R — refresh (handled by browser, ignore)
      // Ctrl+, — settings
      else if (mod && e.key === ',') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('tmc-shortcut-settings'));
      }
      // Escape — close top-most modal
      else if (e.key === 'Escape') {
        const overlay = document.querySelector('.fixed.inset-0.bg-black\\/60, .fixed.inset-0.bg-black\\/70, .fixed.inset-0.bg-black\\/80');
        if (overlay) overlay.click();
      }
      // ? — show help
      else if (e.key === '?' && !mod) {
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
        alert([
          'TM Cloud shortcuts:',
          '  Ctrl+K  — focus search',
          '  Ctrl+N  — add cloud account',
          '  Ctrl+,  — settings',
          '  Esc     — close modal',
          '  ?       — show this help',
        ].join('\n'));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions]);
}

export const SHORTCUTS_HELP = [
  { keys: 'Ctrl+K', desc: 'Focus search' },
  { keys: 'Ctrl+N', desc: 'Add cloud account' },
  { keys: 'Ctrl+,', desc: 'Open Settings' },
  { keys: 'Esc', desc: 'Close modal' },
  { keys: '?', desc: 'Show shortcuts help' },
];
