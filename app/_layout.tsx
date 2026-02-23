import '../global.css';
import '../lib/i18n';

import { useEffect } from 'react';
import { I18nManager } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Linking from 'expo-linking';
import Toast from 'react-native-toast-message';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import i18n from '../lib/i18n';

// Enforce RTL/LTR on app init. A restart is required after toggling.
const isHebrew = i18n.language === 'he';
if (I18nManager.isRTL !== isHebrew) {
  I18nManager.forceRTL(isHebrew);
}

// Separated from RootLayout so useAuth() can be called inside AuthProvider.
function RootNavigator() {
  const { session, loading, recoveryMode } = useAuth();
  const segments = useSegments();
  const router = useRouter();

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

  return <Stack screenOptions={{ headerShown: false }} />;
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
