import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { type ConsultantName, useConsultantFeedback, useConsultantSession } from '../../src/api/consultant';
import { colors, fontSize, radius, spacing } from '../../src/constants/theme';
import { useConsultantStore, useSessionStore } from '../../src/store';

type Phase = 'idle' | 'loading' | 'results';
type GenderFilter = 'girl' | 'unisex' | 'boy';

const GENDER_OPTIONS: { label: string; value: GenderFilter }[] = [
  { label: 'Girl', value: 'girl' },
  { label: 'Unisex', value: 'unisex' },
  { label: 'Boy', value: 'boy' },
];

function LoadingShimmer() {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, []);

  return (
    <View style={styles.loadingContainer}>
      <Animated.Text style={[styles.loadingText, { opacity }]}>
        Your consultant is reviewing your taste…
      </Animated.Text>
      <Animated.Text style={[styles.loadingSubtext, { opacity }]}>
        Building your personalized list
      </Animated.Text>
    </View>
  );
}

function ProfileCard({ summary, partnerSummary }: { summary: string; partnerSummary: string | null }) {
  return (
    <View style={styles.profileCard}>
      <View style={styles.profileCardHeader}>
        <Ionicons name="sparkles" size={14} color={colors.primary} />
        <Text style={styles.profileCardLabel}>TASTE PROFILE</Text>
      </View>
      <Text style={styles.profileSummary}>{summary}</Text>
      {partnerSummary && (
        <View style={styles.partnerRow}>
          <Ionicons name="people-outline" size={14} color={colors.textMuted} />
          <Text style={styles.partnerSummary}>{partnerSummary}</Text>
        </View>
      )}
    </View>
  );
}

function NameRow({
  item,
  onLike,
  onPass,
  onPress,
  liked,
  passed,
}: {
  item: ConsultantName;
  onLike: () => void;
  onPass: () => void;
  onPress: () => void;
  liked: boolean;
  passed: boolean;
}) {
  const isFemale = item.gender === 'girl';
  const accentColor = isFemale ? colors.primary : colors.secondary;

  return (
    <TouchableOpacity style={styles.nameRow} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.nameRowAccent, { backgroundColor: accentColor }]} />
      <View style={styles.nameRowContent}>
        <View style={styles.nameRowTop}>
          <Text style={styles.nameText}>{item.name}</Text>
          {item.origin ? (
            <View style={[styles.originBadge, { backgroundColor: isFemale ? colors.primaryLight : '#EEF3FD' }]}>
              <Text style={[styles.originBadgeText, { color: accentColor }]}>{item.origin}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.descriptionText} numberOfLines={2}>{item.description}</Text>
      </View>
      <View style={styles.nameRowActions}>
        <TouchableOpacity
          style={[styles.actionBtn, liked && styles.actionBtnLiked]}
          onPress={onLike}
          disabled={liked || passed}
          hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
        >
          <Ionicons
            name={liked ? 'heart' : 'heart-outline'}
            size={20}
            color={liked ? '#fff' : colors.primary}
          />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, passed && styles.actionBtnPassed]}
          onPress={onPass}
          disabled={liked || passed}
          hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
        >
          <Ionicons
            name="close"
            size={20}
            color={passed ? '#fff' : colors.textMuted}
          />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

