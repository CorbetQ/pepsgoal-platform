import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { addDays, today, weekdayIndex, ymd, type Checkin, type Goal, type GoalType } from '@pepsgoal/shared';
import { store } from '../../src/db/local';
import { createGoal, deleteGoal } from '../../src/db/repo';
import { refreshPending } from '../../src/sync/engine';
import { useSession } from '../../src/state/session';
import { ask, Button, Card, Empty, Fab, Field, FilterChips, Glass, Icon, Screen, Seg, Txt, TypeChip } from '../../src/ui/kit';
import { isWin, metaLine, WD, WD_LONG } from '../../src/ui/goals';
import { alpha, FONT, TYPE_ICON, TYPE_LABEL, useTheme } from '../../src/ui/theme';

const EMOJIS = ['🎯', '🏃', '🚴', '🏊', '🧘', '💪', '🥗', '💧', '📚', '✍️', '🧠', '💻', '🎸', '🛌', '🚭', '🍬', '🍷', '📵', '🌱', '❤️'];
type Vis = 'private' | 'friends' | 'public';

/**
 * Objectifs : filtres, création (routine ou abstinence) et cartes de suivi.
 * Les 12 autres types sont décrits dans packages/shared (GoalDataByType) : leurs formulaires sont à porter
 * depuis le prototype web (apps/web-legacy), voir docs/ARCHITECTURE.md « Écrans à porter ».
 */
export default function Goals() {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ new?: string; type?: string }>();
  const { userId, mode, dataVersion } = useSession();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [checkins, setCheckins] = useState<Checkin[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [emoji, setEmoji] = useState('🎯');
  const [kind, setKind] = useState<'routine' | 'abstinence'>('routine');
  const [days, setDays] = useState<number[]>([0, 2, 4]);
  const [vis, setVis] = useState<Vis>('friends');

  const load = useCallback(async () => {
    setGoals((await store.goals()).filter(g => g.ownerId === userId || g.memberIds.includes(userId ?? '')));
    setCheckins((await store.checkins(ymd(addDays(new Date(), -14)))).filter(c => c.userId === userId));
  }, [userId, dataVersion]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => {
    if (params.new) { setCreating(true); if (params.type === 'routine' || params.type === 'abstinence') setKind(params.type); router.setParams({ new: undefined, type: undefined }); }
  }, [params.new, params.type]);

  const add = async () => {
    if (!userId || !title.trim()) return;
    await createGoal(userId, kind === 'routine'
      ? { type: 'routine', title, icon: emoji, visibility: mode === 'guest' ? 'private' : vis, data: { mode: 'days', days: days.length ? days : [0, 1, 2, 3, 4, 5, 6], perWeek: 3 } }
      : { type: 'abstinence', title, icon: emoji, visibility: mode === 'guest' ? 'private' : vis, data: { since: today() } });
    setTitle(''); setCreating(false);
    await refreshPending();
    await load();
  };
  const remove = (g: Goal) => {
    const run = async () => { await deleteGoal(g.id); await refreshPending(); await load(); };
    ask('Supprimer cet objectif ?', `« ${g.title} » et son historique seront supprimés.`, 'Supprimer', run);
  };

  const present = [...new Set(goals.map(g => g.type))];
  const filters: [string, string][] = [['all', 'Tous'], ...present.map(k => [k, TYPE_LABEL[k]] as [string, string])];
  const shown = goals.filter(g => filter === 'all' || g.type === filter);
  const cols = width >= 1100 ? 2 : 1;

  return (
    <View style={{ flex: 1 }}>
      <Screen title="Objectifs">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <View style={{ flex: 1, minWidth: 200 }}><FilterChips items={filters} value={filter} onChange={setFilter} /></View>
          {!creating && <Button label="Nouvel objectif" icon="plus" small onPress={() => setCreating(true)} />}
        </View>

        {creating && (
          <Card title="Nouvel objectif" right={<Button label="Fermer" kind="plain" small onPress={() => setCreating(false)} />}>
            <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
              {(['routine', 'abstinence'] as const).map(k => {
                const c = t.type(k), on = kind === k;
                return (
                  <Pressable key={k} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => setKind(k)}
                    style={{ flexGrow: 1, flexBasis: 150, gap: 4, padding: 14, borderRadius: 16, borderWidth: 2, borderColor: on ? c.c : t.line, backgroundColor: on ? alpha(c.c, 0.16) : t.glassStrong }}>
                    <Icon name={TYPE_ICON[k]} size={22} color={c.ink} />
                    <Text style={{ fontFamily: FONT.displayBold, fontSize: 14, color: t.ink }}>{TYPE_LABEL[k]}</Text>
                    <Txt v="small">{k === 'routine' ? 'Certains jours de la semaine' : 'Tenir sans une habitude'}</Txt>
                  </Pressable>
                );
              })}
            </View>
            <Field label="Titre" value={title} onChangeText={setTitle} maxLength={80} placeholder={kind === 'routine' ? 'Ex. Courir 30 minutes' : 'Ex. Pas de sucre'} />
            <Txt v="label">Icône</Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Icône">
              {EMOJIS.map(e => (
                <Pressable key={e} accessibilityRole="radio" accessibilityState={{ checked: emoji === e }} accessibilityLabel={e} onPress={() => setEmoji(e)}
                  style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: emoji === e ? t.flame : 'transparent', backgroundColor: emoji === e ? alpha(t.flame, 0.16) : alpha(t.ink, 0.06) }}>
                  <Text style={{ fontSize: 22 }}>{e}</Text>
                </Pressable>
              ))}
            </View>
            {kind === 'routine' && (
              <>
                <Txt v="label">Jours</Txt>
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }} accessibilityLabel="Jours de la semaine">
                  {WD.map((d, i) => {
                    const on = days.includes(i), c = t.type('routine');
                    return (
                      <Pressable key={i} accessibilityRole="checkbox" accessibilityLabel={WD_LONG[i]} accessibilityState={{ checked: on }} onPress={() => setDays(on ? days.filter(x => x !== i) : [...days, i])}
                        style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: on ? c.c : t.line, backgroundColor: on ? c.c : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontFamily: FONT.heavy, color: on ? t.onAccent : t.ink }}>{d}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}
            {mode === 'account' && (
              <>
                <Txt v="label">Visibilité</Txt>
                <Seg label="Visibilité" items={[['private', 'Privé'], ['friends', 'Amis'], ['public', 'Public']]} value={vis} onChange={setVis} />
              </>
            )}
            <Button label="Créer l'objectif" icon="check" block onPress={add} disabled={!title.trim()} />
          </Card>
        )}

        {shown.length === 0 && !creating && (
          <Glass><Empty title="Aucun objectif" text="Crée une routine ou une abstinence pour commencer ta série." action={<Button label="Nouvel objectif" icon="plus" onPress={() => setCreating(true)} />} /></Glass>
        )}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 18 }}>
          {shown.map(g => (
            <View key={g.id} style={{ width: cols === 2 ? '48.5%' : '100%' }}>
              <GoalCard g={g} checkins={checkins.filter(c => c.goalId === g.id)} mine={g.ownerId === userId} onDelete={() => remove(g)} />
            </View>
          ))}
        </View>
      </Screen>
      <Fab label="Nouvel objectif" onPress={() => setCreating(true)} />
    </View>
  );
}

