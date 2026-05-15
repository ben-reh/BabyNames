import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSwipeBack } from '../../src/components/SwipeBackScreen';
import { useFilterStore } from '../../src/store';
import { colors, fontSize, radius, spacing } from '../../src/constants/theme';

const OPTIONS = [
  {
    value: 'popular',
    label: 'Popular',
    description: 'Olivia, Liam, Charlotte',
    detail: "Top ~50 — you'll hear these everywhere",
  },
  {
    value: 'familiar',
    label: 'Familiar',
    description: 'Sadie, Myles, Juniper',
    detail: 'Top ~200 — recognizable but not overdone',
  },
  {
    value: 'unique',
    label: 'Unique',
    description: 'Celine, Dashiell, Paloma',
    detail: 'Below top 200 — a genuine conversation starter',
  },
];

export default function PopularityFilter() {
  const router = useRouter();
  const setPopularity = useFilterStore((s) => s.setPopularity);
  const [selected, setSelected] = useState<string[]>([]);
  const panHandlers = useSwipeBack();

  const toggle = (value: string) =>
    setSelected((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );

  const handleContinue = () => {
    setPopularity(selected);
    router.push('/(onboarding)/partner');
  };

  return (
    <View style={styles.container} {...panHandlers}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>How well-known should they be?</Text>
          <Text style={styles.subtitle}>Select all that apply — or skip to see everything</Text>
        </View>

        <View style={styles.options}>
          {OPTIONS.map((opt) => {
            const isSelected = selected.includes(opt.value);
            return (
              <TouchableOpacity
                key={opt.value}
                style={[styles.card, isSelected && styles.cardSelected]}
                onPress={() => toggle(opt.value)}
                activeOpacity={0.8}
              >
                <View style={styles.cardRow}>
                  <View style={styles.cardText}>
                    <Text style={[styles.cardLabel, isSelected && styles.cardLabelSelected]}>
                      {opt.label}
                    </Text>
                    <Text style={[styles.cardExamples, isSelected && styles.cardExamplesSelected]}>
                      {opt.description}
                    </Text>
                    <Text style={[styles.cardDetail, isSelected && styles.cardDetailSelected]}>
                      {opt.detail}
                    </Text>
                  </View>
                  <View style={[styles.check, isSelected && styles.checkSelected]}>
                    {isSelected && <Text style={styles.checkMark}>✓</Text>}
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <TouchableOpacity style={styles.continueBtn} onPress={handleContinue}>
        <Text style={styles.continueBtnText}>
          {selected.length === 0 ? 'Show me everything →' : 'Continue →'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'space-between', padding: spacing.xl },
  content: { flex: 1, justifyContent: 'center', gap: spacing.xl },
  header: { gap: spacing.sm },
  title: { fontSize: fontSize.xl, fontWeight: '800', color: colors.text, textAlign: 'center' },
  subtitle: { fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center' },
  options: { gap: spacing.md },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  cardSelected: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardText: { flex: 1, gap: 3 },
  cardLabel: { fontSize: fontSize.lg, fontWeight: '700', color: colors.text },
  cardLabelSelected: { color: colors.primary },
  cardExamples: { fontSize: fontSize.sm, color: colors.textMuted, fontWeight: '500' },
  cardExamplesSelected: { color: colors.primary },
  cardDetail: { fontSize: fontSize.xs, color: colors.textMuted },
  cardDetailSelected: { color: colors.primary, opacity: 0.8 },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkMark: { color: '#fff', fontSize: 13, fontWeight: '800' },
  continueBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: spacing.md + 4,
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  continueBtnText: { color: '#fff', fontSize: fontSize.md, fontWeight: '700' },
});
