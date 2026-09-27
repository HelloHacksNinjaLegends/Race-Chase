// A list of cars with their stats and one action button each. Shared by the
// dealership and garage panels, which decide what the button says and does.

import styles from './CarList.module.css';
import { toKmh, zeroToHundred } from '@/lib/carCatalog';

/**
 * @param {object[]} props.cars
 * @param {(car) => {label: string, onClick?: () => void, disabled?: boolean, primary?: boolean}} props.actionFor
 */
export default function CarList({ cars, actionFor }) {
  return (
    <ul className={styles.list}>
      {cars.map((car) => {
        const action = actionFor(car);
        return (
          <li key={car.id} className={styles.row}>
            <span className={styles.swatch} style={{ background: car.color }} aria-hidden="true" />
            <div className={styles.info}>
              {car.brand && <span className={styles.brand}>{car.brand}</span>}
              <span className={styles.name}>{car.name}</span>
              <span className={styles.stats}>
                {car.kind === 'helicopter' || car.kind === 'airplane'
                  ? toKmh(car.maxSpeed) + ' km/h top · ' + car.maxAltitude + ' m ceiling'
                  : toKmh(car.maxSpeed) + ' km/h top · 0–100 in ' + zeroToHundred(car).toFixed(1) + ' s'}
              </span>
            </div>
            <button
              type="button"
              className={styles.action + (action.primary ? ' ' + styles.primary : '')}
              onClick={action.onClick}
              disabled={action.disabled || !action.onClick}
            >
              {action.label}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
