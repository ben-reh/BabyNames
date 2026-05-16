import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PanGestureHandler, ScrollView, State } from 'react-native-gesture-handler';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  LayoutAnimation,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { api } from '../../src/api/client';
import { useJoinList, useList } from '../../src/api/lists';
import { useNamesBatch } from '../../src/api/names';
import { useSwipedNames } from '../../src/api/swipe';
import { colors, fontSize, radius, spacing } from '../../src/constants/theme';
import { useSessionStore, useListOrderStore } from '../../src/store';

type SexFilter = 'F' | 'M' | 'U';

const SEX_OPTIONS: { label: string; value: SexFilter }[] = [
  { label: '♀ Girl', value: 'F' },
  { label: 'Unisex', value: 'U' },
  { label: '♂ Boy', value: 'M' },
];

function SectionHeader({
  title,
  count,
  expanded,
  onToggle,
  right,
}: {
  title: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  right?: React.ReactNode;
}) {
  return (
    <TouchableOpacity style={styles.sectionHeader} onPress={onToggle} activeOpacity={0.7}>
      <View style={styles.sectionHeaderLeft}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <View style={styles.countBadge}>
          <Text style={styles.countBadgeText}>{count}</Text>
        </View>
      </View>
      <View style={styles.sectionHeaderRight}>
        {right}
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
      </View>
    </TouchableOpacity>
  );
}

function NameRow({ name, onPress }: { name: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.nameCard} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.nameRow}>
        <Text style={styles.nameText}>{name}</Text>
      </View>
    </TouchableOpacity>
  );
}

const ITEM_HEIGHT = 56;

function DraggableNameRow({
  name,
  fromIdx,
  panRef,
  isDragging,
  showDropAbove,
  showDropBelow,
  draggable,
  onPress,
  onDragStart,
  onDragUpdate,
  onDragEnd,
  onDragCancel,
}: {
  name: string;
  fromIdx: number;
  panRef: React.RefObject<PanGestureHandler>;
  isDragging: boolean;
  showDropAbove: boolean;
  showDropBelow: boolean;
  draggable: boolean;
  onPress: () => void;
  onDragStart: (idx: number) => void;
  onDragUpdate: (idx: number, dy: number) => void;
  onDragEnd: (idx: number, dy: number) => void;
  onDragCancel: () => void;
}) {
  return (
    <>
      {showDropAbove && <View style={styles.dropIndicator} />}
      <View style={[styles.nameCard, isDragging && styles.nameCardDragging]}>
        <TouchableOpacity style={styles.nameRow} onPress={onPress} activeOpacity={0.7}>
          <Text style={styles.nameText}>{name}</Text>
        </TouchableOpacity>
        {draggable && (
          <PanGestureHandler
            ref={panRef}
            onGestureEvent={(e) => onDragUpdate(fromIdx, e.nativeEvent.translationY)}
            onHandlerStateChange={(e) => {
              const { state, translationY } = e.nativeEvent;
              if (state === State.ACTIVE) onDragStart(fromIdx);
              else if (state === State.END) onDragEnd(fromIdx, translationY);
              else if (state === State.CANCELLED || state === State.FAILED) onDragCancel();
            }}
          >
            <View style={styles.gripArea}>
              <Ionicons
                name="reorder-three-outline"
                size={24}
                color={isDragging ? colors.primary : colors.textMuted}
              />
            </View>
          </PanGestureHandler>
        )}
      </View>
      {showDropBelow && <View style={styles.dropIndicator} />}
    </>
  );
}

