import styles from './Hint.module.css';

export default function Hint({ visible }) {
  return (
    <div className={'panel ' + styles.hint + (visible ? '' : ' ' + styles.hidden)}>
      Click a building to see its details · <kbd className="kbd">Enter</kbd> to play
    </div>
  );
}
