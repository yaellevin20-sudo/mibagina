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
import { signUp, signInWithGoogle, getJoinToken } from '../../lib/auth';
import { touchLastActive } from '../../lib/db/rpc';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

// Required for OAuth redirect completion on iOS
WebBrowser.maybeCompleteAuthSession();

const BRAND_GREEN = '#3D7A50';

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

  // Route after Google OAuth sets a session (email signup routes to name.tsx directly in handleSignup)
  useEffect(() => {
    if (!session || hasRouted.current) return;
    hasRouted.current = true;
    routeAfterAuth(session.user.id);
  }, [session]);

  async function routeAfterAuth(userId: string) {
    try { await touchLastActive(); } catch {}
    const { data: guardian } = await supabase
      .from('guardians')
      .select('id')
      .eq('id', userId)
      .maybeSingle();
    if (!guardian) { router.replace('/(auth)/name'); return; }
    const pendingToken = await getJoinToken();
    if (pendingToken) { router.replace(`/join/${pendingToken}`); return; }
    router.replace('/(tabs)');
  }

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
        className="flex-1 px-6"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Header */}
        <View className="pt-6 pb-8">
          <Text className="text-3xl font-rubik-bold text-brand-green-dark">{t('auth.signup')}</Text>
        </View>

        {error && (
          <View className="mb-4">
            <Text className="text-red-500 text-sm text-center font-rubik">{error}</Text>
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
                <Text className="font-rubik text-sm underline" style={{ color: BRAND_GREEN }}>
                  {t('auth.forgot_password')}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Google sign-in */}
        <TouchableOpacity
          className="rounded-xl py-3 items-center mb-4 flex-row justify-center border"
          style={{ borderColor: BRAND_GREEN }}
          onPress={handleGoogleSignIn}
          disabled={loading}
        >
          <Text className="font-rubik-semi text-base" style={{ color: BRAND_GREEN }}>
            {t('auth.continue_with_google')}
          </Text>
        </TouchableOpacity>

        {/* Divider */}
        <View className="flex-row items-center mb-4">
          <View className="flex-1 h-px bg-gray-200" />
          <Text className="mx-3 text-gray-400 text-sm font-rubik">{t('common.or')}</Text>
          <View className="flex-1 h-px bg-gray-200" />
        </View>

        <Text className="text-sm font-rubik-semi text-gray-700 mb-1">{t('auth.email')}</Text>
        <TextInput
          className="border border-gray-300 rounded-xl px-4 py-3 mb-4 text-base font-rubik"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          textContentType="emailAddress"
          editable={!loading}
        />

        <Text className="text-sm font-rubik-semi text-gray-700 mb-1">{t('auth.password')}</Text>
        <TextInput
          className="border border-gray-300 rounded-xl px-4 py-3 mb-6 text-base font-rubik"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          textContentType="newPassword"
          editable={!loading}
        />

        <TouchableOpacity
          className="rounded-xl py-4 items-center mb-4"
          style={{ backgroundColor: BRAND_GREEN }}
          onPress={handleSignup}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="text-white font-rubik-bold text-base">{t('auth.signup')}</Text>
          )}
        </TouchableOpacity>

        <Link href="/(auth)/login" asChild>
          <TouchableOpacity className="items-center" disabled={loading}>
            <Text className="font-rubik text-sm" style={{ color: BRAND_GREEN }}>
              {t('auth.login')}
            </Text>
          </TouchableOpacity>
        </Link>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
