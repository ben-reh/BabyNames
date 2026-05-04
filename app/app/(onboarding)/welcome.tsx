import { useRouter } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, fontSize, radius, spacing } from '../../src/constants/theme';

export default function Welcome() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.emoji}>👶</Text>
        <Text style={styles.title}>BabyNames</Text>
        <Text style={styles.subtitle}>Find the perfect name together</Text>
      </View>

      <View style={styles.buttons}>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => router.push('/(onboarding)/create')}>
          <Text style={styles.primaryBtnText}>Start a new list</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.push('/(onboarding)/join')}>
          <Text style={styles.secondaryBtnText}>Join partner's list</Text>
        </TouchableOpacity>
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
});
