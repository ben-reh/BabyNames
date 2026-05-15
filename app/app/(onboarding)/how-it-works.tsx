import { useRouter } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSwipeBack } from '../../src/components/SwipeBackScreen';
import { useSessionStore } from '../../src/store';
import { colors, fontSize, radius, spacing } from '../../src/constants/theme';

const STEPS = [
  { icon: '❤️', label: 'Swipe right', description: 'Save names you love' },
  { icon: '✕', label: 'Swipe left', description: "Pass on names that aren't for you" },
  { icon: '🎉', label: 'Get a match', description: 'When you both like the same name' },
];

export default function HowItWorks() {
  const router = useRouter();
  const setOnboardingDone = useSessionStore((s) => s.setOnboardingDone);

  const panHandlers = useSwipeBack();

  const handleLetsGo = () => {
    setOnboardingDone();
    router.replace('/(tabs)/swipe');
  };

  return (
    <View style={styles.container} {...panHandlers}>
      <View style={styles.content}>
        <Text style={styles.title}>Here's how it works</Text>

        <View style={styles.rows}>
          {STEPS.map((step) => (
            <View key={step.label} style={styles.row}>
              <Text style={styles.rowIcon}>{step.icon}</Text>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>{step.label}</Text>
                <Text style={styles.rowDesc}>{step.description}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      <TouchableOpacity style={styles.letsGoBtn} onPress={handleLetsGo}>
        <Text style={styles.letsGoBtnText}>Let's go! →</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'space-between', padding: spacing.xl },
  content: { flex: 1, justifyContent: 'center', gap: spacing.xxl },
  title: { fontSize: fontSize.xl, fontWeight: '800', color: colors.text, textAlign: 'center' },
  rows: { gap: spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowIcon: { fontSize: 32, width: 44, textAlign: 'center' },
  rowText: { flex: 1, gap: spacing.xs },
  rowLabel: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  rowDesc: { fontSize: fontSize.sm, color: colors.textMuted },
  letsGoBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: spacing.md + 4,
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  letsGoBtnText: { color: '#fff', fontSize: fontSize.md, fontWeight: '700' },
});
