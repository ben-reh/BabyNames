import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAddName, useList } from '../../src/api/lists';
import { type ChatMessage, type NameResult, useChat } from '../../src/api/ai';
import { colors, fontSize, radius, spacing } from '../../src/constants/theme';
import { useFilterStore, useSessionStore } from '../../src/store';

type UserMessage    = { id: string; type: 'user'; content: string };
type AssistantMessage = { id: string; type: 'assistant'; content: string; names: NameResult[] };
type LoadingMessage = { id: string; type: 'loading' };
type MessageItem = UserMessage | AssistantMessage | LoadingMessage;

const SUGGESTIONS = [
  { icon: 'sparkles-outline' as const,     text: 'Tell me about the name Aurora' },
  { icon: 'leaf-outline' as const,          text: 'Southern, vintage boy names' },
  { icon: 'heart-outline' as const,         text: 'Find names like Clementine but shorter' },
  { icon: 'people-outline' as const,        text: 'What do we already have on our list?' },
];

function DotsIndicator() {
  const dots = [
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
  ];

  useEffect(() => {
    const anims = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 180),
          Animated.timing(dot, { toValue: 1, duration: 280, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: 280, useNativeDriver: true }),
          Animated.delay((dots.length - i - 1) * 180),
        ]),
      ),
    );
    Animated.parallel(anims).start();
    return () => anims.forEach((a) => a.stop());
  }, []);

  return (
    <View style={styles.dotsRow}>
      {dots.map((dot, i) => (
        <Animated.View
          key={i}
          style={[
            styles.dot,
            {
              opacity: dot.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
              transform: [{ scale: dot.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.1] }) }],
            },
          ]}
        />
      ))}
    </View>
  );
}