/** Carte d'objectif (`.gcard`) : bandeau de couleur, chiffre clé, 7 derniers jours. */
function GoalCard({ g, checkins, mine, onDelete }: { g: Goal; checkins: Checkin[]; mine: boolean; onDelete: () => void }) {
  const t = useTheme(), c = t.type(g.type);
  const d = g.data as Record<string, any>;
  const now = new Date(), ws = ymd(addDays(now, -weekdayIndex(now)));
  const big = g.type === 'abstinence'
    ? { v: String(Math.max(0, Math.round((Date.now() - new Date(`${d.since ?? today()}T00:00:00`).getTime()) / 86400000))), l: 'jours sans' }
    : { v: String(checkins.filter(x => isWin(x) && x.date >= ws).length), l: 'cette semaine' };
  const last7 = Array.from({ length: 7 }, (_, i) => { const k = ymd(addDays(now, i - 6)); return { k, on: checkins.some(x => x.date === k && isWin(x)), rel: checkins.some(x => x.date === k && x.kind === 'relapse') }; });
  const visLabel = { private: ['lock', 'Privé'], friends: ['users', 'Amis'], public: ['globe', 'Public'] }[g.visibility] ?? ['lock', 'Privé'];
  return (
    <Glass pad={18} style={{ overflow: 'hidden' }}>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 5, backgroundColor: c.c }} />
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
        <View style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(c.c, 0.26) }}><Text style={{ fontSize: 22 }}>{g.icon}</Text></View>
        <View style={{ flex: 1, gap: 6, minWidth: 0 }}>
          <Text style={{ fontFamily: FONT.heavy, fontSize: 16, lineHeight: 20, color: t.ink }}>{g.title}</Text>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <TypeChip type={g.type} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Icon name={visLabel[0]!} size={13} color={t.ink3} /><Txt v="small" color={t.ink3} style={{ fontSize: 12 }}>{mine ? visLabel[1] : 'Partagé avec toi'}</Txt></View>
          </View>
        </View>
        {mine && <Pressable accessibilityRole="button" accessibilityLabel={`Supprimer ${g.title}`} onPress={onDelete} hitSlop={8} style={{ padding: 4 }}><Icon name="trash" size={18} color={t.ink3} /></Pressable>}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
        <Text style={{ fontFamily: FONT.display, fontSize: 30, color: c.ink }}>{big.v}</Text>
        <Txt v="small" style={{ fontFamily: FONT.bold }}>{big.l}</Txt>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <Txt v="small">{metaLine(g)}</Txt>
        <View style={{ flexDirection: 'row', gap: 4 }} accessibilityLabel={`7 derniers jours : ${last7.filter(x => x.on).length} réussis`}>
          {last7.map(x => <View key={x.k} style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: x.rel ? t.danger : x.on ? c.c : t.track }} />)}
        </View>
      </View>
    </Glass>
  );
}
