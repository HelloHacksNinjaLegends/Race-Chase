'use client';

import { useState } from 'react';
import styles from './TokenGate.module.css';

/**
 * One-time setup screen asking for a free Mapbox access token.
 * Validation of the token's *shape* happens here (starts with "pk.", etc.);
 * whether Mapbox actually *accepts* it is only known once the map tries to
 * load, so that error is passed back down from the parent as `error`.
 */
export default function TokenGate({ onSubmit, error }) {
  const [value, setValue] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit(value);
  }

  return (
    <div className={styles.gate}>
      <form className={'panel ' + styles.card} onSubmit={handleSubmit}>
        <p className={styles.eyebrow}>One-time setup</p>
        <h1 className={styles.heading}>Paste a Mapbox access token</h1>
        <p className={styles.body}>
          This app uses Mapbox&apos;s building data to draw and let you click real 3D buildings across
          Richmond, Vancouver, and UBC. A free account is enough &mdash; no card required for this level
          of use.
        </p>
        <ol className={styles.steps}>
          <li>
            Open{' '}
            <a href="https://account.mapbox.com/auth/signup/" target="_blank" rel="noopener noreferrer">
              account.mapbox.com
            </a>{' '}
            and create a free account
          </li>
          <li>
            On your account&apos;s main page, copy the <strong>default public token</strong> (starts with{' '}
            <span className="mono">pk.</span>)
          </li>
          <li>Paste it below</li>
        </ol>
        <div className={styles.row}>
          <input
            id="mapbox-token-input"
            className={'mono ' + styles.input}
            type="text"
            placeholder="pk.eyJ1Ijoi..."
            autoComplete="off"
            spellCheck="false"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
          <button type="submit" className={styles.button}>
            Load map
          </button>
        </div>
        {error && <p className={styles.error}>{error}</p>}
      </form>
    </div>
  );
}
