import styles from './GarageButton.module.css';
import { formatCash } from '@/lib/economy';

// Also shows the player's cash, so it's visible outside play mode.
export default function GarageButton({ cash, onClick }) {
  return (
    <button type="button" className="panel ui-button" onClick={onClick}>
      <span className={styles.cash}>{formatCash(cash)}</span>
      <span className={styles.divider} aria-hidden="true" />
      Garage <kbd className="kbd">G</kbd>
    </button>
  );
}
