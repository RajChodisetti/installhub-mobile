import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth, useTheme } from '../context/AppProviders';
import { Button, Card, TextField } from '../components/ui';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export function LoginScreen({}: Props) {
  const { login } = useAuth();
  const { colors } = useTheme();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
            onChangeText={setUsername}
          />
          <TextField
            label="Password"
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            value={password}
            onChangeText={setPassword}
          />
          {error ? <Text style={{ color: colors.destructive, marginBottom: 12 }}>{error}</Text> : null}
          <Button
            title={busy ? 'Signing in…' : 'Sign in'}
            disabled={busy || !username.trim() || !password}
            onPress={async () => {
              setBusy(true);
              setError('');
              try {
                await login(username, password);
              } catch (e) {
                const message = e instanceof Error ? e.message : 'Login failed';
                setError(message);
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
});
