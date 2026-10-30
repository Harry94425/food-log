import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from 'react-native';
import { CALLBACK_DOMAIN, connectedAthlete, disconnect, getCredentials, saveCredentials } from '@/lib/strava';
import { syncStrava } from '@/lib/stravaSync';
import { colors, ui } from './theme';

/** 設定頁的 Strava 連結區塊 */
export function StravaCard() {
  const db = useSQLiteContext();
  const [athlete, setAthlete] = useState<string | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const [a, c] = await Promise.all([connectedAthlete(), getCredentials()]);
        setAthlete(a);
        setClientId(c.id);
        setClientSecret(c.secret);
      })();
    }, []),
  );

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } catch (e) {
      Alert.alert('Strava', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // 授權在 strava-connect 頁完成，回到這頁時 useFocusEffect 會更新連結狀態
  const onConnect = () =>
    run(async () => {
      await saveCredentials(clientId.trim(), clientSecret.trim());
      router.push('/strava-connect');
    });

  const onSync = () =>
    run(async () => {
      const { added, removed } = await syncStrava(db);
      const changes = [added && `新增 ${added} 筆`, removed && `移除 ${removed} 筆（Strava 上已刪除）`].filter(Boolean);
      Alert.alert('同步完成', changes.length ? `${changes.join('，')}。` : '和 Strava 一致，沒有變動。');
    });

  const onDisconnect = () =>
    Alert.alert('中斷 Strava 連結？', '已匯入的活動會保留。', [
      { text: '取消', style: 'cancel' },
      {
        text: '中斷',
        style: 'destructive',
        onPress: async () => {
          await disconnect();
          setAthlete(null);
        },
      },
    ]);

  return (
    <View style={ui.card}>
      <Text style={ui.title}>Strava</Text>
      {athlete ? (
        <>
          <Text style={ui.muted}>
            ✅ 已連結：{athlete}。打開「今天」頁會自動補齊上次同步後的新活動，以 Strava 為準（要改或刪活動請在 Strava
            上改）。騎車熱量直接加進當天目標。
          </Text>
          <Pressable style={ui.buttonOutline} onPress={onSync} disabled={busy}>
            <Text style={ui.buttonOutlineText}>立即同步</Text>
          </Pressable>
          <Pressable onPress={onDisconnect}>
            <Text style={ui.muted}>中斷連結</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={ui.muted}>
            1. 電腦打開 strava.com/settings/api（已有應用程式就直接用）{'\n'}
            2. 「Authorization Callback Domain」填：
          </Text>
          <Text selectable style={[ui.text, { fontWeight: '700', color: colors.primary }]}>
            {CALLBACK_DOMAIN}
          </Text>
          <Text style={ui.muted}>3. 把頁面上的 Client ID 和 Client Secret 貼到下面，按「連結」</Text>
          <TextInput
            style={ui.input}
            value={clientId}
            onChangeText={setClientId}
            placeholder="Client ID"
            keyboardType="numeric"
          />
          <TextInput
            style={ui.input}
            value={clientSecret}
            onChangeText={setClientSecret}
            placeholder="Client Secret"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable style={ui.button} onPress={onConnect} disabled={busy || !clientId || !clientSecret}>
            <Text style={ui.buttonText}>連結 Strava</Text>
          </Pressable>
          <Text style={ui.muted}>登入頁在 App 裡開，請用 Email 登入（Google 登入在 App 內網頁會被擋）。</Text>
        </>
      )}
      {busy && <ActivityIndicator color={colors.primary} />}
    </View>
  );
}
