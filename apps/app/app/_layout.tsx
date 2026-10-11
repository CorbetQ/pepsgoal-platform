import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { Unbounded_700Bold, Unbounded_800ExtraBold } from '@expo-google-fonts/unbounded';
import { Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold } from '@expo-google-fonts/manrope';
import { NetworkProvider } from '../src/state/network';
import { SessionProvider } from '../src/state/session';
import { A11yProvider, useA11y } from '../src/ui/prefs';
import { AppearanceProvider, useTheme } from '../src/ui/theme';
import { Backdrop } from '../src/ui/kit';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  // Mêmes polices que l'app web : Unbounded (titres, chiffres) et Manrope (texte)
  const [fontsReady, fontError] = useFonts({ Unbounded_700Bold, Unbounded_800ExtraBold, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold });
  useEffect(() => { if (fontsReady || fontError) void SplashScreen.hideAsync().catch(() => undefined); }, [fontsReady, fontError]);
  if (!fontsReady && !fontError) return null;
  return (
    <SafeAreaProvider>
      <A11yProvider>
        <NetworkProvider>
          <SessionProvider>
            <AppearanceProvider>
              <Shell />
            </AppearanceProvider>
          </SessionProvider>
        </NetworkProvider>
      </A11yProvider>
    </SafeAreaProvider>
  );
}

/** Fond nuit ou lavande + halos colorés, derrière tous les écrans (transparents). */
function Shell() {
  const t = useTheme();
  const { motionReduced } = useA11y();
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar style={t.dark ? 'light' : 'dark'} />
      <Backdrop />
      {/* Navigation transparente : le fond et les halos restent visibles derrière chaque écran */}
      <ThemeProvider value={{ ...(t.dark ? DarkTheme : DefaultTheme), colors: { ...(t.dark ? DarkTheme : DefaultTheme).colors, background: 'transparent', card: 'transparent', primary: t.accent[1], text: t.ink, border: t.line } }}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' }, animation: motionReduced ? 'none' : 'fade' }} />
      </ThemeProvider>
    </View>
  );
}
