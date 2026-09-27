'use client';

// Dev-only cheat: adds cash. Shown under `npm run dev`, or in a production
// build when the URL has ?dev (e.g. http://localhost:3000/?dev).

import { useEffect, useState } from 'react';

import styles from './DevCashButton.module.css';

const GRANT_AMOUNT = 10000;

export default function DevCashButton({ onGrant }) {
  const [enabled, setEnabled] = useState(process.env.NODE_ENV !== 'production');

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('dev')) setEnabled(true);
  }, []);

  if (!enabled) return null;
  return (
    <button type="button" className={'panel ui-button ' + styles.dev} onClick={() => onGrant(GRANT_AMOUNT)}>
      <span className={styles.tag}>DEV</span> +${GRANT_AMOUNT.toLocaleString('en-US')}
    </button>
  );
}
