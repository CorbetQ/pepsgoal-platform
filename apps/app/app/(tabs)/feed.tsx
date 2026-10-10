import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { PublicUser } from '@pepsgoal/shared';
import { api, ApiError } from '../../src/lib/api';
import { useSession } from '../../src/state/session';
import { Button, Card, Field, Muted, StatusBanner, Title } from '../../src/ui/kit';
import { useTheme } from '../../src/ui/theme';

interface Post { id: string; author: PublicUser; text: string; likeCount: number; liked: boolean; status: string; comments: { id: string; author: PublicUser; text: string }[] }

/** Feed : nécessite un compte et une connexion (l'onglet est masqué sinon). Les données ne sont pas mises en cache. */
export default function Feed() {
  const t = useTheme();
  const { user } = useSession();
  const [tab, setTab] = useState<'friends' | 'public'>('friends');
  const [posts, setPosts] = useState<Post[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setPosts((await api<{ posts: Post[] }>('GET', `/v1/feed?tab=${tab}`)).posts); }
    catch (e) { if (e instanceof ApiError && e.status !== 0) Alert.alert('Feed indisponible', e.message); }
    finally { setLoading(false); }
  }, [tab]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const publish = async () => {
    try {
      const r = await api<{ status: string }>('POST', '/v1/posts', { text, visibility: 'friends', goalId: null });
      setText('');
      if (r.status === 'pending') Alert.alert('Publication envoyée', 'Elle sera visible après validation par la modération.');
      await load();
    } catch (e) { Alert.alert('Publication impossible', e instanceof Error ? e.message : ''); }
  };
  const like = async (p: Post) => {
    try { await api(p.liked ? 'DELETE' : 'POST', `/v1/posts/${p.id}/like`, p.liked ? undefined : {}); await load(); }
    catch (e) { Alert.alert('Action impossible', e instanceof Error ? e.message : ''); }
  };
  const report = (p: Post) => Alert.alert('Signaler cette publication ?', 'La modération va l’examiner.', [
    { text: 'Annuler', style: 'cancel' },
    { text: 'Signaler', style: 'destructive', onPress: () => void api('POST', `/v1/posts/${p.id}/report`, { reason: 'other' }).then(() => Alert.alert('Merci', 'Signalement envoyé.')) }
  ]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
        <StatusBanner />
        <Title>Feed</Title>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button label="Mes amis" kind={tab === 'friends' ? 'primary' : 'ghost'} onPress={() => setTab('friends')} />
          <Button label="Découvrir" kind={tab === 'public' ? 'primary' : 'ghost'} onPress={() => setTab('public')} />
        </View>
        <Card>
          <Field label="Nouvelle publication" value={text} onChangeText={setText} multiline maxLength={500} placeholder="Partage une victoire…" />
          <Button label="Publier" onPress={publish} disabled={!text.trim()} />
        </Card>
        {posts.length === 0 && !loading && <Muted>Rien pour l'instant.</Muted>}
        {posts.map(p => (
          <Card key={p.id}>
            <Text style={{ color: t.ink, fontWeight: '800' }}>{p.author.id === user?.id ? 'Toi' : p.author.displayName}{p.status === 'pending' ? ' · en attente de validation' : ''}</Text>
            <Text style={{ color: t.ink, fontSize: 15 }}>{p.text}</Text>
            <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
              <Pressable accessibilityRole="button" accessibilityState={{ selected: p.liked }} onPress={() => like(p)}><Text style={{ color: t.ink2, fontWeight: '800' }}>🔥 {p.likeCount} Encourager</Text></Pressable>
              {p.author.id !== user?.id && <Pressable accessibilityRole="button" onPress={() => report(p)}><Text style={{ color: t.ink3 }}>Signaler</Text></Pressable>}
            </View>
            {p.comments.map(c => <Muted key={c.id}>{c.author.displayName} : {c.text}</Muted>)}
          </Card>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
