import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../../src/hooks/useAuth';
import { colors, fontSize, radius, spacing } from '../../src/constants/theme';

export default function Verify() {
  const router = useRouter();
  const { email } = useLocalSearchParams<{ email: string }>();
  const { confirmSignUp, resendConfirmationCode, signInEmail } = useAuth();

  const [code, setCode]         = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [resendSent, setResendSent] = useState(false);

  const handleVerify = async () => {
    if (code.length !== 6) return;
    setLoading(true); setError(null);
    try {
      await confirmSignUp(email, code.trim());
      if (password) {
        await signInEmail(email, password);
        router.replace('/(tabs)/swipe');
      } else {
        router.replace('/(auth)/sign-in');
      }
    } catch (e: any) {
      setError(e.message ?? 'Verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResending(true); setError(null); setResendSent(false);
    try { await resendConfirmationCode(email); setResendSent(true); }
    catch (e: any) { setError(e.message ?? 'Could not resend code.'); }
    finally { setResending(false); }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Check your email</Text>
        <Text style={styles.subtitle}>We sent a 6-digit code to{'\n'}<Text style={styles.em}>{email}</Text></Text>
      </View>

      <View style={styles.form}>
        <TextInput style={[styles.input, styles.codeInput]} placeholder="000000"
          placeholderTextColor={colors.textMuted} keyboardType="number-pad" maxLength={6}
          value={code} onChangeText={setCode} textContentType="oneTimeCode" autoComplete="one-time-code" />

        <TextInput style={styles.input} placeholder="Password (to sign in automatically)"
          placeholderTextColor={colors.textMuted} secureTextEntry
          value={password} onChangeText={setPassword} />

        {error      && <Text style={styles.error}>{error}</Text>}
        {resendSent && <Text style={styles.success}>Code resent — check your inbox.</Text>}

        <TouchableOpacity style={[styles.primaryBtn, (code.length !== 6 || loading) && styles.disabled]}
          onPress={handleVerify} disabled={code.length !== 6 || loading} activeOpacity={0.85}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Verify</Text>}
        </TouchableOpacity>

        <TouchableOpacity onPress={handleResend} disabled={resending}>
          <Text style={[styles.link, resending && styles.disabled]}>{resending ? 'Sending…' : 'Resend code'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, padding: spacing.xl, justifyContent: 'center', gap: spacing.lg },
  header:       { gap: spacing.xs },
  title:        { fontSize: fontSize.xl, fontWeight: '800', color: colors.text },
  subtitle:     { fontSize: fontSize.md, color: colors.textMuted, lineHeight: 22 },
  em:           { color: colors.text, fontWeight: '600' },
  form:         { gap: spacing.md },
  input:        { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, fontSize: fontSize.md, color: colors.text },
  codeInput:    { fontSize: fontSize.xl, textAlign: 'center', letterSpacing: 8, fontWeight: '700' },
  error:        { fontSize: fontSize.sm, color: colors.error },
  success:      { fontSize: fontSize.sm, color: colors.primary },
  primaryBtn:   { backgroundColor: colors.primary, borderRadius: radius.lg, padding: spacing.md + 4, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontSize: fontSize.md, fontWeight: '700' },
  disabled:     { opacity: 0.5 },
  link:         { color: colors.primary, fontSize: fontSize.sm, textAlign: 'center' },
});
