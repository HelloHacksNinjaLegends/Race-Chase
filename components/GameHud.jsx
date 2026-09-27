// Minimal drive-mode HUD: speed, plus a quiet caption with the time of day.
// A contextual prompt ("Press F to drive…") appears above it only when
// there's something to act on, and a short controls hint fades out after
// the first few seconds of a drive. Purely presentational.

import styles from './GameHud.module.css';

const TIME_LABELS = { dawn: 'Dawn', day: 'Day', dusk: 'Dusk', night: 'Night' };

export default function GameHud({ speedKmh, altitudeM, onFoot, timeOfDay, prompt, warning, showControls }) {
  const flying = altitudeM != null;
  return (
    <div className={styles.hud} role="status">
      {(warning || prompt) && (
        <div className={'panel ' + styles.prompt + (warning ? ' ' + styles.warning : '')}>{warning || prompt}</div>
      )}
      <div className={'panel ' + styles.readout}>
        <span className={styles.speed}>{speedKmh}</span>
        <span className={styles.unit}>km/h{flying ? ' · ' + altitudeM + ' m alt' : ''}</span>
        <span className={styles.caption}>{TIME_LABELS[timeOfDay] || ''}</span>
      </div>
      <p className={styles.controls + (showControls ? '' : ' ' + styles.faded)} aria-hidden={!showControls}>
        {flying ? (
          <>
            <kbd>W</kbd>
            <kbd>S</kbd> pitch · <kbd>A</kbd>
            <kbd>D</kbd> yaw · <kbd>E</kbd>/<kbd>Q</kbd> hold to climb/descend · tap <kbd>E</kbd> to exit ·{' '}
          </>
        ) : (
          <>
            <kbd>W</kbd>
            <kbd>A</kbd>
            <kbd>S</kbd>
            <kbd>D</kbd> {onFoot ? 'walk' : 'drive'} · <kbd>E</kbd> {onFoot ? 'interact' : 'get out'} ·{' '}
            {onFoot && (
              <>
                <kbd>Tab</kbd> phone ·{' '}
              </>
            )}
          </>
        )}
        drag/scroll: look around while stopped · <kbd>T</kbd> time of day · <kbd>H</kbd> hide HUD · <kbd>Esc</kbd> exit
      </p>
    </div>
  );
}
