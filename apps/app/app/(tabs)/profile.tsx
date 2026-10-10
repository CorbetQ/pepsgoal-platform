import { useEffect, useState } from 'react';
import { Alert, Linking, Text } from 'react-native';
import { router } from 'expo-router';
import { APP_VERSION, LEGAL_URLS } from '../../src/lib/config';
import { subscribeSync, syncNow, type SyncState } from '../../src/sync/engine';
import { useNetwork } from '../../src/state/network';
import { useSession } from '../../src/state/session';
import { Button, Card, Field, Muted, Screen, Title } from '../../src/ui/kit';
import { useTheme } from '../../src/ui/theme';

export default function Profile() {
  const t = useTheme();
  const { mode, user, register, logout, deleteAccount } = useSession();
  const { online } = useNetwork();
  const [sync, setSync] = useState<SyncState | null>(null);
  const [form, setForm] = useState({ name: '', username: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [delPw, setDelPw] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  useEffect(() => subscribeSync(setSync), []);

  const upgrade = async () => {
    setBusy(true);
    try { await register(form.username, form.name, form.password); Alert.alert('Compte créé', 'Toutes tes données sont conservées et synchronisées.'); }
    catch (e) { Alert.alert('Création impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  };
  const signOut = async () => {
    const r = await logout();
    if (!r.ok) { Alert.alert('Déconnexion impossible', r.reason); return; }
    router.replace('/welcome');
  };
  const confirmDelete = () => Alert.alert('Supprimer ton compte ?', 'Ton compte, tes objectifs, publications, stories et messages seront supprimés définitivement du serveur et de cet appareil.', [
    { text: 'Annuler', style: 'cancel' },
    { text: 'Supprimer définitivement', style: 'destructive', onPress: async () => {
      setBusy(true);
      try { await deleteAccount(delPw); router.replace('/welcome'); }
      catch (e) { Alert.alert('Suppression impossible', e instanceof Error ? e.message : ''); }
      finally { setBusy(false); setDelPw(''); }
    } }
  ]);

  return (
    <Screen>
      <Title>{mode === 'guest' ? 'Sans compte' : user?.displayName}</Title>
      {mode === 'account' && <Muted>@{user?.username}</Muted>}

      {mode === 'account' && (
        <Card>
          <Text style={{ color: t.ink, fontWeight: '900' }}>Synchronisation</Text>
          <Muted>
            {!online ? 'Hors ligne : les modifications seront envoyées au retour de la connexion.'
              : sync?.status === 'syncing' ? 'Synchronisation en cours…'
              : sync?.status === 'error' ? `Erreur : ${sync.message ?? ''}`
              : sync?.lastSyncAt ? `Dernière synchronisation : ${new Date(sync.lastSyncAt).toLocaleString('fr-FR')}` : 'Pas encore synchronisé.'}
          </Muted>
          <Muted>{sync?.pending ? `${sync.pending} modification(s) en attente d'envoi` : 'Tout est à jour.'}</Muted>
          <Button label="Synchroniser maintenant" kind="ghost" onPress={() => void syncNow()} disabled={!online} />
        </Card>
      )}

      {mode === 'guest' && (
        <Card>
          <Text style={{ color: t.ink, fontWeight: '900' }}>Créer un compte</Text>
          <Muted>Garde tes données actuelles et débloque la synchronisation et les fonctions sociales.</Muted>
          <Field label="Prénom et nom" value={form.name} onChangeText={name => setForm({ ...form, name })} />
          <Field label="Nom d'utilisateur" value={form.username} autoCapitalize="none" onChangeText={username => setForm({ ...form, username })} />
          <Field label="Mot de passe" value={form.password} secureTextEntry onChangeText={password => setForm({ ...form, password })} />
          <Button label="Créer mon compte" onPress={upgrade} busy={busy} disabled={!online} />
          {!online && <Muted>Connecte-toi à internet pour créer ton compte.</Muted>}
        </Card>
      )}

      {user?.role === 'admin' && <Button label="Modération" onPress={() => router.push('/moderation')} />}
      <Button label={mode === 'guest' ? 'Quitter le mode sans compte' : 'Se déconnecter'} kind="ghost" onPress={signOut} />

      {mode === 'account' && user?.role !== 'admin' && (
        <Card>
          <Text style={{ color: t.ink, fontWeight: '900' }}>Supprimer mon compte</Text>
          {!showDelete ? <Button label="Supprimer mon compte" kind="danger" onPress={() => setShowDelete(true)} /> : (
            <>
              <Muted>Confirme avec ton mot de passe. Cette action est définitive.</Muted>
              <Field label="Mot de passe" value={delPw} secureTextEntry onChangeText={setDelPw} />
              <Button label="Supprimer définitivement" kind="danger" onPress={confirmDelete} busy={busy} disabled={!online || !delPw} />
              {!online && <Muted>Connecte-toi à internet pour supprimer ton compte.</Muted>}
            </>
          )}
        </Card>
      )}

      <Card>
        <Text style={{ color: t.ink, fontWeight: '900' }}>Informations légales</Text>
        <Button label="Conditions générales d’utilisation" kind="ghost" onPress={() => void Linking.openURL(LEGAL_URLS.cgu)} />
        <Button label="Charte de confidentialité" kind="ghost" onPress={() => void Linking.openURL(LEGAL_URLS.privacy)} />
        <Button label="Mentions légales" kind="ghost" onPress={() => void Linking.openURL(LEGAL_URLS.mentions)} />
        <Muted>PepsGoal {APP_VERSION} · éditée par Quentin CORBET</Muted>
      </Card>
    </Screen>
  );
}
