import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { useList } from '../../src/api/lists';
import { MatchBanner } from '../../src/components/MatchBanner';
import { colors } from '../../src/constants/theme';
import { useMatchBannerStore, useSessionStore } from '../../src/store';

function MatchPoller() {
  const { listId } = useSessionStore();
  const showBanner = useMatchBannerStore((s) => s.showBanner);
  const { data } = useList(listId);
  const prevRef = useRef<Set<string>>(new Set());
  const initialized = useRef(false);

  const matchKey = data?.matches?.join(',') ?? '';

  useEffect(() => {
    if (!data?.matches) return;
    const newOnes = data.matches.filter((m) => !prevRef.current.has(m));
    if (initialized.current && newOnes.length > 0) {
      showBanner(newOnes[0]);
    }
    initialized.current = true;
    prevRef.current = new Set(data.matches);
  }, [matchKey]);

  return null;
}

export default function TabsLayout() {
  return (
    <View style={{ flex: 1 }}>
      <MatchPoller />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarStyle: { borderTopColor: colors.border },
        }}
      >
        <Tabs.Screen
          name="swipe"
          options={{
            title: 'Discover',
            tabBarIcon: ({ color, size }) => <Ionicons name="heart" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="rankings"
          options={{
            title: 'Rankings',
            tabBarIcon: ({ color, size }) => <Ionicons name="trophy" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="my-list"
          options={{
            title: 'My Lists',
            tabBarIcon: ({ color, size }) => <Ionicons name="bookmark" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="chat"
          options={{
            title: 'Brainstorm',
            tabBarIcon: ({ color, size }) => <Ionicons name="cloud" size={size} color={color} />,
          }}
        />
      </Tabs>
      <MatchBanner />
    </View>
  );
}
