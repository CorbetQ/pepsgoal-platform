import { useState } from 'react';
import { Linking, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Field, Glass, Logo, Seg, Txt, TypeChip, WIDE } from '../src/ui/kit';
import { useSession } from '../src/state/session';
import { useNetwork } from '../src/state/network';
import { FONT, useTheme } from '../src/ui/theme';
import { LEGAL_URLS } from '../src/lib/config';

/** Connexion, inscription ou utilisation sans compte (données locales uniquement), comme l'écran d'accueil web. */
export default function Welcome() {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const { login, register, continueAsGuest } = useSession();
  const { online } = useNetwork();
  const [tab, setTab] = useState<'login' | 'signup'>('login');
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(''); setBusy(true);
    try {
      if (tab === 'login') await login(username, password); else await register(username, name, password);
      router.replace('/(tabs)');
    } catch (e) { setError(e instanceof Error ? e.message : 'Erreur inattendue.'); }
    finally { setBusy(false); }
  };
  const link = (label: string, url: string) => <Text accessibilityRole="link" style={{ textDecorationLine: 'underline', fontFamily: FONT.bold, color: t.ink2 }} onPress={() => void Linking.openURL(url)}>{label}</Text>;

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: wide ? 'row' : 'column', alignItems: wide ? 'center' : 'stretch', gap: wide ? 40 : 24, width: '100%', maxWidth: 1100, alignSelf: 'center', paddingHorizontal: wide ? 20 : 16, paddingVertical: 32 }}>
        <View style={{ flex: wide ? 1.1 : undefined, gap: 22 }}>
          <Logo />
          <Text accessibilityRole="header" style={{ fontFamily: FONT.display, fontSize: wide ? 58 : 36, lineHeight: wide ? 60 : 38, letterSpacing: wide ? -2.2 : -1.2, color: t.ink }}>
            Fixe le cap.{'\n'}<Text style={{ color: t.highContrast ? t.ink : t.accent[1] }}>Garde la flamme.</Text>
          </Text>
          <Txt v="muted" style={{ fontSize: 17, lineHeight: 25, maxWidth: 460 }}>Planifie tes objectifs, tes deadlines, tes routines et tes abstinences. Valide chaque jour, fais grandir ta série et avance avec tes amis.</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(['objective', 'deadline', 'routine', 'abstinence'] as const).map(k => <TypeChip key={k} type={k} label={{ objective: 'Objectifs', deadline: 'Deadlines', routine: 'Routines', abstinence: 'Abstinences' }[k]} />)}
          </View>
        </View>

        <Glass pad={26} style={{ width: wide ? 440 : '100%', gap: 16 }}>
          <Seg label="Connexion ou inscription" items={[['login', 'Connexion'], ['signup', 'Créer un compte']]} value={tab} onChange={k => { setTab(k); setError(''); }} />
          {tab === 'signup' && <Field label="Prénom et nom" value={name} onChangeText={setName} autoComplete="name" maxLength={40} placeholder="Camille Roux" />}
          <Field label="Nom d'utilisateur" value={username} onChangeText={setUsername} autoCapitalize="none" autoComplete="username" maxLength={20} placeholder="camille" />
          <Field label="Mot de passe" value={password} onChangeText={setPassword} secureTextEntry autoComplete={tab === 'login' ? 'password' : 'new-password'} placeholder={tab === 'signup' ? '8 caractères minimum' : ''} onSubmitEditing={submit} />
          {!!error && <Text accessibilityRole="alert" style={{ color: t.danger, fontFamily: FONT.bold }}>{error}</Text>}
          {tab === 'signup' && <Text style={{ color: t.ink3, fontFamily: FONT.semibold, fontSize: 12.5, lineHeight: 18 }}>En créant un compte, tu acceptes les {link('conditions générales d’utilisation', LEGAL_URLS.cgu)} et la {link('charte de confidentialité', LEGAL_URLS.privacy)}.</Text>}
          {!online && <Txt v="small">Hors ligne : la connexion à un compte nécessite internet. Tu peux continuer sans compte et créer ton compte plus tard, tes données seront conservées.</Txt>}
          <Button label={tab === 'login' ? 'Me connecter' : 'Créer mon compte'} block onPress={submit} busy={busy} disabled={!online} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flex: 1, height: 1, backgroundColor: t.line }} />
            <Text style={{ color: t.ink3, fontFamily: FONT.heavy, fontSize: 12, letterSpacing: 1.2 }}>OU</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: t.line }} />
          </View>
          <Button label="Continuer sans compte" icon="lock" kind="ghost" block onPress={async () => { await continueAsGuest(); router.replace('/(tabs)'); }} />
          <Text style={{ color: t.ink3, fontFamily: FONT.semibold, fontSize: 12.5, textAlign: 'center', marginTop: -6 }}>Sans compte : données sur cet appareil uniquement, sans synchronisation ni fonctions sociales.</Text>
          <Text style={{ color: t.ink3, fontFamily: FONT.semibold, fontSize: 12.5, textAlign: 'center' }}>{link('CGU', LEGAL_URLS.cgu)} · {link('Mentions légales', LEGAL_URLS.mentions)} · {link('Confidentialité', LEGAL_URLS.privacy)}</Text>
        </Glass>
      </View>
    </ScrollView>
  );
}
