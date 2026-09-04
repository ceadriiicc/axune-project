import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { color, radius, spacing } from '@/constants/theme';

interface Props {
  placeholder: string;
  initialValue?: string;
  onSend: (text: string) => void;
}

export function Composer({ placeholder, initialValue = '', onSend }: Props) {
  const [value, setValue] = useState(initialValue);

  React.useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
  };

  return (
    <View style={styles.row}>
      <View style={styles.iconBtn}>
        <Ionicons name="sparkles-outline" size={18} color={color.text} />
      </View>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={setValue}
        placeholder={placeholder}
        placeholderTextColor={color.textSoft}
        onSubmitEditing={handleSend}
        returnKeyType="send"
      />
      <Pressable style={styles.send} onPress={handleSend}>
        <Ionicons name="arrow-up" size={18} color="#0f1b1c" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.line,
  },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    color: color.text,
    fontSize: 15,
  },
  send: {
    width: 42,
    height: 42,
    borderRadius: radius.sm,
    backgroundColor: color.codex,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
