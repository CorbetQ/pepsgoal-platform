import { useCallback, useState } from 'react';
import { Platform, Pressable, Text, useWindowDimensions, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { globalStreak, today, type Checkin, type Goal, type PublicUser } from '@pepsgoal/shared';
import { store } from '../../src/db/local';
import { toggleDone } from '../../src/db/repo';
import { api } from '../../src/lib/api';
import { refreshPending } from '../../src/sync/engine';
import { useSession } from '../../src/state/session';
import { Avatar, Bar, Button, Card, Empty, Fab, Flame, Glass, Icon, Ring, Screen, Txt, TypeChip } from '../../src/ui/kit';
import { dueToday, isOngoing, isWin, level, metaLine, weekDays } from '../../src/ui/goals';
import { alpha, FONT, TYPE_ICON, TYPE_LABEL, useTheme } from '../../src/ui/theme';

interface Board { u: Pick<PublicUser, 'id' | 'displayName' | 'username' | 'avatar'>; n: number; me: boolean }
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Aujourd'hui : série, semaine, objectifs à valider. Fonctionne entièrement hors ligne. */
export default function Today() {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const compact = width < 700;
  const { userId, user, mode, dataVersion, socialAvailable } = useSession();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [checkins, setCheckins] = useState<Checkin[]>([]);
  const [board, setBoard] = useState<Board[] | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setGoals((await store.goals()).filter(g => g.ownerId === userId || g.memberIds.includes(userId ?? '')));
    setCheckins((await store.checkins()).filter(c => c.userId === userId));
    setLoaded(true);
  }, [userId, dataVersion]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // Classement des flammes : uniquement en ligne avec un compte
  useFocusEffect(useCallback(() => {
    if (!socialAvailable || !user) { setBoard(null); return; }
    void api<{ myStreak: number; friends: { user: PublicUser; streak: number }[] }>('GET', '/v1/friends').then(r => {
      const rows: Board[] = [{ u: user, n: r.myStreak, me: true }, ...r.friends.map(f => ({ u: f.user, n: f.streak, me: false }))];
      setBoard(rows.sort((a, b) => b.n - a.n).slice(0, 5));
    }).catch(() => setBoard(null));
  }, [socialAvailable, user, dataVersion]));

  const wins = checkins.filter(isWin);
  const active = new Set(wins.map(c => c.date));
  const st = globalStreak(active);
  const lv = level(checkins.reduce((s, c) => s + (c.points || 0), 0));
  const due = goals.filter(dueToday).map(g => ({ g, done: checkins.some(c => c.goalId === g.id && c.date === today() && c.kind === 'done') }))
    .sort((a, b) => Number(a.done) - Number(b.done));
  const ongoing = goals.filter(isOngoing);
  const done = due.filter(x => x.done).length, total = due.length;
  // Ma ligne du classement : série locale (à jour même avant la synchronisation)
  const ranking = board?.map(b => (b.me ? { ...b, n: st.n } : b)).sort((a, b) => b.n - a.n) ?? null;
  const first = mode === 'guest' ? '' : (user?.displayName ?? '').split(/\s+/)[0];
  const date = cap(new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }));
  const msg = st.lit ? "Ta flamme brûle aujourd'hui. Continue sur ta lancée."
    : st.n ? `Valide une action avant minuit pour prolonger ta série de ${st.n} ${st.n > 1 ? 'jours' : 'jour'}.`
    : 'Valide ta première action pour allumer ta flamme.';

  const toggle = async (g: Goal) => {
    if (!userId) return;
    await toggleDone(g, userId);
    await refreshPending();
    await load();
  };
  const newGoal = (type?: string) => router.push({ pathname: '/goals', params: { new: '1', ...(type ? { type } : {}) } });

  const flameBlock = (
    <View style={compact ? { flexDirection: 'row', alignItems: 'center', gap: 12 } : { alignItems: 'center', minWidth: 130 }}
      accessibilityLabel={`Série de ${st.n} ${st.n > 1 ? 'jours' : 'jour'}${st.lit ? ", flamme allumée aujourd'hui" : ''}`}>
      {/* Halo lumineux sous la flamme allumée (iOS ; ailleurs l'ombre suivrait le cadre et non la flamme) */}
      <View style={st.lit && !t.highContrast && Platform.OS === 'ios' ? { shadowColor: t.flame, shadowOpacity: 0.6, shadowRadius: 22, shadowOffset: { width: 0, height: 10 } } : null}>
        <Flame size={compact ? 64 : 92} dim={!st.lit} />
      </View>
      <View style={compact ? null : { alignItems: 'center' }}>
        <Text style={{ fontFamily: FONT.display, fontSize: compact ? 38 : 44, lineHeight: compact ? 42 : 48, color: t.ink, marginTop: compact ? 0 : -6 }}>{st.n}</Text>
        <Txt v="eyebrow" style={{ letterSpacing: 1 }}>{st.n > 1 ? 'jours de série' : 'jour de série'}</Txt>
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <Screen title="Aujourd’hui">
        {/* en-tête : date, salutation, semaine, grande flamme */}
        <Glass pad={26} style={{ flexDirection: compact ? 'column' : 'row', alignItems: compact ? 'stretch' : 'center', gap: 20 }}>
          {compact && flameBlock}
          <View style={{ flex: compact ? undefined : 1, gap: 10, minWidth: 0 }}>
            <Txt v="eyebrow">{date}</Txt>
            <Txt v="hello" accessibilityRole="header" style={compact ? { fontSize: 28, lineHeight: 32 } : null}>{first ? `Salut ${first}` : 'Salut !'}</Txt>
            <Txt v="muted">{msg}</Txt>
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
              {weekDays(active).map(d => (
                <View key={d.k} accessibilityLabel={`${d.long} : ${d.on ? 'flamme allumée' : d.fut ? 'à venir' : 'pas de validation'}`}
                  style={{ flex: 1, maxWidth: 44, alignItems: 'center', gap: 3, paddingVertical: 6, borderRadius: 12, borderWidth: d.today ? 1.5 : 0, borderColor: t.ink, opacity: d.fut ? 0.55 : 1 }}>
                  <Flame size={22} dim={!d.on} />
                  <Text style={{ fontFamily: FONT.heavy, fontSize: 11, color: d.today ? t.ink : t.ink3 }}>{d.label}</Text>
                </View>
              ))}
            </View>
          </View>
          {!compact && flameBlock}
        </Glass>

        {!loaded ? null : goals.length === 0 ? (
          <Card title="Crée ton premier objectif">
            <Txt v="muted">Choisis ce que tu veux suivre. Tu pourras le valider ici chaque jour.</Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              {(['routine', 'abstinence'] as const).map(k => {
                const c = t.type(k);
                return (
                  <Pressable key={k} accessibilityRole="button" onPress={() => newGoal(k)}
                    style={{ flexGrow: 1, flexBasis: 160, gap: 6, padding: 16, borderRadius: 16, borderWidth: t.borderWidth, borderColor: t.line, borderTopWidth: 5, borderTopColor: c.c, backgroundColor: t.glassStrong }}>
                    <Icon name={TYPE_ICON[k]} size={24} color={c.ink} />
                    <Text style={{ fontFamily: FONT.displayBold, fontSize: 14, color: t.ink }}>{TYPE_LABEL[k]}</Text>
                    <Txt v="small">{k === 'routine' ? 'Certains jours, ou X fois par semaine' : 'Tenir sans une habitude, jour après jour'}</Txt>
                  </Pressable>
                );
              })}
            </View>
          </Card>
        ) : (
          <>
            <View style={{ flexDirection: compact || !board ? 'column' : 'row', gap: 18 }}>
              <Card title="Ta journée" right={`${lv.pts} flammes`} style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
                  <Ring done={done} total={total} />
                  <View style={{ flex: 1, gap: 6, minWidth: 0 }}>
                    <Txt v="eyebrow">Niveau {lv.idx}</Txt>
                    <Text style={{ fontFamily: FONT.displayBold, fontSize: 16, color: t.ink }}>{lv.name}</Text>
                    <Bar pct={lv.pct} />
                    <Txt v="small">{lv.next ? `${lv.next - lv.pts} flammes avant « ${lv.nextName} »` : 'Niveau maximum atteint'}</Txt>
                    {total > 0 && done === total && <Button label="Journée parfaite" icon="star" small block onPress={() => undefined} />}
                  </View>
                </View>
              </Card>
              {board && (
                <Card title="Classement des flammes" right={<Button label="Amis" kind="plain" small onPress={() => router.push('/friends')} />} style={{ flex: 1 }}>
                  {ranking && ranking.length > 1 ? ranking.map((b, i) => (
                    <View key={b.u.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, paddingHorizontal: b.me ? 6 : 0, borderRadius: 12, backgroundColor: b.me ? alpha(t.flame, 0.16) : 'transparent' }}>
                      <Text style={{ width: 18, fontFamily: FONT.heavy, color: t.ink3 }}>{i + 1}</Text>
                      <Avatar user={b.u} size={30} />
                      <Txt v="bold" numberOfLines={1} style={{ flex: 1 }}>{b.me ? 'Toi' : b.u.displayName}</Txt>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}><Flame size={18} dim={!b.n} /><Txt v="bold">{b.n}</Txt></View>
                    </View>
                  )) : <Empty text="Ajoute des amis pour comparer vos séries." action={<Button label="Trouver des amis" icon="userplus" kind="ghost" small onPress={() => router.push('/friends')} />} />}
                </Card>
              )}
            </View>

            <Card title="À valider aujourd'hui" right={`${done}/${total}`}>
              {total === 0 ? <Empty title="Rien de prévu aujourd'hui" text="Profite de ta journée, ou ajoute une routine." /> : due.map(({ g, done: ok }) => <DueRow key={g.id} g={g} done={ok} onToggle={() => toggle(g)} />)}
            </Card>

            {ongoing.length > 0 && (
              <Card title="En cours" right={ongoing.length}>
                {ongoing.map(g => <DueRow key={g.id} g={g} onOpen={() => router.push('/goals')} />)}
              </Card>
            )}
          </>
        )}
      </Screen>
      <Fab label="Nouvel objectif" onPress={() => newGoal()} />
    </View>
  );
}

