import { DemoSessions } from '@/components/demo/DemoSessions';
import { demoThreads } from '@/components/demo/homeFixtures';
export default function DemoSessionsRoute() {
  return <DemoSessions threads={demoThreads} />;
}
