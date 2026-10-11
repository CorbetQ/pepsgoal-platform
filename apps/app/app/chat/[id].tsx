import { useCallback, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { MESSAGE_MAX, type E2EPayload } from '@pepsgoal/shared';
import { api } from '../../src/lib/api';
import { decrypt, encrypt, openConversation, resetConversationKey, type Conversation } from '../../src/e2e/client';
import { useSession } from '../../src/state/session';
import { ask, Avatar, Button, Card, Empty, Field, Glass, Icon, Screen, tell, Txt } from '../../src/ui/kit';
import { alpha, FONT, useTheme } from '../../src/ui/theme';

interface RawMessage { id: string; mine: boolean; text: string | null; e2e: E2EPayload | null; official: boolean; createdAt: string }
interface Shown { id: string; mine: boolean; text: string; locked: boolean; at: string; official: boolean }

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
        shown.push({ id: m.id, mine: m.mine, official: m.official, text: plain ?? 'Message chiffré : la clé n’est pas encore arrivée sur cet appareil.', locked: plain === null, at: m.createdAt });
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
    } catch (e) { tell('Envoi impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  };
  const reset = () => ask('Créer une nouvelle clé ?', 'Les nouveaux messages seront lisibles tout de suite. Les anciens resteront illisibles sur cet appareil tant que la clé d’origine ne lui aura pas été transmise.', 'Nouvelle clé', async () => {
    if (userId && id) { await resetConversationKey(userId, id).catch(e => tell('Échec', e instanceof Error ? e.message : '')); await load(); }
  }, false);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/friends'));
  const peer = { displayName: name ?? 'Conversation', username: '', avatar: null };

  return (
    <Screen tabs={false}>
      <Glass pad={14} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Button label="Amis" icon="x" kind="plain" small onPress={back} />
        <Avatar user={peer} size={40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt v="bold" numberOfLines={1} accessibilityRole="header">{name ?? 'Conversation'}</Txt>
          <Txt v="small" color={t.ink3}>{isOfficial ? 'Compte officiel' : 'Chiffrée de bout en bout'}</Txt>
        </View>
      </Glass>

      {!socialAvailable ? <Glass><Empty title="Messagerie indisponible" text="Hors ligne : la messagerie revient avec la connexion." /></Glass> : (
        <>
          {!isOfficial && (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingHorizontal: 4 }}>
              <Icon name="lock" size={16} color={t.ink2} />
              <Text style={{ flex: 1, color: t.ink2, fontFamily: FONT.semibold, fontSize: 12.5, lineHeight: 18 }}>
                Seuls ton ami et toi pouvez lire ces messages : les clés restent sur vos appareils.{' '}
                {showCode && conv ? `Code de sécurité : ${conv.safety} (identique chez ton ami).` : <Text accessibilityRole="button" onPress={() => setShowCode(true)} style={{ textDecorationLine: 'underline', fontFamily: FONT.bold }}>Vérifier le code de sécurité</Text>}
              </Text>
            </View>
          )}
          {!!error && <Text accessibilityRole="alert" style={{ color: t.danger, fontFamily: FONT.bold }}>{error}</Text>}
          <Glass style={{ gap: 8 }}>
            {msgs.length === 0 && !error && <Empty text="Aucun message pour l’instant. Lance la conversation !" />}
            {msgs.map(m => {
              const time = new Date(m.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
              const bubble = { maxWidth: '82%' as const, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 18 };
              const content = (
                <>
                  <Text style={{ color: m.mine ? t.onAccent : t.ink, fontFamily: FONT.semibold, fontSize: 14.5, lineHeight: 20, fontStyle: m.locked ? 'italic' : 'normal' }}>{m.text}</Text>
                  <Text style={{ color: m.mine ? t.onAccent : t.ink, opacity: 0.72, fontSize: 10.5, fontFamily: FONT.semibold, textAlign: 'right', marginTop: 2 }}>{time}</Text>
                </>
              );
              return m.mine ? (
                <LinearGradient key={m.id} colors={t.accent} locations={[0, 0.6, 1]} start={{ x: 0, y: 0.2 }} end={{ x: 1, y: 0.8 }} style={[bubble, { alignSelf: 'flex-end', borderBottomRightRadius: 5 }]}>{content}</LinearGradient>
              ) : (
                <View key={m.id} style={[bubble, { alignSelf: 'flex-start', borderBottomLeftRadius: 5, backgroundColor: m.official ? alpha(t.type('project').c, 0.14) : alpha(t.ink, 0.08), borderWidth: m.official ? 1 : 0, borderColor: alpha(t.type('project').c, 0.35) }]}>{content}</View>
              );
            })}
          </Glass>
          {!isOfficial && conv?.waiting && (
            <Card>
              <Txt v="muted">La clé de cette conversation n’est pas encore arrivée sur cet appareil. Elle sera transmise dès qu’un de tes autres appareils ou ton ami ouvrira PepsGoal.</Txt>
              <Button label="Créer une nouvelle clé" icon="lock" kind="ghost" onPress={reset} />
            </Card>
          )}
          {!isOfficial && conv?.current && (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
              <View style={{ flex: 1 }}><Field label="Message" value={draft} onChangeText={setDraft} maxLength={MESSAGE_MAX} placeholder="Écrire un message…" onSubmitEditing={send} /></View>
              <Button label="Envoyer" icon="send" onPress={send} busy={busy} disabled={!draft.trim()} />
            </View>
          )}
          {isOfficial && <Txt v="small">Ce compte ne reçoit pas de réponse. Pour nous écrire : quentin-corbet@outlook.fr</Txt>}
        </>
      )}
    </Screen>
  );
}
