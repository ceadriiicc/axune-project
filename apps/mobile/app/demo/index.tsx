import { DemoHome } from '@/components/demo/DemoHome';
import {
  demoActivity,
  demoAgents,
  demoBranches,
  demoHistory,
  demoLiveRun,
  demoProject,
} from '@/components/demo/homeFixtures';

/** Isolated Home concept. Fixtures are typed real Axune shapes and never reach production routes. */
export default function DemoRoute() {
  return (
    <DemoHome
      project={demoProject}
      agents={demoAgents}
      live={demoLiveRun}
      history={demoHistory}
      activity={demoActivity}
      branches={demoBranches}
    />
  );
}
