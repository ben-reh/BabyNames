import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useList, useRemoveName } from '../../src/api/lists';
import { useNamesBatch } from '../../src/api/names';
import { useSessionStore } from '../../src/store';
import { colors, fontSize, radius, spacing } from '../../src/constants/theme';

type SexFilter = 'any' | 'F' | 'M';

const SEX_OPTIONS: { label: string; value: SexFilter }[] = [
  { label: 'Any', value: 'any' },
  { label: 'Girl ♀', value: 'F' },
  { label: 'Boy ♂', value: 'M' },
];

export default function MyListScreen() {
  const router = useRouter();
  const { listId, deviceId, partnerRole } = useSessionStore();
  const { data, isLoading, refetch } = useList(listId);
  const removeName = useRemoveName(listId!);
  const [sexFilter, setSexFilter] = useState<SexFilter>('any');

  const myNames = partnerRole === 'A'
    ? data?.partnerA?.names ?? []
    : data?.partnerB?.names ?? [];

  const { data: sexMap } = useNamesBatch(myNames);

  const filtered = sexFilter === 'any'
    ? myNames
    : myNames.filter((n) => sexMap?.get(n) === sexFilter);

  if (isLoading) return <View style={styles.center}><Text style={styles.muted}>Loading...</Text></View>;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My List</Text>
        <Text style={styles.count}>{filtered.length} names</Text>
      </View>

      <View style={styles.segmentedRow}>
        <View style={styles.segmented}>
          {SEX_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={[styles.segment, sexFilter === opt.value && styles.segmentActive]}
              onPress={() => setSexFilter(opt.value)}
            >
              <Text style={[styles.segmentText, sexFilter === opt.value && styles.segmentTextActive]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {filtered.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>{myNames.length === 0 ? '💝' : '🔍'}</Text>
          <Text style={styles.emptyTitle}>
            {myNames.length === 0 ? 'No names yet' : 'No names match'}
          </Text>
          <Text style={styles.emptyText}>
            {myNames.length === 0
              ? 'Swipe right on names you love to add them here'
              : 'Try a different filter'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(name) => name}
          onRefresh={refetch}
          refreshing={isLoading}
          contentContainerStyle={styles.list}
          renderItem={({ item: name }) => {
            const sex = sexMap?.get(name);
            return (
              <TouchableOpacity style={styles.nameCard} onPress={() => router.push(`/name/${name}`)}>
                <View style={styles.nameRow}>
                  {sex && (
                    <Text style={[styles.sexIcon, sex === 'F' ? styles.sexF : styles.sexM]}>
                      {sex === 'F' ? '♀' : '♂'}
                    </Text>
                  )}
                  <Text style={styles.nameText}>{name}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => removeName.mutate({ deviceId: deviceId!, name })}
                  hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
                >
                  <Ionicons name="trash-outline" size={20} color={colors.textMuted} />
                </TouchableOpacity>
              </TouchableOpacity>
            );
          }}
        />
      )}
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
    paddingBottom: spacing.sm,
  },
  headerTitle: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  count: { fontSize: fontSize.sm, color: colors.textMuted, fontWeight: '600' },
  segmentedRow: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
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
  segmentText: { fontSize: fontSize.sm, color: colors.textMuted, fontWeight: '600' },
  segmentTextActive: { color: colors.text },
  list: { padding: spacing.lg, gap: spacing.sm },
  nameCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sexIcon: { fontSize: fontSize.sm, fontWeight: '700' },
  sexF: { color: colors.primary },
  sexM: { color: colors.secondary },
  nameText: { fontSize: fontSize.md, fontWeight: '600', color: colors.text },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  emptyEmoji: { fontSize: 56 },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  emptyText: { fontSize: fontSize.md, color: colors.textMuted, textAlign: 'center' },
  muted: { color: colors.textMuted },
});
