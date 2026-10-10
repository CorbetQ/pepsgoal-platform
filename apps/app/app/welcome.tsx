import { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Field, Muted, Screen, Title } from '../src/ui/kit';
import { useSession } from '../src/state/session';
import { useNetwork } from '../src/state/network';
import { useTheme } from '../src/ui/theme';
import { LEGAL_URLS } from '../src/lib/config';

/** Connexion, inscription ou utilisation sans compte (données locales uniquement). */
export default function Welcome() {
  const t = useTheme();
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

  return (
    <Screen>
      <Title>PepsGoal</Title>
      <Muted>Fixe le cap. Garde la flamme.</Muted>
      <Card>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button label="Connexion" kind={tab === 'login' ? 'primary' : 'ghost'} onPress={() => setTab('login')} />
          <Button label="Créer un compte" kind={tab === 'signup' ? 'primary' : 'ghost'} onPress={() => setTab('signup')} />
        </View>
        {tab === 'signup' && <Field label="Prénom et nom" value={name} onChangeText={setName} autoComplete="name" />}
        <Field label="Nom d'utilisateur" value={username} onChangeText={setUsername} autoCapitalize="none" autoComplete="username" />
        <Field label="Mot de passe" value={password} onChangeText={setPassword} secureTextEntry autoComplete={tab === 'login' ? 'password' : 'new-password'} />
        {tab === 'signup' && (
          <Text style={{ color: t.ink2 }}>
            En créant un compte, tu acceptes les{' '}
            <Text accessibilityRole="link" style={{ textDecorationLine: 'underline', fontWeight: '700' }} onPress={() => void Linking.openURL(LEGAL_URLS.cgu)}>conditions générales d’utilisation</Text>
            {' '}et la{' '}
            <Text accessibilityRole="link" style={{ textDecorationLine: 'underline', fontWeight: '700' }} onPress={() => void Linking.openURL(LEGAL_URLS.privacy)}>charte de confidentialité</Text>.
          </Text>
        )}
        {!!error && <Text accessibilityRole="alert" style={{ color: t.danger, fontWeight: '700' }}>{error}</Text>}
        {!online && <Muted>Pas de connexion : tu peux continuer sans compte et créer ton compte plus tard, tes données seront conservées.</Muted>}
        <Button label={tab === 'login' ? 'Me connecter' : 'Créer mon compte'} onPress={submit} busy={busy} disabled={!online} />
      </Card>
      <Button label="Continuer sans compte" kind="ghost" onPress={async () => { await continueAsGuest(); router.replace('/(tabs)'); }} />
      <Muted>Sans compte : tes objectifs restent sur cet appareil, sans synchronisation ni fonctions sociales.</Muted>
    </Screen>
  );
}
