import { Redirect } from 'expo-router';
import { useSessionStore } from '../src/store';

export default function Index() {
  const listId = useSessionStore((s) => s.listId);
  return <Redirect href={listId ? '/(tabs)/swipe' : '/(onboarding)/welcome'} />;
}
