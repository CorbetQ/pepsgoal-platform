import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNetwork } from '../state/network';
import { useSession } from '../state/session';
import { accent, useTheme } from './theme';

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const t = useTheme();
  const body = <View style={styles.inner}><StatusBanner />{children}</View>;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'left', 'right']}>
      {scroll ? <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">{body}</ScrollView> : body}
    </SafeAreaView>
  );
}

/** Bandeau hors ligne / maintenance / mode sans compte, affiché en haut de chaque écran. */
export function StatusBanner() {
  const t = useTheme();
  const { online, maintenance } = useNetwork();
  const { mode } = useSession();
  let text: string | null = null;
  if (mode === 'account' && !online) text = 'Hors ligne : tes validations sont enregistrées sur cet appareil et seront synchronisées au retour de la connexion. Fonctions sociales masquées.';
  else if (maintenance) text = maintenance.mode === 'full' ? `Maintenance en cours. ${maintenance.message}` : 'Maintenance : fonctions sociales en lecture seule.';
  else if (mode === 'guest') text = 'Sans compte : données sur cet appareil uniquement, sans synchronisation ni fonctions sociales.';
  if (!text) return null;
  return <View style={[styles.banner, { borderColor: t.line, borderWidth: t.borderWidth }]} accessibilityRole="alert"><Text style={{ color: t.ink2, fontSize: 13 }}>{text}</Text></View>;
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line, borderWidth: t.borderWidth }, style]}>{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text accessibilityRole="header" style={[styles.title, { color: t.ink }]}>{children}</Text>;
}

export function Muted({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={{ color: t.ink2, fontSize: 14, lineHeight: 20 }}>{children}</Text>;
}

export function Button({ label, onPress, kind = 'primary', busy, disabled }: { label: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'danger'; busy?: boolean; disabled?: boolean }) {
  const t = useTheme();
  const bg = kind === 'primary' ? accent.flame : 'transparent';
  const color = kind === 'primary' ? accent.onAccent : kind === 'danger' ? t.danger : t.ink;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled || busy} onPress={onPress}
      style={({ pressed }) => [styles.btn, { backgroundColor: bg, borderColor: kind === 'primary' ? bg : t.line, borderWidth: t.borderWidth, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }]}>
      {busy ? <ActivityIndicator color={color} /> : <Text style={{ color, fontWeight: '800', fontSize: 15 }}>{label}</Text>}
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: t.ink2, fontWeight: '800', fontSize: 13 }}>{props.label}</Text>
      <TextInput placeholderTextColor={t.ink3} {...props} accessibilityLabel={props.label}
        style={[styles.input, { color: t.ink, borderColor: t.line, backgroundColor: t.card, borderWidth: t.borderWidth + 0.5 }]} />
    </View>
  );
}

/** Interrupteur avec titre et explication, lisible par les lecteurs d'écran. */
export function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: value }} aria-checked={value} accessibilityLabel={label} accessibilityHint={hint}
      onPress={() => onChange(!value)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.ink, fontWeight: '800', fontSize: 15 }}>{label}</Text>
        {!!hint && <Text style={{ color: t.ink2, fontSize: 13 }}>{hint}</Text>}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: accent.flame, false: t.ink3 }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden aria-hidden />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1 },
  inner: { padding: 16, gap: 14, maxWidth: 720, width: '100%', alignSelf: 'center' },
  card: { borderWidth: 1, borderRadius: 24, padding: 18, gap: 10 },
  title: { fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  btn: { minHeight: 48, borderRadius: 999, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  input: { minHeight: 48, borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14, fontSize: 16 },
  banner: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 14, padding: 12 }
});
