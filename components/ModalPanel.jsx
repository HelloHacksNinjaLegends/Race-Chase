'use client';

// Centered overlay card used by the dealership and garage. Esc or the close
// button dismisses it. Esc is caught in the capture phase and stopped, so it
// doesn't also exit play mode.

import { useEffect } from 'react';

import styles from './ModalPanel.module.css';

export default function ModalPanel({ title, subtitle, onClose, children, footer }) {
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.code !== 'Escape') return;
      e.stopImmediatePropagation();
      onClose();
    }
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose]);

  return (
    <div className={'panel ' + styles.modal} role="dialog" aria-label={title}>
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>{title}</h2>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </div>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>
      <div className={styles.body}>{children}</div>
      {footer && <footer className={styles.footer}>{footer}</footer>}
    </div>
  );
}
