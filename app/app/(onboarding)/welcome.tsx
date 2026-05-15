import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, fontSize, radius, spacing } from '../../src/constants/theme';
import { useSessionStore } from '../../src/store';

export default function Welcome() {
  const router = useRouter();
  const clearSession = useSessionStore((s) => s.clearSession);

  const handleDevReset = () => {
    Alert.alert('Reset session', 'Clear all local data and start fresh?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: async () => {
          await AsyncStorage.clear();
          clearSession();
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.emoji}>👶</Text>
        <Text style={styles.title}>BabyNames</Text>
        <Text style={styles.subtitle}>Find the perfect name together</Text>
      </View>

      <View style={styles.buttons}>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => router.push('/(onboarding)/sex-filter')}>
          <Text style={styles.primaryBtnText}>Get started →</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.push('/(onboarding)/join')}>
          <Text style={styles.secondaryBtnText}>Join partner's list</Text>
        </TouchableOpacity>

        {__DEV__ && (
          <TouchableOpacity style={styles.devBtn} onPress={handleDevReset}>
            <Text style={styles.devBtnText}>⚙ Reset session (dev)</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'space-between', padding: spacing.xl },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  emoji: { fontSize: 72 },
  title: { fontSize: fontSize.xxl, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: fontSize.md, color: colors.textMuted, textAlign: 'center' },
  buttons: { gap: spacing.md, paddingBottom: spacing.xl },
  primaryBtn: { backgroundColor: colors.primary, borderRadius: radius.lg, padding: spacing.md + 4, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontSize: fontSize.md, fontWeight: '700' },
  secondaryBtn: { backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.md + 4, alignItems: 'center', borderWidth: 1.5, borderColor: colors.border },
  secondaryBtnText: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  devBtn: { alignItems: 'center', padding: spacing.sm },
  devBtnText: { color: colors.textMuted, fontSize: fontSize.sm },
});
