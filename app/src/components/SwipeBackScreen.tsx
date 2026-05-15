import { useRouter } from 'expo-router';
import { useCallback, useRef } from 'react';
import { PanResponder } from 'react-native';

export function useSwipeBack(onBack?: () => void) {
  const router = useRouter();
  const handleBackRef = useRef(onBack ?? (() => router.back()));
  handleBackRef.current = onBack ?? (() => router.back());

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, { dx, dy }) =>
        dx > 15 && Math.abs(dy) < Math.abs(dx),
      onPanResponderRelease: (_, { dx, vx }) => {
        if (dx > 50 && vx > 0.3) handleBackRef.current();
      },
    }),
  ).current;

  return panResponder.panHandlers;
}
