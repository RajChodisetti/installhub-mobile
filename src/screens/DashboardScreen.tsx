import React, { useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useInstallations } from '../hooks';
import { InstallationCard } from '../components/domain';
import { Button, EmptyState, LoadingState, SearchBar } from '../components/ui';
import { useTheme } from '../context/AppProviders';
import { searchMatch } from '../utils';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList> };

export function DashboardScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { items, loading, refresh } = useInstallations();
  const [query, setQuery] = useState('');
  const filtered = useMemo(
    () =>
      items.filter((i) =>
        i.thumbnail_status !== 'pending' &&
        searchMatch(`${i.site_name} ${i.client_name} ${i.site_address} ${i.inspector_name}`, query),
      ),
    [items, query],
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.hero}>
        <Text style={[typography.title, { color: colors.foreground }]}>
          Field App Complete
        </Text>
        <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>
          Site installations & Wattwatcher metering
        </Text>
      </View>
      <SearchBar value={query} onChangeText={setQuery} placeholder="Search sites or clients" />
      <Button
        title="Start New Site Installation"
        onPress={() => navigation.navigate('InstallationForm')}
        style={{ marginBottom: spacing.md }}
      />
      <Button
        title="Browse Cloud Backups"
        variant="secondary"
        onPress={() => navigation.navigate('RemoteInstallations')}
        style={{ marginBottom: spacing.md }}
      />
      {loading && !items.length ? (
        <LoadingState />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            <EmptyState title="No installations" subtitle="Create a site installation to get started." />
          }
          renderItem={({ item }) => (
            <InstallationCard
              item={item}
              onPress={() => navigation.navigate('InstallationDetail', { installationId: item.id })}
            />
          )}
          ListFooterComponent={<View style={{ height: 24 }} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg },
  hero: { marginBottom: spacing.lg, marginTop: spacing.sm },
});
