import { Ionicons } from '@expo/vector-icons';
import { useDemoTheme as useTheme } from './DemoAppearance';
import { usePathname, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

/** Demo-only navigation grows as each concept page is designed. */
export function DemoTabBar() {
  const { palette: color } = useTheme();
  const pathname = usePathname();
  const router = useRouter();
  const styles = useMemo(() => makeStyles(color), [color]);
  const sessions = pathname.startsWith('/demo/sessions');
  const agents = pathname.startsWith('/demo/agents');
  const settings = pathname.startsWith('/demo/settings');

  return (
    <View style={styles.bar}>
      <Tab
        active={!sessions && !agents && !settings}
        icon="home-outline"
        label="Home"
        onPress={() => router.push('/demo')}
        styles={styles}
      />
      <Tab
        active={sessions}
        icon="chatbubbles-outline"
        label="Sessions"
        onPress={() => router.push('/demo/sessions')}
        styles={styles}
      />
      <Tab
        active={agents}
        icon="sparkles-outline"
        label="Agents"
        onPress={() => router.push('/demo/agents')}
        styles={styles}
      />
      <Tab
        active={settings}
        icon="settings-outline"
        label="Settings"
        onPress={() => router.push('/demo/settings')}
        styles={styles}
      />
    </View>
  );
}

function Tab({
  active,
  icon,
  label,
  onPress,
  styles,
}: {
  active: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  const { palette: color } = useTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
      <Ionicons name={icon} size={21} color={active ? color.text : color.textSoft} />
      <Text style={[styles.label, { color: active ? color.text : color.textSoft }]}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (color: ReturnType<typeof useTheme>['palette']) =>
  StyleSheet.create({
    bar: {
      position: 'absolute',
      left: 18,
      right: 18,
      bottom: 18,
      height: 60,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: color.line,
      backgroundColor: color.panel,
      flexDirection: 'row',
      paddingHorizontal: 18,
      alignItems: 'center',
      justifyContent: 'space-around',
    },
    tab: { minWidth: 82, alignItems: 'center', justifyContent: 'center', gap: 3 },
    label: { fontSize: 11, fontWeight: '700' },
    pressed: { opacity: 0.65, transform: [{ scale: 0.97 }] },
  });
