import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Swiper from 'react-native-deck-swiper';
import { useAddName, useList, useRemoveName } from '../../src/api/lists';
import { useInfiniteNames, useNameSearch } from '../../src/api/names';
import { useInfiniteRecommendations } from '../../src/api/recommendations';
import { useRecordSwipe } from '../../src/api/swipe';
import type { Name } from '../../src/api/types';
import { useSessionStore, useFilterStore, useSeenNamesStore } from '../../src/store';
import { colors, fontSize, radius, spacing } from '../../src/constants/theme';
import { logSwipe, logTimeToFirstCard, logQueueFetch, logQueueRebuild } from '../../src/utils/analytics';

const CARD_BG: Record<string, string> = {
  F: colors.primaryLight,
  M: '#EEF3FD',
  default: colors.card,
};

function NameCard({ name, sex }: { name: Name; sex: 'F' | 'M' | null }) {
  const router = useRouter();
  const cardBg = CARD_BG[sex ?? 'default'] ?? CARD_BG.default;
  if (!name) return <View style={[styles.card, { backgroundColor: cardBg }]} />;
  const displayRank = name.rank_2025 ?? name.rank;
  return (
    <TouchableOpacity style={[styles.card, { backgroundColor: cardBg }]} onPress={() => router.push(`/name/${name.name}`)} activeOpacity={0.95}>
      <View style={styles.cardContent}>
        <Text style={styles.cardName}>{name.name}</Text>
        <View style={styles.cardMeta}>
          {name.year_peak && <Text style={styles.metaText}>Peak {name.year_peak}</Text>}
          {displayRank != null && <Text style={styles.metaText}>#{displayRank} in 2025</Text>}
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function SwipeScreen() {
  const router = useRouter();
  const { listId, deviceId, partnerRole } = useSessionStore();
  const filters = useFilterStore();
  const { seenNames, addSeen } = useSeenNamesStore();
  const swiperRef = useRef<Swiper<Name>>(null);
  const [q, setQ] = useState('');
  const inputRef = useRef<TextInput>(null);
  const [queue, setQueue] = useState<Name[]>([]);
  const [cardIndex, setCardIndex] = useState(0);
  const [deckHeight, setDeckHeight] = useState(0);
  const seenNamesRef = useRef(seenNames);
  const cardIndexRef = useRef(0);
  const mountTimeRef = useRef(Date.now());
  const firstCardLoggedRef = useRef(false);
  const lastSwipeTimeRef = useRef<number | null>(null);
  // Tracks the card just swiped so the likedNames filter doesn't shift the queue
  // and cause a one-frame flash of the wrong card. Cleared after the next filter pass.
  const justSwipedRef = useRef<string | null>(null);
  const addName = useAddName(listId!);
  const removeName = useRemoveName(listId!);
  const { mutate: recordSwipe } = useRecordSwipe();
  const { data: searchResults, isLoading: searchLoading } = useNameSearch(q);

  const { data: listData } = useList(listId);
  const likedNames = useMemo(() => {
    const partner = partnerRole === 'B' ? listData?.partnerB : listData?.partnerA;
    return new Set(partner?.names ?? []);
  }, [listData, partnerRole]);
  // Ref so queue effects can read current likedNames without it being a trigger
  const likedNamesRef = useRef(new Set<string>());
  useEffect(() => { likedNamesRef.current = likedNames; }, [likedNames]);
  useEffect(() => { seenNamesRef.current = seenNames; }, [seenNames]);

  const filterKey = `${filters.sex ?? ''}-${filters.origins.join(',')}-${[...filters.popularity].sort().join(',')}`;
  // committedFilterKey only advances to match filterKey once the queue has been
  // rebuilt for that filter. Using it as the Swiper key ensures the deck
  // remounts in the same render that the new queue lands, so the Swiper never
  // initialises with stale cards.
  const [committedFilterKey, setCommittedFilterKey] = useState(filterKey);
  const loadedFilterKeyRef = useRef(filterKey);

  const namesResult = useInfiniteNames({
    sex: filters.sex ?? undefined,
    origins: filters.origins,
    listId: listId ?? undefined,
    deviceId: deviceId ?? undefined,
    limit: 30,
  });
  const recommendationsResult = useInfiniteRecommendations({
    deviceId: deviceId ?? '',
    listId: listId ?? undefined,
    sex: filters.sex ?? undefined,
    origins: filters.origins,
    popularity: filters.popularity,
  });
  const { data, fetchNextPage, hasNextPage } = deviceId ? recommendationsResult : namesResult;

  useEffect(() => {
    // No data yet (new query in flight) — clear the deck and wait.
    if (!data) {
      setQueue([]);
      setCardIndex(0);
      cardIndexRef.current = 0;
      return;
    }

    const allNames = data.pages
      .flatMap((p) => p.names)
      .filter((n) => !seenNamesRef.current[n.name] && !likedNamesRef.current.has(n.name));

    if (loadedFilterKeyRef.current !== filterKey) {
      // Filter changed — reset to the first card of the new result set.
      // setCommittedFilterKey is batched with the queue reset so the Swiper
      // remounts in the same render it receives the new cards (cardIndex=0).
      loadedFilterKeyRef.current = filterKey;
      cardIndexRef.current = 0;
      setCardIndex(0);
      setQueue(allNames);
      setCommittedFilterKey(filterKey);
      logQueueRebuild(filterKey, allNames.length);
    } else {
      // New data arrived — preserve the full visible stack so incoming names
      // never replace cards the Swiper is actively rendering (stackSize = 3).
      setQueue((prev) => {
        const pos = cardIndexRef.current;
        const preserved = prev.slice(0, pos + 3); // protect current + 2 stacked cards
        const preservedNames = new Set(preserved.map((n) => n.name));
        const tail = allNames.filter((n) => !preservedNames.has(n.name));
        const next = [...preserved, ...tail];
        // Avoid a new array reference (and Swiper re-render) if nothing actually changed.
        if (next.length === prev.length && next.every((n, i) => n.name === prev[i].name)) return prev;
        return next;
      });
    }
  }, [filterKey, data]);

  // When liked names change, filter them out of the queue — but ONLY beyond the
  // visible stack. Removing anything at idx ≤ pos+2 would shift cardIndex's
  // referent and cause the visible card to jump (the source of the swipe-right flash).
  useEffect(() => {
    setQueue((prev) => {
      const pos = cardIndexRef.current;
      return prev.filter((n, idx) => idx <= pos + 2 || !likedNamesRef.current.has(n.name));
    });
    justSwipedRef.current = null;
  }, [likedNames]);

  // Time-to-first-card: log once when the queue first becomes non-empty
  useEffect(() => {
    if (queue.length > 0 && !firstCardLoggedRef.current) {
      firstCardLoggedRef.current = true;
      logTimeToFirstCard(Date.now() - mountTimeRef.current, queue.length);
    }
  }, [queue.length]);

  useEffect(() => {
    cardIndexRef.current = cardIndex;
    if (queue.length - cardIndex < 5 && hasNextPage) {
      const tracker = logQueueFetch('low_buffer', cardIndex, queue.length);
      const prevSize = queue.length;
      fetchNextPage().then(() => tracker.done(queue.length - prevSize));
    }
  }, [cardIndex, queue.length, hasNextPage]);

  const handleSwipedRight = useCallback(
    (idx: number) => {
      const name = queue[idx];
      if (!name || !listId || !deviceId) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const now = Date.now();
      logSwipe('right', name.name, queue.length - idx - 1, lastSwipeTimeRef.current ? now - lastSwipeTimeRef.current : null);
      lastSwipeTimeRef.current = now;
      justSwipedRef.current = name.name;
      // Update ref immediately so any concurrent queue rebuild uses the correct position
      cardIndexRef.current = idx + 1;
      addSeen(name.name);
      addName.mutate({ deviceId, name: name.name });
      recordSwipe({ deviceId, name: name.name, liked: true, sex_context: filters.sex });
      setCardIndex(idx + 1);
    },
    [queue, listId, deviceId, addSeen, addName, recordSwipe],
  );

  const handleSwipedLeft = useCallback(
    (idx: number) => {
      const name = queue[idx];
      if (name) {
        const now = Date.now();
        logSwipe('left', name.name, queue.length - idx - 1, lastSwipeTimeRef.current ? now - lastSwipeTimeRef.current : null);
        lastSwipeTimeRef.current = now;
        // Update ref immediately so any concurrent queue rebuild uses the correct position
        cardIndexRef.current = idx + 1;
        addSeen(name.name);
        if (deviceId) recordSwipe({ deviceId, name: name.name, liked: false, sex_context: filters.sex });
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setCardIndex(idx + 1);
    },
    [queue, deviceId, addSeen, recordSwipe],
  );

  const renderSearchItem = ({ item }: { item: Name }) => {
    const isLiked = likedNames.has(item.name);
    return (
      <TouchableOpacity style={styles.searchRow} onPress={() => router.push(`/name/${item.name}`)}>
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
          onPress={() => {
            if (!deviceId) return;
            if (isLiked) {
              removeName.mutate({ deviceId, name: item.name });
            } else {
              addName.mutate({ deviceId, name: item.name });
              recordSwipe({ deviceId, name: item.name, liked: true, sex_context: filters.sex });
            }
          }}
        >
          <Ionicons name={isLiked ? 'heart' : 'heart-outline'} size={22} color={isLiked ? colors.primary : colors.textMuted} />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  const searching = q.length >= 2;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>Discover</Text>
        </View>
        <View style={styles.headerRight}>
          <View style={styles.sexToggle}>
            {([['F', '♀ Girl'], ['M', '♂ Boy']] as ['F' | 'M', string][]).map(([val, label]) => (
              <TouchableOpacity
                key={val}
                style={[styles.sexSegment, filters.sex === val && styles.sexSegmentActive]}
                onPress={() => filters.setSex(val)}
              >
                <Text style={[styles.sexSegmentText, filters.sex === val && styles.sexSegmentTextActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity onPress={() => router.push('/filter-sheet')} style={styles.filterBtn}>
            <Ionicons name="options" size={24} color={filters.origins.length > 0 ? colors.primary : colors.text} />
            {filters.origins.length > 0 && <View style={styles.filterDot} />}
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.searchBarRow}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={colors.textMuted} style={styles.searchIcon} />
          <TextInput
            ref={inputRef}
            style={styles.searchInput}
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

      {searching ? (
        searchLoading ? (
          <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
        ) : (searchResults?.length ?? 0) === 0 ? (
          <View style={styles.center}><Text style={styles.emptyText}>No names found</Text></View>
        ) : (
          <FlatList
            data={searchResults}
            keyExtractor={(item) => item.name}
            renderItem={renderSearchItem}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.searchList}
          />
        )
      ) : !queue.length ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : (
        <View style={styles.deckContainer} onLayout={(e) => setDeckHeight(e.nativeEvent.layout.height)}>
          <Swiper
            key={committedFilterKey}
            ref={swiperRef}
            cards={queue}
            cardIndex={cardIndex}
            renderCard={(name) => <NameCard name={name} sex={filters.sex} />}
            onSwipedRight={handleSwipedRight}
            onSwipedLeft={handleSwipedLeft}
            backgroundColor="transparent"
            cardVerticalMargin={deckHeight > 0 ? Math.round(deckHeight * 0.03) : 4}
            stackSize={3}
            stackSeparation={12}
            overlayLabels={{
              left: { title: 'NOPE', style: { label: styles.overlayNope, wrapper: styles.overlayWrapperLeft } },
              right: { title: '❤️', style: { label: styles.overlayLike, wrapper: styles.overlayWrapperRight } },
            }}
            infinite={false}
            animateOverlayLabelsOpacity
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.xl + spacing.lg, paddingBottom: spacing.md },
  headerLeft:  { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerTitle: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  deckContainer: { flex: 1 },
  card: { height: '69%', borderRadius: radius.xl, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 12, elevation: 5 },
  cardContent: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.lg },
  cardName: { fontSize: fontSize.xxl, fontWeight: '900', color: colors.text },
  cardMeta: { flexDirection: 'row', gap: spacing.md },
  metaText: { fontSize: fontSize.md, color: colors.textMuted },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  sexToggle: { flexDirection: 'row', backgroundColor: colors.border, borderRadius: radius.full, padding: 2 },
  sexSegment: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.full },
  sexSegmentActive: { backgroundColor: colors.card },
  sexSegmentText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textMuted },
  sexSegmentTextActive: { color: colors.text },
  filterBtn: { position: 'relative' },
  filterDot: { position: 'absolute', top: -2, right: -2, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  overlayNope: { fontSize: 32, fontWeight: '900', color: colors.error, borderWidth: 3, borderColor: colors.error, padding: spacing.sm, borderRadius: radius.sm },
  overlayLike: { fontSize: 32, fontWeight: '900', color: colors.success, borderWidth: 3, borderColor: colors.success, padding: spacing.sm, borderRadius: radius.sm },
  overlayWrapperLeft: { flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'flex-start', marginTop: 30, marginLeft: -30 },
  overlayWrapperRight: { flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start', marginTop: 30, marginLeft: 30 },
  searchBarRow: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.border, paddingHorizontal: spacing.md },
  searchIcon: { marginRight: spacing.sm },
  searchInput: { flex: 1, height: 44, fontSize: fontSize.md, color: colors.text },
  searchList: { paddingBottom: spacing.xl },
  searchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, gap: spacing.md },
  sexIcon: { fontSize: fontSize.md, fontWeight: '700', width: 18, textAlign: 'center' },
  sexF: { color: colors.primary },
  sexM: { color: colors.secondary },
  nameCol: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  nameText: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  originBadge: { backgroundColor: colors.primaryLight, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  originText: { fontSize: fontSize.xs, color: colors.primary, fontWeight: '600' },
  emptyText: { fontSize: fontSize.md, color: colors.textMuted },
});
