import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../../src/hooks/useAuth';
import { useAuthStore, useSessionStore } from '../../src/store';
import { DevProfileSwitcher } from '../../src/components/DevProfileSwitcher';
import { colors, fontSize, radius, spacing } from '../../src/constants/theme';

const AVATAR_SIZE = 52;

export default function ProfileScreen() {
  const router    = useRouter();
  const { sub, email } = useAuthStore();
  const { signOut } = useAuth();
  const deviceId  = useSessionStore((s) => s.deviceId);
  const [devVisible, setDevVisible] = useState(false);

  const handleSignOut = () => {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: async () => { await signOut(); } },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Account</Text>
      </View>
      {__DEV__ && (
        <>
          <TouchableOpacity style={styles.devBanner} onPress={() => setDevVisible(true)} activeOpacity={0.8}>
            <Ionicons name="construct" size={14} color={colors.primary} />
            <Text style={styles.devBannerText}>Dev profile: {deviceId ?? 'none'}</Text>
            <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
          </TouchableOpacity>
          <DevProfileSwitcher visible={devVisible} onClose={() => setDevVisible(false)} />
        </>
      )}

      {sub ? (
        <View style={styles.section}>
          <View style={styles.avatarRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarInitial}>{email?.[0]?.toUpperCase() ?? '?'}</Text>
            </View>
            <View>
              <Text style={styles.emailText}>{email}</Text>
              <Text style={styles.subtleText}>Signed in</Text>
            </View>
          </View>

          <TouchableOpacity style={styles.signOutRow} onPress={handleSignOut} activeOpacity={0.8}>
            <Ionicons name="log-out-outline" size={18} color={colors.error} />
            <Text style={styles.signOutText}>Sign out</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.section}>
          <View style={styles.guestPrompt}>
            <Ionicons name="person-circle-outline" size={56} color={colors.textMuted} />
            <Text style={styles.guestTitle}>You're browsing as a guest</Text>
            <Text style={styles.guestSub}>Sign in to sync your names and matches across devices.</Text>
          </View>

          <TouchableOpacity style={styles.primaryBtn} onPress={() => router.push('/(auth)/sign-in')} activeOpacity={0.85}>
            <Text style={styles.primaryBtnText}>Sign in</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.push('/(auth)/sign-up')} activeOpacity={0.85}>
            <Text style={styles.secondaryBtnText}>Create account</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:        { flex: 1, backgroundColor: colors.background },
  header:           { paddingHorizontal: spacing.lg, paddingTop: spacing.xl + spacing.lg, paddingBottom: spacing.md },
  devBanner:        { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginHorizontal: spacing.lg, marginBottom: spacing.sm, padding: spacing.sm, backgroundColor: colors.primaryLight, borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary },
  devBannerText:    { flex: 1, fontSize: fontSize.xs, color: colors.primary, fontWeight: '600' },
  headerTitle:      { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  section:          { padding: spacing.lg, gap: spacing.md },
  avatarRow:        { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  avatar:           { width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarInitial:    { fontSize: fontSize.lg, fontWeight: '800', color: '#fff' },
  emailText:        { fontSize: fontSize.md, fontWeight: '600', color: colors.text },
  subtleText:       { fontSize: fontSize.sm, color: colors.textMuted, marginTop: 2 },
  signOutRow:       { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.sm },
  signOutText:      { fontSize: fontSize.md, color: colors.error, fontWeight: '600' },
  guestPrompt:      { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  guestTitle:       { fontSize: fontSize.md, fontWeight: '700', color: colors.text, textAlign: 'center' },
  guestSub:         { fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center', lineHeight: 20 },
  primaryBtn:       { backgroundColor: colors.primary, borderRadius: radius.lg, padding: spacing.md + 4, alignItems: 'center' },
  primaryBtnText:   { color: '#fff', fontSize: fontSize.md, fontWeight: '700' },
  secondaryBtn:     { backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.md + 4, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  secondaryBtnText: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
});
