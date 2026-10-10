import { useCallback, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { PublicUser } from '@pepsgoal/shared';
import { api } from '../../src/lib/api';
import { Button, Card, Field, Muted, Screen, Title } from '../../src/ui/kit';
import { useTheme } from '../../src/ui/theme';

interface Friends { friends: { friendshipId: string; user: PublicUser }[]; incoming: { friendshipId: string; user: PublicUser }[]; outgoing: { friendshipId: string; user: PublicUser }[] }
interface Conversation { peer: PublicUser; lastText: string; unread: number }

/** Amis, demandes et conversations (dont PepsGoal Officiel, épinglé en premier). Nécessite un compte et une connexion. */
export default function FriendsScreen() {
  const t = useTheme();
  const [data, setData] = useState<Friends>({ friends: [], incoming: [], outgoing: [] });
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PublicUser[]>([]);

  const load = useCallback(async () => {
    try {
      setData(await api<Friends>('GET', '/v1/friends'));
      setConvs(await api<Conversation[]>('GET', '/v1/conversations'));
    } catch { /* hors ligne : l'onglet sera masqué */ }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const search = async () => setResults(await api<PublicUser[]>('GET', `/v1/users/search?q=${encodeURIComponent(q)}`).catch(() => []));
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); await load(); } catch (e) { Alert.alert('Action impossible', e instanceof Error ? e.message : ''); } };
  const block = (u: PublicUser) => Alert.alert(`Bloquer ${u.displayName} ?`, 'Vous ne pourrez plus vous voir ni vous écrire.', [
    { text: 'Annuler', style: 'cancel' },
    { text: 'Bloquer', style: 'destructive', onPress: () => void act(() => api('POST', `/v1/users/${u.id}/block`, {})) }
  ]);

  return (
    <Screen>
      <Title>Amis</Title>
      {convs.length > 0 && (
        <Card>
          <Text style={{ color: t.ink, fontWeight: '900' }}>Messages</Text>
          {convs.map(c => <Muted key={c.peer.id}>{c.peer.role === 'official' ? '✓ ' : ''}{c.peer.displayName}{c.unread ? ` (${c.unread})` : ''} : {c.lastText}</Muted>)}
        </Card>
      )}
      {data.incoming.length > 0 && (
        <Card>
          <Text style={{ color: t.ink, fontWeight: '900' }}>Demandes reçues</Text>
          {data.incoming.map(r => (
            <View key={r.friendshipId} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text style={{ color: t.ink, flex: 1 }}>{r.user.displayName}</Text>
              <Button label="Accepter" onPress={() => act(() => api('POST', `/v1/friends/requests/${r.friendshipId}/accept`, {}))} />
              <Button label="Refuser" kind="ghost" onPress={() => act(() => api('POST', `/v1/friends/requests/${r.friendshipId}/decline`, {}))} />
            </View>
          ))}
        </Card>
      )}
      <Card>
        <Text style={{ color: t.ink, fontWeight: '900' }}>Mes amis ({data.friends.length})</Text>
        {data.friends.length === 0 && <Muted>Cherche des personnes ci-dessous.</Muted>}
        {data.friends.map(f => (
          <View key={f.friendshipId} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: t.ink, flex: 1 }}>{f.user.displayName} · @{f.user.username}</Text>
            <Button label="Bloquer" kind="danger" onPress={() => block(f.user)} />
          </View>
        ))}
      </Card>
      <Card>
        <Field label="Trouver des amis" value={q} onChangeText={setQ} onSubmitEditing={search} autoCapitalize="none" placeholder="Nom ou @utilisateur" />
        <Button label="Rechercher" kind="ghost" onPress={search} />
        {results.map(u => (
          <View key={u.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: t.ink, flex: 1 }}>{u.displayName} · @{u.username}</Text>
            <Button label="Ajouter" onPress={() => act(() => api('POST', '/v1/friends/requests', { userId: u.id }))} />
          </View>
        ))}
      </Card>
    </Screen>
  );
}
