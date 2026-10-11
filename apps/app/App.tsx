/**
 * Application mobile PepsGoal : coque native autour de l'interface PepsGoal (la même que https://app.pepsgoal.fr).
 *
 * L'interface est embarquée dans l'app (src/webapp.generated.ts, produit par « node apps/web/build.mjs ») :
 * elle s'ouvre instantanément et fonctionne hors ligne. La coque s'occupe de ce que le navigateur ne fait pas :
 *   - bouton retour Android (ferme la fenêtre ouverte, revient à « Jour », sinon quitte) ;
 *   - liens externes et e-mails ouverts dans le navigateur / la messagerie du téléphone ;
 *   - fichiers exportés (.zip, .json) proposés via la feuille de partage ;
 *   - zones sûres (encoche, barre de navigation) et couleur de la barre d'état.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { BackHandler, Linking, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';
import html, { WEBAPP_API } from './src/webapp.generated';

void SplashScreen.preventAutoHideAsync();

// Origine de la page : la même que la version web, pour que le serveur l'accepte (CORS) et que les données locales persistent
const ORIGIN = 'https://app.pepsgoal.fr';
// Adresse du serveur : celle du build web, sauf si EXPO_PUBLIC_API_URL est fournie (eas.json)
const API = (process.env.EXPO_PUBLIC_API_URL || WEBAPP_API).replace(/\/$/, '');
const BG = '#07081A';

// Bouton retour : exécuté dans la page, répond « handled » si l'interface a fermé ou changé quelque chose
const BACK_JS = `(function(){var done=false;try{
  if (typeof UI !== 'undefined') {
    if (UI.modal) { ACT.close(); done = true; }
    else if (UI.view && UI.view !== 'today' && DB && DB.session) { ACT.nav('today'); done = true; }
  }
}catch(e){}
window.ReactNativeWebView.postMessage(JSON.stringify({type:'back', handled:done}));})();true;`;

export default function App() {
  const web = useRef<WebView>(null);
  const page = useMemo(() => (API === WEBAPP_API ? html : html.split(JSON.stringify(WEBAPP_API)).join(JSON.stringify(API))), []);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { web.current?.injectJavaScript(BACK_JS); return true; });
    return () => sub.remove();
  }, []);

  const onMessage = useCallback(async (e: WebViewMessageEvent) => {
    let msg: { type?: string; handled?: boolean; filename?: string; mime?: string; data?: string };
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (msg.type === 'back' && !msg.handled) BackHandler.exitApp();
    if (msg.type === 'file' && msg.filename && msg.data) {
      const uri = `${FileSystem.cacheDirectory}${msg.filename.replace(/[^\w.\-]+/g, '_')}`;
      await FileSystem.writeAsStringAsync(uri, msg.data, { encoding: FileSystem.EncodingType.Base64 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: msg.mime, dialogTitle: msg.filename });
    }
  }, []);

  // Tout ce qui sort de l'application (sites, e-mails) s'ouvre en dehors
  const onNavigate = useCallback((req: WebViewNavigation) => {
    const url = req.url;
    if (url === 'about:blank' || url.startsWith(ORIGIN) || url.startsWith('data:') || url.startsWith('blob:')) return true;
    void Linking.openURL(url).catch(() => undefined);
    return false;
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" backgroundColor={BG} />
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.root}>
          <WebView
            ref={web}
            source={{ html: page, baseUrl: ORIGIN }}
            originWhitelist={['*']}
            style={styles.web}
            containerStyle={styles.web}
            onLoadEnd={() => void SplashScreen.hideAsync()}
            onMessage={onMessage}
            onShouldStartLoadWithRequest={onNavigate}
            setSupportMultipleWindows={false}
            javaScriptEnabled
            domStorageEnabled
            allowFileAccess
            allowsBackForwardNavigationGestures={false}
            allowsInlineMediaPlayback
            bounces={false}
            overScrollMode="never"
            keyboardDisplayRequiresUserAction={false}
            textZoom={100}
            pullToRefreshEnabled={false}
            webviewDebuggingEnabled={__DEV__}
            // Développement uniquement : autorise un serveur local en http (la page a une origine https)
            mixedContentMode={__DEV__ ? 'always' : 'never'}
          />
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: BG }, web: { flex: 1, backgroundColor: BG } });
