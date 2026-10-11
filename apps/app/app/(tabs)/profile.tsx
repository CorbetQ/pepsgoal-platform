import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { bestStreak, globalStreak } from '@pepsgoal/shared';
import { store } from '../../src/db/local';
import { APP_VERSION, LEGAL_URLS } from '../../src/lib/config';
import { subscribeSync, syncNow, type SyncState } from '../../src/sync/engine';
import { useNetwork } from '../../src/state/network';
import { useSession } from '../../src/state/session';
import { ask, Avatar, Button, Card, Chip, Field, Glass, Screen, Seg, SetRow, tell, Toggle, Txt } from '../../src/ui/kit';
import { isWin, level } from '../../src/ui/goals';
import { useA11y } from '../../src/ui/prefs';
import { ACCENTS, FONT, useAppearance, useTheme } from '../../src/ui/theme';

/** Profil et réglages : apparence, accessibilité, synchronisation, compte, informations légales. */
export default function Profile() {
  const t = useTheme();
  const { settings, setAppearance } = useAppearance();
  const { mode, user, userId, dataVersion, register, logout, deleteAccount, canSwitchAccount } = useSession();
  const { online } = useNetwork();
  const { prefs, set } = useA11y();
  const [sync, setSync] = useState<SyncState | null>(null);
  const [form, setForm] = useState({ name: '', username: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [delPw, setDelPw] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const [stats, setStats] = useState({ pts: 0, streak: 0, best: 0, goals: 0 });
  useEffect(() => subscribeSync(setSync), []);
  useFocusEffect(useCallback(() => {
    void (async () => {
      const cs = (await store.checkins()).filter(c => c.userId === userId);
      const days = new Set(cs.filter(isWin).map(c => c.date));
      setStats({ pts: cs.reduce((s, c) => s + (c.points || 0), 0), streak: globalStreak(days).n, best: bestStreak(days), goals: (await store.goals()).filter(g => g.ownerId === userId && !g.archived).length });
    })();
  }, [userId, dataVersion]));
  const lv = level(stats.pts);

  const upgrade = async () => {
    setBusy(true);
    try { await register(form.username, form.name, form.password); tell('Compte créé', 'Toutes tes données sont conservées et synchronisées.'); }
    catch (e) { tell('Création impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  };
  const signOut = async () => {
    const r = await logout();
    if (!r.ok) { tell('Déconnexion impossible', r.reason); return; }
    router.replace('/welcome');
  };
  const confirmDelete = () => ask('Supprimer ton compte ?', 'Ton compte, tes objectifs, publications, stories et messages seront supprimés définitivement du serveur et de cet appareil.', 'Supprimer définitivement', async () => {
    setBusy(true);
    try { await deleteAccount(delPw); router.replace('/welcome'); }
    catch (e) { tell('Suppression impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); setDelPw(''); }
  });
  const syncText = !online ? 'Hors ligne : les modifications seront envoyées au retour de la connexion.'
    : sync?.status === 'syncing' ? 'Synchronisation en cours…'
    : sync?.status === 'error' ? `Erreur : ${sync.message ?? ''}`
    : sync?.lastSyncAt ? `Dernière synchronisation : ${new Date(sync.lastSyncAt).toLocaleString('fr-FR')}` : 'Pas encore synchronisé.';

  return (
    <Screen title="Profil">
      <Glass pad={22} style={{ flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <Avatar user={user ?? { displayName: 'Sans compte', avatar: { kind: 'picto', picto: 'user' } }} size={72} />
        <View style={{ flex: 1, minWidth: 200, gap: 4 }}>
          <Txt v="h1" accessibilityRole="header">{mode === 'guest' ? 'Sans compte' : user?.displayName}</Txt>
          <Txt v="muted">{mode === 'guest' ? 'Données sur cet appareil' : `@${user?.username}`} · Niveau {lv.idx}, {lv.name}{user?.role === 'admin' ? ' · Administrateur' : ''}</Txt>
        </View>
        {user?.role === 'admin' && <Button label="Modération" icon="shield" onPress={() => router.push('/moderation')} />}
      </Glass>

      <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
        {[[stats.pts, 'Flammes'], [stats.streak, 'Série en cours'], [stats.best, 'Meilleure série'], [stats.goals, 'Objectifs']].map(([n, l]) => (
          <Glass key={l as string} pad={16} style={{ flexGrow: 1, flexBasis: 140, alignItems: 'center', gap: 2 }}>
            <Text style={{ fontFamily: FONT.display, fontSize: 26, color: t.ink }}>{n}</Text>
            <Txt v="small">{l}</Txt>
          </Glass>
        ))}
      </View>

      {mode === 'guest' && (
        <Card title="Créer un compte" right={<Chip label="Mode sans compte" icon="lock" />}>
          <Txt v="muted">Garde toutes tes données actuelles et débloque les fonctions sociales et la synchronisation entre tes appareils.</Txt>
          <Field label="Prénom et nom" value={form.name} onChangeText={name => setForm({ ...form, name })} autoComplete="name" />
          <Field label="Nom d'utilisateur" value={form.username} autoCapitalize="none" onChangeText={username => setForm({ ...form, username })} autoComplete="username" />
          <Field label="Mot de passe" value={form.password} secureTextEntry onChangeText={password => setForm({ ...form, password })} placeholder="8 caractères minimum" autoComplete="new-password" />
          <Button label="Créer mon compte" block onPress={upgrade} busy={busy} disabled={!online} />
          {!online && <Txt v="small">Connecte-toi à internet pour créer ton compte.</Txt>}
        </Card>
      )}

      <Card title="Apparence">
        <SetRow title="Thème" hint="Clair, sombre ou selon ton appareil">
          <View style={{ minWidth: 240 }}><Seg label="Thème" items={[['system', 'Auto'], ['light', 'Clair'], ['dark', 'Sombre']]} value={settings.theme} onChange={v => void setAppearance({ theme: v })} /></View>
        </SetRow>
        <Txt v="bold">Couleur d'accent</Txt>
        <Txt v="small">{(ACCENTS[settings.accent] ?? ACCENTS[0]!).n} · flammes, boutons et anneau de progression</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }} accessibilityRole="radiogroup" accessibilityLabel="Couleur d'accent">
          {ACCENTS.map((a, i) => {
            const on = settings.accent === i;
            return (
              <Pressable key={a.n} accessibilityRole="radio" accessibilityLabel={a.n} accessibilityState={{ checked: on }} onPress={() => void setAppearance({ accent: i })}
                style={{ width: 44, height: 44, borderRadius: 22, padding: 3, borderWidth: 3, borderColor: on ? t.ink : 'transparent' }}>
                <View style={{ flex: 1, borderRadius: 20, overflow: 'hidden', flexDirection: 'row' }}>
                  {a.c.map(c => <View key={c} style={{ flex: 1, backgroundColor: c }} />)}
                </View>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Card title="Accessibilité">
        <Toggle label="Contraste élevé" hint="Texte et bordures en noir et blanc purs." value={prefs.highContrast} onChange={v => set({ highContrast: v })} />
        <Toggle label="Mode daltonien" hint="Couleurs des types d’objectifs distinguables avec tous les daltonismes courants." value={prefs.colorblind} onChange={v => set({ colorblind: v })} />
        <Toggle label="Désactiver les animations" hint="Aucune transition entre les écrans." value={prefs.reduceMotion} onChange={v => set({ reduceMotion: v })} />
        <Toggle label="Désactiver la transparence" hint="Panneaux opaques, sans halos colorés en arrière-plan." value={prefs.noTransparency} onChange={v => set({ noTransparency: v })} />
      </Card>

      {mode === 'account' && (
        <Card title="Synchronisation" right={<Chip label={online ? 'En ligne' : 'Hors ligne'} icon={online ? 'cloud' : 'cloudoff'} color={online ? t.ok : t.ink3} />}>
          <Txt v="muted">{syncText}</Txt>
          <Txt v="small">{sync?.pending ? `${sync.pending} modification(s) en attente d'envoi` : 'Tout est à jour.'}</Txt>
          <Button label="Synchroniser maintenant" icon="cloud" kind="ghost" onPress={() => void syncNow()} disabled={!online} />
        </Card>
      )}

      <Card title="Compte">
        <SetRow title={mode === 'guest' ? 'Quitter le mode sans compte' : 'Se déconnecter'} hint={canSwitchAccount ? (mode === 'guest' ? 'Tes données restent sur cet appareil.' : 'Tes données restent sauvegardées sur le serveur.') : 'Hors ligne : la déconnexion et le changement de compte reviendront avec la connexion au serveur.'}>
          <Button label="Se déconnecter" icon="logout" kind="ghost" small onPress={signOut} disabled={!canSwitchAccount} />
        </SetRow>
        {mode === 'account' && user?.role !== 'admin' && (
          !showDelete ? (
            <SetRow title="Supprimer mon compte" hint="Supprime ton profil, tes objectifs, tes publications, tes stories et tes messages. Définitif.">
              <Button label="Supprimer" icon="trash" kind="danger" small onPress={() => setShowDelete(true)} />
            </SetRow>
          ) : (
            <View style={{ gap: 10, paddingTop: 6 }}>
              <Txt v="muted">Confirme avec ton mot de passe. Cette action est définitive.</Txt>
              <Field label="Mot de passe" value={delPw} secureTextEntry onChangeText={setDelPw} autoComplete="current-password" />
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <Button label="Supprimer définitivement" icon="trash" kind="danger" onPress={confirmDelete} busy={busy} disabled={!online || !delPw} />
                <Button label="Annuler" kind="plain" onPress={() => { setShowDelete(false); setDelPw(''); }} />
              </View>
              {!online && <Txt v="small">Connecte-toi à internet pour supprimer ton compte.</Txt>}
            </View>
          )
        )}
      </Card>

      <Card title="Aide et informations légales">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Button label="CGU" kind="ghost" small onPress={() => void Linking.openURL(LEGAL_URLS.cgu)} />
          <Button label="Confidentialité" kind="ghost" small onPress={() => void Linking.openURL(LEGAL_URLS.privacy)} />
          <Button label="Mentions légales" kind="ghost" small onPress={() => void Linking.openURL(LEGAL_URLS.mentions)} />
        </View>
        <Txt v="small">PepsGoal {APP_VERSION} · éditée par Quentin CORBET · quentin-corbet@outlook.fr</Txt>
      </Card>
    </Screen>
  );
}
