import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSwipeBack } from '../../src/components/SwipeBackScreen';
import { useFilterStore, useSessionStore } from '../../src/store';
import { colors, fontSize, radius, spacing } from '../../src/constants/theme';

type SexOption = 'F' | 'M' | 'U';

const OPTIONS: { value: SexOption; label: string; selectedBg: string }[] = [
  { value: 'F', label: 'Girl names', selectedBg: colors.primaryLight },
  { value: 'M', label: 'Boy names', selectedBg: '#EEF3FD' },
  { value: 'U', label: 'Unisex names', selectedBg: colors.card },
];

export default function SexFilter() {
  const router = useRouter();
  const setSex = useFilterStore((s) => s.setSex);
  const setDefaultSex = useSessionStore((s) => s.setDefaultSex);
  const [selected, setSelected] = useState<SexOption | null>(null);
  const panHandlers = useSwipeBack();

  const handleSelect = (value: SexOption) => {
    setSelected(value);
    setSex(value);
    setDefaultSex(value);
  };

  const handleContinue = () => {
    if (!selected) return;
    router.push('/(onboarding)/style-quiz');
  };

  return (
    <View style={styles.container} {...panHandlers}>
      <View style={styles.content}>
        <Text style={styles.title}>What are you looking for?</Text>

        <View style={styles.options}>
          {OPTIONS.map((opt) => {
            const isSelected = selected === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[
                  styles.card,
                  isSelected && { backgroundColor: opt.selectedBg, borderColor: colors.primary },
                ]}
                onPress={() => handleSelect(opt.value)}
                activeOpacity={0.8}
              >
                <Text style={[styles.cardLabel, isSelected && styles.cardLabelSelected]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <TouchableOpacity
        style={[styles.continueBtn, !selected && styles.continueBtnDisabled]}
        onPress={handleContinue}
        disabled={!selected}
      >
        <Text style={styles.continueBtnText}>Continue →</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'space-between', padding: spacing.xl },
  content: { flex: 1, justifyContent: 'center', gap: spacing.xl },
  title: { fontSize: fontSize.xl, fontWeight: '800', color: colors.text, textAlign: 'center' },
  options: { gap: spacing.md },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  cardLabel: { fontSize: fontSize.lg, fontWeight: '600', color: colors.text },
  cardLabelSelected: { color: colors.primary },
  continueBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: spacing.md + 4,
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  continueBtnDisabled: { opacity: 0.5 },
  continueBtnText: { color: '#fff', fontSize: fontSize.md, fontWeight: '700' },
});
