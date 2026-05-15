import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useCreateList } from '../../src/api/lists';
import { useDeviceId } from '../../src/hooks/useDeviceId';
import { useSessionStore } from '../../src/store';
import { colors, fontSize, radius, spacing } from '../../src/constants/theme';

export default function Create() {
  const router = useRouter();
  const deviceId = useDeviceId();
  const setSession = useSessionStore((s) => s.setSession);
  const { mutate, data, isPending, isError } = useCreateList();

  useEffect(() => {
    if (deviceId) mutate(deviceId);
  }, [deviceId]);

  const handleContinue = () => {
    if (!data || !deviceId) return;
    setSession({ listId: data.listId, deviceId, partnerRole: 'A', code: data.code });
    router.replace('/(onboarding)/name-favorites');
  };

  if (isPending || !data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Creating your list...</Text>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Something went wrong. Please try again.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Your share code</Text>
        <Text style={styles.subtitle}>Share this code with your partner so they can join your list</Text>

        <TouchableOpacity style={styles.codeBox} onPress={() => Clipboard.setStringAsync(data.code)}>
          <Text style={styles.code}>{data.code}</Text>
          <Text style={styles.copyHint}>Tap to copy</Text>
        </TouchableOpacity>

        <Text style={styles.waitingText}>Waiting for your partner to join...</Text>
      </View>

      <TouchableOpacity style={styles.continueBtn} onPress={handleContinue}>
        <Text style={styles.continueBtnText}>Start swiping →</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  container: { flex: 1, justifyContent: 'space-between', padding: spacing.xl },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg },
  title: { fontSize: fontSize.xl, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: fontSize.md, color: colors.textMuted, textAlign: 'center', lineHeight: 22 },
  codeBox: { backgroundColor: colors.primaryLight, borderRadius: radius.lg, paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, alignItems: 'center', gap: spacing.xs },
  code: { fontSize: 48, fontWeight: '900', letterSpacing: 8, color: colors.primary, fontFamily: 'monospace' },
  copyHint: { fontSize: fontSize.sm, color: colors.primary, opacity: 0.7 },
  waitingText: { fontSize: fontSize.sm, color: colors.textMuted },
  loadingText: { fontSize: fontSize.md, color: colors.textMuted },
  errorText: { fontSize: fontSize.md, color: colors.error },
  continueBtn: { backgroundColor: colors.primary, borderRadius: radius.lg, padding: spacing.md + 4, alignItems: 'center', marginBottom: spacing.xl },
  continueBtnText: { color: '#fff', fontSize: fontSize.md, fontWeight: '700' },
});
