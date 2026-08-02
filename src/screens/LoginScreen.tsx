import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth, useTheme } from '../context/AppProviders';
import { Button, Card, TextField } from '../components/ui';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import {
  supportsCloudLoginSource,
  type CloudLoginSource,
} from '../services/authSession';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export function LoginScreen({}: Props) {
  const { login } = useAuth();
  const { colors } = useTheme();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [sourceApp, setSourceApp] = useState<CloudLoginSource>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const sourceSelectionSupported = supportsCloudLoginSource(username);
  const sourceOptions: Array<{
    label: string;
    value: CloudLoginSource;
  }> = [
    { label: 'Automatic', value: null },
    { label: 'Eco Audit', value: 'ecoaudit' },
    { label: 'Solar Sense', value: 'solarsense' },
  ];

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Text style={[typography.title, { color: colors.primary }]}>
          Field App Complete
        </Text>
        <Text style={{ color: colors.mutedForeground, marginBottom: spacing.xl, marginTop: 8 }}>
          Sign in to Field App Complete Cloud Backup
        </Text>
        <Card>
          <TextField
            label="Username or email"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            value={username}
            onChangeText={(next) => {
              setUsername(next);
              if (!supportsCloudLoginSource(next)) setSourceApp(null);
            }}
          />
          <TextField
            label="Password"
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            value={password}
            onChangeText={setPassword}
          />
          <Text style={[styles.sourceLabel, { color: colors.mutedForeground }]}>
            Account source
          </Text>
          <View accessibilityRole="radiogroup" accessibilityLabel="Account source" style={styles.sourceOptions}>
            {sourceOptions.map((option) => {
              const selected = sourceApp === option.value;
              return (
                <Button
                  key={option.label}
                  title={option.label}
                  variant={selected ? 'primary' : 'secondary'}
                  style={styles.sourceButton}
                  disabled={
                    option.value !== null && !sourceSelectionSupported
                  }
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  onPress={() => {
                    setSourceApp(option.value);
                    setError('');
                  }}
                />
              );
            })}
          </View>
          <Text style={[styles.sourceHelp, { color: colors.mutedForeground }]}>
            {sourceSelectionSupported
              ? 'Use Automatic unless this username exists in more than one Sustainability Wise app.'
              : 'Account source selection is available for plain usernames and *.users.local identities.'}
          </Text>
          {error ? <Text style={{ color: colors.destructive, marginBottom: 12 }}>{error}</Text> : null}
          <Button
            title={busy ? 'Signing in…' : 'Sign in'}
            disabled={busy || !username.trim() || !password}
            onPress={async () => {
              setBusy(true);
              setError('');
              try {
                await login(username, password, sourceApp);
              } catch (e) {
                const message = e instanceof Error ? e.message : 'Login failed';
                setError(
                  sourceApp === null && !username.includes('@')
                    ? `${message} If this username is used in both Eco Audit and Solar Sense, select its account source and retry.`
                    : message,
                );
              } finally {
                setBusy(false);
              }
            }}
          />
          <Text style={{ color: colors.mutedForeground, marginTop: 12, fontSize: 12 }}>
            Your work stays available offline after the first successful sign-in.
          </Text>
        </Card>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1, justifyContent: 'center', padding: spacing.xl },
  sourceLabel: { fontSize: 13, fontWeight: '600', marginBottom: 6 },
  sourceOptions: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  sourceButton: { flex: 1, minHeight: 40, paddingHorizontal: 8 },
  sourceHelp: { fontSize: 12, lineHeight: 17, marginBottom: 12 },
});
