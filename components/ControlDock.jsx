// Bottom-left stack of map controls. Children are laid out bottom-up with
// even spacing, so nothing needs a hard-coded offset.

import styles from './ControlDock.module.css';

export default function ControlDock({ children }) {
  return <div className={styles.dock}>{children}</div>;
}
