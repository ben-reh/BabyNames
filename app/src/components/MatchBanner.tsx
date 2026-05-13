import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fontSize, radius, spacing } from '../constants/theme';
import { useMatchBannerStore } from '../store';

export function MatchBanner() {
  const { pendingMatch, dismissBanner } = useMatchBannerStore();
  const router = useRouter();
  const { top } = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-120)).current;

  function hide() {
    Animated.timing(translateY, { toValue: -120, duration: 280, useNativeDriver: true }).start(() => {
      translateY.setValue(-120);
      dismissBanner();
    });
  }

  useEffect(() => {
    if (!pendingMatch) return;
    translateY.setValue(-120);
    Animated.spring(translateY, { toValue: 0, useNativeDriver: true, damping: 14, stiffness: 100 }).start();
    const timer = setTimeout(hide, 4000);
    return () => clearTimeout(timer);
  }, [pendingMatch]);

  if (!pendingMatch) return null;

  return (
    <Animated.View style={[styles.banner, { paddingTop: top + spacing.xs, transform: [{ translateY }] }]}>
      <TouchableOpacity
        style={styles.inner}
        onPress={() => { hide(); router.push('/(tabs)/matches'); }}
        activeOpacity={0.9}
      >
        <Text style={styles.emoji}>✨</Text>
        <View style={styles.textBlock}>
          <Text style={styles.title}>New match!</Text>
          <Text style={styles.sub}>You both love {pendingMatch}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.8)" />
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    paddingHorizontal: spacing.md,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  emoji: { fontSize: 22 },
  textBlock: { flex: 1 },
  title: { fontSize: fontSize.md, fontWeight: '800', color: '#fff' },
  sub: { fontSize: fontSize.sm, color: 'rgba(255,255,255,0.85)' },
});
