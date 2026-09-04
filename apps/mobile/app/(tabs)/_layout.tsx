import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';

import { color } from '@/constants/theme';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.claudeText,
        tabBarInactiveTintColor: '#d6dde5',
        tabBarStyle: {
          backgroundColor: '#0d1218',
          borderTopColor: color.line,
        },
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
      <Tabs.Screen
        name="workspace"
        options={{
          title: 'Workspace',
          tabBarIcon: ({ color: c, size }) => <Ionicons name="grid" size={size} color={c} />,
        }}
      />
      <Tabs.Screen
        name="insights"
        options={{
          title: 'Insights',
          tabBarIcon: ({ color: c, size }) => <Ionicons name="git-compare" size={size} color={c} />,
        }}
      />
    </Tabs>
  );
}
