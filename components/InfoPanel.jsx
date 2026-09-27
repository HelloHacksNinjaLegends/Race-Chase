import styles from './InfoPanel.module.css';

/**
 * Slide-in panel showing details for the currently selected building.
 * `building` is null when nothing is selected, or
 * { title, height, minHeight, type, coords } (all pre-formatted strings).
 */
export default function InfoPanel({ building, onClose }) {
  const open = Boolean(building);

  return (
    <div
      className={'panel ' + styles.panelWrap + (open ? ' ' + styles.open : '')}
      role="region"
      aria-label="Building details"
    >
      <button className={styles.close} onClick={onClose} aria-label="Close">
        &times;
      </button>
      <p className={styles.eyebrow}>Selected building</p>
      <h2 className={styles.title}>{building ? building.title : '—'}</h2>
      <div className={styles.statRow}>
        <span className={styles.k}>Height</span>
        <span className={'mono ' + styles.v}>{building ? building.height : '—'}</span>
      </div>
      <div className={styles.statRow}>
        <span className={styles.k}>Base elevation</span>
        <span className={'mono ' + styles.v}>{building ? building.minHeight : '—'}</span>
      </div>
      <div className={styles.statRow}>
        <span className={styles.k}>Type</span>
        <span className={styles.v}>{building ? building.type : '—'}</span>
      </div>
      <div className={styles.statRow}>
        <span className={styles.k}>Coordinates</span>
        <span className={'mono ' + styles.v}>{building ? building.coords : '—'}</span>
      </div>
    </div>
  );
}
