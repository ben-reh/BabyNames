import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSwipeBack } from '../../src/components/SwipeBackScreen';
import { useCreateList } from '../../src/api/lists';
import { useDeviceId } from '../../src/hooks/useDeviceId';
import { useSessionStore } from '../../src/store';
import { colors, fontSize, radius, spacing } from '../../src/constants/theme';

type MainChoice = 'solo' | 'partner' | null;
type PartnerSubChoice = 'setup' | 'join' | null;

export default function Partner() {
  const router = useRouter();
  const deviceId = useDeviceId();
  const setSession = useSessionStore((s) => s.setSession);
  const { mutate: createList, isPending } = useCreateList();

  const [mainChoice, setMainChoice] = useState<MainChoice>(null);
  const [showSubOptions, setShowSubOptions] = useState(false);
  const panHandlers = useSwipeBack();
  const subPanHandlers = useSwipeBack(() => setShowSubOptions(false));

  const handleContinue = () => {
    if (!mainChoice) return;

    if (mainChoice === 'solo') {
      if (!deviceId) return;
      createList(deviceId, {
        onSuccess: (data) => {
          setSession({ listId: data.listId, deviceId, partnerRole: 'A', code: data.code });
          router.replace('/(onboarding)/name-favorites');
        },
      });
    } else {
      setShowSubOptions(true);
    }
  };

  if (showSubOptions) {
    return (
      <View style={styles.container} {...subPanHandlers}>
          <View style={styles.content}>
            <Text style={styles.title}>Who's setting it up?</Text>

            <View style={styles.options}>
              <TouchableOpacity
                style={styles.card}
                onPress={() => router.push('/(onboarding)/create')}
                activeOpacity={0.8}
              >
                <Text style={styles.cardLabel}>I'm setting it up</Text>
                <Text style={styles.cardSubtitle}>Create a list and invite your partner</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.card}
                onPress={() => router.push('/(onboarding)/join')}
                activeOpacity={0.8}
              >
                <Text style={styles.cardLabel}>My partner started</Text>
                <Text style={styles.cardSubtitle}>Enter their share code to join</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
    );
  }

  return (
    <View style={styles.container} {...panHandlers}>
        <View style={styles.content}>
          <Text style={styles.title}>Are you doing this together?</Text>

          <View style={styles.options}>
            <TouchableOpacity
              style={[styles.card, mainChoice === 'solo' && styles.cardSelected]}
              onPress={() => setMainChoice('solo')}
              activeOpacity={0.8}
            >
              <Text style={[styles.cardLabel, mainChoice === 'solo' && styles.cardLabelSelected]}>
                Just me
              </Text>
              <Text style={styles.cardSubtitle}>I'll browse on my own</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.card, mainChoice === 'partner' && styles.cardSelected]}
              onPress={() => setMainChoice('partner')}
              activeOpacity={0.8}
            >
              <Text style={[styles.cardLabel, mainChoice === 'partner' && styles.cardLabelSelected]}>
                With my partner
              </Text>
              <Text style={styles.cardSubtitle}>We'll swipe and find matches together</Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.continueBtn, (!mainChoice || isPending) && styles.continueBtnDisabled]}
          onPress={handleContinue}
          disabled={!mainChoice || isPending}
        >
          {isPending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.continueBtnText}>Continue →</Text>
          )}
        </TouchableOpacity>
      </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'space-between', padding: spacing.xl },
  content: { flex: 1, justifyContent: 'center', gap: spacing.xl },
  title: { fontSize: fontSize.xl, fontWeight: '800', color: colors.text, textAlign: 'center' },
  options: { gap: spacing.md },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  cardSelected: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  cardLabel: { fontSize: fontSize.lg, fontWeight: '600', color: colors.text },
  cardLabelSelected: { color: colors.primary },
  cardSubtitle: { fontSize: fontSize.sm, color: colors.textMuted },
  continueBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: spacing.md + 4,
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  continueBtnDisabled: { opacity: 0.5 },
  continueBtnText: { color: '#fff', fontSize: fontSize.md, fontWeight: '700' },
});
