import ModalPanel from './ModalPanel';
import CarList from './CarList';
import { CARS } from '@/lib/carCatalog';
import { PLANES } from '@/lib/planeCatalog';

// Summon a vehicle to wherever the player is standing.
//
// Cars: any other owned car currently out in the world is parked back at
// the dealership lot first, so summoning never leaves duplicate cars
// littering the map. This is a convenience for calling up a car you already
// own — it is not a way to get new cars; those still only come from the
// dealership.
//
// Planes/jets: always listed (there's no "owning" one — they're a fixed
// set), and summonable from anywhere, not just the airport — unlike cars,
// summoning one never touches any other vehicle.
//
// The phone deliberately shows a short, curated list rather than every
// vehicle: the base car and the Lamborghini (if owned), the helicopter (if
// owned), and one representative plane and one private jet — not all 3
// Skyrunner 320s / both Skyrunner Execs, which are otherwise-identical
// duplicates in this list (they only matter as distinct physical airport
// parking spots, not as separate summon choices).
const PHONE_CAR_IDS = ['starter', 'lamborghini', 'chopper'];

export default function PhonePanel({ owned, onSummon, onSummonPlane, onClose }) {
  const cars = CARS.filter((c) => owned.includes(c.id) && PHONE_CAR_IDS.includes(c.id));
  const plane = PLANES.find((p) => p.model === 'plane');
  const jet = PLANES.find((p) => p.model === 'pj');
  const vehicles = [...cars, ...(plane ? [plane] : []), ...(jet ? [jet] : [])];

  function actionFor(vehicle) {
    const summon = vehicle.kind === 'car' ? onSummon : onSummonPlane;
    return { label: 'Summon', primary: true, onClick: () => summon(vehicle.id) };
  }

  return (
    <ModalPanel title="Phone" subtitle="Summon a vehicle to your location" onClose={onClose}>
      <CarList cars={vehicles} actionFor={actionFor} />
    </ModalPanel>
  );
}