export default function ConsultantScreen() {
  const router = useRouter();
  const { deviceId, listId } = useSessionStore();
  const { session, vibeText, sex, setSession, setVibeText, setSex } = useConsultantStore();
  const [phase, setPhase] = useState<Phase>(session ? 'results' : 'idle');
  const [genderFilter, setGenderFilter] = useState<GenderFilter>('girl');
  const [votes, setVotes] = useState<Record<string, 'like' | 'pass'>>({});
  const inputRef = useRef<TextInput>(null);

  const { mutate: generateSession, isPending } = useConsultantSession();
  const { mutate: sendFeedback } = useConsultantFeedback();

  // Load profile on first open if no session yet
  useEffect(() => {
    if (!session && deviceId && phase === 'idle') {
      handleGenerate();
    }
  }, []);

  function handleGenerate() {
    if (!deviceId) return;
    setPhase('loading');
    generateSession(
      { deviceId, listId: listId ?? undefined, vibeText: vibeText || undefined, sex },
      {
        onSuccess: (data) => {
          setSession(data);
          setPhase('results');
        },
        onError: () => {
          setPhase(session ? 'results' : 'idle');
        },
      },
    );
  }

  function handleLike(name: string) {
    if (!deviceId || votes[name]) return;
    setVotes((v) => ({ ...v, [name]: 'like' }));
    sendFeedback({ deviceId, likes: [name], passes: [] });
  }

  function handlePass(name: string) {
    if (!deviceId || votes[name]) return;
    setVotes((v) => ({ ...v, [name]: 'pass' }));
    sendFeedback({ deviceId, likes: [], passes: [name] });
  }

  const currentSession = session;
  const filteredNames = currentSession?.names.filter((n) => n.gender === genderFilter) ?? [];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <View style={styles.headerTitleRow}>
            <Ionicons name="person" size={18} color={colors.primary} />
            <Text style={styles.headerTitle}>Your Name Consultant</Text>
          </View>
          <View style={styles.sexToggle}>
            {([['F', '♀ Girl'], ['U', 'Unisex'], ['M', '♂ Boy']] as ['F' | 'U' | 'M', string][]).map(([val, label]) => (
              <TouchableOpacity
                key={val}
                style={[styles.sexSegment, sex === val && styles.sexSegmentActive]}
                onPress={() => setSex(val)}
              >
                <Text style={[styles.sexSegmentText, sex === val && styles.sexSegmentTextActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <Text style={styles.headerSubtitle}>Personalized picks, just for you</Text>
        <View style={styles.segmented}>
          {GENDER_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={[styles.segment, genderFilter === opt.value && styles.segmentActive]}
              onPress={() => setGenderFilter(opt.value)}
            >
              <Text style={[styles.segmentText, genderFilter === opt.value && styles.segmentTextActive]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {phase === 'loading' && !currentSession ? (
          <LoadingShimmer />
        ) : (
          <FlatList
            data={filteredNames}
            keyExtractor={(item) => item.name}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={
              <View>
                {currentSession && (
                  <ProfileCard
                    summary={currentSession.profileSummary}
                    partnerSummary={currentSession.partnerSummary}
                  />
                )}

                <View style={styles.inputSection}>
                  <Text style={styles.inputLabel}>What are you looking for?</Text>
                  <TextInput
                    ref={inputRef}
                    style={styles.vibeInput}
                    value={vibeText}
                    onChangeText={setVibeText}
                    placeholder="Something unusual, with a nature feel…"
                    placeholderTextColor={colors.textMuted}
                    multiline
                    maxLength={200}
                    returnKeyType="default"
                  />
                  <TouchableOpacity
                    style={[styles.generateBtn, isPending && styles.generateBtnDisabled]}
                    onPress={handleGenerate}
                    disabled={isPending}
                  >
                    {phase === 'loading' ? (
                      <Text style={styles.generateBtnText}>Generating…</Text>
                    ) : (
                      <>
                        <Ionicons name="sparkles" size={16} color="#fff" />
                        <Text style={styles.generateBtnText}>Generate My List</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>

                {currentSession && currentSession.names.length > 0 && (
                  <View style={styles.listDivider}>
                    <View style={styles.dividerLine} />
                    <Text style={styles.dividerText}>Your List</Text>
                    <View style={styles.dividerLine} />
                  </View>
                )}

                {phase === 'loading' && currentSession && (
                  <LoadingShimmer />
                )}
              </View>
            }
            renderItem={({ item }) => (
              <NameRow
                item={item}
                liked={votes[item.name] === 'like'}
                passed={votes[item.name] === 'pass'}
                onLike={() => handleLike(item.name)}
                onPass={() => handlePass(item.name)}
                onPress={() => router.push(`/name/${item.name}`)}
              />
            )}
            ListEmptyComponent={
              phase !== 'loading' && currentSession ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyText}>Tap Generate My List to get started</Text>
                </View>
              ) : null
            }
          />
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl + spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.card,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  headerTitle: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  headerSubtitle: { fontSize: fontSize.xs, color: colors.textMuted },
  sexToggle: { flexDirection: 'row', backgroundColor: colors.border, borderRadius: radius.full, padding: 2 },
  sexSegment: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.full },
  sexSegmentActive: { backgroundColor: colors.card },
  sexSegmentText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textMuted },
  sexSegmentTextActive: { color: colors.text },

  listContent: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md },

  profileCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  profileCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: 2,
  },
  profileCardLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.primary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  profileSummary: {
    fontSize: fontSize.sm,
    color: colors.text,
    lineHeight: 22,
  },
  partnerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    marginTop: spacing.xs,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  partnerSummary: {
    flex: 1,
    fontSize: fontSize.xs,
    color: colors.textMuted,
    lineHeight: 18,
  },

  inputSection: { gap: spacing.sm, marginBottom: spacing.sm },
  inputLabel: { fontSize: fontSize.sm, fontWeight: '600', color: colors.text },
  vibeInput: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.sm,
    color: colors.text,
    minHeight: 64,
    lineHeight: 22,
  },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
  },
  generateBtnDisabled: { opacity: 0.6 },
  generateBtnText: { fontSize: fontSize.md, fontWeight: '700', color: '#fff' },

  listDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginVertical: spacing.sm,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { fontSize: fontSize.xs, fontWeight: '600', color: colors.textMuted },

  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  nameRowAccent: { width: 4, alignSelf: 'stretch' },
  nameRowContent: { flex: 1, padding: spacing.md, gap: 4 },
  nameRowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  nameText: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  originBadge: {
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  originBadgeText: { fontSize: fontSize.xs, fontWeight: '600' },
  descriptionText: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    lineHeight: 18,
  },
  nameRowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingRight: spacing.sm,
  },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.border,
  },
  actionBtnLiked: { backgroundColor: colors.primary },
  actionBtnPassed: { backgroundColor: colors.textMuted },

  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  loadingText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
  },
  loadingSubtext: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textAlign: 'center',
  },

  emptyState: { alignItems: 'center', paddingTop: spacing.xl },
  emptyText: { fontSize: fontSize.sm, color: colors.textMuted },
});