function NameCard({
  nameResult,
  isAdded,
  onAdd,
  onPress,
}: {
  nameResult: NameResult;
  isAdded: boolean;
  onAdd: () => void;
  onPress: () => void;
}) {
  const isFemale = nameResult.sex === 'F';
  const accentColor = isFemale ? colors.primary : colors.secondary;
  const accentLight = isFemale ? colors.primaryLight : '#EEF3FD';

  return (
    <TouchableOpacity style={styles.nameCard} onPress={onPress} activeOpacity={0.7}>
      {/* Color accent bar at top */}
      <View style={[styles.nameCardAccent, { backgroundColor: accentColor }]} />

      <View style={styles.nameCardBody}>
        {/* Name + rank row */}
        <View style={styles.nameCardTop}>
          <Text style={styles.nameCardName} numberOfLines={1}>{nameResult.name}</Text>
          {nameResult.rank && (
            <Text style={styles.nameCardRank}>#{nameResult.rank}</Text>
          )}
        </View>

        {/* Origin + year */}
        <View style={styles.nameCardMeta}>
          {nameResult.origin && (
            <Text style={styles.nameCardOrigin} numberOfLines={1}>{nameResult.origin}</Text>
          )}
          {nameResult.year_peak && (
            <Text style={styles.nameCardYear}>Peak {nameResult.year_peak}</Text>
          )}
        </View>

        {/* Add button */}
        <TouchableOpacity
          style={[styles.addBtn, isAdded ? styles.addBtnAdded : { backgroundColor: accentLight, borderColor: accentColor }]}
          onPress={onAdd}
          disabled={isAdded}
        >
          <Ionicons
            name={isAdded ? 'checkmark' : 'add'}
            size={13}
            color={isAdded ? colors.success : accentColor}
          />
          <Text style={[styles.addBtnText, isAdded ? styles.addBtnTextAdded : { color: accentColor }]}>
            {isAdded ? 'Added' : 'Add to list'}
          </Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

function AssistantBubble({
  message,
  myNames,
  onAdd,
  onAddAll,
  onNamePress,
}: {
  message: AssistantMessage;
  myNames: Set<string>;
  onAdd: (name: string) => void;
  onAddAll: (names: NameResult[]) => void;
  onNamePress: (name: string) => void;
}) {
  const unadded = message.names.filter((n) => !myNames.has(n.name));
  return (
    <View style={styles.assistantRow}>
      {/* Text bubble — never contains name cards */}
      <View style={styles.assistantBubble}>
        <Text style={styles.bubbleText}>{message.content}</Text>
      </View>

      {/* Name cards live OUTSIDE the bubble so it never inflates */}
      {message.names.length > 0 && (
        <View style={styles.nameCardsSection}>
          {message.names.length > 4 && unadded.length > 0 && (
            <TouchableOpacity style={styles.addAllBtn} onPress={() => onAddAll(unadded)}>
              <Ionicons name="add-circle-outline" size={14} color={colors.primary} />
              <Text style={styles.addAllText}>Add all {unadded.length} names</Text>
            </TouchableOpacity>
          )}
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={message.names}
            keyExtractor={(item) => item.name}
            contentContainerStyle={styles.nameCardsList}
            renderItem={({ item }) => (
              <NameCard
                nameResult={item}
                isAdded={myNames.has(item.name)}
                onAdd={() => onAdd(item.name)}
                onPress={() => onNamePress(item.name)}
              />
            )}
          />
        </View>
      )}
    </View>
  );
}

const TEST_MESSAGES: MessageItem[] = [
  { id: '1', type: 'user', content: 'Tell me about the name Aurora' },
  {
    id: '2', type: 'assistant',
    content: "Aurora is a beautiful girl's name of Latin origin, meaning \"dawn.\" It ranked 704th in 2024, and similar names include Georgia, Marcella, and Norma.",
    names: [{ name: 'Aurora', sex: 'F', rank: 704, origin: 'Latin', year_peak: 2024, vibe_names: [] }],
  },
  { id: '3', type: 'user', content: 'Southern, vintage one-syllable boy names' },
  {
    id: '4', type: 'assistant',
    content: 'Here are some Southern vintage one-syllable boy names:',
    names: [
      { name: 'Joel', sex: 'M', rank: 248, origin: 'Hebrew', year_peak: 1977, vibe_names: [] },
      { name: 'Jude', sex: 'M', rank: 182, origin: 'Hebrew', year_peak: 2022, vibe_names: [] },
      { name: 'Levi', sex: 'M', rank: 29, origin: 'Hebrew', year_peak: 2023, vibe_names: [] },
      { name: 'Ezra', sex: 'M', rank: 37, origin: 'Hebrew', year_peak: 2022, vibe_names: [] },
      { name: 'Ira', sex: 'M', rank: 690, origin: 'Hebrew', year_peak: 1918, vibe_names: [] },
      { name: 'Amos', sex: 'M', rank: 891, origin: 'Hebrew', year_peak: 1918, vibe_names: [] },
    ],
  },
  { id: '5', type: 'user', content: 'What do we already have on our list?' },
  {
    id: '6', type: 'assistant',
    content: "You haven't saved any names yet — swipe or search to build your list, then come back for personalized suggestions.",
    names: [],
  },
];

export default function ChatScreen() {
  const router = useRouter();
  const { listId, deviceId, partnerRole } = useSessionStore();
  const filters = useFilterStore();

  const { data: listData } = useList(listId);
  const myNames = useMemo(() => {
    const partner = partnerRole === 'B' ? listData?.partnerB : listData?.partnerA;
    return new Set(partner?.names ?? []);
  }, [listData, partnerRole]);

  const addName = useAddName(listId ?? '');
  const { mutate: sendChat, isPending } = useChat();

  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [input, setInput] = useState('');
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  function handleSend(text?: string) {
    const content = (text ?? input).trim();
    if (!content || isPending) return;

    const userMsg: UserMessage = { id: Date.now().toString(), type: 'user', content };
    const loadingMsg: LoadingMessage = { id: 'loading', type: 'loading' };

    setMessages((prev) => [...prev, userMsg, loadingMsg]);
    setInput('');

    const history: ChatMessage[] = [
      ...messages
        .filter((m): m is UserMessage | AssistantMessage => m.type !== 'loading')
        .slice(-19)
        .map((m) => ({ role: m.type as 'user' | 'assistant', content: m.content })),
      { role: 'user', content },
    ];

    sendChat(
      { messages: history, context: { listId, sex: filters.sex } },
      {
        onSuccess: (data) => {
          const assistantMsg: AssistantMessage = {
            id: (Date.now() + 1).toString(),
            type: 'assistant',
            content: data.reply,
            names: data.names,
          };
          setMessages((prev) => [...prev.filter((m) => m.type !== 'loading'), assistantMsg]);
        },
        onError: () => {
          setMessages((prev) => [
            ...prev.filter((m) => m.type !== 'loading'),
            {
              id: 'err-' + Date.now(),
              type: 'assistant',
              content: 'Something went wrong. Please try again.',
              names: [],
            },
          ]);
        },
      },
    );
  }

  function handleAdd(name: string) {
    if (!deviceId || !listId) return;
    addName.mutate({ deviceId, name });
  }

  function handleAddAll(names: NameResult[]) {
    if (!deviceId || !listId) return;
    names.forEach((n) => addName.mutate({ deviceId, name: n.name }));
  }

  function renderItem({ item }: { item: MessageItem }) {
    if (item.type === 'user') {
      return (
        <View style={styles.userRow}>
          <View style={styles.userBubble}>
            <Text style={styles.userBubbleText}>{item.content}</Text>
          </View>
        </View>
      );
    }
    if (item.type === 'loading') {
      return (
        <View style={styles.assistantRow}>
          <View style={styles.assistantBubble}>
            <DotsIndicator />
          </View>
        </View>
      );
    }
    return (
      <AssistantBubble
        message={item}
        myNames={myNames}
        onAdd={handleAdd}
        onAddAll={handleAddAll}
        onNamePress={(name) => router.push(`/name/${name}`)}
      />
    );
  }

  const isEmpty = messages.length === 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Ionicons name="sparkles" size={18} color={colors.primary} />
          <Text style={styles.headerTitle}>Ask AI</Text>
        </View>
        <Text style={styles.headerSubtitle}>Explore names, get suggestions, ask anything</Text>
      </View>

      {isEmpty ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyPrompt}>Try asking…</Text>
          <ScrollView
            style={styles.suggestionsScroll}
            contentContainerStyle={styles.suggestionsContent}
            showsVerticalScrollIndicator={false}
          >
            {SUGGESTIONS.map((s) => (
              <TouchableOpacity
                key={s.text}
                style={styles.suggestionChip}
                onPress={() => handleSend(s.text)}
                activeOpacity={0.7}
              >
                <View style={styles.suggestionIconWrap}>
                  <Ionicons name={s.icon} size={16} color={colors.primary} />
                </View>
                <Text style={styles.suggestionText}>{s.text}</Text>
                <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.messageList}
          keyboardShouldPersistTaps="handled"
        />
      )}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.textInput}
            value={input}
            onChangeText={setInput}
            placeholder="Ask about baby names…"
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={500}
            returnKeyType="default"
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!input.trim() || isPending) && styles.sendBtnDisabled]}
            onPress={() => handleSend()}
            disabled={!input.trim() || isPending}
          >
            <Ionicons name="arrow-up" size={18} color={colors.card} />
          </TouchableOpacity>
        </View>
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
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: 2,
  },
  headerTitle: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  headerSubtitle: { fontSize: fontSize.xs, color: colors.textMuted, fontWeight: '400' },

  // Empty state
  emptyState: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  emptyPrompt: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing.md,
  },
  suggestionsScroll: { flex: 1 },
  suggestionsContent: { gap: spacing.sm, paddingBottom: spacing.xl },
  suggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  suggestionIconWrap: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionText: { flex: 1, fontSize: fontSize.sm, color: colors.text, fontWeight: '500', lineHeight: 20 },

  // Messages
  messageList: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.md },

  userRow: { alignItems: 'flex-end' },
  userBubble: {
    backgroundColor: colors.primary,
    borderRadius: radius.xl,
    borderBottomRightRadius: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    maxWidth: '78%',
  },
  userBubbleText: { fontSize: fontSize.sm, color: '#fff', lineHeight: 22, fontWeight: '500' },

  assistantRow: { alignItems: 'flex-start', flexDirection: 'column' },
  assistantBubble: {
    backgroundColor: '#F2F2F7',
    borderRadius: radius.xl,
    borderBottomLeftRadius: 4,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    maxWidth: '88%',
    alignSelf: 'flex-start',
  },
  bubbleText: { fontSize: fontSize.sm, color: colors.text, lineHeight: 22 },

  // Loading dots
  dotsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  dot: { width: 7, height: 7, borderRadius: radius.full, backgroundColor: colors.textMuted },

  // Name cards strip — sits below the text bubble, full message width
  nameCardsSection: { marginTop: spacing.xs, width: '100%' },
  addAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  addAllText: { fontSize: fontSize.xs, color: colors.primary, fontWeight: '600' },
  nameCardsList: { gap: spacing.sm, paddingLeft: 2, paddingRight: spacing.md, paddingBottom: spacing.xs, alignItems: 'flex-start' },
  nameCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    width: 148,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  nameCardAccent: { height: 4, width: '100%' },
  nameCardBody: {
    padding: spacing.sm,
    gap: 4,
  },
  nameCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  nameCardName: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text, flex: 1 },
  nameCardRank: { fontSize: 11, color: colors.textMuted, marginTop: 3 },
  nameCardMeta: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  nameCardOrigin: { fontSize: 11, color: colors.textMuted },
  nameCardYear: { fontSize: 11, color: colors.textMuted },
  sexF: { color: colors.primary },
  sexM: { color: colors.secondary },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 2,
    paddingVertical: 5,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.primary,
    alignSelf: 'flex-start',
  },
  addBtnAdded: { borderColor: colors.success, backgroundColor: '#F0FFF4' },
  addBtnText: { fontSize: 11, fontWeight: '600' },
  addBtnTextAdded: { color: colors.success },

  // Input row
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
  },
  textInput: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.text,
    backgroundColor: '#F2F2F7',
    borderRadius: radius.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    maxHeight: 100,
    lineHeight: 20,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: colors.border },
});
