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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Text style={[typography.title, { color: colors.primary }]}>InstallHub</Text>
        <Text style={{ color: colors.mutedForeground, marginBottom: spacing.xl, marginTop: 8 }}>
          Sign in to InstallHub Cloud Backup
        </Text>
        <Card>
          <TextField
            label="Email"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextField
            label="Password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          {error ? <Text style={{ color: colors.destructive, marginBottom: 12 }}>{error}</Text> : null}
          <Button
            title={busy ? 'Signing in…' : 'Sign in'}
            disabled={busy}
            onPress={async () => {
              setBusy(true);
              setError('');
              try {
                await login(email, password);
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Login failed');
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
