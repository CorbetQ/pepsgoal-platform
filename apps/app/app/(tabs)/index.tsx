import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { addDays, globalStreak, today, weekdayIndex, ymd, type Checkin, type Goal } from '@pepsgoal/shared';
import { store } from '../../src/db/local';
import { toggleDone } from '../../src/db/repo';
import { refreshPending } from '../../src/sync/engine';
import { useSession } from '../../src/state/session';
import { Card, Muted, Screen, Title } from '../../src/ui/kit';
import { accent, useTheme, useTypeColor } from '../../src/ui/theme';

/** Objectifs à valider aujourd'hui : fonctionne entièrement hors ligne. */
function dueToday(g: Goal): boolean {
  if (g.archived) return false;
  const d = g.data as Record<string, any>;
  if (g.type === 'routine') return d.mode === 'days' ? (d.days as number[]).includes(weekdayIndex(new Date())) : true;
  return ['abstinence', 'limit', 'duration', 'timed', 'challenge'].includes(g.type);
}

export default function Today() {
  const t = useTheme();
  const typeColor = useTypeColor();
  const { userId, dataVersion } = useSession();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [checkins, setCheckins] = useState<Checkin[]>([]);

  const load = useCallback(async () => {
    setGoals((await store.goals()).filter(g => g.ownerId === userId || g.memberIds.includes(userId ?? '')));
    setCheckins(await store.checkins(ymd(addDays(new Date(), -400))));
  }, [userId, dataVersion]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const mine = checkins.filter(c => c.userId === userId && c.kind !== 'relapse' && c.kind !== 'use');
  const streak = globalStreak(new Set(mine.map(c => c.date)));
  const due = goals.filter(dueToday);
  const done = (g: Goal) => checkins.some(c => c.goalId === g.id && c.date === today() && c.kind === 'done' && c.userId === userId);

  const toggle = async (g: Goal) => {
    if (!userId) return;
    await toggleDone(g, userId);
    await refreshPending();
    await load();
  };

  return (
    <Screen>
      <Card>
        <Text style={{ fontSize: 48, fontWeight: '900', color: t.ink }} accessibilityLabel={`Série de ${streak.n} ${streak.n > 1 ? 'jours' : 'jour'}`}>🔥 {streak.n}</Text>
        <Muted>{streak.lit ? "Ta flamme brûle aujourd'hui." : streak.n ? 'Valide une action avant minuit pour garder ta série.' : 'Valide ta première action pour allumer ta flamme.'}</Muted>
      </Card>
      <Title>À valider aujourd'hui</Title>
      {due.length === 0 && <Muted>Rien de prévu aujourd'hui. Ajoute une routine depuis l'onglet Objectifs.</Muted>}
      {due.map(g => {
        const ok = done(g);
        return (
          <Pressable key={g.id} onPress={() => toggle(g)} accessibilityRole="checkbox" accessibilityState={{ checked: ok }} accessibilityLabel={`${g.title} : ${ok ? 'validé' : 'à valider'}`}>
            <Card style={{ flexDirection: 'row', alignItems: 'center', borderLeftWidth: 5, borderLeftColor: typeColor[g.type] ?? accent.flame }}>
              <Text style={{ fontSize: 24 }}>{g.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.ink, fontWeight: '800', fontSize: 16, textDecorationLine: ok ? 'line-through' : 'none' }}>{g.title}</Text>
              </View>
              <View style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 3, borderColor: typeColor[g.type] ?? accent.flame, backgroundColor: ok ? typeColor[g.type] : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontWeight: '900', color: accent.onAccent }}>{ok ? '✓' : ''}</Text>
              </View>
            </Card>
          </Pressable>
        );
      })}
    </Screen>
  );
}
