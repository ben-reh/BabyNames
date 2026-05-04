import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useList, useRemoveName } from '../../src/api/lists';
import { useSessionStore } from '../../src/store';
import { colors, fontSize, radius, spacing } from '../../src/constants/theme';

export default function MyListScreen() {
  const router = useRouter();
  const { listId, deviceId, partnerRole } = useSessionStore();
  const { data, isLoading, refetch } = useList(listId);
  const removeName = useRemoveName(listId!);

  const myNames = partnerRole === 'A'
    ? data?.partnerA?.names ?? []
    : data?.partnerB?.names ?? [];

  if (isLoading) return <View style={styles.center}><Text style={styles.muted}>Loading...</Text></View>;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My List</Text>
        <Text style={styles.count}>{myNames.length} names</Text>
      </View>

      {myNames.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>💝</Text>
          <Text style={styles.emptyTitle}>No names yet</Text>
          <Text style={styles.emptyText}>Swipe right on names you love to add them here</Text>
        </View>
      ) : (
        <FlatList
          data={myNames}
          keyExtractor={(name) => name}
          onRefresh={refetch}
          refreshing={isLoading}
          contentContainerStyle={styles.list}
          renderItem={({ item: name }) => (
            <TouchableOpacity style={styles.nameCard} onPress={() => router.push(`/name/${name}`)}>
              <Text style={styles.nameText}>{name}</Text>
              <TouchableOpacity
                onPress={() => removeName.mutate({ deviceId: deviceId!, name })}
                hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
              >
                <Ionicons name="trash-outline" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.xl + spacing.lg, paddingBottom: spacing.md },
  headerTitle: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  count: { fontSize: fontSize.sm, color: colors.textMuted, fontWeight: '600' },
  list: { padding: spacing.lg, gap: spacing.sm },
  nameCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4 },
  nameText: { fontSize: fontSize.md, fontWeight: '600', color: colors.text },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  emptyEmoji: { fontSize: 56 },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  emptyText: { fontSize: fontSize.md, color: colors.textMuted, textAlign: 'center' },
  muted: { color: colors.textMuted },
});
