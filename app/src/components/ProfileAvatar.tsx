import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useAuthStore } from '../store';
import { colors, fontSize } from '../constants/theme';

const SIZE = 32;

export function ProfileAvatar() {
  const router  = useRouter();
  const email   = useAuthStore((s) => s.email);
  const initial = email ? email[0].toUpperCase() : null;

  return (
    <TouchableOpacity
      style={[styles.circle, initial ? styles.signedIn : styles.guest]}
      onPress={() => router.navigate('/(tabs)/profile')}
      activeOpacity={0.7}
    >
      {initial
        ? <Text style={styles.initial}>{initial}</Text>
        : <Ionicons name="person-circle-outline" size={SIZE} color={colors.textMuted} />
      }
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  circle:   { width: SIZE, height: SIZE, borderRadius: SIZE / 2, alignItems: 'center', justifyContent: 'center' },
  signedIn: { backgroundColor: colors.primary },
  guest:    { backgroundColor: 'transparent' },
  initial:  { fontSize: fontSize.sm, fontWeight: '700', color: '#fff' },
});
