import { useState, useRef, useEffect } from 'react';
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
import * as WebBrowser from 'expo-web-browser';
import { signUp, signInWithGoogle } from '../../lib/auth';
import { useAuth } from '../../contexts/AuthContext';

// Required for OAuth redirect completion on iOS
WebBrowser.maybeCompleteAuthSession();

export default function SignupScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailInUse, setEmailInUse] = useState(false);

  // Prevent double-routing when Google OAuth triggers session
  const hasRouted = useRef(false);

  // Route after Google OAuth sets a session (email signup always goes to name.tsx directly)
  useEffect(() => {
    if (!session || hasRouted.current) return;
    hasRouted.current = true;
    // Google OAuth: session exists after sign-in
    // Guardian row not yet created for new users → name.tsx will handle routing
    router.replace('/(auth)/name');
  }, [session]);

  async function handleSignup() {
    setError(null);
    setEmailInUse(false);
    setLoading(true);
    try {
      await signUp(email.trim(), password);
      // Guardian row doesn't exist yet — always route to name.tsx on sign-up.
      router.replace('/(auth)/name');
    } catch (e: any) {
      const msg = e.message ?? '';
      if (msg.toLowerCase().includes('already registered') || msg.toLowerCase().includes('already been registered')) {
        setEmailInUse(true);
        setError(t('auth.email_in_use'));
      } else {
        setError(msg || t('errors.generic'));
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    setError(null);
    setEmailInUse(false);
    try {
      await signInWithGoogle();
      // onAuthStateChange SIGNED_IN → session → useEffect routes
    } catch (e: any) {
      if (e.message === 'cancelled') return;
      setError(e.message ?? t('errors.generic'));
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView
        className="flex-1 px-6 justify-center"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Text className="text-3xl font-bold text-center mb-8">mi bagina</Text>

        {error && (
          <View className="mb-4">
            <Text className="text-red-500 text-sm text-center">{error}</Text>
            {emailInUse && (
              <TouchableOpacity
                className="mt-2 items-center"
                onPress={() =>
                  router.replace({
                    pathname: '/(auth)/login',
                    params: { prefillEmail: email.trim(), showForgot: '1' },
                  } as any)
                }
              >
                <Text className="text-green-600 text-sm underline">{t('auth.forgot_password')}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Google sign-in */}
        <TouchableOpacity
          className="border border-gray-300 rounded-lg py-3 items-center mb-4 flex-row justify-center"
          onPress={handleGoogleSignIn}
          disabled={loading}
        >
          <Text className="text-gray-700 font-semibold text-base">{t('auth.continue_with_google')}</Text>
        </TouchableOpacity>

        {/* Divider */}
        <View className="flex-row items-center mb-4">
          <View className="flex-1 h-px bg-gray-200" />
          <Text className="mx-3 text-gray-400 text-sm">—  {t('common.or')}  —</Text>
          <View className="flex-1 h-px bg-gray-200" />
        </View>

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
          textContentType="newPassword"
          editable={!loading}
        />

        <TouchableOpacity
          className="bg-green-600 rounded-lg py-4 items-center mb-4"
          onPress={handleSignup}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="text-white font-semibold text-base">{t('auth.signup')}</Text>
          )}
        </TouchableOpacity>

        <Link href="/(auth)/login" asChild>
          <TouchableOpacity className="items-center" disabled={loading}>
            <Text className="text-green-600 text-sm">{t('auth.login')}</Text>
          </TouchableOpacity>
        </Link>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
