import { DemoChangeReview } from '@/components/demo/DemoChangeReview';
import { demoChangeSet } from '@/components/demo/homeFixtures';
export default function DemoReviewRoute() {
  return <DemoChangeReview result={demoChangeSet} />;
}
