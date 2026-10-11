import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { E2EPayload, PublicUser } from '@pepsgoal/shared';
import { decrypt } from '../../src/e2e/client';
import { api } from '../../src/lib/api';
import { ask, Avatar, Button, Card, Empty, Field, Flame, Icon, Screen, tell, Txt } from '../../src/ui/kit';
import { alpha, FONT, useTheme } from '../../src/ui/theme';

interface Friend { friendshipId: string; user: PublicUser; streak?: number }
interface Friends { friends: Friend[]; incoming: Friend[]; outgoing: Friend[] }
interface Conversation { peer: PublicUser; lastText: string | null; lastE2e: E2EPayload | null; unread: number; preview?: string }

const openChat = (u: PublicUser) => router.push({ pathname: '/chat/[id]', params: { id: u.id, name: u.displayName, official: u.role === 'official' ? '1' : '0' } });

/** Amis, demandes et conversations (dont PepsGoal Officiel, épinglé en premier). Nécessite un compte et une connexion. */
export default function FriendsScreen() {
  const t = useTheme();
  const [data, setData] = useState<Friends>({ friends: [], incoming: [], outgoing: [] });
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PublicUser[] | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Friends>('GET', '/v1/friends'));
      const list = await api<Conversation[]>('GET', '/v1/conversations');
      // Aperçus déchiffrés sur l'appareil ; « message chiffré » si la clé n'est pas encore là
      for (const c of list) c.preview = c.lastE2e ? ((await decrypt(c.lastE2e)) ?? '🔒 Message chiffré') : c.lastText ?? '';
      setConvs(list);
    } catch { /* hors ligne : l'onglet sera masqué */ }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const search = async () => setResults(q.trim() ? await api<PublicUser[]>('GET', `/v1/users/search?q=${encodeURIComponent(q.trim())}`).catch(() => []) : null);
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); await load(); } catch (e) { tell('Action impossible', e instanceof Error ? e.message : ''); } };
  const block = (u: PublicUser) => ask(`Bloquer ${u.displayName} ?`, 'Vous ne pourrez plus vous voir ni vous écrire.', 'Bloquer', () => act(() => api('POST', `/v1/users/${u.id}/block`, {})));
  const unread = convs.reduce((s, c) => s + c.unread, 0);
  const friendIds = new Set([...data.friends, ...data.outgoing, ...data.incoming].map(f => f.user.id));

  return (
    <Screen title="Amis">
      {convs.length > 0 && (
        <Card title="Messages" right={unread ? <View style={{ paddingVertical: 2, paddingHorizontal: 9, borderRadius: 999, backgroundColor: alpha(t.type('deadline').c, 0.22) }}><Text style={{ fontFamily: FONT.heavy, fontSize: 12, color: t.type('deadline').ink }}>{unread} non lus</Text></View> : undefined}>
          {convs.map(c => {
            const off = c.peer.role === 'official';
            return (
              <Pressable key={c.peer.id} accessibilityRole="button" accessibilityLabel={`Conversation avec ${c.peer.displayName}${c.unread ? `, ${c.unread} non lus` : ''}`} onPress={() => openChat(c.peer)}
                style={s => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 14, backgroundColor: off ? alpha(t.type('project').c, 0.09) : (s as { hovered?: boolean }).hovered ? alpha(t.ink, 0.05) : 'transparent' })}>
                <Avatar user={c.peer} size={44} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Txt v="bold" numberOfLines={1}>{c.peer.displayName}</Txt>
                    {off ? <Icon name="check" size={14} color={t.type('project').ink} stroke={3} /> : <Icon name="lock" size={13} color={t.ink3} />}
                  </View>
                  <Txt v="small" numberOfLines={1} color={c.unread ? t.ink : t.ink2} style={c.unread ? { fontFamily: FONT.heavy } : null}>{c.preview}</Txt>
                </View>
                {c.unread > 0 && <View style={{ minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: t.accent[2] }}><Text style={{ fontFamily: FONT.heavy, fontSize: 11, color: t.onAccent }}>{c.unread}</Text></View>}
              </Pressable>
            );
          })}
        </Card>
      )}

      {data.incoming.length > 0 && (
        <Card title="Demandes reçues" right={data.incoming.length}>
          {data.incoming.map(r => (
            <Row key={r.friendshipId} u={r.user}>
              <Button label="Accepter" icon="check" small onPress={() => act(() => api('POST', `/v1/friends/requests/${r.friendshipId}/accept`, {}))} />
              <Button label="Refuser" kind="plain" small onPress={() => act(() => api('POST', `/v1/friends/requests/${r.friendshipId}/decline`, {}))} />
            </Row>
          ))}
        </Card>
      )}

      <Card title="Mes amis" right={data.friends.length}>
        {data.friends.length === 0 && <Empty text="Cherche des personnes ci-dessous pour comparer vos séries et vous encourager." />}
        {data.friends.map(f => (
          <Row key={f.friendshipId} u={f.user} streak={f.streak}>
            <Button label="Écrire" icon="comment" kind="ghost" small onPress={() => openChat(f.user)} />
            <Button label="Bloquer" kind="plain" small onPress={() => block(f.user)} />
          </Row>
        ))}
      </Card>

      <Card title="Trouver des amis">
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}><Field label="Nom ou @utilisateur" value={q} onChangeText={setQ} onSubmitEditing={search} autoCapitalize="none" placeholder="camille" /></View>
          <Button label="Rechercher" icon="userplus" kind="ghost" onPress={search} />
        </View>
        {results && results.length === 0 && <Txt v="small">Aucun compte ne correspond.</Txt>}
        {results?.map(u => (
          <Row key={u.id} u={u}>
            {friendIds.has(u.id) ? <Txt v="small">Déjà en lien</Txt> : <Button label="Ajouter" icon="userplus" small onPress={() => act(() => api('POST', '/v1/friends/requests', { userId: u.id }))} />}
          </Row>
        ))}
        {data.outgoing.length > 0 && <Txt v="small">Demandes envoyées : {data.outgoing.map(o => o.user.displayName).join(', ')}</Txt>}
      </Card>
    </Screen>
  );
}

function Row({ u, streak, children }: { u: PublicUser; streak?: number; children?: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.line, flexWrap: 'wrap' }}>
      <Avatar user={u} size={44} />
      <View style={{ flex: 1, minWidth: 140 }}>
        <Txt v="bold" numberOfLines={1}>{u.displayName}</Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Txt v="small" color={t.ink3}>@{u.username}</Txt>
          {streak !== undefined && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}><Flame size={16} dim={!streak} /><Txt v="small" style={{ fontFamily: FONT.heavy }}>{streak}</Txt></View>}
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 6 }}>{children}</View>
    </View>
  );
}
