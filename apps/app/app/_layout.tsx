import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NetworkProvider } from '../src/state/network';
import { SessionProvider } from '../src/state/session';
import { A11yProvider, useA11y } from '../src/ui/prefs';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <A11yProvider>
        <NetworkProvider>
          <SessionProvider>
            <StatusBar style="auto" />
            <Screens />
          </SessionProvider>
        </NetworkProvider>
      </A11yProvider>
    </SafeAreaProvider>
  );
}

/** Transitions désactivées si l'utilisateur (ou le système) demande de réduire les animations. */
function Screens() {
  const { motionReduced } = useA11y();
  return <Stack screenOptions={{ headerShown: false, animation: motionReduced ? 'none' : 'default' }} />;
}
