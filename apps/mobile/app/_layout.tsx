import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { color } from '@/constants/theme';
import { WorkspaceProvider } from '@/lib/WorkspaceContext';

export { ErrorBoundary } from 'expo-router';

// No custom font is loaded: the app uses the system face everywhere, so there
// is nothing to wait for before the first render.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  return (
    <WorkspaceProvider>
      <StatusBar style="light" />
      {/*
       * Theming is set directly on the navigator rather than through
       * react-navigation's ThemeProvider: as of SDK 56 expo-router no longer
       * works alongside react-navigation, and importing from it breaks the
       * bundle. contentStyle keeps the dark ground behind every screen so
       * pushes never flash white.
       */}
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: color.bg },
        }}
      >
        <Stack.Screen name="(tabs)" />
      </Stack>
    </WorkspaceProvider>
  );
}
