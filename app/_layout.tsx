import '../global.css';
import '../lib/i18n';

import { useEffect, useState } from 'react';
import { I18nManager } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import Toast from 'react-native-toast-message';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import i18n from '../lib/i18n';
import { StillThereModal } from '../components/StillThereModal';
import type { StillTherePayload, GroupCheckinPayload } from '../lib/notifications';

// Enforce RTL/LTR on app init. A restart is required after toggling.
const isHebrew = i18n.language === 'he';
if (I18nManager.isRTL !== isHebrew) {
  I18nManager.forceRTL(isHebrew);
}

// Handle notifications when the app is open (foreground).
// StillThereModal handles its own UI; group_checkin uses Toast.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Separated from RootLayout so useAuth() can be called inside AuthProvider.
function RootNavigator() {
  const { session, loading, recoveryMode } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  const [pendingPrompt, setPendingPrompt] = useState<StillTherePayload | null>(null);

  // Handle deep link tokens (OAuth callback fallback + recovery tokens on Android)
  const url = Linking.useURL();
  useEffect(() => {
    if (!url) return;
    const fragment = url.split('#')[1];
    if (!fragment) return;
    const params = new URLSearchParams(fragment);
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');
    if (access_token && refresh_token) {
      // setSession triggers onAuthStateChange → AuthContext handles all routing
      supabase.auth.setSession({ access_token, refresh_token }).catch(console.warn);
    }
  }, [url]);

  useEffect(() => {
    if (loading) return;

    // Recovery mode: route to password reset screen
    if (recoveryMode) {
      router.replace('/reset-password');
      return;
    }

    const inAuthGroup = segments[0] === '(auth)';
    const inJoinRoute = segments[0] === 'join'; // join/[token].tsx handles its own auth redirect
    const inResetRoute = segments[0] === 'reset-password';

    if (!session && !inAuthGroup && !inJoinRoute && !inResetRoute) {
      // Not authenticated — send to login.
      router.replace('/(auth)/login');
    }
    // Auth screens handle their own post-login routing (guardians row check,
    // join token resumption). Do not redirect here to avoid races.
  }, [session, loading, segments, recoveryMode]);

  // 1. Foreground: notification received while app is open
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((n) => {
      const d = n.request.content.data as StillTherePayload | GroupCheckinPayload | undefined;
      if (!d) return;
      if (d.type === 'still_there_prompt') setPendingPrompt(d as StillTherePayload);
      if (d.type === 'group_checkin') {
        Toast.show({
          text1: n.request.content.title ?? '',
          text2: n.request.content.body ?? '',
        });
      }
    });
    return () => sub.remove();
  }, []);

  // 2. Warm-start: user tapped notification, app was backgrounded
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const d = r.notification.request.content.data as StillTherePayload | GroupCheckinPayload | undefined;
      if (!d) return;
      if (d.type === 'still_there_prompt') setPendingPrompt(d as StillTherePayload);
      if (d.type === 'group_checkin') {
        router.push(`/playground/${(d as GroupCheckinPayload).playground_id}`);
      }
    });
    return () => sub.remove();
  }, []);

  // 3. Cold-start: user tapped notification, app was killed — wait for session
  useEffect(() => {
    if (!session) return;
    Notifications.getLastNotificationResponseAsync().then((r) => {
      if (!r) return;
      const d = r.notification.request.content.data as StillTherePayload | GroupCheckinPayload | undefined;
      if (!d) return;
      if (d.type === 'still_there_prompt') setPendingPrompt(d as StillTherePayload);
      if (d.type === 'group_checkin') {
        router.push(`/playground/${(d as GroupCheckinPayload).playground_id}`);
      }
    });
  }, [session]);

  return (
    <>
      <Stack screenOptions={{ headerShown: false }} />
      <StillThereModal payload={pendingPrompt} onDismiss={() => setPendingPrompt(null)} />
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
      <Toast />
    </GestureHandlerRootView>
  );
}
