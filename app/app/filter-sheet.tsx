import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { api } from '../src/api/client';
import { ORIGINS } from '../src/constants/origins';
import { colors, fontSize, radius, spacing } from '../src/constants/theme';
import { useFilterStore, useSessionStore } from '../src/store';

type Sex = 'M' | 'F' | 'U';

const SEX_OPTIONS: { label: string; value: Sex }[] = [
  { label: '♀ Girl', value: 'F' },
  { label: 'Unisex', value: 'U' },
  { label: '♂ Boy', value: 'M' },
];

const POPULARITY_OPTIONS = [
  { value: 'popular',  label: 'Popular',  subtitle: 'Top ~50' },
  { value: 'familiar', label: 'Familiar', subtitle: 'Top ~200' },
  { value: 'unique',   label: 'Unique',   subtitle: 'Below top 200' },
];

export default function FilterSheet() {
  const router = useRouter();
  const qc = useQueryClient();
  const { deviceId } = useSessionStore();
  const { sex: savedSex, origins: savedOrigins, popularity: savedPopularity, setSex, setOrigins, setPopularity } = useFilterStore();

  // Local state — only commit on Apply
  const [sex, setLocalSex] = useState<Sex>(savedSex ?? 'F');
  const [origins, setLocalOrigins] = useState<string[]>(savedOrigins);
  const [popularity, setLocalPopularity] = useState<string[]>(savedPopularity);

  const hasChanges =
    sex !== savedSex ||
    [...origins].sort().join(',') !== [...savedOrigins].sort().join(',') ||
    [...popularity].sort().join(',') !== [...savedPopularity].sort().join(',');
  const activeFilterCount = (origins.length > 0 ? 1 : 0) + (popularity.length > 0 ? 1 : 0);

  // Prefetch recommendations in the background as the user adjusts filters so
  // the data is already cached by the time they tap Apply.
  useEffect(() => {
    if (!deviceId || !hasChanges) return;
    const timer = setTimeout(() => {
      qc.prefetchInfiniteQuery({
        queryKey: ['recommendations', deviceId, sex, origins, popularity],
        queryFn: async () => {
          const params: Record<string, string> = { deviceId };
          if (sex) params.sex = sex;
          if (origins.length) params.origins = origins.join(',');
          if (popularity.length) params.popularity = popularity.join(',');
          const { data } = await api.get<{ names: unknown[] }>('/recommendations', { params });
          return data;
        },
        initialPageParam: 0,
        getNextPageParam: (_: unknown, allPages: unknown[]) => allPages.length,
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [sex, origins, popularity, deviceId, hasChanges, qc]);

  const handleApply = () => {
    setSex(sex);
    setOrigins(origins);
    setPopularity(popularity);
    router.back();
  };

  const handleReset = () => {
    setLocalSex('U');
    setLocalOrigins([]);
    setLocalPopularity([]);
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

        {/* Popularity filter */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Popularity</Text>
          <View style={styles.originGrid}>
            {POPULARITY_OPTIONS.map((opt) => {
              const active = popularity.includes(opt.value);
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.popularityChip, active && styles.originChipActive]}
                  onPress={() => setLocalPopularity(active ? popularity.filter((x) => x !== opt.value) : [...popularity, opt.value])}
                >
                  <Text style={[styles.originChipText, active && styles.originChipTextActive]}>
                    {opt.label}
                  </Text>
                  <Text style={[styles.popularitySubtitle, active && styles.originChipTextActive]}>
                    {opt.subtitle}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Origin filter */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Origin</Text>
          <View style={styles.originGrid}>
            {ORIGINS.map((o) => {
              const active = origins.includes(o);
              return (
                <TouchableOpacity
                  key={o}
                  style={[styles.originChip, active && styles.originChipActive]}
                  onPress={() => setLocalOrigins(active ? origins.filter((x) => x !== o) : [...origins, o])}
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
  popularityChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: 'center',
    minWidth: 100,
  },
  popularitySubtitle: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
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
