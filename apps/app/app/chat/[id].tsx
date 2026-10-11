import { useCallback, useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { MESSAGE_MAX, type E2EPayload } from '@pepsgoal/shared';
import { api } from '../../src/lib/api';
import { decrypt, encrypt, openConversation, resetConversationKey, type Conversation } from '../../src/e2e/client';
import { useSession } from '../../src/state/session';
import { Button, Card, Field, Muted, Screen, Title } from '../../src/ui/kit';
import { accent, useTheme } from '../../src/ui/theme';

interface RawMessage { id: string; mine: boolean; text: string | null; e2e: E2EPayload | null; official: boolean; createdAt: string }
interface Shown { id: string; mine: boolean; text: string; locked: boolean; at: string }

/**
 * Conversation avec un ami : messages chiffrés de bout en bout sur l'appareil avant l'envoi,
 * déchiffrés à l'affichage. Le compte PepsGoal Officiel écrit en clair et ne reçoit pas de réponse.
 */
export default function Chat() {
  const t = useTheme();
  const { id, name, official } = useLocalSearchParams<{ id: string; name?: string; official?: string }>();
  const isOfficial = official === '1';
  const { userId, socialAvailable } = useSession();
  const [conv, setConv] = useState<Conversation | null>(null);
  const [msgs, setMsgs] = useState<Shown[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showCode, setShowCode] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!userId || !id) return;
    try {
      if (!isOfficial) setConv(await openConversation(userId, id));
      const raw = await api<RawMessage[]>('GET', `/v1/conversations/${id}`);
      const shown: Shown[] = [];
      for (const m of raw) {
        const plain = m.e2e ? await decrypt(m.e2e) : m.text;
        shown.push({ id: m.id, mine: m.mine, text: plain ?? 'Message chiffré : la clé n’est pas encore arrivée sur cet appareil.', locked: plain === null, at: m.createdAt });
      }
      setMsgs(shown); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Conversation indisponible.'); }
  }, [userId, id, isOfficial]);

  useFocusEffect(useCallback(() => {
    void load();
    timer.current = setInterval(() => void load(), 10_000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [load]));

  const send = async () => {
    const text = draft.trim();
    if (!text || !conv?.current || !id) return;
    setBusy(true);
    try {
      await api('POST', `/v1/conversations/${id}`, { e2e: encrypt(text, conv.current) });
      setDraft('');
      await load();
    } catch (e) { Alert.alert('Envoi impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  };

  const reset = () => Alert.alert('Créer une nouvelle clé ?', 'Les nouveaux messages seront lisibles tout de suite. Les anciens resteront illisibles sur cet appareil tant que la clé d’origine ne lui aura pas été transmise.', [
    { text: 'Annuler', style: 'cancel' },
    { text: 'Nouvelle clé', onPress: async () => { if (userId && id) { await resetConversationKey(userId, id).catch(e => Alert.alert('Échec', e instanceof Error ? e.message : '')); await load(); } } }
  ]);

  if (!socialAvailable) {
    return <Screen><Title>{name ?? 'Conversation'}</Title><Muted>Messagerie indisponible hors ligne.</Muted><Button label="Retour" kind="ghost" onPress={() => router.back()} /></Screen>;
  }

  return (
    <Screen>
      <Button label="‹ Amis" kind="ghost" onPress={() => router.back()} />
      <Title>{name ?? 'Conversation'}</Title>
      {!isOfficial && (
        <Card>
          <Text style={{ color: t.ink, fontWeight: '800' }} accessibilityRole="text">🔒 Chiffrée de bout en bout</Text>
          <Muted>Seuls ton ami et toi pouvez lire ces messages. Les clés restent sur vos appareils ; PepsGoal ne peut pas les lire.</Muted>
          {showCode && conv ? <Muted>Code de sécurité : {conv.safety}. Il doit être identique sur le téléphone de ton ami.</Muted>
            : <Button label="Vérifier le code de sécurité" kind="ghost" onPress={() => setShowCode(true)} />}
        </Card>
      )}
      {!!error && <Text accessibilityRole="alert" style={{ color: t.danger, fontWeight: '700' }}>{error}</Text>}
      {msgs.length === 0 && !error && <Muted>Aucun message pour l’instant.</Muted>}
      {msgs.map(m => (
        <View key={m.id} style={{ alignSelf: m.mine ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
          <View style={{ backgroundColor: m.mine ? accent.flame : t.card, borderColor: t.line, borderWidth: m.mine ? 0 : 1, borderRadius: 18, paddingVertical: 10, paddingHorizontal: 14 }}>
            <Text style={{ color: m.mine ? accent.onAccent : t.ink, fontStyle: m.locked ? 'italic' : 'normal' }}>{m.text}</Text>
          </View>
          <Text style={{ color: t.ink3, fontSize: 11, textAlign: m.mine ? 'right' : 'left', marginTop: 2 }}>{new Date(m.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</Text>
        </View>
      ))}
      {!isOfficial && conv?.waiting && (
        <Card>
          <Muted>La clé de cette conversation n’est pas encore arrivée sur cet appareil. Elle sera transmise dès qu’un de tes autres appareils ou ton ami ouvrira PepsGoal.</Muted>
          <Button label="Créer une nouvelle clé" kind="ghost" onPress={reset} />
        </Card>
      )}
      {!isOfficial && conv?.current && (
        <Card>
          <Field label="Message" value={draft} onChangeText={setDraft} maxLength={MESSAGE_MAX} multiline placeholder="Écris un message…" />
          <Button label="Envoyer" onPress={send} busy={busy} disabled={!draft.trim()} />
        </Card>
      )}
      {isOfficial && <Muted>Ce compte ne reçoit pas de réponse. Pour nous écrire : quentin-corbet@outlook.fr</Muted>}
    </Screen>
  );
}
