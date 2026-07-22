import React from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { radii, spacing, typography } from '../../theme';
import { useTheme } from '../../context/AppProviders';

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  style,
}: {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const { colors } = useTheme();
  const bg =
    variant === 'primary'
      ? colors.primary
      : variant === 'danger'
        ? colors.destructive
        : variant === 'secondary'
          ? colors.muted
          : 'transparent';
  const fg =
    variant === 'ghost'
      ? colors.primary
      : variant === 'secondary'
        ? colors.foreground
        : variant === 'danger'
          ? colors.destructiveForeground
          : colors.primaryForeground;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        variant === 'ghost' && { borderWidth: 1, borderColor: colors.border },
        style,
      ]}
    >
      <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>
    </Pressable>
  );
}

export function TextField({
  label,
  error,
  ...props
}: TextInputProps & { label?: string; error?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      {label ? <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.mutedForeground}
        {...props}
        style={[
          styles.input,
          {
            backgroundColor: colors.card,
            borderColor: error ? colors.destructive : colors.border,
            color: colors.foreground,
          },
          props.style,
        ]}
      />
      {error ? <Text style={{ color: colors.destructive, fontSize: 12 }}>{error}</Text> : null}
    </View>
  );
}

export function TextArea(props: TextInputProps & { label?: string }) {
  return (
    <TextField
      {...props}
      multiline
      style={[{ minHeight: 96, textAlignVertical: 'top' }, props.style]}
    />
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }, style]}>
      {children}
    </View>
  );
}

export function Badge({
  label,
  tone = 'default',
}: {
  label: string;
  tone?: 'default' | 'success' | 'tbc' | 'danger';
}) {
  const { colors } = useTheme();
  const bg =
    tone === 'success'
      ? colors.success
      : tone === 'tbc'
        ? colors.tbc
        : tone === 'danger'
          ? colors.destructive
          : colors.muted;
  const fg =
    tone === 'tbc'
      ? colors.tbcForeground
      : tone === 'default'
        ? colors.foreground
        : '#fff';
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{label}</Text>
    </View>
  );
}

export function EmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.empty}>
      <Text style={[typography.subheading, { color: colors.foreground }]}>{title}</Text>
      {subtitle ? (
        <Text style={[typography.caption, { color: colors.mutedForeground, marginTop: 6, textAlign: 'center' }]}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

export function LoadingState() {
  const { colors } = useTheme();
  return (
    <View style={styles.empty}>
      <ActivityIndicator color={colors.primary} size="large" />
    </View>
  );
}

export function SectionHeader({
  title,
  actionLabel,
  onAction,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <Text style={[typography.subheading, { color: colors.foreground }]}>{title}</Text>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction}>
          <Text style={{ color: colors.primary, fontWeight: '600' }}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function SearchBar({
  value,
  onChangeText,
  placeholder = 'Search…',
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <TextField
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      autoCapitalize="none"
      autoCorrect={false}
    />
  );
}

export function ListRow({
  title,
  subtitle,
  right,
  onPress,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.listRow,
        { borderColor: colors.border, backgroundColor: colors.card, opacity: pressed ? 0.9 : 1 },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[typography.subheading, { color: colors.foreground }]}>{title}</Text>
        {subtitle ? (
          <Text style={[typography.caption, { color: colors.mutedForeground, marginTop: 4 }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </Pressable>
  );
}

export function PhotoThumbnailGrid({
  uris,
  onAdd,
  onRemove,
}: {
  uris: string[];
  onAdd?: () => void;
  onRemove?: (uri: string) => void;
}) {
  const { colors } = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoRow}>
      {uris.map((uri) => (
        <Pressable
          key={uri}
          onLongPress={() => onRemove?.(uri)}
          style={[styles.photoThumb, { borderColor: colors.border, backgroundColor: colors.muted }]}
        >
          <Image source={{ uri }} style={styles.photoImage} />
        </Pressable>
      ))}
      {onAdd ? (
        <Pressable
          onPress={onAdd}
          style={[styles.photoThumb, styles.photoAdd, { borderColor: colors.border, backgroundColor: colors.card }]}
        >
          <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 28 }}>+</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: radii.md,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  buttonText: { fontSize: 15, fontWeight: '700' },
  field: { gap: 6, marginBottom: spacing.md },
  label: { ...typography.label, textTransform: 'uppercase' },
  input: {
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
  },
  card: {
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radii.full,
    alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 11, fontWeight: '700' },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  listRow: {
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: spacing.sm,
  },
  photoRow: { gap: 8, paddingVertical: 4 },
  photoThumb: {
    width: 88,
    height: 88,
    borderRadius: radii.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  photoImage: { width: '100%', height: '100%' },
  photoAdd: { alignItems: 'center', justifyContent: 'center' },
});
