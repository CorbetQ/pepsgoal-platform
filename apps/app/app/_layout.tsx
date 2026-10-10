import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NetworkProvider } from '../src/state/network';
import { SessionProvider } from '../src/state/session';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <NetworkProvider>
        <SessionProvider>
          <StatusBar style="auto" />
          <Stack screenOptions={{ headerShown: false }} />
        </SessionProvider>
      </NetworkProvider>
    </SafeAreaProvider>
  );
}