export default function MyListsScreen() {
  const router = useRouter();
  const { listId, deviceId, partnerRole, code, setSession, clearSession, defaultSex } = useSessionStore();
  const [sexFilter, setSexFilter] = useState<SexFilter>(() => (defaultSex === 'F' || defaultSex === 'M' ? defaultSex : 'U'));
  const { data, isLoading } = useList(listId);
  const { data: passedNames = [] } = useSwipedNames(deviceId, false, sexFilter);
  const { mutate: joinList, isPending: isJoining, error: joinError, reset: resetJoin } = useJoinList();
  const [likedExpanded, setLikedExpanded] = useState(false);
  const [matchesExpanded, setMatchesExpanded] = useState(false);
  const [passedExpanded, setPassedExpanded] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    AsyncStorage.getItem('seen_my_lists').then((val) => {
      if (val === null) {
        setMatchesExpanded(true);
        AsyncStorage.setItem('seen_my_lists', '1');
      }
    });
  }, []);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const joinInputRef = useRef<TextInput>(null);
  const panRefMap = useRef(new Map<string, React.RefObject<PanGestureHandler>>());
  const getPanRef = (name: string): React.RefObject<PanGestureHandler> => {
    if (!panRefMap.current.has(name)) panRefMap.current.set(name, React.createRef<PanGestureHandler>());
    return panRefMap.current.get(name)!;
  };

  const myNames = partnerRole === 'A' ? data?.partnerA?.names ?? [] : data?.partnerB?.names ?? [];
  const matches = data?.matches ?? [];
  const partnerJoined = data?.partnerCount === 2;

  const allNames = [...new Set([...myNames, ...matches, ...passedNames])];
  const { data: sexMap } = useNamesBatch(allNames);

  function applyFilter(names: string[]) {
    return names.filter((n) => {
      const entry = sexMap?.get(n);
      const unknownDefault = defaultSex === 'F' ? 1 : defaultSex === 'M' ? 0 : 0.5;
      const femalePct = entry == null ? unknownDefault : (entry.female_pct ?? (entry.sex === 'F' ? 1 : 0));
      if (sexFilter === 'F') return femalePct >= 0.05;
      if (sexFilter === 'M') return femalePct <= 0.95;
      if (sexFilter === 'U') return femalePct > 0.05 && femalePct < 0.95;
      return true;
    });
  }

  const EMPTY_ORDER = useRef<string[]>([]).current;
  const storedOrder = useListOrderStore((s) => s.orders[listId ?? ''] ?? EMPTY_ORDER);
  const setOrder = useListOrderStore((s) => s.setOrder);

  const matchSearch = (n: string) => !search || n.toLowerCase().includes(search.toLowerCase());

  const baseLiked = useMemo(
    () => applyFilter(myNames),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [myNames, sexMap, sexFilter],
  );
  const orderedLiked = useMemo(() => {
    const likedSet = new Set(baseLiked);
    const ordered = storedOrder.filter((n) => likedSet.has(n));
    const inOrder = new Set(ordered);
    return [...ordered, ...baseLiked.filter((n) => !inOrder.has(n))];
  }, [baseLiked, storedOrder]);
  const filteredLiked = orderedLiked.filter(matchSearch);

  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [targetIdx, setTargetIdx] = useState<number | null>(null);
  const orderedLikedRef = useRef(orderedLiked);
  useEffect(() => { orderedLikedRef.current = orderedLiked; }, [orderedLiked]);

  const handleDragStart = (idx: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setDraggingIdx(idx);
    setTargetIdx(idx);
  };

  const handleDragUpdate = (fromIdx: number, dy: number) => {
    const list = orderedLikedRef.current;
    const to = Math.max(0, Math.min(list.length - 1, Math.round(fromIdx + dy / ITEM_HEIGHT)));
    setTargetIdx(to);
  };

  const handleDragEnd = (fromIdx: number, dy: number) => {
    const list = orderedLikedRef.current;
    const to = Math.max(0, Math.min(list.length - 1, Math.round(fromIdx + dy / ITEM_HEIGHT)));
    if (to !== fromIdx && listId) {
      LayoutAnimation.easeInEaseOut();
      const next = [...list];
      const [item] = next.splice(fromIdx, 1);
      next.splice(to, 0, item);
      setOrder(listId, next);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setDraggingIdx(null);
    setTargetIdx(null);
  };

  const handleDragCancel = () => {
    setDraggingIdx(null);
    setTargetIdx(null);
  };

  const filteredMatches = applyFilter(matches).filter(matchSearch);
  const filteredPassed = passedNames.filter(matchSearch);

  const openJoinModal = () => {
    resetJoin();
    setJoinCode('');
    setShowJoinModal(true);
  };

  const closeJoinModal = () => {
    setShowJoinModal(false);
    setJoinCode('');
    resetJoin();
  };

  const doJoin = (carryOver: boolean) => {
    if (!deviceId) return;
    joinList(
      { code: joinCode, deviceId },
      {
        onSuccess: async (result) => {
          if (carryOver && myNames.length > 0) {
            for (const name of myNames) {
              try {
                await api.post(`/lists/${result.listId}/names`, { deviceId, name });
              } catch {}
            }
          }
          setSession({ listId: result.listId, deviceId, partnerRole: result.role, code: joinCode });
          closeJoinModal();
        },
      },
    );
  };

  const handleJoin = () => {
    if (!deviceId || joinCode.length < 6) return;
    if (myNames.length > 0) {
      Alert.alert(
        'Carry over your liked names?',
        `You have ${myNames.length} liked ${myNames.length === 1 ? 'name' : 'names'}. Add them to the new list?`,
        [
          { text: 'Start fresh', style: 'cancel', onPress: () => doJoin(false) },
          { text: 'Carry over', onPress: () => doJoin(true) },
        ],
      );
    } else {
      doJoin(false);
    }
  };

  const handleDevReset = () => {
    Alert.alert('Reset session', 'Clear all local data and start fresh?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: async () => {
          await AsyncStorage.clear();
          clearSession();
        },
      },
    ]);
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Loading...</Text>
      </View>
    );
  }

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        waitFor={filteredLiked.map(name => getPanRef(name))}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>My Lists</Text>
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

        <View style={styles.searchBarRow}>
          <View style={styles.searchBar}>
            <Ionicons name="search" size={18} color={colors.textMuted} style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Filter names…"
              placeholderTextColor={colors.textMuted}
              autoCorrect={false}
              autoCapitalize="none"
              clearButtonMode="while-editing"
            />
          </View>
        </View>

        {/* Liked section */}
        <View style={styles.section}>
          <SectionHeader
            title="Liked"
            count={filteredLiked.length}
            expanded={likedExpanded}
            onToggle={() => setLikedExpanded((v) => !v)}
          />
          {likedExpanded && (
            filteredLiked.length === 0 ? (
              <View style={styles.emptySection}>
                <Text style={styles.muted}>
                  {myNames.length === 0 ? 'Swipe right on names to add them here' : 'No names match this filter'}
                </Text>
              </View>
            ) : (
              <View style={styles.sectionList}>
                {filteredLiked.map((name, idx) => (
                  <DraggableNameRow
                    key={name}
                    name={name}
                    fromIdx={idx}
                    panRef={getPanRef(name)}
                    isDragging={draggingIdx === idx}
                    showDropAbove={targetIdx === idx && draggingIdx !== null && idx < draggingIdx}
                    showDropBelow={targetIdx === idx && draggingIdx !== null && idx > draggingIdx}
                    draggable={!search}
                    onPress={() => router.push(`/name/${name}`)}
                    onDragStart={handleDragStart}
                    onDragUpdate={handleDragUpdate}
                    onDragEnd={handleDragEnd}
                    onDragCancel={handleDragCancel}
                  />
                ))}
              </View>
            )
          )}
        </View>

        {/* Matches section */}
        <View style={styles.section}>
          <SectionHeader
            title="Matches"
            count={filteredMatches.length}
            expanded={matchesExpanded}
            onToggle={() => setMatchesExpanded((v) => !v)}
            right={
              __DEV__ ? (
                <TouchableOpacity onPress={handleDevReset} hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}>
                  <Text style={styles.devReset}>⚙</Text>
                </TouchableOpacity>
              ) : undefined
            }
          />
          {matchesExpanded && (
            !partnerJoined ? (
              <View style={styles.waitingSection}>
                <Text style={styles.waitingText}>Share this code so your partner can join</Text>
                <TouchableOpacity
                  style={styles.codeBox}
                  onPress={() => code && Clipboard.setStringAsync(code)}
                >
                  <Text style={styles.codeText}>{code}</Text>
                  <Text style={styles.copyHint}>Tap to copy</Text>
                </TouchableOpacity>
                <View style={styles.dividerRow}>
                  <View style={styles.divider} />
                  <Text style={styles.dividerText}>or</Text>
                  <View style={styles.divider} />
                </View>
                <TouchableOpacity style={styles.joinCodeBtn} onPress={openJoinModal}>
                  <Text style={styles.joinCodeBtnText}>Enter partner's code</Text>
                </TouchableOpacity>
              </View>
            ) : filteredMatches.length === 0 ? (
              <View style={styles.emptySection}>
                <Text style={styles.muted}>
                  {matches.length === 0
                    ? 'Matches appear when you both like the same name'
                    : 'No matches match this filter'}
                </Text>
              </View>
            ) : (
              <View style={styles.sectionList}>
                {filteredMatches.map((name) => (
                  <TouchableOpacity
                    key={name}
                    style={[styles.nameCard, styles.matchCard]}
                    onPress={() => router.push(`/name/${name}`)}
                  >
                    <View style={styles.nameRow}>
                      <Text style={styles.nameText}>{name}</Text>
                    </View>
                    <Text style={styles.matchEmoji}>✨</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )
          )}
        </View>

        {/* Passed section */}
        <View style={styles.section}>
          <SectionHeader
            title="Passed"
            count={filteredPassed.length}
            expanded={passedExpanded}
            onToggle={() => setPassedExpanded((v) => !v)}
          />
          {passedExpanded && (
            filteredPassed.length === 0 ? (
              <View style={styles.emptySection}>
                <Text style={styles.muted}>
                  {passedNames.length === 0 ? 'Names you skip will appear here' : 'No names match this filter'}
                </Text>
              </View>
            ) : (
              <View style={styles.sectionList}>
                {filteredPassed.map((name) => (
                  <NameRow
                    key={name}
                    name={name}
                    onPress={() => router.push(`/name/${name}`)}
                  />
                ))}
              </View>
            )
          )}
        </View>
      </ScrollView>

      <Modal
        visible={showJoinModal}
        transparent
        animationType="slide"
        onRequestClose={closeJoinModal}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={closeJoinModal} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Enter partner's code</Text>
            <Text style={styles.modalSubtitle}>Ask your partner for their 6-character share code</Text>

            <TextInput
              ref={joinInputRef}
              style={styles.codeInput}
              value={joinCode}
              onChangeText={(t) => {
                setJoinCode(t.toUpperCase().slice(0, 6));
                if (joinError) resetJoin();
              }}
              placeholder="ABC123"
              placeholderTextColor={colors.border}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={6}
              autoFocus
            />

            {joinError && (
              <Text style={styles.errorText}>Code not found or list is full</Text>
            )}

            <TouchableOpacity
              style={[styles.joinBtn, (joinCode.length < 6 || isJoining) && styles.joinBtnDisabled]}
              onPress={handleJoin}
              disabled={joinCode.length < 6 || isJoining}
            >
              {isJoining ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.joinBtnText}>Join list</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelBtn} onPress={closeJoinModal}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: spacing.xl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
  searchInput: { flex: 1, height: 44, fontSize: fontSize.md, color: colors.text },
  section: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  sectionHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sectionHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sectionTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  countBadge: {
    backgroundColor: colors.border,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  countBadgeText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.textMuted },
  sectionList: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm },
  emptySection: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, alignItems: 'center' },
  nameCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  nameCardDragging: {
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 8,
  },
  dropIndicator: { height: 3, backgroundColor: colors.primary, borderRadius: 2, marginHorizontal: spacing.sm, marginVertical: 1 },
  matchCard: { borderWidth: 1.5, borderColor: colors.match + '60' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  nameText: { fontSize: fontSize.md, fontWeight: '600', color: colors.text },
  gripArea: { padding: 12 },
  matchEmoji: { fontSize: 18 },
  waitingSection: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, alignItems: 'center', gap: spacing.md },
  waitingText: { fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center' },
  codeBox: {
    backgroundColor: colors.primaryLight,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    alignItems: 'center',
    gap: spacing.xs,
  },
  codeText: { fontSize: 32, fontWeight: '900', letterSpacing: 6, color: colors.primary, fontFamily: 'monospace' },
  copyHint: { fontSize: fontSize.xs, color: colors.primary, opacity: 0.7 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, width: '100%' },
  divider: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { fontSize: fontSize.xs, color: colors.textMuted, fontWeight: '600' },
  joinCodeBtn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  joinCodeBtnText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.primary },
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  devReset: { fontSize: fontSize.md, color: colors.textMuted },
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  modalSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl + spacing.lg,
    paddingTop: spacing.md,
    alignItems: 'center',
    gap: spacing.md,
  },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.sm },
  modalTitle: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  modalSubtitle: { fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center' },
  codeInput: {
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: 10,
    color: colors.text,
    textAlign: 'center',
    borderBottomWidth: 2,
    borderBottomColor: colors.primary,
    paddingBottom: spacing.sm,
    minWidth: 220,
    fontFamily: 'monospace',
  },
  errorText: { fontSize: fontSize.sm, color: colors.error },
  joinBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    width: '100%',
    marginTop: spacing.sm,
  },
  joinBtnDisabled: { opacity: 0.5 },
  joinBtnText: { color: '#fff', fontSize: fontSize.md, fontWeight: '700' },
  cancelBtn: { paddingVertical: spacing.sm },
  cancelBtnText: { fontSize: fontSize.sm, color: colors.textMuted, fontWeight: '600' },
});
