import { Redirect } from 'expo-router';
import { useSessionStore } from '../src/store';

export default function Index() {
  const onboardingDone = useSessionStore((s) => s.onboardingDone);
  return <Redirect href={onboardingDone ? '/(tabs)/swipe' : '/(onboarding)/welcome'} />;
}
