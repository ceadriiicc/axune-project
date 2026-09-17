import { DemoAgents } from '@/components/demo/DemoAgents';
import { demoAgents, demoCapability } from '@/components/demo/homeFixtures';
export default function DemoAgentsRoute() {
  return <DemoAgents agents={demoAgents} capability={demoCapability} />;
}
