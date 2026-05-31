import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAddName, useList, useRemoveName } from '../../src/api/lists';
import { useRankings } from '../../src/api/names';
import type { RankingRow } from '../../src/api/types';
import { colors, fontSize, radius, spacing } from '../../src/constants/theme';
import { useSessionStore } from '../../src/store';

const CURRENT_YEAR = 2025;
const ALL_YEARS = Array.from({ length: CURRENT_YEAR - 1880 + 1 }, (_, i) => CURRENT_YEAR - i);
const YEAR_ROW_HEIGHT = 52;

export default function RankingsScreen() {
  const router = useRouter();
  const { listId, deviceId, partnerRole } = useSessionStore();
  const { bottom } = useSafeAreaInsets();
  const [year, setYear] = useState(CURRENT_YEAR);
  const [sex, setSex] = useState<'M' | 'F'>('F');
  const [yearPickerOpen, setYearPickerOpen] = useState(false);
  const yearListRef = useRef<FlatList>(null);

  const { data: listData } = useList(listId);
  const myNames = useMemo(() => {
    const partner = partnerRole === 'B' ? listData?.partnerB : listData?.partnerA;
    return new Set(partner?.names ?? []);
  }, [listData, partnerRole]);

  const addName = useAddName(listId!);
  const removeName = useRemoveName(listId!);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useRankings(year, sex);
  const rankings = data?.pages.flatMap((p) => p.rankings) ?? [];

  const renderItem = ({ item }: { item: RankingRow }) => {
    const isLiked = myNames.has(item.name);
    return (
      <TouchableOpacity style={styles.row} onPress={() => router.push(`/name/${item.name}?sex=${sex}`)}>
        <Text style={styles.rankNum}>#{item.rank}</Text>
        <View style={styles.nameCol}>
          <Text style={styles.nameText}>{item.name}</Text>
          <Text style={styles.countText}>{item.count.toLocaleString()} babies</Text>
        </View>
        <TouchableOpacity
          hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
          onPress={() => {
            if (!deviceId) return;
            if (isLiked) removeName.mutate({ deviceId, name: item.name });
            else addName.mutate({ deviceId, name: item.name });
          }}
        >
          <Ionicons
            name={isLiked ? 'heart' : 'heart-outline'}
            size={22}
            color={isLiked ? colors.primary : colors.textMuted}
          />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  const selectedYearIndex = ALL_YEARS.indexOf(year);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Lists</Text>
        <TouchableOpacity style={styles.yearBtn} onPress={() => setYearPickerOpen(true)}>
          <Text style={styles.yearBtnText}>{year}</Text>
          <Ionicons name="chevron-down" size={15} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Girl / Boy toggle */}
      <View style={styles.toggleRow}>
        {(['F', 'M'] as const).map((s) => (
          <TouchableOpacity
            key={s}
            style={[styles.toggleOption, sex === s && (s === 'F' ? styles.toggleF : styles.toggleM)]}
            onPress={() => setSex(s)}
          >
            <Text style={[styles.toggleText, sex === s && styles.toggleTextActive]}>
              {s === 'F' ? 'Girl ♀' : 'Boy ♂'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={rankings}
          keyExtractor={(item) => `${item.name}-${year}-${sex}`}
          renderItem={renderItem}
          onEndReached={() => hasNextPage && fetchNextPage()}
          onEndReachedThreshold={0.3}
          contentContainerStyle={styles.list}
          ListFooterComponent={
            isFetchingNextPage ? (
              <ActivityIndicator color={colors.primary} style={styles.footer} />
            ) : null
          }
        />
      )}

      {/* Year picker bottom sheet */}
      <Modal
        visible={yearPickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setYearPickerOpen(false)}
      >
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={() => setYearPickerOpen(false)}
        />
        <View style={[styles.sheet, { paddingBottom: bottom + spacing.md }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Select Year</Text>
            <TouchableOpacity onPress={() => setYearPickerOpen(false)}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
          <FlatList
            ref={yearListRef}
            data={ALL_YEARS}
            keyExtractor={String}
            getItemLayout={(_, index) => ({
              length: YEAR_ROW_HEIGHT,
              offset: YEAR_ROW_HEIGHT * index,
              index,
            })}
            initialScrollIndex={selectedYearIndex >= 0 ? selectedYearIndex : 0}
            renderItem={({ item: y }) => (
              <TouchableOpacity
                style={[styles.yearRow, y === year && styles.yearRowActive]}
                onPress={() => { setYear(y); setYearPickerOpen(false); }}
              >
                <Text style={[styles.yearRowText, y === year && styles.yearRowTextActive]}>{y}</Text>
                {y === year && <Ionicons name="checkmark" size={18} color={colors.primary} />}
              </TouchableOpacity>
            )}
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl + spacing.lg,
    paddingBottom: spacing.md,
  },
  headerTitle: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  yearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primaryLight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.full,
  },
  yearBtnText: { fontSize: fontSize.md, fontWeight: '700', color: colors.primary },
  toggleRow: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  toggleOption: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  toggleF: { backgroundColor: colors.primaryLight },
  toggleM: { backgroundColor: '#EEF3FD' },
  toggleText: { fontSize: fontSize.md, fontWeight: '600', color: colors.textMuted },
  toggleTextActive: { color: colors.text, fontWeight: '700' },
  list: { paddingBottom: spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  rankNum: {
    width: 48,
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.textMuted,
    textAlign: 'right',
  },
  nameCol: { flex: 1 },
  nameText: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  countText: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  footer: { padding: spacing.lg },
  // Year picker modal
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: '55%',
    paddingTop: spacing.sm,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sheetTitle: { fontSize: fontSize.md, fontWeight: '800', color: colors.text },
  yearRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: YEAR_ROW_HEIGHT,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  yearRowActive: { backgroundColor: colors.primaryLight },
  yearRowText: { fontSize: fontSize.md, color: colors.text },
  yearRowTextActive: { fontWeight: '700', color: colors.primary },
});
