import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { PublicUser } from '@pepsgoal/shared';
import { api } from '../src/lib/api';
import { useSession } from '../src/state/session';
import { Button, Card, Muted, Screen, tell, Txt } from '../src/ui/kit';
import { useTheme } from '../src/ui/theme';

interface Overview { users: number; banned: number; warned: number; pending_posts: number; open_reports: number; open_appeals: number }
interface AdminPost { id: string; author: PublicUser; text: string; reportCount: number }

/**
 * Console de modération (comptes admin). Couvre la vue d'ensemble, la validation des publications et les signalements ;
 * les autres rubriques (comptes, contestations, maintenances, annonces) appellent les routes /v1/admin/* décrites dans docs/API.md.
 */
export default function Moderation() {
  const t = useTheme();
  const { user } = useSession();
  const [ov, setOv] = useState<Overview | null>(null);
  const [pending, setPending] = useState<AdminPost[]>([]);
  const [reported, setReported] = useState<AdminPost[]>([]);

  const load = useCallback(async () => {
    try {
      setOv(await api<Overview>('GET', '/v1/admin/overview'));
      setPending(await api<AdminPost[]>('GET', '/v1/admin/posts?scope=pending'));
      setReported(await api<AdminPost[]>('GET', '/v1/admin/posts?scope=reported'));
    } catch (e) { tell('Modération indisponible', e instanceof Error ? e.message : ''); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (user?.role !== 'admin') { router.replace('/(tabs)/profile'); return null; }
  const act = async (path: string) => { try { await api('POST', path, {}); await load(); } catch (e) { tell('Action impossible', e instanceof Error ? e.message : ''); } };

  return (
    <Screen title="Modération" tabs={false}>
      <Button label="Profil" icon="x" kind="plain" small onPress={() => router.back()} />
      {ov && (
        <Card>
          <Muted>{ov.users} comptes · {ov.banned} bannis · {ov.warned} avertis</Muted>
          <Muted>{ov.pending_posts} à valider · {ov.open_reports} signalements · {ov.open_appeals} contestations</Muted>
        </Card>
      )}
      <Txt v="h2">Publications à valider</Txt>
      {pending.length === 0 && <Muted>Rien en attente.</Muted>}
      {pending.map(p => (
        <Card key={p.id}>
          <Text style={{ color: t.ink, fontWeight: '800' }}>{p.author.displayName}</Text>
          <Muted>{p.text}</Muted>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button label="Valider" onPress={() => act(`/v1/admin/posts/${p.id}/approve`)} />
            <Button label="Refuser" kind="danger" onPress={() => act(`/v1/admin/posts/${p.id}/reject`)} />
          </View>
        </Card>
      ))}
      <Txt v="h2">Signalements</Txt>
      {reported.length === 0 && <Muted>Rien à signaler.</Muted>}
      {reported.map(p => (
        <Card key={p.id}>
          <Text style={{ color: t.ink, fontWeight: '800' }}>{p.author.displayName} · {p.reportCount} signalement(s)</Text>
          <Muted>{p.text}</Muted>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button label="Supprimer" kind="danger" onPress={() => act(`/v1/admin/posts/${p.id}/delete`)} />
            <Button label="Ignorer" kind="ghost" onPress={() => act(`/v1/admin/posts/${p.id}/dismiss`)} />
          </View>
        </Card>
      ))}
    </Screen>
  );
}
