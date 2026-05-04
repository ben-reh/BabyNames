import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useList } from '../../src/api/lists';
import { useSessionStore } from '../../src/store';
import { colors, fontSize, radius, spacing } from '../../src/constants/theme';

export default function MatchesScreen() {
  const router = useRouter();
  const { listId, code } = useSessionStore();
  const { data, isLoading, refetch } = useList(listId);

  if (isLoading) return <View style={styles.center}><Text style={styles.muted}>Loading...</Text></View>;

  const partnerJoined = data?.partnerCount === 2;
  const matches = data?.matches ?? [];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Matches</Text>
        {matches.length > 0 && <Text style={styles.count}>{matches.length}</Text>}
      </View>

      {!partnerJoined ? (
        <View style={styles.waiting}>
          <Text style={styles.waitingEmoji}>⏳</Text>
          <Text style={styles.waitingTitle}>Waiting for your partner</Text>
          <Text style={styles.waitingText}>Share this code so they can join</Text>
          <TouchableOpacity style={styles.codeBox} onPress={() => code && Clipboard.setStringAsync(code)}>
            <Text style={styles.codeText}>{code}</Text>
            <Text style={styles.copyHint}>Tap to copy</Text>
          </TouchableOpacity>
        </View>
      ) : matches.length === 0 ? (
        <View style={styles.waiting}>
          <Text style={styles.waitingEmoji}>🔍</Text>
          <Text style={styles.waitingTitle}>No matches yet</Text>
          <Text style={styles.waitingText}>Keep swiping — matches appear when you both like the same name</Text>
        </View>
      ) : (
        <FlatList
          data={matches}
          keyExtractor={(name) => name}
          onRefresh={refetch}
          refreshing={isLoading}
          contentContainerStyle={styles.list}
          ListHeaderComponent={<Text style={styles.matchesHeader}>You both love these names 💛</Text>}
          renderItem={({ item: name }) => (
            <TouchableOpacity style={styles.matchCard} onPress={() => router.push(`/name/${name}`)}>
              <Text style={styles.matchEmoji}>✨</Text>
              <Text style={styles.matchName}>{name}</Text>
              <Text style={styles.chevron}>›</Text>
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
  count: { backgroundColor: colors.primary, color: '#fff', fontSize: fontSize.sm, fontWeight: '700', paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.full, overflow: 'hidden' },
  waiting: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  waitingEmoji: { fontSize: 56 },
  waitingTitle: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  waitingText: { fontSize: fontSize.md, color: colors.textMuted, textAlign: 'center' },
  codeBox: { backgroundColor: colors.primaryLight, borderRadius: radius.lg, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
  codeText: { fontSize: 32, fontWeight: '900', letterSpacing: 6, color: colors.primary, fontFamily: 'monospace' },
  copyHint: { fontSize: fontSize.xs, color: colors.primary, opacity: 0.7 },
  list: { padding: spacing.lg, gap: spacing.sm },
  matchesHeader: { fontSize: fontSize.md, color: colors.textMuted, textAlign: 'center', marginBottom: spacing.md },
  matchCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, borderWidth: 1.5, borderColor: colors.match + '60', gap: spacing.md },
  matchEmoji: { fontSize: 20 },
  matchName: { flex: 1, fontSize: fontSize.md + 2, fontWeight: '700', color: colors.text },
  chevron: { fontSize: 22, color: colors.textMuted },
  muted: { color: colors.textMuted },
});
