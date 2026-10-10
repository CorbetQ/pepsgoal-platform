import { useCallback, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { today, type Goal } from '@pepsgoal/shared';
import { store } from '../../src/db/local';
import { createGoal, deleteGoal } from '../../src/db/repo';
import { refreshPending } from '../../src/sync/engine';
import { useSession } from '../../src/state/session';
import { Button, Card, Field, Muted, Screen, Title } from '../../src/ui/kit';
import { typeColor, useTheme } from '../../src/ui/theme';

const DAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const DAY_NAMES = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

/**
 * Liste et création rapide d'objectifs (routine ou abstinence).
 * Les 12 autres types sont décrits dans packages/shared (GoalDataByType) : leurs formulaires sont à porter depuis
 * le prototype web (apps/web-legacy), voir docs/ARCHITECTURE.md « Écrans à porter ».
 */
export default function Goals() {
  const t = useTheme();
  const { userId, dataVersion } = useSession();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<'routine' | 'abstinence'>('routine');
  const [days, setDays] = useState<number[]>([0, 2, 4]);

  const load = useCallback(async () => setGoals((await store.goals()).filter(g => g.ownerId === userId || g.memberIds.includes(userId ?? ''))), [userId, dataVersion]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const add = async () => {
    if (!userId || !title.trim()) return;
    await createGoal(userId, kind === 'routine'
      ? { type: 'routine', title, icon: '🎯', data: { mode: 'days', days: days.length ? days : [0, 1, 2, 3, 4, 5, 6], perWeek: 3 } }
      : { type: 'abstinence', title, icon: '🚫', data: { since: today() } });
    setTitle('');
    await refreshPending();
    await load();
  };

  const remove = (g: Goal) => Alert.alert('Supprimer cet objectif ?', `« ${g.title} » et son historique seront supprimés.`, [
    { text: 'Annuler', style: 'cancel' },
    { text: 'Supprimer', style: 'destructive', onPress: async () => { await deleteGoal(g.id); await refreshPending(); await load(); } }
  ]);

  return (
    <Screen>
      <Title>Objectifs</Title>
      <Card>
        <Field label="Nouvel objectif" value={title} onChangeText={setTitle} placeholder="Ex. Courir 30 minutes" />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button label="Routine" kind={kind === 'routine' ? 'primary' : 'ghost'} onPress={() => setKind('routine')} />
          <Button label="Abstinence" kind={kind === 'abstinence' ? 'primary' : 'ghost'} onPress={() => setKind('abstinence')} />
        </View>
        {kind === 'routine' && (
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }} accessibilityLabel="Jours de la semaine">
            {DAYS.map((d, i) => {
              const on = days.includes(i);
              return (
                <Pressable key={i} accessibilityRole="checkbox" accessibilityLabel={DAY_NAMES[i]} accessibilityState={{ checked: on }} onPress={() => setDays(on ? days.filter(x => x !== i) : [...days, i])}
                  style={{ width: 42, height: 42, borderRadius: 21, borderWidth: 2, borderColor: on ? typeColor.routine : t.line, backgroundColor: on ? typeColor.routine : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontWeight: '800', color: on ? '#10102A' : t.ink }}>{d}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
        <Button label="Créer" onPress={add} disabled={!title.trim()} />
      </Card>
      {goals.length === 0 && <Muted>Aucun objectif pour l'instant.</Muted>}
      {goals.map(g => (
        <Pressable key={g.id} onLongPress={() => remove(g)} accessibilityHint="Appui long pour supprimer">
          <Card style={{ borderLeftWidth: 5, borderLeftColor: typeColor[g.type] }}>
            <Text style={{ color: t.ink, fontWeight: '800', fontSize: 16 }}>{g.icon} {g.title}</Text>
            <Muted>{g.type}{g.ownerId !== userId ? ' · partagé avec toi' : ''}</Muted>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}
