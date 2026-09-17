import { Stack } from 'expo-router';
import { DemoAppearanceProvider } from '@/components/demo/DemoAppearance';

export default function DemoLayout() { return <DemoAppearanceProvider><Stack screenOptions={{ headerShown: false }} /></DemoAppearanceProvider>; }
