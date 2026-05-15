import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSwipeBack } from '../../src/components/SwipeBackScreen';
import { useAddName } from '../../src/api/lists';
import { useNameSearch } from '../../src/api/names';
import { useRecordSwipe } from '../../src/api/swipe';
import type { Name } from '../../src/api/types';
import { useSessionStore } from '../../src/store';
import { colors, fontSize, radius, spacing } from '../../src/constants/theme';

function parseRawNames(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((s) => s.trim().replace(/[^a-zA-Z\s'-]/g, '').trim())
    .map((s) => s.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' '))
    .filter((s) => s.length >= 2 && s.length <= 20 && /^[A-Za-z]/.test(s))
    .filter((s, i, arr) => arr.indexOf(s) === i);
}

export default function NameFavorites() {
  const router = useRouter();
  const { listId, deviceId } = useSessionStore();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [freeText, setFreeText] = useState('');
  const [showFreeText, setShowFreeText] = useState(false);

  const { data: searchResults } = useNameSearch(query);
  const panHandlers = useSwipeBack();
  const { mutateAsync: addName } = useAddName(listId!);
  const { mutate: recordSwipe } = useRecordSwipe();

  const selectedSet = new Set(selected);

  const addNames = (names: string[]) => {
    setSelected((prev) => {
      const next = [...prev];
      for (const n of names) {
        if (!new Set(next).has(n)) next.push(n);
      }
      return next;
    });
  };

  const toggleName = (name: string) => {
    setSelected((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  };

  const handleSearchSelect = (name: Name) => {
    toggleName(name.name);
    setQuery('');
  };

  const handleFreeTextDone = () => {
    const parsed = parseRawNames(freeText);
    addNames(parsed);
    setFreeText('');
    setShowFreeText(false);
  };

  const handleContinue = async () => {
    if (!listId || !deviceId) return;
    if (selected.length === 0) {
      router.replace('/(onboarding)/how-it-works');
      return;
    }
    setIsSaving(true);
    await Promise.all(
      selected.map((name) => {
        recordSwipe({ deviceId, name, liked: true });
        return addName({ deviceId, name });
      }),
    );
    router.replace('/(onboarding)/how-it-works');
  };

  const visibleResults = (searchResults ?? [])
    .filter((n) => !selectedSet.has(n.name))
    .slice(0, 6);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      {...panHandlers}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Text style={styles.title}>Any names you already love?</Text>
        <Text style={styles.subtitle}>We'll add them to your list and sharpen your recommendations</Text>
      </View>

      {/* Search */}
      <View style={styles.section}>
        <View style={styles.searchRow}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search a name..."
            placeholderTextColor={colors.textMuted}
            autoCorrect={false}
            autoCapitalize="words"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
        {query.length > 0 && visibleResults.length > 0 && (
          <View style={styles.results}>
            {visibleResults.map((name) => (
              <TouchableOpacity key={name.name} style={styles.resultRow} onPress={() => handleSearchSelect(name)}>
                <Text style={styles.resultName}>{name.name}</Text>
                <Text style={styles.resultMeta}>{name.sex === 'F' ? 'Girl' : 'Boy'}{name.origin ? ` · ${name.origin}` : ''}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {/* Free text */}
      <View style={styles.section}>
        {!showFreeText ? (
          <TouchableOpacity style={styles.importBtn} onPress={() => setShowFreeText(true)}>
            <Ionicons name="create-outline" size={20} color={colors.primary} />
            <View style={styles.importBtnText}>
              <Text style={styles.importBtnLabel}>Paste / Type a List</Text>
              <Text style={styles.importBtnHint}>Enter names separated by commas or new lines</Text>
            </View>
            <Ionicons name="chevron-down" size={18} color={colors.primary} />
          </TouchableOpacity>
        ) : (
          <View style={styles.freeTextBox}>
            <TextInput
              style={styles.freeTextInput}
              value={freeText}
              onChangeText={setFreeText}
              placeholder={'Emma, Liam, Charlotte\nOlivia\nNoah, Ava'}
              placeholderTextColor={colors.textMuted}
              multiline
              autoFocus
              autoCorrect={false}
              autoCapitalize="words"
            />
            <View style={styles.freeTextActions}>
              <TouchableOpacity onPress={() => { setFreeText(''); setShowFreeText(false); }}>
                <Text style={styles.freeTextCancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.freeTextDoneBtn, !freeText.trim() && styles.freeTextDoneBtnDisabled]}
                onPress={handleFreeTextDone}
                disabled={!freeText.trim()}
              >
                <Text style={styles.freeTextDoneText}>Add names</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      {/* Selected chips */}
      {selected.length > 0 && (
        <View style={styles.chips}>
          {selected.map((name) => (
            <TouchableOpacity key={name} style={styles.chip} onPress={() => toggleName(name)}>
              <Text style={styles.chipText}>{name}</Text>
              <Ionicons name="close" size={14} color={colors.primary} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Footer */}
      <View style={styles.footer}>
        {showFreeText && freeText.trim().length > 0 && (
          <Text style={styles.pendingWarning}>
            Tap "Add names" or clear the box before continuing
          </Text>
        )}
        <TouchableOpacity
          style={[styles.continueBtn, (isSaving || (showFreeText && freeText.trim().length > 0)) && styles.continueBtnDisabled]}
          onPress={handleContinue}
          disabled={isSaving || (showFreeText && freeText.trim().length > 0)}
        >
          {isSaving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.continueBtnText}>
              {selected.length > 0
                ? `Add ${selected.length} name${selected.length > 1 ? 's' : ''} & continue →`
                : 'Continue →'}
            </Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.replace('/(onboarding)/how-it-works')}>
          <Text style={styles.skipText}>Skip for now</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  container: { padding: spacing.xl, paddingTop: spacing.xl + spacing.lg, gap: spacing.lg, paddingBottom: spacing.xl * 2 },
  header: { gap: spacing.sm },
  title: { fontSize: fontSize.xl, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: fontSize.sm, color: colors.textMuted, lineHeight: 20 },
  section: { gap: spacing.xs },
  searchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.lg, paddingHorizontal: spacing.md, borderWidth: 1.5, borderColor: colors.border, gap: spacing.sm },
  searchInput: { flex: 1, fontSize: fontSize.md, color: colors.text, paddingVertical: spacing.md },
  results: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.border, overflow: 'hidden' },
  resultRow: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  resultName: { fontSize: fontSize.md, fontWeight: '600', color: colors.text },
  resultMeta: { fontSize: fontSize.sm, color: colors.textMuted },
  importBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1.5, borderColor: colors.border },
  importBtnText: { flex: 1, gap: 2 },
  importBtnLabel: { fontSize: fontSize.md, fontWeight: '600', color: colors.text },
  importBtnHint: { fontSize: fontSize.xs, color: colors.textMuted },
  freeTextBox: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.primary, overflow: 'hidden' },
  freeTextInput: { fontSize: fontSize.md, color: colors.text, padding: spacing.md, minHeight: 100, textAlignVertical: 'top' },
  freeTextActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  freeTextCancel: { fontSize: fontSize.sm, color: colors.textMuted },
  freeTextDoneBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2 },
  freeTextDoneBtnDisabled: { opacity: 0.4 },
  freeTextDoneText: { fontSize: fontSize.sm, color: '#fff', fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.primaryLight, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.primary + '40' },
  chipText: { fontSize: fontSize.sm, color: colors.primary, fontWeight: '600' },
  footer: { gap: spacing.md, paddingTop: spacing.sm },
  pendingWarning: { fontSize: fontSize.sm, color: colors.error, textAlign: 'center', fontWeight: '600' },
  continueBtn: { backgroundColor: colors.primary, borderRadius: radius.lg, padding: spacing.md + 4, alignItems: 'center' },
  continueBtnDisabled: { opacity: 0.5 },
  continueBtnText: { color: '#fff', fontSize: fontSize.md, fontWeight: '700' },
  skipText: { textAlign: 'center', fontSize: fontSize.sm, color: colors.textMuted, paddingVertical: spacing.sm },
});
