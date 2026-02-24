import { View, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

export default function LandingScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-white items-center justify-center px-8">
      <Text className="text-4xl font-bold text-center text-gray-900 mb-2">🛝</Text>
      <Text className="text-3xl font-bold text-center text-gray-900 mb-2">mi bagina</Text>
      <Text className="text-base text-center text-gray-500 mb-12">{t('home.title')}</Text>

      <TouchableOpacity
        className="w-full bg-green-600 rounded-xl py-4 items-center mb-4"
        onPress={() => router.push('/(auth)/login')}
      >
        <Text className="text-white font-bold text-base">{t('auth.login')}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        className="w-full border border-green-600 rounded-xl py-4 items-center"
        onPress={() => router.push('/(auth)/signup')}
      >
        <Text className="text-green-600 font-bold text-base">{t('auth.signup')}</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}
