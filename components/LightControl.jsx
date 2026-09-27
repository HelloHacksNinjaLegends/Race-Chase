// Day/night selector: Auto (follows your clock) or a pinned preset.

import styles from './LightControl.module.css';
import { LIGHT_MODES } from '@/lib/lightPreset';

const LABELS = { auto: 'Auto', dawn: 'Dawn', day: 'Day', dusk: 'Dusk', night: 'Night' };

export default function LightControl({ mode, preset, onChange }) {
  return (
    <div className={'panel ' + styles.control} role="radiogroup" aria-label="Time of day">
      {LIGHT_MODES.map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          className={styles.option + (mode === m ? ' ' + styles.selected : '')}
          onClick={() => onChange(m)}
          title={m === 'auto' ? 'Follow your local time (currently ' + LABELS[preset].toLowerCase() + ')' : undefined}
        >
          {LABELS[m]}
          {m === 'auto' && mode === 'auto' && <span className={styles.current}> · {LABELS[preset]}</span>}
        </button>
      ))}
      <kbd className={'kbd ' + styles.key} title="Press T to cycle">
        T
      </kbd>
    </div>
  );
}
