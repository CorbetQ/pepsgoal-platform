import { ActivityIndicator, Platform, Pressable, Text, useWindowDimensions, View } from 'react-native';
import { Tabs, Redirect, router } from 'expo-router';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../../src/state/session';
import { Avatar, Button, Icon, Logo, Txt, WIDE } from '../../src/ui/kit';
import { FONT, useTheme } from '../../src/ui/theme';

/** Onglets : icône, libellé long (barre latérale) et court (barre d'onglets mobile), comme l'app web. */
const NAV: { name: string; label: string; short: string; icon: string }[] = [
  { name: 'index', label: 'Aujourd’hui', short: 'Jour', icon: 'sun' },
  { name: 'goals', label: 'Objectifs', short: 'Objectifs', icon: 'target' },
  { name: 'feed', label: 'Feed', short: 'Feed', icon: 'feed' },
  { name: 'friends', label: 'Amis', short: 'Amis', icon: 'users' },
  { name: 'profile', label: 'Profil', short: 'Profil', icon: 'user' }
];
const SIDE_W = 248, GAP = 24, MAX = 1180;

/**
 * Feed et Amis disparaissent sans compte, hors ligne ou pendant une maintenance complète,
 * puis réapparaissent automatiquement au retour de la connexion.
 */
export default function TabsLayout() {
  const t = useTheme();
  const { mode, socialAvailable } = useSession();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  if (mode === 'loading') return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={t.accent[1]} /></View>;
  if (mode === 'signedOut') return <Redirect href="/welcome" />;
  const hidden = socialAvailable ? [] : ['feed', 'friends'];
  // Grand écran : colonne principale centrée à droite de la barre latérale (largeur totale 1180 px max)
  const side = Math.max(20, (width - MAX) / 2 + 20);
  return (
    <Tabs
      tabBar={props => <NavBar {...props} hidden={hidden} wide={wide} left={side} />}
      sceneContainerStyle={{ backgroundColor: 'transparent', paddingLeft: wide ? side + SIDE_W + GAP : 0, paddingRight: wide ? side : 0 }}
      screenOptions={{ headerShown: false }}>
      {NAV.map(n => <Tabs.Screen key={n.name} name={n.name} options={{ title: n.label, href: hidden.includes(n.name) ? null : undefined }} />)}
    </Tabs>
  );
}

function NavBar({ state, navigation, hidden, wide, left }: BottomTabBarProps & { hidden: string[]; wide: boolean; left: number }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { user, mode } = useSession();
  const routes = state.routes.filter(r => NAV.some(n => n.name === r.name) && !hidden.includes(r.name));
  const current = state.routes[state.index]?.name;
  const goTo = (name: string) => { const r = state.routes.find(x => x.name === name); if (r && current !== name) navigation.navigate(r.name); };
  const glass = { backgroundColor: t.glass, borderColor: t.glassEdge, borderWidth: t.borderWidth, ...(Platform.OS === 'web' && t.blobOpacity > 0 ? { backdropFilter: 'blur(16px) saturate(160%)' } : {}) } as object;

  if (wide) {
    return (
      <View accessibilityRole="menu" accessibilityLabel="Navigation principale"
        style={[{ position: 'absolute', left, top: 20 + insets.top, bottom: 20, width: SIDE_W, borderRadius: 24, paddingVertical: 22, paddingHorizontal: 14, gap: 6 }, glass]}>
        <View style={{ paddingHorizontal: 10, paddingBottom: 18 }}><Logo /></View>
        {routes.map(r => {
          const n = NAV.find(x => x.name === r.name)!, on = current === r.name;
          return (
            <Pressable key={r.key} accessibilityRole="menuitem" accessibilityState={{ selected: on }} accessibilityLabel={n.label} onPress={() => goTo(r.name)}
              style={s => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 14, borderRadius: 14, backgroundColor: on ? t.ink : (s as { hovered?: boolean }).hovered ? 'rgba(127,127,160,0.12)' : 'transparent' })}>
              <Icon name={n.icon} size={21} color={on ? t.bg : t.ink2} />
              <Text style={{ fontFamily: FONT.bold, fontSize: 15, color: on ? t.bg : t.ink2 }}>{n.label}</Text>
            </Pressable>
          );
        })}
        <View style={{ marginTop: 'auto', gap: 10 }}>
          <Button label="Nouvel objectif" icon="plus" block onPress={() => router.push({ pathname: '/goals', params: { new: '1' } })} />
          <Pressable accessibilityRole="button" accessibilityLabel="Mon profil" onPress={() => goTo('profile')}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 16, borderWidth: t.borderWidth, borderColor: t.line }}>
            <Avatar user={user ?? { displayName: 'Sans compte', avatar: { kind: 'picto', picto: 'user' } }} size={38} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt v="bold" numberOfLines={1}>{mode === 'guest' ? 'Sans compte' : user?.displayName ?? ''}</Txt>
              <Txt v="small" numberOfLines={1} color={t.ink3}>{mode === 'guest' ? 'Données sur cet appareil' : `@${user?.username ?? ''}`}</Txt>
            </View>
          </Pressable>
        </View>
      </View>
    );
  }
  return (
    <View accessibilityRole="tablist" style={[{ position: 'absolute', left: 10, right: 10, bottom: 10 + insets.bottom, flexDirection: 'row', padding: 6, borderRadius: 24 }, glass]}>
      {routes.map(r => {
        const n = NAV.find(x => x.name === r.name)!, on = current === r.name;
        return (
          <Pressable key={r.key} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={n.label} onPress={() => goTo(r.name)}
            style={{ flex: 1, alignItems: 'center', gap: 2, paddingVertical: 7, paddingHorizontal: 2, borderRadius: 18, backgroundColor: on ? t.ink : 'transparent' }}>
            <Icon name={n.icon} size={22} color={on ? t.bg : t.ink2} />
            <Text style={{ fontFamily: FONT.heavy, fontSize: 11, color: on ? t.bg : t.ink2 }}>{n.short}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
