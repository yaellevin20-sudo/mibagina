import { useState, useEffect, useRef } from 'react';
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
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as WebBrowser from 'expo-web-browser';
import { changePassword, getJoinToken } from '../lib/auth';
import { useAuth } from '../contexts/AuthContext';

// Required for OAuth redirect completion
WebBrowser.maybeCompleteAuthSession();

const RECOVERY_TIMEOUT_MS = 10_000;

export default function ResetPasswordScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session, recoveryMode, clearRecoveryMode } = useAuth();

  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  // Guard: if recoveryMode is false once session is known, redirect to login
  useEffect(() => {
    if (!session) return; // still waiting
    if (!recoveryMode) {
      router.replace('/(auth)/login');
    }
  }, [session, recoveryMode]);

  // Timeout fallback: if session not established within 10s, show error
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (session) return; // session arrived, no timeout needed
    timeoutRef.current = setTimeout(() => setTimedOut(true), RECOVERY_TIMEOUT_MS);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [session]);

  async function handleReset() {
    if (newPassword.length < 6) {
      setError(t('errors.generic'));
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await changePassword(newPassword);
      clearRecoveryMode();

      const pendingToken = await getJoinToken();
      if (pendingToken) {
        router.replace(`/join/${pendingToken}`);
      } else {
        router.replace('/(tabs)');
      }
    } catch (e: any) {
      setError(e.message ?? t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }

  // Timed out — show error with back-to-login link
  if (timedOut && !session) {
    return (
      <SafeAreaView className="flex-1 bg-white items-center justify-center px-6">
        <Text className="text-red-500 text-base text-center mb-6">{t('errors.generic')}</Text>
        <TouchableOpacity
          className="bg-green-600 rounded-lg px-8 py-3"
          onPress={() => router.replace('/(auth)/login')}
        >
          <Text className="text-white font-semibold">{t('common.back')}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // Waiting for session / recovery token
  if (!session || !recoveryMode) {
    return (
      <SafeAreaView className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#16a34a" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView
        className="flex-1 px-6 justify-center"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Text className="text-2xl font-bold text-center mb-8">{t('auth.reset_password_title')}</Text>

        {error && (
          <Text className="text-red-500 text-sm mb-4 text-center">{error}</Text>
        )}

        <Text className="text-sm font-medium text-gray-700 mb-1">{t('auth.new_password')}</Text>
        <TextInput
          className="border border-gray-300 rounded-lg px-4 py-3 mb-6 text-base"
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
          textContentType="newPassword"
          autoFocus
          editable={!loading}
          returnKeyType="done"
          onSubmitEditing={handleReset}
        />

        <TouchableOpacity
          className="bg-green-600 rounded-lg py-4 items-center mb-4"
          onPress={handleReset}
          disabled={loading || newPassword.length < 6}
        >
          {loading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="text-white font-semibold text-base">{t('common.confirm')}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          className="items-center"
          onPress={() => router.replace('/(auth)/login')}
          disabled={loading}
        >
          <Text className="text-gray-400 text-sm">{t('common.back')}</Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
