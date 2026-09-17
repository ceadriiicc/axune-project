import { DemoSessionChat } from '@/components/demo/DemoSessionChat';
import { demoLiveRun, demoThreads } from '@/components/demo/homeFixtures';
import type { Thread } from '@/lib/WorkspaceContext';
import { useLocalSearchParams } from 'expo-router';

export default function DemoSessionRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const live: Thread = {
    id: 'live',
    startedAt: demoLiveRun.startedAt ?? Date.now(),
    runs: [demoLiveRun],
  };
  const thread =
    id === 'live' || id === 'new'
      ? live
      : (demoThreads.find((entry) => entry.id === id) ?? demoThreads[0]!);
  return <DemoSessionChat thread={thread} active={id === 'live' || id === 'new'} />;
}
