import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAddName, useList, useRemoveName } from '../../src/api/lists';
import { useNameSearch } from '../../src/api/names';
import { useRecordSwipe } from '../../src/api/swipe';
import type { Name } from '../../src/api/types';
import { colors, fontSize, radius, spacing } from '../../src/constants/theme';
import { useSessionStore, useFilterStore } from '../../src/store';

export default function SearchScreen() {
  const router = useRouter();
  const { listId, deviceId, partnerRole } = useSessionStore();
  const filters = useFilterStore();
  const [q, setQ] = useState('');
  const inputRef = useRef<TextInput>(null);

  const { data: listData } = useList(listId);
  const myNames = useMemo(() => {
    const partner = partnerRole === 'B' ? listData?.partnerB : listData?.partnerA;
    return new Set(partner?.names ?? []);
  }, [listData, partnerRole]);

  const addName = useAddName(listId!);
  const removeName = useRemoveName(listId!);
  const { mutate: recordSwipe } = useRecordSwipe();

  const { data: results, isLoading } = useNameSearch(q);

  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }, []),
  );

  const renderItem = ({ item }: { item: Name }) => {
    const isLiked = myNames.has(item.name);
    return (
      <TouchableOpacity style={styles.row} onPress={() => router.push(`/name/${item.name}`)}>
        <Text style={[styles.sexIcon, item.sex === 'F' ? styles.sexF : styles.sexM]}>
          {item.sex === 'F' ? '♀' : '♂'}
        </Text>
        <View style={styles.nameCol}>
          <Text style={styles.nameText}>{item.name}</Text>
          {item.origin && (
            <View style={styles.originBadge}>
              <Text style={styles.originText}>{item.origin}</Text>
            </View>
          )}
        </View>
        <TouchableOpacity
          hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
          delayLongPress={400}
          onPress={() => {
            if (!deviceId) return;
            if (isLiked) {
              removeName.mutate({ deviceId, name: item.name });
            } else {
              addName.mutate({ deviceId, name: item.name });
              recordSwipe({ deviceId, name: item.name, liked: true, sex_context: filters.sex });
            }
          }}
          onLongPress={() => {
            if (!deviceId || isLiked) return;
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            ActionSheetIOS.showActionSheetWithOptions(
              {
                title: `Add "${item.name}" to`,
                options: ['Cancel', '♀ Girl list', 'Unisex list', '♂ Boy list'],
                cancelButtonIndex: 0,
              },
              (buttonIndex) => {
                const ctx = ([null, 'F', 'U', 'M'] as const)[buttonIndex];
                if (!ctx) return;
                addName.mutate({ deviceId, name: item.name });
                recordSwipe({ deviceId, name: item.name, liked: true, sex_context: ctx });
              },
            );
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

  const showSpinner = isLoading && q.length >= 2;
  const showEmpty = !isLoading && q.length >= 2 && (results?.length ?? 0) === 0;
  const showPrompt = q.length < 2;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Search</Text>
      </View>

      <View style={styles.segmentedRow}>
        <View style={styles.segmented}>
          {([['F', '♀ Girl'], ['U', 'Unisex'], ['M', '♂ Boy']] as ['F' | 'U' | 'M', string][]).map(([val, label]) => (
            <TouchableOpacity
              key={val}
              style={[styles.segment, filters.sex === val && styles.segmentActive]}
              onPress={() => filters.setSex(val)}
            >
              <Text style={[styles.segmentText, filters.sex === val && styles.segmentTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.searchBarRow}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={colors.textMuted} style={styles.searchIcon} />
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={q}
            onChangeText={setQ}
            placeholder="Search names…"
            placeholderTextColor={colors.textMuted}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>
      </View>

      {showPrompt && (
        <View style={styles.center}>
          <Ionicons name="search-outline" size={52} color={colors.border} />
          <Text style={styles.promptText}>Type at least 2 letters to search</Text>
        </View>
      )}

      {showSpinner && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}

      {showEmpty && (
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>🤷</Text>
          <Text style={styles.emptyTitle}>No names found</Text>
          <Text style={styles.emptyText}>Try a different spelling</Text>
        </View>
      )}

      {!showPrompt && !showSpinner && !showEmpty && (
        <FlatList
          data={results}
          keyExtractor={(item) => item.name}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl + spacing.lg,
    paddingBottom: spacing.sm,
  },
  headerTitle: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  segmentedRow: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  segmented: { flexDirection: 'row', backgroundColor: colors.border, borderRadius: radius.md, padding: 3 },
  segment: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: radius.sm },
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
  searchBarRow: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  searchIcon: { marginRight: spacing.sm },
  input: {
    flex: 1,
    height: 44,
    fontSize: fontSize.md,
    color: colors.text,
  },
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
  sexIcon: { fontSize: fontSize.md, fontWeight: '700', width: 18, textAlign: 'center' },
  sexF: { color: colors.primary },
  sexM: { color: colors.secondary },
  nameCol: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  nameText: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  originBadge: {
    backgroundColor: colors.primaryLight,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  originText: { fontSize: fontSize.xs, color: colors.primary, fontWeight: '600' },
  promptText: { fontSize: fontSize.md, color: colors.textMuted, textAlign: 'center', marginTop: spacing.sm },
  emptyEmoji: { fontSize: 48 },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  emptyText: { fontSize: fontSize.md, color: colors.textMuted },
});