/** Ligne d'objectif (`.item`) : pastille emoji, titre, type, info, et bouton rond de validation. */
function DueRow({ g, done, onToggle, onOpen }: { g: Goal; done?: boolean; onToggle?: () => void; onOpen?: () => void }) {
  const t = useTheme(), c = t.type(g.type);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingRight: 10, paddingLeft: 12, borderRadius: 16, backgroundColor: t.glassStrong, borderWidth: t.borderWidth, borderColor: t.line, borderLeftWidth: 5, borderLeftColor: c.c }}>
      <View style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(c.c, 0.26) }}>
        <Text style={{ fontSize: 22 }}>{g.icon}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text numberOfLines={1} style={{ fontFamily: FONT.heavy, fontSize: 15, color: t.ink, textDecorationLine: done ? 'line-through' : 'none', textDecorationColor: c.c }}>{g.title}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <TypeChip type={g.type} />
          {!!metaLine(g) && <Txt v="small">{metaLine(g)}</Txt>}
        </View>
      </View>
      {onToggle ? (
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: !!done }} onPress={onToggle}
          accessibilityLabel={`${done ? 'Annuler la validation' : g.type === 'abstinence' ? "J'ai tenu aujourd'hui" : 'Valider'} : ${g.title}`}
          style={({ pressed }) => ({ width: 50, height: 50, borderRadius: 25, borderWidth: 3, borderColor: c.c, backgroundColor: done ? c.c : 'transparent', alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.94 : 1 }] })}>
          <View style={{ opacity: done ? 1 : 0.35 }}><Icon name="check" size={24} stroke={3} color={done ? t.onAccent : c.ink} /></View>
        </Pressable>
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel={`Ouvrir ${g.title}`} onPress={onOpen}
          style={{ borderRadius: 999, borderWidth: 2, borderColor: c.c, paddingVertical: 8, paddingHorizontal: 12 }}>
          <Text style={{ fontFamily: FONT.heavy, fontSize: 13, color: c.ink }}>Voir</Text>
        </Pressable>
      )}
    </View>
  );
}
