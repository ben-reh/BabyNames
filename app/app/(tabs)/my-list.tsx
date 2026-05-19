import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { NestableDraggableFlatList, NestableScrollContainer, RenderItemParams } from 'react-native-draggable-flatlist';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
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
import {
  PREDEFINED_TAGS,
  TAG_COLOR_OPTIONS,
  TagDef,
  useCreateTag,
  useDeleteTag,
  usePartnerTags,
  useSetNameTags,
  useTagAssignments,
  useTagDefs,
} from '../../src/api/tags';
import { colors, fontSize, radius, spacing } from '../../src/constants/theme';
import { useSessionStore, useListOrderStore, useFilterStore } from '../../src/store';

type SexFilter = 'F' | 'M' | 'U';

const SEX_OPTIONS: { label: string; value: SexFilter }[] = [
  { label: '♀ Girl', value: 'F' },
  { label: 'Unisex', value: 'U' },
  { label: '♂ Boy', value: 'M' },
];

function TagChip({ tag }: { tag: TagDef }) {
  return (
    <View style={[styles.tagChip, { backgroundColor: tag.color + '22' }]}>
      <View style={[styles.tagDot, { backgroundColor: tag.color }]} />
      <Text style={[styles.tagChipText, { color: tag.color }]}>{tag.label}</Text>
    </View>
  );
}

function PartnerTagChip({ tag }: { tag: TagDef }) {
  return (
    <View style={[styles.tagChip, { borderWidth: 1.5, borderColor: tag.color + '99', backgroundColor: 'transparent' }]}>
      <View style={[styles.tagDot, { backgroundColor: tag.color + '99' }]} />
      <Text style={[styles.tagChipText, { color: tag.color + '99' }]}>{tag.label}</Text>
    </View>
  );
}

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
        <Ionicons name={expanded ? 'chevron-down' : 'chevron-back'} size={18} color={colors.textMuted} />
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

function DraggableNameRow({
  name,
  drag,
  isActive,
  onPress,
  tags,
  partnerTags,
  onTagPress,
}: {
  name: string;
  drag: () => void;
  isActive: boolean;
  onPress: () => void;
  tags: TagDef[];
  partnerTags: TagDef[];
  onTagPress: () => void;
}) {
  return (
    <View style={[styles.nameCard, isActive && styles.nameCardDragging]}>
      <TouchableOpacity style={styles.nameContent} onPress={onPress} activeOpacity={0.7}>
        <Text style={styles.nameText}>{name}</Text>
        {(tags.length > 0 || partnerTags.length > 0) && (
          <View style={styles.tagChipsRow}>
            {tags.map((t) => <TagChip key={t.id} tag={t} />)}
            {partnerTags.map((t) => <PartnerTagChip key={`p-${t.id}`} tag={t} />)}
          </View>
        )}
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onTagPress}
        style={styles.tagButton}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons
          name="pricetag-outline"
          size={18}
          color={tags.length > 0 ? colors.primary : colors.textMuted}
        />
      </TouchableOpacity>
      <TouchableOpacity onPressIn={drag} style={styles.gripArea} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="reorder-three-outline" size={24} color={isActive ? colors.primary : colors.textMuted} />
      </TouchableOpacity>
    </View>
  );
}

