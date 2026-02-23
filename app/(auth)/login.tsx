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
import { Link, useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as WebBrowser from 'expo-web-browser';
import { signIn, signInWithGoogle, sendPasswordReset, getJoinToken } from '../../lib/auth';
import { touchLastActive } from '../../lib/db/rpc';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

// Required for OAuth redirect completion on iOS
WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session } = useAuth();
  const { prefillEmail, showForgot } = useLocalSearchParams<{ prefillEmail?: string; showForgot?: string }>();

  const [email, setEmail] = useState(prefillEmail ?? '');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Forgot password state
  const [showForgotForm, setShowForgotForm] = useState(showForgot === '1');
  const [forgotEmail, setForgotEmail] = useState(prefillEmail ?? '');
  const [forgotSending, setForgotSending] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  // Prevent double-routing when both email login and Google OAuth trigger session
  const hasRouted = useRef(false);

  // Route after any auth method sets a session
  useEffect(() => {
    if (!session || hasRouted.current) return;
    hasRouted.current = true;
    routeAfterAuth(session.user.id);
  }, [session]);

  async function routeAfterAuth(userId: string) {
    // touch_last_active — best effort (runs once for all auth methods)
    try {
      const found = await touchLastActive();
      if (!found) console.warn('[login] touch_last_active returned false — guardian row not found');
    } catch (e) {
      console.warn('[login] touch_last_active failed', e);
    }

    const { data: guardian } = await supabase
      .from('guardians')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (!guardian) {
      router.replace('/(auth)/name');
      return;
    }

    const pendingToken = await getJoinToken();
    if (pendingToken) {
      router.replace(`/join/${pendingToken}`);
      return;
    }

    router.replace('/(tabs)');
  }

  async function handleLogin() {
    setError(null);
    setLoading(true);
    try {
      await signIn(email.trim(), password);
      // Session update triggers the useEffect above
    } catch (e: any) {
      setError(e.message ?? t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    setError(null);
    try {
      await signInWithGoogle();
      // onAuthStateChange SIGNED_IN → session → useEffect routes
    } catch (e: any) {
      if (e.message === 'cancelled') return; // user dismissed browser
      setError(e.message ?? t('errors.generic'));
    }
  }

  async function handleForgotPassword() {
    if (!forgotEmail.trim()) return;
    setForgotSending(true);
    try {
      await sendPasswordReset(forgotEmail.trim());
      setForgotSent(true);
    } catch (e: any) {
      setError(e.message ?? t('errors.generic'));
    } finally {
      setForgotSending(false);
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
          <Text className="text-red-500 text-sm mb-4 text-center">{error}</Text>
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
          className="border border-gray-300 rounded-lg px-4 py-3 text-base"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          textContentType="password"
          editable={!loading}
        />

        {/* Forgot password link */}
        <TouchableOpacity
          className="items-end mb-6 mt-1"
          onPress={() => setShowForgotForm((v) => !v)}
          disabled={loading}
        >
          <Text className="text-green-600 text-sm">{t('auth.forgot_password')}</Text>
        </TouchableOpacity>

        {/* Inline forgot password form */}
        {showForgotForm && (
          <View className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
            {forgotSent ? (
              <Text className="text-green-700 text-sm text-center">{t('auth.reset_password_sent')}</Text>
            ) : (
              <>
                <Text className="text-sm font-medium text-gray-700 mb-2">{t('auth.email')}</Text>
                <TextInput
                  className="border border-gray-300 rounded-lg px-4 py-3 mb-3 text-base bg-white"
                  value={forgotEmail}
                  onChangeText={setForgotEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  editable={!forgotSending}
                />
                <TouchableOpacity
                  className="bg-green-600 rounded-lg py-3 items-center"
                  onPress={handleForgotPassword}
                  disabled={forgotSending || !forgotEmail.trim()}
                >
                  {forgotSending ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text className="text-white font-semibold text-sm">{t('auth.reset_password_title')}</Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

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
