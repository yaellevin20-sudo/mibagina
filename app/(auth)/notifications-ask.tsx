import { useState } from 'react';
import { View, Text, Image, TouchableOpacity, ActivityIndicator, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { registerForPushNotifications } from '../../lib/notifications';
import { getJoinToken } from '../../lib/auth';
import OnboardingProgress from '../../components/OnboardingProgress';

const BRAND_GREEN = '#3D7A50';

export default function NotificationsAskScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [denied, setDenied] = useState(false);

  async function routeAfterNotifications() {
    // Check for pending join token (moved from name.tsx to ensure full onboarding first)
    const pendingToken = await getJoinToken();
    if (pendingToken) {
      router.replace(`/join/${pendingToken}`);
      return;
    }
    router.replace('/(tabs)');
  }

  async function handleAllow() {
    if (!Device.isDevice) {
      await routeAfterNotifications();
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
        await routeAfterNotifications();
      }
    } catch {
      await routeAfterNotifications();
    } finally {
      setLoading(false);
    }
  }

  if (denied) {
    return (
      <SafeAreaView className="flex-1 bg-white items-center justify-center px-8">
        <Text className="text-xl font-rubik-bold text-brand-green-dark text-center mb-3">
          {t('auth.notifications_denied_title')}
        </Text>
        <Text className="font-rubik text-gray-500 text-base text-center mb-8">
          {t('auth.notifications_denied_body')}
        </Text>
        <TouchableOpacity
          className="w-full rounded-xl py-4 items-center mb-4"
          style={{ backgroundColor: BRAND_GREEN }}
          onPress={() => Linking.openSettings()}
        >
          <Text className="text-white font-rubik-bold text-base">
            {t('auth.notifications_open_settings')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={routeAfterNotifications}>
          <Text className="font-rubik text-base text-gray-400">{t('auth.skip')}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 px-6">
        {/* Back button */}
        <TouchableOpacity className="pt-4 pb-2" onPress={() => router.back()}>
          <Text className="font-rubik text-sm text-gray-500">{t('nav.back')}</Text>
        </TouchableOpacity>

        {/* Progress bar */}
        <View className="pt-4">
          <OnboardingProgress steps={4} current={4} />
        </View>

        {/* Illustration + text */}
        <View className="flex-1 items-center justify-center">
          <Image
            source={require('../../assets/message.png')}
            style={{ width: 140, height: 140, marginBottom: 32 }}
            resizeMode="contain"
          />
          <Text className="text-2xl font-rubik-bold text-brand-green-dark text-center mb-3">
            {t('onboarding.notifications_title')}
          </Text>
          <Text className="font-rubik text-gray-500 text-base text-center">
            {t('auth.notifications_subtitle')}
          </Text>
        </View>
      </View>

      {/* Actions */}
      <View className="px-6 pb-8 items-center">
        <TouchableOpacity
          className="w-full rounded-xl py-4 items-center mb-4"
          style={{ backgroundColor: BRAND_GREEN }}
          onPress={handleAllow}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="text-white font-rubik-bold text-base">
              {t('onboarding.notifications_cta')}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={routeAfterNotifications}>
          <Text className="font-rubik text-base text-gray-400">{t('onboarding.skip')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
