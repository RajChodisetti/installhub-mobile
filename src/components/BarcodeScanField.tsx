import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useTheme } from '../context/AppProviders';
import { radii, spacing, typography } from '../theme';
import { Button, TextField } from './ui';

/**
 * Text field + barcode/QR camera scan (Expo Camera).
 * Manual typing always works as fallback.
 */
export function BarcodeScanField({
  label,
  value,
  onChangeText,
  placeholder,
}: {
  label?: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  const openScanner = async () => {
    setScanned(false);
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) return;
    }
    setOpen(true);
  };

  return (
    <View>
      <TextField
        label={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        autoCapitalize="characters"
      />
      <Pressable
        onPress={() => void openScanner()}
        style={{
          alignSelf: 'flex-start',
          marginTop: -8,
          marginBottom: spacing.md,
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: radii.full,
          borderWidth: 1,
          borderColor: colors.primary,
          backgroundColor: colors.card,
        }}
      >
        <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>Scan barcode / QR</Text>
      </Pressable>
      {permission && !permission.granted ? (
        <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: -8, marginBottom: spacing.sm }}>
          Camera permission needed to scan. You can still type the code.
        </Text>
      ) : null}

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <View
            style={{
              zIndex: 2,
              paddingTop: 56,
              paddingHorizontal: spacing.lg,
              paddingBottom: spacing.md,
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: 'rgba(0,0,0,0.55)',
            }}
          >
            <Text style={[typography.subheading, { color: '#fff' }]}>Scan barcode / QR</Text>
            <Pressable onPress={() => setOpen(false)} hitSlop={12}>
              <Text style={{ color: '#fff', fontWeight: '600' }}>Close</Text>
            </Pressable>
          </View>

          <View style={{ flex: 1 }}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{
                barcodeTypes: [
                  'qr',
                  'code128',
                  'code39',
                  'ean13',
                  'ean8',
                  'upc_a',
                  'upc_e',
                  'codabar',
                  'itf14',
                ],
              }}
              onBarcodeScanned={
                scanned
                  ? undefined
                  : ({ data }) => {
                      setScanned(true);
                      onChangeText(data);
                      setOpen(false);
                    }
              }
            />
          </View>

          <View style={{ padding: spacing.lg, gap: 12, backgroundColor: 'rgba(0,0,0,0.7)' }}>
            <Text style={{ color: 'rgba(255,255,255,0.75)', textAlign: 'center', fontSize: 13 }}>
              Point at the barcode on the device. Or close and type manually.
            </Text>
            <Button title="Close & type manually" variant="secondary" onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

/** Keep a saved legacy option visible when editing old installs. */
export function withLegacyOption(options: string[], current?: string): string[] {
  if (!current || options.includes(current)) return options;
  return [current, ...options];
}
