import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { PublicUser } from '@pepsgoal/shared';
import { api, ApiError } from '../../src/lib/api';
import { useSession } from '../../src/state/session';
import { ask, Avatar, Button, Card, Chip, Empty, Fab, Field, Flame, Glass, Icon, Screen, Seg, tell, Txt, useWide } from '../../src/ui/kit';
import { alpha, FONT, useTheme } from '../../src/ui/theme';

interface Post { id: string; author: PublicUser; text: string; likeCount: number; liked: boolean; status: string; visibility?: string; createdAt?: string; comments: { id: string; author: PublicUser; text: string }[] }

const ago = (iso?: string) => {
  if (!iso) return '';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "à l'instant" : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : `il y a ${Math.round(m / 1440)} j`;
};

/** Feed : nécessite un compte et une connexion (l'onglet est masqué sinon). Les données ne sont pas mises en cache. */
export default function Feed() {
  const t = useTheme();
  const { user } = useSession();
  const wide = useWide();
  const [tab, setTab] = useState<'friends' | 'public'>('friends');
  const [posts, setPosts] = useState<Post[]>([]);
  const [text, setText] = useState('');
  const [vis, setVis] = useState<'friends' | 'public'>('friends');
  const [comment, setComment] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [composing, setComposing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setPosts((await api<{ posts: Post[] }>('GET', `/v1/feed?tab=${tab}`)).posts); }
    catch (e) { if (e instanceof ApiError && e.status !== 0) tell('Feed indisponible', e.message); }
    finally { setLoading(false); }
  }, [tab]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const publish = async () => {
    try {
      const r = await api<{ status: string }>('POST', '/v1/posts', { text, visibility: vis, goalId: null });
      setText(''); setComposing(false);
      if (r.status === 'pending') tell('Publication envoyée', 'Elle sera visible après validation par la modération.');
      await load();
    } catch (e) { tell('Publication impossible', e instanceof Error ? e.message : ''); }
  };
  const like = async (p: Post) => {
    try { await api(p.liked ? 'DELETE' : 'POST', `/v1/posts/${p.id}/like`, p.liked ? undefined : {}); await load(); }
    catch (e) { tell('Action impossible', e instanceof Error ? e.message : ''); }
  };
  const send = async (p: Post) => {
    const c = (comment[p.id] ?? '').trim(); if (!c) return;
    try { await api('POST', `/v1/posts/${p.id}/comments`, { text: c }); setComment({ ...comment, [p.id]: '' }); await load(); }
    catch (e) { tell('Commentaire impossible', e instanceof Error ? e.message : ''); }
  };
  const report = (p: Post) => ask('Signaler cette publication ?', 'La modération va l’examiner.', 'Signaler', () => void api('POST', `/v1/posts/${p.id}/report`, { reason: 'other' }).then(() => tell('Merci', 'Signalement envoyé.')));

  return (
    <View style={{ flex: 1 }}>
    <Screen title="Feed">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1 }}><Seg label="Fil" items={[['friends', 'Mes amis'], ['public', 'Découvrir']]} value={tab} onChange={setTab} /></View>
        {wide && !composing && <Button label="Publier" icon="plus" onPress={() => setComposing(true)} />}
      </View>
      {composing && <Card title="Nouvelle publication" right={<Button label="Fermer" kind="plain" small onPress={() => setComposing(false)} />}>
        <Field label="Partage une victoire" value={text} onChangeText={setText} multiline maxLength={500} placeholder="Trois semaines sans sucre, je suis fier !" />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <View style={{ flex: 1, minWidth: 200 }}><Seg label="Visibilité" items={[['friends', 'Amis'], ['public', 'Public']]} value={vis} onChange={setVis} /></View>
          <Button label="Publier" icon="send" onPress={publish} disabled={!text.trim()} />
        </View>
      </Card>}
      {posts.length === 0 && !loading && <Glass><Empty title="Rien pour l'instant" text={tab === 'friends' ? 'Les victoires de tes amis apparaîtront ici.' : 'Aucune publication publique pour le moment.'} /></Glass>}
      {posts.map(p => (
        <Glass key={p.id}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Avatar user={p.author} size={42} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt v="bold" numberOfLines={1}>{p.author.id === user?.id ? 'Toi' : p.author.displayName}</Txt>
              <Txt v="small" color={t.ink3}>@{p.author.username}{p.createdAt ? ` · ${ago(p.createdAt)}` : ''}</Txt>
            </View>
            {p.status === 'pending' && <Chip label="En attente" icon="clock" />}
          </View>
          <Txt style={{ fontSize: 15.5 }}>{p.text}</Txt>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Pressable accessibilityRole="button" accessibilityState={{ selected: p.liked }} accessibilityLabel={`${p.liked ? 'Retirer mon encouragement' : 'Encourager'} (${p.likeCount})`} onPress={() => like(p)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: p.liked ? alpha(t.flame, 0.18) : alpha(t.ink, 0.06) }}>
              <Flame size={18} dim={!p.liked} /><Text style={{ fontFamily: FONT.heavy, color: p.liked ? t.ink : t.ink2 }}>{p.likeCount} · Encourager</Text>
            </Pressable>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 6 }}><Icon name="comment" size={17} color={t.ink2} /><Txt v="small">{p.comments.length}</Txt></View>
            <View style={{ flex: 1 }} />
            {p.author.id !== user?.id && <Button label="Signaler" icon="flag" kind="plain" small onPress={() => report(p)} />}
          </View>
          {p.comments.map(c => (
            <View key={c.id} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
              <Avatar user={c.author} size={28} />
              <View style={{ flex: 1, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 14, backgroundColor: alpha(t.ink, 0.06) }}>
                <Txt v="bold" style={{ fontSize: 13 }}>{c.author.id === user?.id ? 'Toi' : c.author.displayName}</Txt>
                <Txt style={{ fontSize: 14 }}>{c.text}</Txt>
              </View>
            </View>
          ))}
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}><Field label="Commenter" value={comment[p.id] ?? ''} onChangeText={v => setComment({ ...comment, [p.id]: v })} maxLength={280} placeholder="Un mot d'encouragement…" onSubmitEditing={() => send(p)} /></View>
            <Button label="Envoyer" kind="ghost" small onPress={() => send(p)} disabled={!(comment[p.id] ?? '').trim()} />
          </View>
        </Glass>
      ))}
    </Screen>
    {!composing && <Fab label="Nouvelle publication" onPress={() => setComposing(true)} />}
    </View>
  );
}
