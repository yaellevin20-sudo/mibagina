import { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { registerForPushNotifications } from '../../lib/notifications';

export default function NotificationsAskScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [denied, setDenied] = useState(false);

  async function handleAllow() {
    if (!Device.isDevice) {
      router.replace('/(tabs)');
      return;
    }
    setLoading(true);
    try {
      // registerForPushNotifications handles the full setup:
      // Android channel, still_there category, permission request, token save.
      await registerForPushNotifications();
      const { status } = await Notifications.getPermissionsAsync();
      if (status === 'denied') {
        setDenied(true);
      } else {
        router.replace('/(tabs)');
      }
    } catch {
      router.replace('/(tabs)');
    } finally {
      setLoading(false);
    }
  }

  if (denied) {
    return (
      <SafeAreaView className="flex-1 bg-white items-center justify-center px-8">
        <Text className="text-xl font-bold text-gray-900 text-center mb-3">
          {t('auth.notifications_denied_title')}
        </Text>
        <Text className="text-gray-500 text-base text-center mb-8">
          {t('auth.notifications_denied_body')}
        </Text>
        <TouchableOpacity
          className="w-full bg-green-600 rounded-xl py-4 items-center mb-4"
          onPress={() => Linking.openSettings()}
        >
          <Text className="text-white font-bold text-base">
            {t('auth.notifications_open_settings')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.replace('/(tabs)')}>
          <Text className="text-gray-400 text-base">{t('auth.skip')}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white items-center justify-center px-8">
      <Text className="text-5xl mb-6">🔔</Text>
      <Text className="text-xl font-bold text-gray-900 text-center mb-3">
        {t('auth.allow_notifications')}
      </Text>
      <Text className="text-gray-500 text-base text-center mb-10">
        {t('auth.notifications_subtitle')}
      </Text>

      <TouchableOpacity
        className="w-full bg-green-600 rounded-xl py-4 items-center mb-4"
        onPress={handleAllow}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text className="text-white font-bold text-base">{t('auth.allow_notifications')}</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity onPress={() => router.replace('/(tabs)')}>
        <Text className="text-gray-400 text-base">{t('auth.skip')}</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}
