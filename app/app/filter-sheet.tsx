import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { ORIGINS } from '../src/constants/origins';
import { colors, fontSize, radius, spacing } from '../src/constants/theme';
import { useFilterStore } from '../src/store';

type Sex = 'M' | 'F' | null;

const SEX_OPTIONS: { label: string; value: Sex }[] = [
  { label: 'Any', value: null },
  { label: 'Girl ♀', value: 'F' },
  { label: 'Boy ♂', value: 'M' },
];

export default function FilterSheet() {
  const router = useRouter();
  const qc = useQueryClient();
  const { sex: savedSex, origin: savedOrigin, setSex, setOrigin } = useFilterStore();

  // Local state — only commit on Apply
  const [sex, setLocalSex] = useState<Sex>(savedSex);
  const [origin, setLocalOrigin] = useState<string | null>(savedOrigin);

  const hasChanges = sex !== savedSex || origin !== savedOrigin;
  const activeFilterCount = (sex ? 1 : 0) + (origin ? 1 : 0);

  const handleApply = () => {
    setSex(sex);
    setOrigin(origin);
    // Reset swipe deck by invalidating the names cache
    qc.removeQueries({ queryKey: ['names'] });
    router.back();
  };

  const handleReset = () => {
    setLocalSex(null);
    setLocalOrigin(null);
  };

  return (
    <View style={styles.container}>
      {/* Drag handle */}
      <View style={styles.handle} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Filters</Text>
        <View style={styles.headerRight}>
          {activeFilterCount > 0 && (
            <TouchableOpacity onPress={handleReset} style={styles.resetBtn}>
              <Text style={styles.resetText}>Reset</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* Sex filter */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Gender</Text>
          <View style={styles.segmented}>
            {SEX_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={String(opt.value)}
                style={[styles.segment, sex === opt.value && styles.segmentActive]}
                onPress={() => setLocalSex(opt.value)}
              >
                <Text style={[styles.segmentText, sex === opt.value && styles.segmentTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Origin filter */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Origin</Text>
          <View style={styles.originGrid}>
            {ORIGINS.map((o) => {
              const active = origin === o;
              return (
                <TouchableOpacity
                  key={o}
                  style={[styles.originChip, active && styles.originChipActive]}
                  onPress={() => setLocalOrigin(active ? null : o)}
                >
                  <Text style={[styles.originChipText, active && styles.originChipTextActive]}>
                    {o}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </ScrollView>

      {/* Apply button */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.applyBtn, !hasChanges && styles.applyBtnDisabled]}
          onPress={handleApply}
          disabled={!hasChanges}
        >
          <Text style={styles.applyBtnText}>
            {hasChanges ? 'Apply filters' : 'No changes'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.sm,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  resetBtn: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  resetText: { fontSize: fontSize.sm, color: colors.primary, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xl },
  section: { marginBottom: spacing.xl },
  sectionLabel: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing.md,
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.border,
    borderRadius: radius.md,
    padding: 3,
  },
  segment: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: radius.sm,
  },
  segmentActive: {
    backgroundColor: colors.card,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  segmentText: { fontSize: fontSize.md, color: colors.textMuted, fontWeight: '600' },
  segmentTextActive: { color: colors.text },
  originGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  originChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  originChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  originChipText: { fontSize: fontSize.sm, color: colors.textMuted, fontWeight: '500' },
  originChipTextActive: { color: colors.primary, fontWeight: '700' },
  footer: {
    padding: spacing.lg,
    paddingBottom: spacing.xl + spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  applyBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: spacing.md + 2,
    alignItems: 'center',
  },
  applyBtnDisabled: { opacity: 0.45 },
  applyBtnText: { color: '#fff', fontSize: fontSize.md, fontWeight: '700' },
});
