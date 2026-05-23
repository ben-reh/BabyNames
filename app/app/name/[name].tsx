import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Dimensions, FlatList, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { useAddName, useList, useRemoveName, useSetSpellingOverride } from '../../src/api/lists';
import { useName, useNameComparableNames, useNamePopularity, useNameYearRank } from '../../src/api/names';
import { useRecordSwipe } from '../../src/api/swipe';
import { useSessionStore } from '../../src/store';
import { colors, fontSize, radius, spacing } from '../../src/constants/theme';
import { SSA_BIRTHS_BY_YEAR } from '../../src/constants/ssaBirths';

const CHART_WIDTH = Dimensions.get('window').width - spacing.lg * 2;
const GIRL_COLOR = colors.primary;       // pink
const BOY_COLOR = colors.secondary;      // blue

export default function NameDetail() {
  const router = useRouter();
  const { name: nameParam, sex: sexParam } = useLocalSearchParams<{ name: string; sex?: string }>();
  const { listId, deviceId, partnerRole, birthYear, setBirthYear } = useSessionStore();
  const { data: nameData, isLoading } = useName(nameParam);
  const { data: popularity } = useNamePopularity(nameParam);
  const rankSex = (sexParam === 'M' || sexParam === 'F') ? sexParam : (nameData?.sex ?? 'F');
  const { data: yearRank } = useNameYearRank(nameParam, rankSex);
  const { data: fComparable } = useNameComparableNames(nameParam, 'F', birthYear);
  const { data: mComparable } = useNameComparableNames(nameParam, 'M', birthYear);
  const { data: listData } = useList(listId);
  const addName = useAddName(listId!);
  const removeName = useRemoveName(listId!);
  const { mutate: setSpellingOverride } = useSetSpellingOverride(listId!);
  const { mutate: recordSwipe } = useRecordSwipe();

  const spellingOverrides = listData?.spellingOverrides ?? {};
  const displayName = spellingOverrides[nameParam] ?? nameParam;

  const [yearPickerVisible, setYearPickerVisible] = useState(false);

  const [showF, setShowF] = useState(true);
  const [showM, setShowM] = useState(true);
  const [showGenderTooltip, setShowGenderTooltip] = useState(false);

  const myNames = partnerRole === 'A'
    ? listData?.partnerA?.names ?? []
    : listData?.partnerB?.names ?? [];
  const isInMyList = myNames.includes(nameParam);

  const handleAdd = (sexContext: 'F' | 'M' | 'U') => {
    if (!deviceId) return;
    addName.mutate({ deviceId, name: nameParam });
    recordSwipe({ deviceId, name: nameParam, liked: true, sex_context: sexContext });
  };

  const handleToggle = () => {
    if (!deviceId) return;
    if (isInMyList) {
      removeName.mutate({ deviceId, name: nameParam });
    } else {
      handleAdd(nameData?.sex === 'M' ? 'M' : 'F');
    }
  };

  const handleLongPress = () => {
    if (!deviceId || !nameData) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: isInMyList ? `Move "${nameParam}" to` : `Add "${nameParam}" to`,
        options: ['Cancel', '♀ Girl list', 'Unisex list', '♂ Boy list'],
        cancelButtonIndex: 0,
      },
      (buttonIndex) => {
        const ctx = ([null, 'F', 'U', 'M'] as const)[buttonIndex];
        if (!ctx) return;
        if (isInMyList) {
          recordSwipe({ deviceId, name: nameParam, liked: true, sex_context: ctx });
        } else {
          handleAdd(ctx);
        }
      },
    );
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

  // Compute female_pct from 2025 popularity data; fall back to DynamoDB value
  const f2025 = fByYear.get(2025) ?? 0;
  const m2025 = mByYear.get(2025) ?? 0;
  const total2025 = f2025 + m2025;
  const femalePct = total2025 > 0 ? f2025 / total2025 : (nameData.female_pct ?? null);
  const fPct2025 = total2025 > 0 ? f2025 / total2025 : 0;
  const mPct2025 = total2025 > 0 ? m2025 / total2025 : 0;

  // Sample ~20 points for smooth rendering
  const step = Math.max(1, Math.ceil(allYears.length / 20));
  const sampledYears = allYears.filter((_, i) => i % step === 0);
  if (sampledYears.length > 0 && sampledYears[sampledYears.length - 1] !== allYears[allYears.length - 1]) {
    sampledYears.push(allYears[allYears.length - 1]);
  }

  const toPct = (count: number, year: number) => {
    const total = SSA_BIRTHS_BY_YEAR[year];
    return total ? (count / total) * 100 : 0;
  };
  const fData = sampledYears.map((y) => toPct(fByYear.get(y) ?? 0, y));
  const mData = sampledYears.map((y) => toPct(mByYear.get(y) ?? 0, y));

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
        <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace('/')} hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}>
          <Ionicons name="close" size={24} color={colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.name}>{displayName}</Text>
        {nameData.meaning && (
          <Text style={styles.meaning}>"{nameData.meaning}"</Text>
        )}

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
          {nameData.origin && (
            <View style={styles.stat}>
              <Text style={styles.statValue}>{nameData.origin}</Text>
              <Text style={styles.statLabel}>Origin</Text>
            </View>
          )}
        </View>

        {femalePct != null && (
          <TouchableOpacity
            style={styles.genderBarSection}
            onPress={() => setShowGenderTooltip((v) => !v)}
            activeOpacity={0.8}
          >
            <View style={styles.genderBarRow}>
              <Text style={styles.genderBarLabel}>♀ {Math.round(femalePct * 100)}%</Text>
              <Text style={styles.genderBarLabel}>{Math.round((1 - femalePct) * 100)}% ♂</Text>
            </View>
            <View style={styles.genderBar}>
              <View style={[styles.genderBarFemale, { flex: femalePct * 100 }]} />
              <View style={[styles.genderBarMale, { flex: (1 - femalePct) * 100 }]} />
            </View>
            {showGenderTooltip && (
              <View style={styles.tooltip}>
                <Text style={styles.tooltipText}>Based on 2025 births</Text>
              </View>
            )}
          </TouchableOpacity>
        )}

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
              formatYLabel={(v) => `${parseFloat(v).toFixed(2)}%`}
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

        {(f2025 > 0 || m2025 > 0) && (
          <View style={styles.contextSection}>
            {[
              { sex: 'F' as const, count: f2025, pct: fPct2025, comparable: fComparable },
              { sex: 'M' as const, count: m2025, pct: mPct2025, comparable: mComparable },
            ]
              .sort((a, b) => b.pct - a.pct)
              .filter((g) => g.pct > 0.05)
              .map((g, i) => (
                <Text
                  key={g.sex}
                  style={[styles.contextText, i > 0 ? styles.contextBlockDivider : undefined]}
                >
                  {`There were ${g.count.toLocaleString()} (${((g.count / (SSA_BIRTHS_BY_YEAR[2025] ?? 1)) * 100).toFixed(2)}%) baby `}
                  <Text style={{ color: g.sex === 'F' ? GIRL_COLOR : BOY_COLOR }}>{g.sex === 'F' ? 'girls' : 'boys'}</Text>
                  {` named ${nameData.name} in 2025.`}
                  {g.comparable && g.comparable.length > 0 && (
                    <>
                      {' This is similar to '}
                      <Text style={styles.contextLink} onPress={() => router.replace(`/name/${g.comparable![0]}`)}>
                        {g.comparable[0]}
                      </Text>
                      {g.comparable.length >= 2 && (
                        <>
                          {' or '}
                          <Text style={styles.contextLink} onPress={() => router.replace(`/name/${g.comparable![1]}`)}>
                            {g.comparable[1]}
                          </Text>
                        </>
                      )}
                      {' for '}
                      <Text style={{ color: g.sex === 'F' ? GIRL_COLOR : BOY_COLOR }}>{g.sex === 'F' ? 'girls' : 'boys'}</Text>
                      {' born in '}
                      <Text style={styles.yearLink} onPress={() => setYearPickerVisible(true)}>{birthYear}</Text>
                      {'.'}
                    </>
                  )}
                </Text>
              ))}
          </View>
        )}

        {(nameData.vibe_names?.length ?? 0) > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>You might also like</Text>
            <View style={styles.chips}>
              {(nameData.vibe_names ?? []).slice(0, 10).map((n) => (
                <TouchableOpacity key={n} style={styles.chip} onPress={() => router.replace(`/name/${n}`)}>
                  <Text style={styles.chipText}>{n}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {(nameData.phonetic_names?.length ?? 0) > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Similar Sounding Names</Text>
            <View style={styles.chips}>
              {(nameData.phonetic_names ?? []).slice(0, 8).map((n) => (
                <TouchableOpacity key={n} style={styles.chip} onPress={() => router.replace(`/name/${n}`)}>
                  <Text style={styles.chipText}>{n}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {nameData.spelling_variants.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Spellings of {nameParam}</Text>
            <View style={styles.chips}>
              {[nameParam, ...nameData.spelling_variants].map((v) => {
                const isSelected = v === displayName;
                return (
                  <TouchableOpacity
                    key={v}
                    style={[styles.chip, styles.variantChip, isSelected && styles.variantChipSelected]}
                    onPress={() => {
                      if (isSelected) return;
                      Alert.alert(
                        `Use "${v}"?`,
                        `This will show "${v}" wherever "${nameParam}" appears in your list.`,
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Use this spelling',
                            onPress: () => {
                              if (!listId) return;
                              setSpellingOverride({ name: nameParam, displayName: v });
                            },
                          },
                        ],
                      );
                    }}
                  >
                    <Text style={[styles.chipText, isSelected && styles.variantChipTextSelected]}>{v}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}
      </ScrollView>

      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.toggleBtn, isInMyList && styles.toggleBtnActive]}
          onPress={handleToggle}
          onLongPress={handleLongPress}
          delayLongPress={400}
        >
          <Ionicons name={isInMyList ? 'heart' : 'heart-outline'} size={20} color={isInMyList ? '#fff' : colors.primary} />
          <Text style={[styles.toggleBtnText, isInMyList && styles.toggleBtnTextActive]}>
            {isInMyList ? 'In my list' : 'Add to my list'}
          </Text>
        </TouchableOpacity>
        {!isInMyList && (
          <Text style={styles.longPressHint}>Hold to choose which list</Text>
        )}
      </View>

      <YearSelectorModal
        visible={yearPickerVisible}
        value={birthYear}
        onSelect={(y) => { setBirthYear(y); setYearPickerVisible(false); }}
        onClose={() => setYearPickerVisible(false)}
      />
    </View>
  );
}

const BIRTH_YEARS = Array.from({ length: 2010 - 1950 + 1 }, (_, i) => 1950 + i);
const YEAR_ITEM_HEIGHT = 52;

function YearSelectorModal({
  visible,
  value,
  onSelect,
  onClose,
}: {
  visible: boolean;
  value: number;
  onSelect: (y: number) => void;
  onClose: () => void;
}) {
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    if (visible) {
      const index = BIRTH_YEARS.indexOf(value);
      if (index >= 0) {
        setTimeout(() => {
          listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0.5 });
        }, 80);
      }
    }
  }, [visible, value]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={pickerStyles.overlay} activeOpacity={1} onPress={onClose}>
        <View style={pickerStyles.sheet} onStartShouldSetResponder={() => true}>
          <View style={pickerStyles.handle} />
          <View style={pickerStyles.header}>
            <Text style={pickerStyles.title}>Your birth year</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <Text style={pickerStyles.done}>Done</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            ref={listRef}
            data={BIRTH_YEARS}
            keyExtractor={(y) => String(y)}
            getItemLayout={(_, index) => ({ length: YEAR_ITEM_HEIGHT, offset: YEAR_ITEM_HEIGHT * index, index })}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => {
              const selected = item === value;
              return (
                <TouchableOpacity
                  style={[pickerStyles.item, selected && pickerStyles.itemSelected]}
                  onPress={() => onSelect(item)}
                  activeOpacity={0.7}
                >
                  <Text style={[pickerStyles.itemText, selected && pickerStyles.itemTextSelected]}>
                    {item}
                  </Text>
                  {selected && <Ionicons name="checkmark" size={18} color={colors.primary} />}
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.card },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerBar: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg + spacing.md, paddingBottom: spacing.md, alignItems: 'flex-end' },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 120 },
  name: { fontSize: fontSize.xxl, fontWeight: '900', color: colors.text, marginBottom: spacing.xs },
  meaning: { fontSize: fontSize.md, color: colors.textMuted, fontStyle: 'italic', marginBottom: spacing.lg },
  statsRow: { flexDirection: 'row', gap: spacing.xl, marginBottom: spacing.lg, flexWrap: 'wrap' },
  stat: { alignItems: 'center' },
  statValue: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text, textAlign: 'center' },
  statLabel: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  genderBarSection: { marginBottom: spacing.lg },
  genderBarRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs },
  genderBarLabel: { fontSize: fontSize.xs, color: colors.textMuted, fontWeight: '600' },
  genderBar: { flexDirection: 'row', height: 8, borderRadius: radius.full, overflow: 'hidden' },
  genderBarFemale: { backgroundColor: colors.primary },
  genderBarMale: { backgroundColor: colors.secondary },
  tooltip: {
    alignSelf: 'center',
    marginTop: spacing.sm,
    backgroundColor: colors.text,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  tooltipText: { fontSize: fontSize.xs, color: '#fff', fontWeight: '600' },
  chartSection: { marginBottom: spacing.xl },
  chartHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  legend: { flexDirection: 'row', gap: spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendDotOff: { opacity: 0.25 },
  legendLabel: { fontSize: fontSize.xs, fontWeight: '600', color: colors.text },
  legendLabelOff: { color: colors.textMuted },
  contextSection: { marginBottom: spacing.xl, gap: spacing.xs },
  contextBlockDivider: { marginTop: spacing.md },
  contextText: { fontSize: fontSize.sm, color: colors.textMuted, lineHeight: 20 },
  contextLink: { fontSize: fontSize.sm, color: colors.text, fontWeight: '600' },
  yearLink: { fontSize: fontSize.sm, fontWeight: '700', color: colors.primary, textDecorationLine: 'underline' },
  section: { marginBottom: spacing.xl },
  sectionTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  chip: { backgroundColor: colors.primaryLight, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  variantChip: { backgroundColor: colors.border },
  variantChipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  variantChipTextSelected: { color: '#fff' },
  chipText: { fontSize: fontSize.sm, color: colors.text, fontWeight: '600' },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border, padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.xs },
  longPressHint: { fontSize: fontSize.xs, color: colors.textMuted, textAlign: 'center' },
  toggleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderRadius: radius.lg, padding: spacing.md, borderWidth: 2, borderColor: colors.primary },
  toggleBtnActive: { backgroundColor: colors.primary },
  toggleBtnText: { fontSize: fontSize.md, fontWeight: '700', color: colors.primary },
  toggleBtnTextActive: { color: '#fff' },
});

const pickerStyles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: 420,
    paddingBottom: spacing.xl,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  title: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  done: { fontSize: fontSize.md, fontWeight: '600', color: colors.primary },
  item: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    height: YEAR_ITEM_HEIGHT, paddingHorizontal: spacing.lg,
  },
  itemSelected: { backgroundColor: colors.primaryLight },
  itemText: { fontSize: fontSize.md, color: colors.text },
  itemTextSelected: { fontWeight: '700', color: colors.primary },
});
