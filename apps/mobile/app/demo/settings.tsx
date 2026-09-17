import { DemoSettings } from '@/components/demo/DemoSettings';
import { demoCapability, demoMachine, demoProject } from '@/components/demo/homeFixtures';
export default function DemoSettingsRoute() {
  return <DemoSettings machine={demoMachine} project={demoProject} capability={demoCapability} />;
}
