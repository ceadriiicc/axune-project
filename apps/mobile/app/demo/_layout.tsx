import { Stack } from 'expo-router';
import { DemoAppearanceProvider } from '@/components/demo/DemoAppearance';
import { DemoScenarioProvider } from '@/components/demo/DemoScenario';

export default function DemoLayout() {
  return (
    <DemoAppearanceProvider>
      <DemoScenarioProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </DemoScenarioProvider>
    </DemoAppearanceProvider>
  );
}
