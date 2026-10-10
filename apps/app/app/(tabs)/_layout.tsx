import { ActivityIndicator, View } from 'react-native';
import { Tabs, Redirect } from 'expo-router';
import { useSession } from '../../src/state/session';
import { accent, useTheme } from '../../src/ui/theme';

/**
 * Onglets. Feed et Amis disparaissent (href: null) sans compte, hors ligne ou pendant une maintenance complète,
 * puis réapparaissent automatiquement au retour de la connexion.
 */
export default function TabsLayout() {
  const t = useTheme();
  const { mode, socialAvailable, user } = useSession();
  if (mode === 'loading') return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg }}><ActivityIndicator /></View>;
  if (mode === 'signedOut') return <Redirect href="/welcome" />;
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: accent.flame, tabBarInactiveTintColor: t.ink3, tabBarStyle: { backgroundColor: t.bg, borderTopColor: t.line } }}>
      <Tabs.Screen name="index" options={{ title: 'Jour' }} />
      <Tabs.Screen name="goals" options={{ title: 'Objectifs' }} />
      <Tabs.Screen name="feed" options={{ title: 'Feed', href: socialAvailable ? undefined : null }} />
      <Tabs.Screen name="friends" options={{ title: 'Amis', href: socialAvailable ? undefined : null }} />
      <Tabs.Screen name="profile" options={{ title: user?.role === 'admin' ? 'Profil · Modo' : 'Profil' }} />
    </Tabs>
  );
}
