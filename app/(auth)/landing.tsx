import { View, Text, TouchableOpacity, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

export default function LandingScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <LinearGradient colors={['#FFFFFF', '#F1FDF5']} style={{ flex: 1 }}>
      <SafeAreaView className="flex-1 px-8">
        {/* Hero section */}
        <View className="flex-1 items-center justify-center">
          <Image
            source={require('../../assets/tree.png')}
            style={{ width: 120, height: 120, marginBottom: 24 }}
            resizeMode="contain"
          />
          <Text className="text-4xl font-rubik-bold text-brand-green-dark text-center mb-2">
            {t('common.app_name')}
          </Text>
          <Text className="text-base font-rubik text-gray-400 text-center">
            {t('home.title')}
          </Text>
        </View>

        {/* Actions */}
        <View className="pb-8">
          <TouchableOpacity
            className="w-full rounded-xl py-4 items-center mb-3"
            style={{ backgroundColor: '#3D7A50' }}
            onPress={() => router.push('/(auth)/login')}
          >
            <Text className="text-white font-rubik-bold text-base">{t('auth.login')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            className="w-full rounded-xl py-4 items-center mb-6 border"
            style={{ borderColor: '#3D7A50' }}
            onPress={() => router.push('/(auth)/signup')}
          >
            <Text className="font-rubik-bold text-base" style={{ color: '#3D7A50' }}>
              {t('auth.signup')}
            </Text>
          </TouchableOpacity>

          <Text className="text-xs text-gray-400 text-center font-rubik">
            {t('common.app_name')}
          </Text>
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}
