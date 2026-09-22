import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { PrivacyShield } from '@/components/ui/PrivacyShield';
import { ThemeProvider, useTheme } from '@/lib/ThemeContext';
import { WorkspaceProvider } from '@/lib/WorkspaceContext';

export { ErrorBoundary } from 'expo-router';

// No custom font is loaded: the app uses the system face everywhere, so there
// is nothing to wait for before the first render.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  // ThemeProvider wraps everything, so the navigator itself can follow the
  // active palette. Split into an inner component because the navigator needs
  // to read the theme, and a provider cannot consume its own context.
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <WorkspaceProvider>
          <Shell />
        </WorkspaceProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function Shell() {
  const { palette, scheme } = useTheme();

  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
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
          contentStyle: { backgroundColor: palette.bg },
        }}
      >
        <Stack.Screen name="(tabs)" />
      </Stack>
      {/*
       * Last, so it draws over every screen and any sheet pushed on top of
       * them. A cover that something else can render above is not a cover.
       */}
      <PrivacyShield />
    </>
  );
}
