import ModalPanel from './ModalPanel';
import CarList from './CarList';
import { CARS } from '@/lib/carCatalog';
import { distanceMeters } from '@/lib/buildingCollision';

// Read-only list of owned cars and where they are. To bring one to you, use
// the phone (Tab) while on foot, or move one to the dealership lot from the
// dealership.
export default function GaragePanel({ owned, fleet, playerPos, onClose }) {
  const cars = CARS.filter((c) => owned.includes(c.id));

  function statusFor(car) {
    const out = fleet.find((f) => f.carId === car.id);
    if (!out) return { label: 'At dealership' };
    if (out.inUse) return { label: 'Driving' };
    if (!playerPos) return { label: 'Parked' };
    return { label: 'Parked · ' + formatDistance(distanceMeters(playerPos.lng, playerPos.lat, out.lng, out.lat)) };
  }

  return (
    <ModalPanel
      title="My cars"
      subtitle={
        cars.length === 0
          ? 'No cars yet — get one at the dealership'
          : cars.length + (cars.length === 1 ? ' car' : ' cars') + ' owned · collect or move cars at the dealership'
      }
      onClose={onClose}
    >
      <CarList cars={cars} actionFor={statusFor} />
    </ModalPanel>
  );
}

function formatDistance(m) {
  if (m < 20) return 'here';
  if (m < 1000) return Math.round(m / 10) * 10 + ' m away';
  return (m / 1000).toFixed(1) + ' km away';
}
