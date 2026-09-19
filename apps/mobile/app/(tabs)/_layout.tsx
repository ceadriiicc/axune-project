import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';

import { useTheme } from '@/lib/ThemeContext';

export default function TabLayout() {
  const { palette } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.claudeText,
        tabBarInactiveTintColor: palette.textSoft,
        tabBarStyle: {
          backgroundColor: palette.screen,
          borderTopColor: palette.line,
          borderTopWidth: 1,
          height: 68,
          paddingTop: 7,
          paddingBottom: 8,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700', letterSpacing: 0.15 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color: c, size }) => <Ionicons name="home" size={size} color={c} />,
        }}
      />
      <Tabs.Screen
        name="sessions"
        options={{
          title: 'Sessions',
          tabBarIcon: ({ color: c, size }) => <Ionicons name="time" size={size} color={c} />,
        }}
      />
      {/*
        Workspace is no longer a tab. It is still the screen a run is started
        from and is still reached at /workspace - it has simply moved out of
        this group, because starting work belongs with the agent you are
        starting it with rather than in a destination of its own. It retires
        once the session chat can start a run.

        Insights is gone. It held a place for comparing two agents and showed
        nothing invented while only one exists; a permanent tab reading "not yet
        possible" spends a quarter of the navigation on something that cannot
        act. Its promise lives on the Agents page, and comparison earns a tab
        back when there is a second agent.
      */}
      <Tabs.Screen
        name="agents"
        options={{
          title: 'Agents',
          tabBarIcon: ({ color: c, size }) => <Ionicons name="sparkles" size={size} color={c} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color: c, size }) => <Ionicons name="settings" size={size} color={c} />,
        }}
      />
    </Tabs>
  );
}
