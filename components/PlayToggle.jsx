import styles from './PlayToggle.module.css';

// Starts / leaves play mode (on foot, with cars from the dealership).
export default function PlayToggle({ active, onToggle }) {
  return (
    <button
      type="button"
      className={'panel ui-button' + (active ? ' ' + styles.active : '')}
      onClick={onToggle}
      aria-pressed={active}
    >
      {active ? 'Exit play' : 'Play'} <kbd className="kbd">Enter</kbd>
    </button>
  );
}
