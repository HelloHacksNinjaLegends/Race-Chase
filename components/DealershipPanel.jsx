import ModalPanel from './ModalPanel';
import CarList from './CarList';
import { CARS } from '@/lib/carCatalog';
import { DEALERSHIP_NAME } from '@/lib/dealership';
import { formatCash } from '@/lib/economy';

// The only way to get a car: anything obtained here is parked on the lot
// next to the dealership. Owned cars can be brought back to the lot too.
export default function DealershipPanel({ cash, owned, fleet, onBuy, onMoveToLot, onClose }) {
  function actionFor(car) {
    if (owned.includes(car.id)) {
      const out = fleet.find((f) => f.carId === car.id);
      return out
        ? { label: 'Move to lot', onClick: () => onMoveToLot(car.id) }
        : { label: 'Collect', primary: true, onClick: () => onMoveToLot(car.id) };
    }
    const affordable = cash >= car.price;
    return {
      label: car.price === 0 ? 'Get free' : formatCash(car.price),
      primary: affordable,
      disabled: !affordable,
      onClick: () => onBuy(car)
    };
  }

  return (
    <ModalPanel
      title={DEALERSHIP_NAME}
      subtitle={'You have ' + formatCash(cash) + ' · cars are parked on the lot outside'}
      onClose={onClose}
      footer="Brand names are flavor text — every car here is a generic model."
    >
      <CarList cars={CARS} actionFor={actionFor} />
    </ModalPanel>
  );
}
