import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSwipeBack } from '../../src/components/SwipeBackScreen';
import { useRecordSwipe } from '../../src/api/swipe';
import { useDeviceId } from '../../src/hooks/useDeviceId';
import { useFilterStore } from '../../src/store';
import { colors, fontSize, radius, spacing } from '../../src/constants/theme';

const QUIZ_PAIRS: Record<string, [string, string][]> = {
  F: [
    ['Olivia', 'Harper'],
    ['Charlotte', 'Sophia'],
    ['Emma', 'Eleanor'],
    ['Hazel', 'Kennedy'],
    ['Josephine', 'Ailany'],
  ],
  M: [
    ['Liam', 'Mateo'],
    ['Oliver', 'Elijah'],
    ['Lucas', 'Alexander'],
    ['Matthew', 'John'],
    ['Ethan', 'Cooper'],
  ],
  both: [
    ['Jordan', 'Riley'],
    ['Charlie', 'Quinn'],
    ['Morgan', 'Parker'],
    ['Rowan', 'Finley'],
    ['River', 'Sage'],
  ],
};

const ADVANCE_DELAY = 350;

export default function StyleQuiz() {
  const router = useRouter();
  const deviceId = useDeviceId();
  const sex = useFilterStore((s) => s.sex);
  const { mutate: recordSwipe } = useRecordSwipe();

  const pairKey = sex === 'F' ? 'F' : sex === 'M' ? 'M' : 'both';
  const pairs = QUIZ_PAIRS[pairKey];

  const [step, setStep] = useState(0);
  const [chosen, setChosen] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const panHandlers = useSwipeBack();

  // Animated scale values for each card
  const scaleLeft = useRef(new Animated.Value(1)).current;
  const scaleRight = useRef(new Animated.Value(1)).current;

  const accentColor = sex === 'F' ? colors.primary : sex === 'M' ? colors.secondary : colors.primary;

  const handleChoose = (name: string, side: 'left' | 'right') => {
    if (locked) return;
    setLocked(true);
    setChosen(name);

    // Animate chosen card up
    const targetScale = side === 'left' ? scaleLeft : scaleRight;
    Animated.spring(targetScale, { toValue: 1.06, useNativeDriver: true, speed: 30 }).start();

    // Fire-and-forget swipe recording
    if (deviceId) {
      recordSwipe({ deviceId, name, liked: true });
    }

    setTimeout(() => {
      // Reset animation values for next pair
      scaleLeft.setValue(1);
      scaleRight.setValue(1);

      const nextStep = step + 1;
      if (nextStep >= pairs.length) {
        router.push('/(onboarding)/popularity-filter');
      } else {
        setStep(nextStep);
        setChosen(null);
        setLocked(false);
      }
    }, ADVANCE_DELAY);
  };

  const currentPair = pairs[step];

  return (
    <View style={styles.container} {...panHandlers}>
      {/* Progress dots */}
      <View style={styles.dotsRow}>
        {pairs.map((_, i) => (
          <View
            key={i}
            style={[styles.dot, i <= step && { backgroundColor: accentColor }]}
          />
        ))}
      </View>

      <View style={styles.content}>
        <Text style={styles.title}>Which feels more like you?</Text>
        <Text style={styles.subtitle}>Pick your favourite from each pair</Text>

        <View style={styles.pairRow}>
          <Animated.View style={{ transform: [{ scale: scaleLeft }], flex: 1 }}>
            <TouchableOpacity
              style={[
                styles.nameCard,
                chosen === currentPair[0] && { borderColor: accentColor, borderWidth: 2.5 },
              ]}
              onPress={() => handleChoose(currentPair[0], 'left')}
              activeOpacity={0.85}
            >
              <Text style={styles.nameText}>{currentPair[0]}</Text>
            </TouchableOpacity>
          </Animated.View>

          <Text style={styles.orText}>or</Text>

          <Animated.View style={{ transform: [{ scale: scaleRight }], flex: 1 }}>
            <TouchableOpacity
              style={[
                styles.nameCard,
                chosen === currentPair[1] && { borderColor: accentColor, borderWidth: 2.5 },
              ]}
              onPress={() => handleChoose(currentPair[1], 'right')}
              activeOpacity={0.85}
            >
              <Text style={styles.nameText}>{currentPair[1]}</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.xl },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingTop: spacing.md,
    marginBottom: spacing.lg,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: radius.full,
    backgroundColor: colors.border,
  },
  content: { flex: 1, justifyContent: 'center', gap: spacing.lg },
  title: { fontSize: fontSize.xl, fontWeight: '800', color: colors.text, textAlign: 'center' },
  subtitle: { fontSize: fontSize.md, color: colors.textMuted, textAlign: 'center' },
  pairRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  nameCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.border,
    minHeight: 120,
  },
  nameText: { fontSize: fontSize.lg, fontWeight: '700', color: colors.text, textAlign: 'center' },
  orText: { fontSize: fontSize.sm, color: colors.textMuted, fontWeight: '500' },
});
