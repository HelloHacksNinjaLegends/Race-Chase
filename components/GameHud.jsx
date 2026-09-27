// Minimal drive-mode HUD: speed, plus a quiet caption with the camera view
// and time of day. A contextual prompt ("Press F to drive…") appears above it
// only when there's something to act on, and a short controls hint fades
// out after the first few seconds of a drive. Purely presentational.

import styles from './GameHud.module.css';

const VIEW_LABELS = { chase: 'Third person', pov: 'Driver view' };
const TIME_LABELS = { dawn: 'Dawn', day: 'Day', dusk: 'Dusk', night: 'Night' };

export default function GameHud({ speedKmh, view, onFoot, timeOfDay, prompt, warning, showControls }) {
  const viewLabel = view === 'pov' && onFoot ? 'First person' : VIEW_LABELS[view] || VIEW_LABELS.chase;
  return (
    <div className={styles.hud} role="status">
      {(warning || prompt) && (
        <div className={'panel ' + styles.prompt + (warning ? ' ' + styles.warning : '')}>{warning || prompt}</div>
      )}
      <div className={'panel ' + styles.readout}>
        <span className={styles.speed}>{speedKmh}</span>
        <span className={styles.unit}>km/h</span>
        <span className={styles.caption}>
          {viewLabel} · {TIME_LABELS[timeOfDay] || ''}
        </span>
      </div>
      <p className={styles.controls + (showControls ? '' : ' ' + styles.faded)} aria-hidden={!showControls}>
        <kbd>W</kbd>
        <kbd>A</kbd>
        <kbd>S</kbd>
        <kbd>D</kbd> {onFoot ? 'walk' : 'drive'} · <kbd>E</kbd> {onFoot ? 'interact' : 'get out'} ·{' '}
        <kbd>C</kbd> camera · <kbd>T</kbd> time of day · <kbd>H</kbd> hide HUD · <kbd>Esc</kbd> exit
      </p>
    </div>
  );
}
