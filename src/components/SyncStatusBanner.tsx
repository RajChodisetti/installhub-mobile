import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/AppProviders';
import { useSyncStatus } from '../services/SyncStatusContext';

export function SyncStatusBanner() {
  const { colors } = useTheme();
  const { syncing, progress, retrySync } = useSyncStatus();
  if (!syncing && !['error', 'offline'].includes(progress.phase)) return null;

  const failed = progress.phase === 'error' || progress.phase === 'offline';
  const message = failed
    ? progress.lastError || 'Cloud Backup paused.'
    : progress.phase === 'uploading'
      ? `Backing up evidence ${progress.uploaded}/${progress.total}`
      : 'Backing up Field App Complete data…';

  return (
    <View
      style={[
        styles.banner,
        { backgroundColor: failed ? colors.destructive : colors.reportNavy },
      ]}
    >
      <Text
        numberOfLines={2}
        accessibilityRole={failed ? 'alert' : 'summary'}
        accessibilityLiveRegion={failed ? 'assertive' : 'polite'}
        accessibilityLabel={`Cloud Backup status: ${message}`}
        style={styles.text}
      >
        {message}
      </Text>
      {failed ? (
        <Pressable accessibilityRole="button" onPress={() => void retrySync()}>
          <Text style={styles.action}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    minHeight: 38,
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  text: { color: '#FFFFFF', flex: 1, fontSize: 12, fontWeight: '600' },
  action: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
});
