import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Dimensions, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { useAddName, useList, useRemoveName } from '../../src/api/lists';
import { useName, useNamePopularity } from '../../src/api/names';
import { useSessionStore } from '../../src/store';
import { colors, fontSize, radius, spacing } from '../../src/constants/theme';

const CHART_WIDTH = Dimensions.get('window').width - spacing.lg * 2;

export default function NameDetail() {
  const router = useRouter();
  const { name: nameParam } = useLocalSearchParams<{ name: string }>();
  const { listId, deviceId, partnerRole } = useSessionStore();
  const { data: nameData, isLoading } = useName(nameParam);
  const { data: popularity } = useNamePopularity(nameParam);
  const { data: listData } = useList(listId);
  const addName = useAddName(listId!);
  const removeName = useRemoveName(listId!);

  const myNames = partnerRole === 'A'
    ? listData?.partnerA?.names ?? []
    : listData?.partnerB?.names ?? [];

  const isInMyList = myNames.includes(nameParam);

  const handleToggle = () => {
    if (!deviceId) return;
    if (isInMyList) {
      removeName.mutate({ deviceId, name: nameParam });
    } else {
      addName.mutate({ deviceId, name: nameParam });
    }
  };

  if (isLoading || !nameData) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // Build chart data from popularity rows (sample every 5 years to avoid clutter)
  const chartRows = (popularity ?? []).filter((_, i) => i % 5 === 0);
  const chartData = {
    labels: chartRows.map((r) => String(r.year)),
    datasets: [{ data: chartRows.map((r) => r.count) }],
  };

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
          {nameData.rank && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>Rank #{nameData.rank}</Text>
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
          {nameData.total_count && (
            <View style={styles.stat}>
              <Text style={styles.statValue}>{(nameData.total_count / 1000).toFixed(0)}K</Text>
              <Text style={styles.statLabel}>Total given</Text>
            </View>
          )}
        </View>

        {chartRows.length > 1 && (
          <View style={styles.chartSection}>
            <Text style={styles.sectionTitle}>Popularity over time</Text>
            <LineChart
              data={chartData}
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
                propsForLabels: { fontSize: 10 },
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
  section: { marginBottom: spacing.xl },
  sectionTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { backgroundColor: colors.primaryLight, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  variantChip: { backgroundColor: colors.border },
  chipText: { fontSize: fontSize.sm, color: colors.text, fontWeight: '600' },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border, padding: spacing.lg, paddingBottom: spacing.xl },
  toggleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderRadius: radius.lg, padding: spacing.md, borderWidth: 2, borderColor: colors.primary },
  toggleBtnActive: { backgroundColor: colors.primary },
  toggleBtnText: { fontSize: fontSize.md, fontWeight: '700', color: colors.primary },
  toggleBtnTextActive: { color: '#fff' },
});
