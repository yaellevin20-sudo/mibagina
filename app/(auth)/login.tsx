import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { signIn } from '../../lib/auth';
import { getJoinToken } from '../../lib/auth';
import { supabase } from '../../lib/supabase';

export default function LoginScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin() {
    setError(null);
    setLoading(true);
    try {
      const data = await signIn(email.trim(), password);
      if (!data.session) {
        // Email verification required — show message and stay on screen.
        setError(t('auth.email_verification_required'));
        return;
      }

      await routeAfterAuth(data.session.user.id);
    } catch (e: any) {
      setError(e.message ?? t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }

  async function routeAfterAuth(userId: string) {
    // Check if guardian row exists (determines first-login onboarding).
    const { data: guardian } = await supabase
      .from('guardians')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (!guardian) {
      // First login — collect display name.
      router.replace('/(auth)/name');
      return;
    }

    // Check for pending join token from a deep-link that arrived before auth.
    const pendingToken = await getJoinToken();
    if (pendingToken) {
      router.replace(`/join/${pendingToken}`);
      return;
    }

    router.replace('/(tabs)');
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView
        className="flex-1 px-6 justify-center"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Text className="text-3xl font-bold text-center mb-8">mi bagina</Text>

        {error && (
          <Text className="text-red-500 text-sm mb-4 text-center">{error}</Text>
        )}

        <Text className="text-sm font-medium text-gray-700 mb-1">{t('auth.email')}</Text>
        <TextInput
          className="border border-gray-300 rounded-lg px-4 py-3 mb-4 text-base"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          textContentType="emailAddress"
          editable={!loading}
        />

        <Text className="text-sm font-medium text-gray-700 mb-1">{t('auth.password')}</Text>
        <TextInput
          className="border border-gray-300 rounded-lg px-4 py-3 mb-6 text-base"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          textContentType="password"
          editable={!loading}
        />

        <TouchableOpacity
          className="bg-green-600 rounded-lg py-4 items-center mb-4"
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="text-white font-semibold text-base">{t('auth.login')}</Text>
          )}
        </TouchableOpacity>

        <Link href="/(auth)/signup" asChild>
          <TouchableOpacity className="items-center" disabled={loading}>
            <Text className="text-green-600 text-sm">{t('auth.signup')}</Text>
          </TouchableOpacity>
        </Link>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
