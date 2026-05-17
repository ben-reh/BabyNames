import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { LogBox } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { colors } from '../src/constants/theme';

// react-native-draggable-flatlist v4.0.3 calls measureLayout on Animated.View refs,
// which newer RN versions require to be native refs. Drag still works correctly.
LogBox.ignoreLogs(['ref.measureLayout must be called with a ref to a native component']);

const queryClient = new QueryClient();

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
          <Stack.Screen name="(onboarding)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="name/[name]" options={{ presentation: 'modal', headerShown: false }} />
          <Stack.Screen name="filter-sheet" options={{ presentation: 'modal', headerShown: false }} />
        </Stack>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
