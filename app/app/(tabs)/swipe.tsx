import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Swiper from 'react-native-deck-swiper';
import { useAddName } from '../../src/api/lists';
import { useInfiniteNames } from '../../src/api/names';
import type { Name } from '../../src/api/types';
import { useSessionStore, useFilterStore } from '../../src/store';
import { colors, fontSize, radius, spacing } from '../../src/constants/theme';

function NameCard({ name }: { name: Name }) {
  const router = useRouter();
  return (
    <TouchableOpacity style={styles.card} onPress={() => router.push(`/name/${name.name}`)} activeOpacity={0.95}>
      <View style={styles.cardContent}>
        <Text style={styles.cardName}>{name.name}</Text>
        {name.origin && (
          <View style={styles.originBadge}>
            <Text style={styles.originText}>{name.origin}</Text>
          </View>
        )}
        <View style={styles.cardMeta}>
          <Text style={styles.metaText}>#{name.rank}</Text>
          {name.year_peak && <Text style={styles.metaText}>Peak {name.year_peak}</Text>}
          <Text style={styles.metaText}>{name.sex === 'F' ? '♀' : '♂'}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function SwipeScreen() {
  const router = useRouter();
  const { listId, deviceId } = useSessionStore();
  const filters = useFilterStore();
  const swiperRef = useRef<Swiper<Name>>(null);
  const [queue, setQueue] = useState<Name[]>([]);
  const [cardIndex, setCardIndex] = useState(0);
  const addName = useAddName(listId!);

  const { data, fetchNextPage, hasNextPage } = useInfiniteNames({
    sex: filters.sex ?? undefined,
    origin: filters.origin ?? undefined,
    limit: 30,
  });

  useEffect(() => {
    if (data) {
      const allNames = data.pages.flatMap((p) => p.names);
      setQueue(allNames);
      setCardIndex(0);
    }
  }, [data]);

  useEffect(() => {
    if (queue.length - cardIndex < 5 && hasNextPage) {
      fetchNextPage();
    }
  }, [cardIndex, queue.length, hasNextPage]);

  const handleSwipedRight = useCallback(
    (idx: number) => {
      const name = queue[idx];
      if (!name || !listId || !deviceId) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      addName.mutate({ deviceId, name: name.name });
      setCardIndex(idx + 1);
    },
    [queue, listId, deviceId, addName],
  );

  const handleSwipedLeft = useCallback((idx: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCardIndex(idx + 1);
  }, []);

  if (!queue.length) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Discover</Text>
        <TouchableOpacity onPress={() => router.push('/filter-sheet')}>
          <Ionicons name="options" size={24} color={colors.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.deckContainer}>
        <Swiper
          ref={swiperRef}
          cards={queue}
          cardIndex={cardIndex}
          renderCard={(name) => <NameCard name={name} />}
          onSwipedRight={handleSwipedRight}
          onSwipedLeft={handleSwipedLeft}
          backgroundColor="transparent"
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

      <View style={styles.actions}>
        <TouchableOpacity style={[styles.actionBtn, styles.passBtn]} onPress={() => swiperRef.current?.swipeLeft()}>
          <Ionicons name="close" size={32} color={colors.error} />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, styles.likeBtn]} onPress={() => swiperRef.current?.swipeRight()}>
          <Ionicons name="heart" size={32} color={colors.primary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.xl + spacing.lg, paddingBottom: spacing.md },
  headerTitle: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  deckContainer: { flex: 1 },
  card: { height: '100%', borderRadius: radius.xl, backgroundColor: colors.card, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 12, elevation: 5 },
  cardContent: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.lg },
  cardName: { fontSize: fontSize.xxl, fontWeight: '900', color: colors.text },
  originBadge: { backgroundColor: colors.primaryLight, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.full },
  originText: { fontSize: fontSize.sm, color: colors.primary, fontWeight: '600' },
  cardMeta: { flexDirection: 'row', gap: spacing.md },
  metaText: { fontSize: fontSize.md, color: colors.textMuted },
  actions: { flexDirection: 'row', justifyContent: 'center', gap: spacing.xl, paddingBottom: spacing.xl + spacing.lg, paddingTop: spacing.lg },
  actionBtn: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 6, elevation: 3 },
  passBtn: { backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.error + '40' },
  likeBtn: { backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.primary + '40' },
  overlayNope: { fontSize: 32, fontWeight: '900', color: colors.error, borderWidth: 3, borderColor: colors.error, padding: spacing.sm, borderRadius: radius.sm },
  overlayLike: { fontSize: 32, fontWeight: '900', color: colors.success, borderWidth: 3, borderColor: colors.success, padding: spacing.sm, borderRadius: radius.sm },
  overlayWrapperLeft: { flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'flex-start', marginTop: 30, marginLeft: -30 },
  overlayWrapperRight: { flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start', marginTop: 30, marginLeft: 30 },
});
