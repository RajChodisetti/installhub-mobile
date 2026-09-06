import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View, type ImageProps, type ImageStyle, type StyleProp } from 'react-native';
import { useTheme } from '../context/AppProviders';

type Props = {
  uri: string;
  label: string;
  style: StyleProp<ImageStyle>;
  resizeMode?: ImageProps['resizeMode'];
};

/** Preview failures never change the stored evidence or its report inclusion. */
export function ReportEvidencePreview(props: Props) {
  return <EvidenceImage key={props.uri} {...props} />;
}

function EvidenceImage({ uri, label, style, resizeMode = 'cover' }: Props) {
  const { colors } = useTheme();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const currentAttempt = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const finish = (next: 'ready' | 'error') => {
    if (mounted.current && currentAttempt.current === attempt) setStatus(next);
  };

  return (
    <View style={[style, { overflow: 'hidden', justifyContent: 'center', alignItems: 'center', backgroundColor: colors.muted }]}>
      {status === 'error' ? <>
        <Text accessibilityRole="alert" style={{ color: colors.mutedForeground, fontSize: 11, lineHeight: 13, textAlign: 'center' }}>Preview unavailable</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`Retry preview for ${label}`}
          style={{ minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' }}
          onPress={() => { currentAttempt.current += 1; setAttempt(currentAttempt.current); setStatus('loading'); }}>
          <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>Retry</Text>
        </Pressable>
      </> : <>
        <Image key={attempt} source={{ uri }} accessibilityLabel={label} style={StyleSheet.absoluteFill}
          resizeMode={resizeMode} onLoad={() => finish('ready')} onError={() => finish('error')} />
        {status === 'loading' ? <ActivityIndicator accessibilityLabel={`Loading preview for ${label}`} color={colors.primary} /> : null}
      </>}
    </View>
  );
}