export default function MyListsScreen() {
  const router = useRouter();
  const { listId, deviceId, partnerRole, code, setSession, clearSession, defaultSex } = useSessionStore();
  const { sex: rawSex, setSex } = useFilterStore();
  const sexFilter: SexFilter = rawSex ?? 'F';
  const setSexFilter = setSex;
  const { data, isLoading } = useList(listId);
  const { data: passedNames = [] } = useSwipedNames(deviceId, false, sexFilter);
  const { mutate: joinList, isPending: isJoining, error: joinError, reset: resetJoin } = useJoinList();
  const [likedExpanded, setLikedExpanded] = useState(false);
  const [matchesExpanded, setMatchesExpanded] = useState(false);
  const [passedExpanded, setPassedExpanded] = useState(false);
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [selectedNameForTag, setSelectedNameForTag] = useState<string | null>(null);
  const [isCreatingTag, setIsCreatingTag] = useState(false);
  const [newTagLabel, setNewTagLabel] = useState('');
  const [newTagColor, setNewTagColor] = useState(TAG_COLOR_OPTIONS[0]);

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

  // Tag data
  const { data: customTagDefs = [] } = useTagDefs(deviceId);
  const { data: tagAssignments = {} } = useTagAssignments(deviceId);
  const { mutate: createTag } = useCreateTag(deviceId);
  const { mutate: deleteTag } = useDeleteTag(deviceId);
  const { mutate: setNameTags } = useSetNameTags(deviceId);
  const allTagDefs = useMemo(() => [...PREDEFINED_TAGS, ...customTagDefs], [customTagDefs]);

  const { data: partnerTagData } = usePartnerTags(listId, deviceId);
  const partnerTagAssignments = partnerTagData?.assignments ?? {};
  const partnerAllTagDefs = useMemo(
    () => [...PREDEFINED_TAGS, ...(partnerTagData?.customDefs ?? [])],
    [partnerTagData],
  );

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

  const filteredLiked = orderedLiked
    .filter(matchSearch)
    .filter((n) => !tagFilter || (tagAssignments[n] ?? []).includes(tagFilter));

  const filteredMatches = applyFilter(matches).filter(matchSearch);
  const filteredPassed = passedNames.filter(matchSearch);

  // Tags that have at least one assignment among liked names (for the filter row)
  const tagsInUse = useMemo(
    () => allTagDefs.filter((tag) => baseLiked.some((n) => (tagAssignments[n] ?? []).includes(tag.id))),
    [allTagDefs, baseLiked, tagAssignments],
  );

  function getNameTags(name: string): TagDef[] {
    const ids = tagAssignments[name] ?? [];
    return ids.flatMap((id) => allTagDefs.find((t) => t.id === id) ?? []);
  }

  function getPartnerNameTags(name: string): TagDef[] {
    const ids = partnerTagAssignments[name] ?? [];
    return ids.flatMap((id) => partnerAllTagDefs.find((t) => t.id === id) ?? []);
  }

  function toggleTag(name: string, tagId: string) {
    const current = tagAssignments[name] ?? [];
    const newTagIds = current.includes(tagId) ? current.filter((t) => t !== tagId) : [...current, tagId];
    setNameTags({ name, tagIds: newTagIds });
  }

  function openCreateTag() {
    setNewTagLabel('');
    setNewTagColor(TAG_COLOR_OPTIONS[0]);
    setIsCreatingTag(true);
  }

  function submitCreateTag() {
    if (!newTagLabel.trim()) return;
    createTag({ label: newTagLabel.trim(), color: newTagColor });
    setIsCreatingTag(false);
    setNewTagLabel('');
  }

  function handleDeleteTag(tagId: string) {
    Alert.alert('Delete tag?', 'This will remove the tag from all names.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteTag(tagId) },
    ]);
  }

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
      <NestableScrollContainer style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>My Lists</Text>
        </View>

        <View style={styles.segmentedRow}>
          <View style={styles.segmented}>
            {SEX_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.segment, sexFilter === opt.value && styles.segmentActive]}
                onPress={() => { setSexFilter(opt.value); setTagFilter(null); }}
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

        {tagsInUse.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.filterRow}
            contentContainerStyle={styles.filterRowContent}
          >
            <TouchableOpacity
              style={[styles.filterChip, !tagFilter && styles.filterChipActive]}
              onPress={() => setTagFilter(null)}
            >
              <Text style={[styles.filterChipText, !tagFilter && styles.filterChipTextActive]}>All</Text>
            </TouchableOpacity>
            {tagsInUse.map((tag) => (
              <TouchableOpacity
                key={tag.id}
                style={[
                  styles.filterChip,
                  tagFilter === tag.id && { backgroundColor: tag.color + '22', borderColor: tag.color },
                ]}
                onPress={() => setTagFilter((v) => (v === tag.id ? null : tag.id))}
              >
                <View style={[styles.tagDot, { backgroundColor: tag.color }]} />
                <Text style={[styles.filterChipText, tagFilter === tag.id && { color: tag.color }]}>
                  {tag.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* Liked section */}
        <View style={[styles.section, { overflow: 'visible' }]}>
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
                <NestableDraggableFlatList
                  data={filteredLiked}
                  keyExtractor={(name) => name}
                  scrollEnabled={false}
                  onDragBegin={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }}
                  onDragEnd={({ data }) => { if (listId) setOrder(listId, data); }}
                  renderItem={({ item: name, drag, isActive }: RenderItemParams<string>) => (
                    <DraggableNameRow
                      name={name}
                      drag={drag}
                      isActive={isActive}
                      onPress={() => router.push(`/name/${name}`)}
                      tags={getNameTags(name)}
                      partnerTags={getPartnerNameTags(name)}
                      onTagPress={() => setSelectedNameForTag(name)}
                    />
                  )}
                />
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
                {filteredMatches.map((name) => {
                  const myTags = getNameTags(name);
                  const theirTags = getPartnerNameTags(name);
                  return (
                    <TouchableOpacity
                      key={name}
                      style={[styles.nameCard, styles.matchCard]}
                      onPress={() => router.push(`/name/${name}`)}
                    >
                      <View style={styles.nameContent}>
                        <Text style={styles.nameText}>{name}</Text>
                        {(myTags.length > 0 || theirTags.length > 0) && (
                          <View style={styles.tagChipsRow}>
                            {myTags.map((t) => <TagChip key={t.id} tag={t} />)}
                            {theirTags.map((t) => <PartnerTagChip key={`p-${t.id}`} tag={t} />)}
                          </View>
                        )}
                      </View>
                      <Text style={styles.matchEmoji}>✨</Text>
                    </TouchableOpacity>
                  );
                })}
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
      </NestableScrollContainer>

      {/* Tag picker sheet */}
      {selectedNameForTag && (
        <Modal
          visible
          transparent
          animationType="slide"
          onRequestClose={() => { setSelectedNameForTag(null); setIsCreatingTag(false); }}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.modalOverlay}
          >
            <TouchableOpacity
              style={styles.modalBackdrop}
              activeOpacity={1}
              onPress={() => { setSelectedNameForTag(null); setIsCreatingTag(false); }}
            />
            <View style={styles.modalSheet}>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>Tag "{selectedNameForTag}"</Text>

              <ScrollView style={styles.tagPickerList} showsVerticalScrollIndicator={false}>
                {allTagDefs.map((tag) => {
                  const isAssigned = (tagAssignments[selectedNameForTag] ?? []).includes(tag.id);
                  const isCustom = !PREDEFINED_TAGS.find((p) => p.id === tag.id);
                  return (
                    <TouchableOpacity
                      key={tag.id}
                      style={styles.tagPickerRow}
                      onPress={() => toggleTag(selectedNameForTag, tag.id)}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.tagDot, styles.tagDotLg, { backgroundColor: tag.color }]} />
                      <Text style={styles.tagPickerLabel}>{tag.label}</Text>
                      <View style={styles.tagPickerSpacer} />
                      {isCustom && (
                        <TouchableOpacity
                          onPress={() => handleDeleteTag(tag.id)}
                          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        >
                          <Ionicons name="close-circle-outline" size={20} color={colors.textMuted} />
                        </TouchableOpacity>
                      )}
                      {isAssigned && (
                        <Ionicons
                          name="checkmark"
                          size={20}
                          color={colors.primary}
                          style={isCustom ? styles.checkmarkWithDelete : undefined}
                        />
                      )}
                    </TouchableOpacity>
                  );
                })}

                {isCreatingTag ? (
                  <View style={styles.createTagForm}>
                    <TextInput
                      style={styles.createTagInput}
                      value={newTagLabel}
                      onChangeText={setNewTagLabel}
                      placeholder="Tag name"
                      placeholderTextColor={colors.textMuted}
                      autoFocus
                      autoCorrect={false}
                      maxLength={24}
                      onSubmitEditing={submitCreateTag}
                      returnKeyType="done"
                    />
                    <View style={styles.colorSwatchRow}>
                      {TAG_COLOR_OPTIONS.map((c) => (
                        <TouchableOpacity key={c} onPress={() => setNewTagColor(c)} activeOpacity={0.8}>
                          <View style={[styles.colorSwatch, { backgroundColor: c }, newTagColor === c && styles.colorSwatchSelected]} />
                        </TouchableOpacity>
                      ))}
                    </View>
                    <View style={styles.createTagActions}>
                      <TouchableOpacity onPress={() => setIsCreatingTag(false)} style={styles.createTagCancel}>
                        <Text style={styles.createTagCancelText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={submitCreateTag}
                        style={[styles.createTagSubmit, !newTagLabel.trim() && styles.createTagSubmitDisabled]}
                        disabled={!newTagLabel.trim()}
                      >
                        <Text style={styles.createTagSubmitText}>Add</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity style={styles.addTagRow} onPress={openCreateTag} activeOpacity={0.7}>
                    <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
                    <Text style={styles.addTagText}>Create new tag</Text>
                  </TouchableOpacity>
                )}
              </ScrollView>

              <TouchableOpacity style={styles.doneBtn} onPress={() => { setSelectedNameForTag(null); setIsCreatingTag(false); }}>
                <Text style={styles.doneBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      )}

      {/* Join partner modal */}
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
  filterRow: { marginBottom: spacing.md },
  filterRowContent: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  filterChipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  filterChipText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textMuted },
  filterChipTextActive: { color: colors.primary },
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
  matchCard: { borderWidth: 1.5, borderColor: colors.match + '60' },
  nameContent: { flex: 1, gap: spacing.xs },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  nameText: { fontSize: fontSize.md, fontWeight: '600', color: colors.text },
  tagChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  tagDot: { width: 6, height: 6, borderRadius: 3 },
  tagDotLg: { width: 10, height: 10, borderRadius: 5 },
  tagChipText: { fontSize: fontSize.xs, fontWeight: '600' },
  tagButton: { padding: 8 },
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
  tagPickerList: { width: '100%', maxHeight: 320 },
  tagPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  tagPickerLabel: { fontSize: fontSize.md, color: colors.text, fontWeight: '500' },
  tagPickerSpacer: { flex: 1 },
  checkmarkWithDelete: { marginLeft: spacing.sm },
  addTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  addTagText: { fontSize: fontSize.md, color: colors.primary, fontWeight: '600' },
  doneBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    width: '100%',
    marginTop: spacing.sm,
  },
  doneBtnText: { color: '#fff', fontSize: fontSize.md, fontWeight: '700' },
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
  createTagForm: { paddingTop: spacing.md, gap: spacing.md },
  createTagInput: {
    fontSize: fontSize.md,
    color: colors.text,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
  },
  colorSwatchRow: { flexDirection: 'row', gap: spacing.md, justifyContent: 'center' },
  colorSwatch: { width: 32, height: 32, borderRadius: 16 },
  colorSwatchSelected: { borderWidth: 3, borderColor: colors.text },
  createTagActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md, alignItems: 'center' },
  createTagCancel: { paddingVertical: spacing.sm, paddingHorizontal: spacing.sm },
  createTagCancelText: { fontSize: fontSize.sm, color: colors.textMuted, fontWeight: '600' },
  createTagSubmit: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  createTagSubmitDisabled: { opacity: 0.4 },
  createTagSubmitText: { color: '#fff', fontSize: fontSize.sm, fontWeight: '700' },
});
