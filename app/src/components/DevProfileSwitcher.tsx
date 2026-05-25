import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { DEV_PROFILES } from '../dev/devProfiles';
import { colors, fontSize, radius, spacing } from '../constants/theme';
import { useConsultantStore, useFilterStore, useSeenNamesStore, useSessionStore } from '../store';

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function DevProfileSwitcher({ visible, onClose }: Props) {
  const deviceId        = useSessionStore((s) => s.deviceId);
  const setDeviceId     = useSessionStore((s) => s.setDeviceId);
  const resetOnboarding = useSessionStore((s) => s.resetOnboarding);
  const clearSeen       = useSeenNamesStore((s) => s.clearSeen);
  const clearConsultant = useConsultantStore((s) => s.clearSession);
  const resetFilters    = useFilterStore((s) => s.resetFilters);

  const switchProfile = (deviceId: string, listId: string | null) => {
    setDeviceId(deviceId, listId);
    clearSeen();
    clearConsultant();
    resetFilters();
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Dev Profiles</Text>
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeTxt}>Done</Text>
          </Pressable>
        </View>
        <Text style={styles.subtitle}>Active: {deviceId ?? 'none'}</Text>
        <ScrollView contentContainerStyle={styles.list}>
          {DEV_PROFILES.map((profile) => {
            const active = deviceId === profile.deviceId;
            return (
              <Pressable
                key={profile.deviceId}
                style={[styles.card, active && styles.cardActive]}
                onPress={() => switchProfile(profile.deviceId, profile.listId)}
              >
                <View style={styles.cardTop}>
                  <Text style={[styles.cardLabel, active && styles.cardLabelActive]}>
                    {profile.label}
                  </Text>
                  {active && <Text style={styles.activeBadge}>active</Text>}
                  {!profile.listId && <Text style={styles.unseededBadge}>no list</Text>}
                </View>
                <Text style={styles.cardDesc}>{profile.description}</Text>
                <Text style={styles.cardSwipes}>{profile.swipeSummary}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={styles.footer}>
          <Pressable
            style={styles.resetBtn}
            onPress={() => { resetOnboarding(); onClose(); }}
          >
            <Text style={styles.resetTxt}>↩ Restart onboarding</Text>
          </Pressable>
          <Text style={styles.footerNote}>
            Seed: python3.12 data/scripts/seed_dev_profiles.py
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: colors.background },
  header:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg, paddingTop: spacing.xl, borderBottomWidth: 1, borderBottomColor: colors.border },
  title:           { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  closeBtn:        { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
  closeTxt:        { fontSize: fontSize.md, color: colors.primary, fontWeight: '600' },
  subtitle:        { fontSize: fontSize.sm, color: colors.textMuted, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  list:            { padding: spacing.lg, gap: spacing.sm },
  card:            { backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  cardActive:      { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  cardTop:         { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 4 },
  cardLabel:       { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  cardLabelActive: { color: colors.primary },
  activeBadge:     { fontSize: fontSize.xs, fontWeight: '700', color: colors.primary, backgroundColor: '#fff', paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.full, borderWidth: 1, borderColor: colors.primary },
  unseededBadge:   { fontSize: fontSize.xs, fontWeight: '600', color: colors.textMuted, backgroundColor: colors.border, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.full },
  cardDesc:        { fontSize: fontSize.sm, color: colors.textMuted, marginBottom: 2 },
  cardSwipes:      { fontSize: fontSize.xs, color: colors.textMuted },
  footer:          { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, gap: spacing.sm },
  resetBtn:        { alignSelf: 'flex-start', paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  resetTxt:        { fontSize: fontSize.sm, color: colors.textMuted },
  footerNote:      { fontSize: fontSize.xs, color: colors.textMuted, fontFamily: 'Courier' },
});
