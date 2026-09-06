import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiClient, cloudConnectionErrorMessage } from '../api/apiClient';
import { Badge, Button, Card, EmptyState, LoadingState, SearchBar } from '../components/ui';
import { useAuth, useTheme } from '../context/AppProviders';
import { filterUnifiedPortalUsers, editableFieldMembership, membershipForApp } from '../domain/unifiedUsers';
import type { UnifiedPortalApp, UnifiedPortalUsersResponse } from '../types/unifiedUsers';
import { spacing, typography } from '../theme';

const appLabels: Record<UnifiedPortalApp, string> = { ecoaudit: 'Eco Audit', solarsense: 'Solar Sense', installhub: 'Field App Complete' };
const syncLabels = { synced: 'Synced', drifted: 'Role or status drift', missing_projection: 'Missing Field access', orphaned_projection: 'Source unavailable', field_only: 'Field only', unlinked: 'Unlinked identity' };
type Props = { navigation: { navigate: (name: string, params?: Record<string, unknown>) => void } };

export function UserManagementScreen({ navigation }: Props) {
  const { user: currentUser } = useAuth();
  const { colors } = useTheme();
  const [directory, setDirectory] = useState<UnifiedPortalUsersResponse>();
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    if (currentUser?.role !== 'admin') { setLoading(false); return; }
    setLoading(true); setError(undefined);
    try { setDirectory(await apiClient.listUnifiedUsers()); }
    catch (caught) { setError(cloudConnectionErrorMessage(caught)); }
    finally { setLoading(false); }
  }, [currentUser?.role]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const filtered = useMemo(() => filterUnifiedPortalUsers(directory?.data ?? [], search), [directory, search]);
  if (currentUser?.role !== 'admin') return <EmptyState title="Administrator access required" subtitle="Only administrators can view the unified user directory." />;
  if (loading && !directory) return <LoadingState />;
  const summary = directory?.summary;
  return <FlatList
    style={{ flex: 1, backgroundColor: colors.background }}
    contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
    data={filtered} keyExtractor={(item) => item.key}
    refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    ListHeaderComponent={<>
      <Text style={[typography.title, { color: colors.foreground }]}>Unified user directory</Text>
      <Text style={{ color: colors.mutedForeground, marginVertical: spacing.md }}>Review roles and access across Eco Audit, Solar Sense, and Field App Complete.</Text>
      {summary ? <Card style={{ marginBottom: spacing.md }}>
        <Text style={{ color: colors.foreground }}>Identities: {summary.total} · Memberships: {Object.values(summary.byApp).reduce((total, app) => total + app.total, 0)}</Text>
        <Text style={{ color: colors.foreground, marginTop: spacing.sm }}>Active users: {summary.active} · Administrators: {summary.admins} · Needs attention: {summary.needsAttention}</Text>
      </Card> : null}
      <Button title="Add user" onPress={() => navigation.navigate('UserEditor')} style={{ marginBottom: spacing.md }} />
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search name, login, app, role, status, or sync" />
      {error ? <Card><Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text><Button title="Try again" onPress={() => void load()} /></Card> : null}
    </>}
    ListEmptyComponent={<EmptyState title={search ? 'No matching users' : 'No directory users'} />}
    renderItem={({ item }) => {
      const editable = editableFieldMembership(item);
      const field = membershipForApp(item, 'installhub');
      return <Card style={{ marginBottom: spacing.md }}>
        <Text style={[typography.subheading, { color: colors.foreground }]}>{item.fullName?.trim() || item.displayEmail}</Text>
        <Text style={{ color: colors.mutedForeground, marginVertical: spacing.sm }}>{item.displayEmail}</Text>
        <Badge label={syncLabels[item.syncStatus]} tone={['synced', 'field_only'].includes(item.syncStatus) ? 'success' : 'tbc'} />
        {item.possibleDuplicateCount ? <Text style={{ color: colors.mutedForeground, marginTop: spacing.sm }}>Possible duplicates: {item.possibleDuplicateCount}</Text> : null}
        {(['ecoaudit', 'solarsense', 'installhub'] as const).map((app) => {
          const membership = membershipForApp(item, app);
          return <View key={app} style={{ marginTop: spacing.md }}>
            <Text style={{ color: colors.foreground, fontWeight: '700' }}>{appLabels[app]}</Text>
            <Text style={{ color: colors.mutedForeground }}>{membership ? `${membership.role === 'admin' ? 'Administrator' : 'Inspector'} · ${membership.isActive ? 'Active' : 'Inactive'}${membership.userId === currentUser.id && app === 'installhub' ? ' · You' : ''}` : 'No access'}</Text>
            {membership?.isSourceProjection ? <Text style={{ color: colors.mutedForeground }}>Managed in {membership.sourceApp ? appLabels[membership.sourceApp] : 'source app'}</Text> : null}
          </View>;
        })}
        {field ? <Button title={editable ? 'Edit user' : 'View Field access'} variant="secondary" style={{ marginTop: spacing.md }} onPress={() => navigation.navigate('UserEditor', {
          userId: field.userId,
          sourceManaged: field.isSourceProjection,
          sourceApp: field.sourceApp,
          sourceState: item.syncStatus === 'orphaned_projection' ? 'orphaned' : field.isSourceProjection ? 'linked' : 'explicit',
        })} /> : <Text style={{ color: colors.mutedForeground, marginTop: spacing.md }}>No Field App account is available to edit.</Text>}
      </Card>;
    }}
  />;
}
