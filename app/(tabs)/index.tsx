import { View, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';

// Placeholder — full implementation in Phase 7
export default function HomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <SafeAreaView className="flex-1 bg-gray-50 items-center justify-center">
      <Text className="text-gray-400 text-base mb-8">{t('nav.home')}</Text>
      <TouchableOpacity
        className="bg-green-600 rounded-lg px-8 py-3"
        onPress={() => router.push('/checkin')}
      >
        <Text className="text-white font-semibold text-base">{t('checkin.submit')}</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}
