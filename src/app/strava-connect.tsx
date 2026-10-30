import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { colors, ui } from '@/components/theme';
import { authorizeUrl, completeAuthorization, getCredentials, REDIRECT_URI } from '@/lib/strava';
import { SYNC_DAYS, syncStrava } from '@/lib/stravaSync';

/** 在 App 內開 Strava 授權頁，攔下導回 localhost 的網址取授權碼 */
export default function StravaConnectScreen() {
  const db = useSQLiteContext();
  const [url, setUrl] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const handled = useRef(false);

  useEffect(() => {
    getCredentials().then((c) => setUrl(authorizeUrl(c.id)));
  }, []);

  const finish = async (redirected: string) => {
    if (handled.current) return;
    handled.current = true;
    setFinishing(true);
    try {
      await completeAuthorization(redirected);
      const added = await syncStrava(db);
      Alert.alert('已連結 Strava', `匯入最近 ${SYNC_DAYS} 天的 ${added} 筆活動。`);
    } catch (e) {
      Alert.alert('Strava', (e as Error).message);
    }
    router.back();
  };

  if (!url || finishing) {
    return (
      <View style={[ui.screen, { alignItems: 'center', justifyContent: 'center', gap: 8 }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        {finishing && <Text style={ui.muted}>連結並匯入活動中…</Text>}
      </View>
    );
  }

  return (
    <WebView
      source={{ uri: url }}
      onShouldStartLoadWithRequest={(req) => {
        if (req.url.startsWith(REDIRECT_URI)) {
          finish(req.url);
          return false;
        }
        // 擋掉想跳去 Strava App 的 intent:// / strava:// 連結，留在網頁授權
        return /^https?:/.test(req.url);
      }}
    />
  );
}
