import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useJoinList } from '../../src/api/lists';
import { useDeviceId } from '../../src/hooks/useDeviceId';
import { useSessionStore } from '../../src/store';
import { colors, fontSize, radius, spacing } from '../../src/constants/theme';

export default function Join() {
  const router = useRouter();
  const deviceId = useDeviceId();
  const setSession = useSessionStore((s) => s.setSession);
  const [code, setCode] = useState('');
  const inputRef = useRef<TextInput>(null);
  const { mutate, isPending, error } = useJoinList();

  const handleJoin = () => {
    if (!deviceId || code.length < 6) return;
    mutate(
      { code: code.toUpperCase(), deviceId },
      {
        onSuccess: (data) => {
          setSession({ listId: data.listId, deviceId, partnerRole: data.role, code: code.toUpperCase() });
          router.replace('/(tabs)/swipe');
        },
      },
    );
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.content}>
        <Text style={styles.title}>Enter the code</Text>
        <Text style={styles.subtitle}>Ask your partner for their 6-character share code</Text>

        <TextInput
          ref={inputRef}
          style={styles.input}
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase().slice(0, 6))}
          placeholder="ABC123"
          placeholderTextColor={colors.border}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={6}
          keyboardType="default"
        />

        {error && <Text style={styles.errorText}>Code not found or list is full</Text>}
      </View>

      <TouchableOpacity
        style={[styles.joinBtn, (code.length < 6 || isPending) && styles.joinBtnDisabled]}
        onPress={handleJoin}
        disabled={code.length < 6 || isPending}
      >
        {isPending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.joinBtnText}>Join list</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.xl, paddingTop: spacing.xl + spacing.lg },
  backBtn: { marginBottom: spacing.xl },
  backText: { fontSize: fontSize.md, color: colors.primary, fontWeight: '600' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg },
  title: { fontSize: fontSize.xl, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: fontSize.md, color: colors.textMuted, textAlign: 'center' },
  input: { fontSize: 40, fontWeight: '900', letterSpacing: 10, color: colors.text, textAlign: 'center', borderBottomWidth: 2, borderBottomColor: colors.primary, paddingBottom: spacing.sm, minWidth: 200, fontFamily: 'monospace' },
  errorText: { fontSize: fontSize.sm, color: colors.error },
  joinBtn: { backgroundColor: colors.primary, borderRadius: radius.lg, padding: spacing.md + 4, alignItems: 'center', marginBottom: spacing.xl },
  joinBtnDisabled: { opacity: 0.5 },
  joinBtnText: { color: '#fff', fontSize: fontSize.md, fontWeight: '700' },
});
