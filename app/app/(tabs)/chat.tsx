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

type UserMessage = { id: string; type: 'user'; content: string };
type AssistantMessage = { id: string; type: 'assistant'; content: string; names: NameResult[] };
type LoadingMessage = { id: string; type: 'loading' };
type MessageItem = UserMessage | AssistantMessage | LoadingMessage;

const SUGGESTIONS = [
  'Find me something like Clementine but shorter',
  'Southern, vintage, one-syllable boy names',
  'Tell me about the name Aurora',
  'Help us decide between Liam and Oliver',
];

function DotsIndicator() {
  const dots = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];

  useEffect(() => {
    const anims = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(dot, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: 300, useNativeDriver: true }),
          Animated.delay((dots.length - i - 1) * 160),
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
          style={[styles.dot, { opacity: dot, transform: [{ translateY: dot.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }] }]}
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
  return (
    <TouchableOpacity style={styles.nameCard} onPress={onPress} activeOpacity={0.75}>
      <Text style={[styles.nameCardSex, nameResult.sex === 'F' ? styles.sexF : styles.sexM]}>
        {nameResult.sex === 'F' ? '♀' : '♂'}
      </Text>
      <Text style={styles.nameCardName}>{nameResult.name}</Text>
      {nameResult.rank && <Text style={styles.nameCardRank}>#{nameResult.rank}</Text>}
      {nameResult.origin && <Text style={styles.nameCardOrigin} numberOfLines={1}>{nameResult.origin}</Text>}
      <TouchableOpacity
        style={[styles.addBtn, isAdded && styles.addBtnAdded]}
        onPress={onAdd}
        disabled={isAdded}
        hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
      >
        <Ionicons name={isAdded ? 'checkmark' : 'add'} size={14} color={isAdded ? colors.success : colors.primary} />
        <Text style={[styles.addBtnText, isAdded && styles.addBtnTextAdded]}>{isAdded ? 'Added' : 'Add'}</Text>
      </TouchableOpacity>
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
      <View style={styles.assistantBubble}>
        <Text style={styles.bubbleText}>{message.content}</Text>
        {message.names.length > 0 && (
          <View style={styles.nameCardsSection}>
            {message.names.length > 5 && unadded.length > 0 && (
              <TouchableOpacity style={styles.addAllBtn} onPress={() => onAddAll(unadded)}>
                <Ionicons name="add-circle-outline" size={15} color={colors.primary} />
                <Text style={styles.addAllText}>Add all ({unadded.length})</Text>
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
    </View>
  );
}

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
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 80);
    }
  }, [messages.length]);

  function handleSend(text?: string) {
    const content = (text ?? input).trim();
    if (!content || isPending) return;

    const userMsg: UserMessage = { id: Date.now().toString(), type: 'user', content };
    const loadingMsg: LoadingMessage = { id: 'loading', type: 'loading' };

    setMessages((prev) => [...prev, userMsg, loadingMsg]);
    setInput('');

    // Build conversation history from current messages (cap at 20)
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
          const errMsg: AssistantMessage = {
            id: 'err-' + Date.now(),
            type: 'assistant',
            content: "Sorry, something went wrong. Please try again.",
            names: [],
          };
          setMessages((prev) => [...prev.filter((m) => m.type !== 'loading'), errMsg]);
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
        <Text style={styles.headerTitle}>Ask AI</Text>
      </View>

      {isEmpty ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIconWrap}>
            <Ionicons name="sparkles" size={36} color={colors.primary} />
          </View>
          <Text style={styles.emptyTitle}>Explore names with AI</Text>
          <Text style={styles.emptySubtitle}>Ask anything — style, origin, meaning, or get a curated list.</Text>
          <ScrollView
            style={styles.suggestionsScroll}
            contentContainerStyle={styles.suggestionsContent}
            showsVerticalScrollIndicator={false}
          >
            {SUGGESTIONS.map((s) => (
              <TouchableOpacity key={s} style={styles.suggestionChip} onPress={() => handleSend(s)}>
                <Text style={styles.suggestionText}>{s}</Text>
                <Ionicons name="arrow-forward" size={14} color={colors.primary} />
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
            <Ionicons name="send" size={18} color={colors.card} />
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
    paddingBottom: spacing.sm,
  },
  headerTitle: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },

  // Empty state
  emptyState: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  emptySubtitle: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  suggestionsScroll: { width: '100%' },
  suggestionsContent: { gap: spacing.sm, paddingBottom: spacing.lg },
  suggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  suggestionText: { flex: 1, fontSize: fontSize.sm, color: colors.text, fontWeight: '500' },

  // Messages
  messageList: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.lg },

  userRow: { alignItems: 'flex-end' },
  userBubble: {
    backgroundColor: colors.primary,
    borderRadius: radius.xl,
    borderBottomRightRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    maxWidth: '80%',
  },
  userBubbleText: { fontSize: fontSize.sm, color: colors.card, lineHeight: 20 },

  assistantRow: { alignItems: 'flex-start' },
  assistantBubble: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    borderBottomLeftRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    maxWidth: '92%',
  },
  bubbleText: { fontSize: fontSize.sm, color: colors.text, lineHeight: 20 },

  // Loading dots
  dotsRow: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: spacing.xs },
  dot: { width: 7, height: 7, borderRadius: radius.full, backgroundColor: colors.textMuted },

  // Name cards strip
  nameCardsSection: { marginTop: spacing.sm },
  addAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
    marginLeft: 2,
  },
  addAllText: { fontSize: fontSize.xs, color: colors.primary, fontWeight: '600' },
  nameCardsList: { gap: spacing.sm, paddingRight: spacing.sm, paddingBottom: spacing.xs, alignItems: 'flex-start' },
  nameCard: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.sm,
    width: 120,
    height: 110,
    gap: 3,
  },
  nameCardSex: { fontSize: fontSize.xs, fontWeight: '700' },
  sexF: { color: colors.primary },
  sexM: { color: colors.secondary },
  nameCardName: { fontSize: fontSize.md, fontWeight: '800', color: colors.text },
  nameCardRank: { fontSize: fontSize.xs, color: colors.textMuted },
  nameCardOrigin: { fontSize: fontSize.xs, color: colors.textMuted },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: spacing.xs,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.primary,
    alignSelf: 'flex-start',
  },
  addBtnAdded: { borderColor: colors.success },
  addBtnText: { fontSize: fontSize.xs, color: colors.primary, fontWeight: '600' },
  addBtnTextAdded: { color: colors.success },

  // Input row
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    paddingBottom: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
  },
  textInput: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.text,
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    maxHeight: 120,
    lineHeight: 20,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: colors.border },
});
