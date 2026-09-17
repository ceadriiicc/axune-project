import { DemoPairing } from '@/components/demo/DemoPairing';
import { demoPairingPayload } from '@/components/demo/homeFixtures';
export default function DemoPairRoute() {
  return <DemoPairing payload={demoPairingPayload} />;
}
