import ModalPanel from './ModalPanel';
import CarList from './CarList';
import { CARS } from '@/lib/carCatalog';

// Summon an owned car to wherever the player is standing. Any other owned
// car currently out in the world is parked back at the dealership lot first,
// so summoning never leaves duplicate cars littering the map. This is a
// convenience for calling up a car you already own — it is not a way to get
// new cars; those still only come from the dealership.
export default function PhonePanel({ owned, onSummon, onClose }) {
  const cars = CARS.filter((c) => owned.includes(c.id));

  function actionFor(car) {
    return { label: 'Summon', primary: true, onClick: () => onSummon(car.id) };
  }

  return (
    <ModalPanel
      title="Phone"
      subtitle={cars.length === 0 ? 'No cars yet — get one at the dealership' : 'Summon a car to your location'}
      onClose={onClose}
    >
      <CarList cars={cars} actionFor={actionFor} />
    </ModalPanel>
  );
}
