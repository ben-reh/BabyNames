import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSwipeBack } from '../../src/components/SwipeBackScreen';
import { useOnboarding, type OnboardingAction } from '../../src/api/onboarding';
import { useDeviceId } from '../../src/hooks/useDeviceId';
import { useFilterStore } from '../../src/store';
import { colors, fontSize, radius, spacing } from '../../src/constants/theme';

// Pre-computed via data/scripts/compute_onboarding_gallery.py (k=16 k-means on embedding space, count >= 500)
const GALLERY = [
  'Ryan', 'Alessandra', 'Amara', 'Kaden', 'Jose', 'Sarah',
  'Mila', 'Alayah', 'Lily', 'Alani', 'Blake', 'Elijah',
  'James', 'Elizabeth', 'Jay', 'Hunter',
];

export default function StyleQuiz() {
  const router    = useRouter();
  const deviceId  = useDeviceId();
  const sex       = useFilterStore((s) => s.sex);
  const { mutate: onboard } = useOnboarding();

  const [step, setStep]       = useState(0);
  const [actions, setActions] = useState<OnboardingAction[]>([]);
  const cardScale             = useRef(new Animated.Value(1)).current;
  const panHandlers           = useSwipeBack();

  const animateTap = (cb: () => void) => {
    Animated.sequence([
      Animated.timing(cardScale, { toValue: 0.93, duration: 70, useNativeDriver: true }),
      Animated.timing(cardScale, { toValue: 1,    duration: 0,  useNativeDriver: true }),
    ]).start(cb);
  };

  const handleAction = (action: OnboardingAction['action']) => {
    const next = [...actions, { name: GALLERY[step], action }];
    animateTap(() => {
      if (step + 1 >= GALLERY.length) {
        setActions(next);
        complete(next);
      } else {
        setActions(next);
        setStep((s) => s + 1);
      }
    });
  };

  const complete = (allActions: OnboardingAction[]) => {
    if (deviceId) {
      onboard({ deviceId, sex, actions: allActions });
    }
    router.push('/(onboarding)/popularity-filter');
  };

  const currentName = GALLERY[step];

  return (
    <View style={styles.container} {...panHandlers}>
      <View style={styles.header}>
        <Text style={styles.counter}>{step + 1} / {GALLERY.length}</Text>
      </View>

      <View style={styles.nameArea}>
        <Text style={styles.prompt}>What do you think of…</Text>
        <Animated.View style={[styles.nameCard, { transform: [{ scale: cardScale }] }]}>
          <Text style={styles.nameText}>{currentName}</Text>
        </Animated.View>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => handleAction('add')}
          activeOpacity={0.85}
        >
          <Text style={styles.addBtnText}>Add to my list</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.vibeBtn}
          onPress={() => handleAction('vibe')}
          activeOpacity={0.85}
        >
          <Text style={styles.vibeBtnText}>Like the vibe</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.skipBtn}
          onPress={() => handleAction('skip')}
          activeOpacity={0.7}
        >
          <Text style={styles.skipBtnText}>Skip</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    justifyContent: 'space-between',
  },
  header: {
    alignItems: 'center',
    paddingBottom: spacing.sm,
  },
  counter: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    fontWeight: '600',
  },
  nameArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.lg,
  },
  prompt: {
    fontSize: fontSize.md,
    color: colors.textMuted,
    fontWeight: '500',
  },
  nameCard: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.border,
    width: '100%',
    minHeight: 160,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  nameText: {
    fontSize: fontSize.xxl,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
  },
  actions: {
    gap: spacing.sm,
  },
  addBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: spacing.md + 4,
    alignItems: 'center',
  },
  addBtnText: {
    color: '#fff',
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  vibeBtn: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md + 4,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  vibeBtnText: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  skipBtn: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  skipBtnText: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
});
