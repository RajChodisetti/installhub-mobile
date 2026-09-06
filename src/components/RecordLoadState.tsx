import React from 'react';
import { Text, View } from 'react-native';
import { Button, Card } from './ui';
import { useTheme } from '../context/AppProviders';
import { spacing, typography } from '../theme';

export function RecordLoadState({ title, message, onRetry, onBack, inline = false }: {
  title: string;
  message: string;
  onRetry: () => void;
  onBack: () => void;
  inline?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={inline ? { marginBottom: spacing.md } : { flex: 1, padding: spacing.lg, backgroundColor: colors.background }}>
      <Card accessibilityRole="alert" accessibilityLiveRegion="polite">
        <Text style={[typography.subheading, { color: colors.foreground }]}>{title}</Text>
        <Text style={{ color: colors.mutedForeground, marginTop: spacing.sm, lineHeight: 20 }}>{message}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
          <Button title="Retry" onPress={onRetry} />
          <Button title="Back" variant="secondary" onPress={onBack} />
        </View>
      </Card>
    </View>
  );
}
