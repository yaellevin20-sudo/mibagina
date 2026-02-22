import '../global.css';
import '../lib/i18n';

import { useEffect } from 'react';
import { I18nManager } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import i18n from '../lib/i18n';

// Enforce RTL/LTR on app init. A restart is required after toggling.
const isHebrew = i18n.language === 'he';
if (I18nManager.isRTL !== isHebrew) {
  I18nManager.forceRTL(isHebrew);
}

// Separated from RootLayout so useAuth() can be called inside AuthProvider.
function RootNavigator() {
  const { session, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === '(auth)';
    const inJoinRoute = segments[0] === 'join'; // join/[token].tsx handles its own auth redirect

    if (!session && !inAuthGroup && !inJoinRoute) {
      // Not authenticated — send to login.
      router.replace('/(auth)/login');
    }
    // Auth screens handle their own post-login routing (guardians row check,
    // join token resumption). Do not redirect here to avoid races.
  }, [session, loading, segments]);

  return <Stack screenOptions={{ headerShown: false }} />;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
