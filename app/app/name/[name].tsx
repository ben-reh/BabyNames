import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Dimensions, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { useAddName, useList, useRemoveName } from '../../src/api/lists';
import { useName, useNamePopularity, useNameYearRank } from '../../src/api/names';
import { useSessionStore } from '../../src/store';
import { colors, fontSize, radius, spacing } from '../../src/constants/theme';

const CHART_WIDTH = Dimensions.get('window').width - spacing.lg * 2;
const GIRL_COLOR = colors.primary;       // pink
const BOY_COLOR = colors.secondary;      // blue

export default function NameDetail() {
  const router = useRouter();
  const { name: nameParam } = useLocalSearchParams<{ name: string }>();
  const { listId, deviceId, partnerRole } = useSessionStore();
  const { data: nameData, isLoading } = useName(nameParam);
  const { data: popularity } = useNamePopularity(nameParam);
  const { data: yearRank } = useNameYearRank(nameParam, nameData?.sex ?? 'F');
  const { data: listData } = useList(listId);
  const addName = useAddName(listId!);
  const removeName = useRemoveName(listId!);

  const [showF, setShowF] = useState(true);
  const [showM, setShowM] = useState(true);

  const myNames = partnerRole === 'A'
    ? listData?.partnerA?.names ?? []
    : listData?.partnerB?.names ?? [];
  const isInMyList = myNames.includes(nameParam);

  const handleToggle = () => {
    if (!deviceId) return;
    if (isInMyList) removeName.mutate({ deviceId, name: nameParam });
    else addName.mutate({ deviceId, name: nameParam });
  };

  if (isLoading || !nameData) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // Build separate M/F time series aligned on a common year axis
  const allRows = popularity ?? [];
  const fByYear = new Map(allRows.filter((r) => r.gender === 'F').map((r) => [r.year, r.count]));
  const mByYear = new Map(allRows.filter((r) => r.gender === 'M').map((r) => [r.year, r.count]));
  const allYears = [...new Set(allRows.map((r) => r.year))].sort((a, b) => a - b);

  const hasFData = fByYear.size > 0;
  const hasMData = mByYear.size > 0;

  // Sample ~20 points for smooth rendering
  const step = Math.max(1, Math.ceil(allYears.length / 20));
  const sampledYears = allYears.filter((_, i) => i % step === 0);
  if (sampledYears.length > 0 && sampledYears[sampledYears.length - 1] !== allYears[allYears.length - 1]) {
    sampledYears.push(allYears[allYears.length - 1]);
  }

  const fData = sampledYears.map((y) => fByYear.get(y) ?? 0);
  const mData = sampledYears.map((y) => mByYear.get(y) ?? 0);

  // Only ~6 visible labels
  const labelStep = Math.max(1, Math.ceil(sampledYears.length / 6));
  const labels = sampledYears.map((y, i) =>
    i % labelStep === 0 || i === sampledYears.length - 1 ? String(y) : '',
  );

  const datasets = [
    ...(showF && hasFData ? [{ data: fData, color: (o = 1) => `rgba(232,96,138,${o})`, strokeWidth: 2 }] : []),
    ...(showM && hasMData ? [{ data: mData, color: (o = 1) => `rgba(91,141,239,${o})`, strokeWidth: 2 }] : []),
  ];
  // Fallback to prevent chart crash when both lines are hidden
  if (datasets.length === 0) {
    datasets.push({ data: sampledYears.map(() => 0), color: () => 'transparent', strokeWidth: 0 });
  }

  const showChart = sampledYears.length > 1 && (hasFData || hasMData);

  return (
    <View style={styles.container}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}>
          <Ionicons name="close" size={24} color={colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.name}>{nameData.name}</Text>

        <View style={styles.badges}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{nameData.sex === 'F' ? '♀ Girl' : '♂ Boy'}</Text>
          </View>
          {nameData.origin && (
            <View style={[styles.badge, styles.originBadge]}>
              <Text style={[styles.badgeText, styles.originBadgeText]}>{nameData.origin}</Text>
            </View>
          )}
        </View>

        <View style={styles.statsRow}>
          {nameData.year_peak && (
            <View style={styles.stat}>
              <Text style={styles.statValue}>{nameData.year_peak}</Text>
              <Text style={styles.statLabel}>Peak year</Text>
            </View>
          )}
          {yearRank?.rank && (
            <View style={styles.stat}>
              <Text style={styles.statValue}>#{yearRank.rank}</Text>
              <Text style={styles.statLabel}>{yearRank.year} rank</Text>
            </View>
          )}
        </View>

        {showChart && (
          <View style={styles.chartSection}>
            <View style={styles.chartHeader}>
              <Text style={styles.sectionTitle}>Popularity over time</Text>
              <View style={styles.legend}>
                {hasFData && (
                  <TouchableOpacity style={styles.legendItem} onPress={() => setShowF((v) => !v)}>
                    <View style={[styles.legendDot, { backgroundColor: GIRL_COLOR }, !showF && styles.legendDotOff]} />
                    <Text style={[styles.legendLabel, !showF && styles.legendLabelOff]}>Girl</Text>
                  </TouchableOpacity>
                )}
                {hasMData && (
                  <TouchableOpacity style={styles.legendItem} onPress={() => setShowM((v) => !v)}>
                    <View style={[styles.legendDot, { backgroundColor: BOY_COLOR }, !showM && styles.legendDotOff]} />
                    <Text style={[styles.legendLabel, !showM && styles.legendLabelOff]}>Boy</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
            <LineChart
              data={{ labels, datasets }}
              width={CHART_WIDTH}
              height={180}
              withDots={false}
              withInnerLines={false}
              chartConfig={{
                backgroundColor: colors.card,
                backgroundGradientFrom: colors.card,
                backgroundGradientTo: colors.card,
                color: () => colors.primary,
                labelColor: () => colors.textMuted,
                propsForLabels: { fontSize: 9 },
                // Fill color: blue for boy-only, pink for girl-only, transparent for both
                fillShadowGradient:
                  showM && hasMData && !(showF && hasFData) ? BOY_COLOR : GIRL_COLOR,
                fillShadowGradientOpacity:
                  showF && hasFData && showM && hasMData ? 0 : 0.15,
              }}
              bezier
              style={{ borderRadius: radius.md }}
            />
          </View>
        )}

        {nameData.similar_names.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Similar names</Text>
            <View style={styles.chips}>
              {nameData.similar_names.slice(0, 10).map((n) => (
                <TouchableOpacity key={n} style={styles.chip} onPress={() => router.replace(`/name/${n}`)}>
                  <Text style={styles.chipText}>{n}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {nameData.spelling_variants.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Spellings</Text>
            <View style={styles.chips}>
              {nameData.spelling_variants.map((v) => (
                <View key={v} style={[styles.chip, styles.variantChip]}>
                  <Text style={styles.chipText}>{v}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.toggleBtn, isInMyList && styles.toggleBtnActive]}
          onPress={handleToggle}
        >
          <Ionicons name={isInMyList ? 'heart' : 'heart-outline'} size={20} color={isInMyList ? '#fff' : colors.primary} />
          <Text style={[styles.toggleBtnText, isInMyList && styles.toggleBtnTextActive]}>
            {isInMyList ? 'In my list' : 'Add to my list'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.card },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerBar: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg + spacing.md, paddingBottom: spacing.md, alignItems: 'flex-end' },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 120 },
  name: { fontSize: fontSize.xxl, fontWeight: '900', color: colors.text, marginBottom: spacing.md },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  badge: { backgroundColor: colors.border, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  badgeText: { fontSize: fontSize.sm, color: colors.text, fontWeight: '600' },
  originBadge: { backgroundColor: colors.primaryLight },
  originBadgeText: { color: colors.primary },
  statsRow: { flexDirection: 'row', gap: spacing.xl, marginBottom: spacing.lg },
  stat: { alignItems: 'center' },
  statValue: { fontSize: fontSize.xl, fontWeight: '800', color: colors.text },
  statLabel: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  chartSection: { marginBottom: spacing.xl },
  chartHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  legend: { flexDirection: 'row', gap: spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendDotOff: { opacity: 0.25 },
  legendLabel: { fontSize: fontSize.xs, fontWeight: '600', color: colors.text },
  legendLabelOff: { color: colors.textMuted },
  section: { marginBottom: spacing.xl },
  sectionTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  chip: { backgroundColor: colors.primaryLight, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  variantChip: { backgroundColor: colors.border },
  chipText: { fontSize: fontSize.sm, color: colors.text, fontWeight: '600' },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border, padding: spacing.lg, paddingBottom: spacing.xl },
  toggleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderRadius: radius.lg, padding: spacing.md, borderWidth: 2, borderColor: colors.primary },
  toggleBtnActive: { backgroundColor: colors.primary },
  toggleBtnText: { fontSize: fontSize.md, fontWeight: '700', color: colors.primary },
  toggleBtnTextActive: { color: '#fff' },
});
