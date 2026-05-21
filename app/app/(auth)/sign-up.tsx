import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../../src/hooks/useAuth';
import { colors, fontSize, radius, spacing } from '../../src/constants/theme';

export default function SignUp() {
  const router = useRouter();
  const { signUpEmail, useSocialSignIn } = useAuth();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const { request: appleRequest, promptAsync: promptApple } = useSocialSignIn('Apple');
  const { request: googleRequest, promptAsync: promptGoogle } = useSocialSignIn('Google');

  const handleEmail = async () => {
    if (!email || !password) return;
    setLoading(true); setError(null);
    try {
      await signUpEmail(email.trim(), password);
      router.push({ pathname: '/(auth)/verify', params: { email: email.trim() } });
    } catch (e: any) {
      setError(e.message ?? 'Sign up failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSocial = async (prompt: () => void) => {
    setError(null);
    try { await prompt(); router.replace('/(tabs)/swipe'); }
    catch (e: any) { setError(e.message ?? 'Sign up failed. Please try again.'); }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Create account</Text>
        <Text style={styles.subtitle}>Save and sync your names across devices</Text>
      </View>

      <View style={styles.form}>
        <TextInput style={styles.input} placeholder="Email" placeholderTextColor={colors.textMuted}
          keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
          value={email} onChangeText={setEmail} />
        <TextInput style={styles.input} placeholder="Password" placeholderTextColor={colors.textMuted}
          secureTextEntry value={password} onChangeText={setPassword} />

        {error && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity style={[styles.primaryBtn, (!email || !password || loading) && styles.disabled]}
          onPress={handleEmail} disabled={!email || !password || loading} activeOpacity={0.85}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Create account</Text>}
        </TouchableOpacity>
      </View>

      <View style={styles.dividerRow}>
        <View style={styles.divider} /><Text style={styles.dividerText}>or</Text><View style={styles.divider} />
      </View>

      <View style={styles.socialBtns}>
        {Platform.OS === 'ios' && (
          <TouchableOpacity style={[styles.socialBtn, styles.appleBtn, !appleRequest && styles.disabled]}
            onPress={() => handleSocial(promptApple as any)} disabled={!appleRequest} activeOpacity={0.85}>
            <Text style={styles.appleBtnText}>Sign up with Apple</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[styles.socialBtn, styles.googleBtn, !googleRequest && styles.disabled]}
          onPress={() => handleSocial(promptGoogle as any)} disabled={!googleRequest} activeOpacity={0.85}>
          <Text style={styles.googleBtnText}>Sign up with Google</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.footer} onPress={() => router.push('/(auth)/sign-in')}>
        <Text style={styles.footerText}>Already have an account? <Text style={styles.footerLink}>Sign in</Text></Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, padding: spacing.xl, justifyContent: 'center', gap: spacing.lg },
  header:         { gap: spacing.xs },
  title:          { fontSize: fontSize.xl, fontWeight: '800', color: colors.text },
  subtitle:       { fontSize: fontSize.md, color: colors.textMuted, lineHeight: 22 },
  form:           { gap: spacing.md },
  input:          { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, fontSize: fontSize.md, color: colors.text },
  error:          { fontSize: fontSize.sm, color: colors.error },
  primaryBtn:     { backgroundColor: colors.primary, borderRadius: radius.lg, padding: spacing.md + 4, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontSize: fontSize.md, fontWeight: '700' },
  disabled:       { opacity: 0.5 },
  dividerRow:     { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  divider:        { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText:    { color: colors.textMuted, fontSize: fontSize.sm },
  socialBtns:     { gap: spacing.sm },
  socialBtn:      { borderRadius: radius.lg, padding: spacing.md + 4, alignItems: 'center' },
  appleBtn:       { backgroundColor: '#000' },
  appleBtnText:   { color: '#fff', fontSize: fontSize.md, fontWeight: '600' },
  googleBtn:      { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  googleBtnText:  { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  footer:         { alignItems: 'center' },
  footerText:     { fontSize: fontSize.sm, color: colors.textMuted },
  footerLink:     { color: colors.primary, fontWeight: '600' },
});
