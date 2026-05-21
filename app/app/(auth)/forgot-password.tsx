import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../../src/hooks/useAuth';
import { colors, fontSize, radius, spacing } from '../../src/constants/theme';

export default function ForgotPassword() {
  const router = useRouter();
  const { forgotPassword, confirmForgotPassword } = useAuth();

  const [step, setStep]             = useState<'email' | 'reset'>('email');
  const [email, setEmail]           = useState('');
  const [code, setCode]             = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);

  const handleSendCode = async () => {
    if (!email) return;
    setLoading(true); setError(null);
    try { await forgotPassword(email.trim()); setStep('reset'); }
    catch (e: any) { setError(e.message ?? 'Could not send reset code.'); }
    finally { setLoading(false); }
  };

  const handleReset = async () => {
    if (!code || !newPassword) return;
    setLoading(true); setError(null);
    try {
      await confirmForgotPassword(email.trim(), code.trim(), newPassword);
      router.replace('/(auth)/sign-in');
    } catch (e: any) {
      setError(e.message ?? 'Reset failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'email') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Reset password</Text>
          <Text style={styles.subtitle}>Enter your email and we'll send a reset code.</Text>
        </View>
        <View style={styles.form}>
          <TextInput style={styles.input} placeholder="Email" placeholderTextColor={colors.textMuted}
            keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
            value={email} onChangeText={setEmail} />
          {error && <Text style={styles.error}>{error}</Text>}
          <TouchableOpacity style={[styles.primaryBtn, (!email || loading) && styles.disabled]}
            onPress={handleSendCode} disabled={!email || loading} activeOpacity={0.85}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Send code</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.link}>Back to sign in</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Enter new password</Text>
        <Text style={styles.subtitle}>Check your email for the code sent to{'\n'}<Text style={styles.em}>{email}</Text></Text>
      </View>
      <View style={styles.form}>
        <TextInput style={[styles.input, styles.codeInput]} placeholder="000000"
          placeholderTextColor={colors.textMuted} keyboardType="number-pad" maxLength={6}
          value={code} onChangeText={setCode} textContentType="oneTimeCode" autoComplete="one-time-code" />
        <TextInput style={styles.input} placeholder="New password" placeholderTextColor={colors.textMuted}
          secureTextEntry value={newPassword} onChangeText={setNewPassword} />
        {error && <Text style={styles.error}>{error}</Text>}
        <TouchableOpacity style={[styles.primaryBtn, (!code || !newPassword || loading) && styles.disabled]}
          onPress={handleReset} disabled={!code || !newPassword || loading} activeOpacity={0.85}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Reset password</Text>}
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { setStep('email'); setError(null); }}>
          <Text style={styles.link}>Use a different email</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, padding: spacing.xl, justifyContent: 'center', gap: spacing.lg },
  header:         { gap: spacing.xs },
  title:          { fontSize: fontSize.xl, fontWeight: '800', color: colors.text },
  subtitle:       { fontSize: fontSize.md, color: colors.textMuted, lineHeight: 22 },
  em:             { color: colors.text, fontWeight: '600' },
  form:           { gap: spacing.md },
  input:          { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, fontSize: fontSize.md, color: colors.text },
  codeInput:      { fontSize: fontSize.xl, textAlign: 'center', letterSpacing: 8, fontWeight: '700' },
  error:          { fontSize: fontSize.sm, color: colors.error },
  primaryBtn:     { backgroundColor: colors.primary, borderRadius: radius.lg, padding: spacing.md + 4, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontSize: fontSize.md, fontWeight: '700' },
  disabled:       { opacity: 0.5 },
  link:           { color: colors.primary, fontSize: fontSize.sm, textAlign: 'center' },
});
