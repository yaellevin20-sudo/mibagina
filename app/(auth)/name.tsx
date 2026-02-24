import { useState, useEffect } from 'react';
import {
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
import { supabase } from '../../lib/supabase';
import { createGuardian, touchLastActive } from '../../lib/db/rpc';
import { getJoinToken } from '../../lib/auth';

export default function NameScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-fill name from Google user metadata (only if truthy)
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      const googleName = user.user_metadata?.full_name as string | undefined;
      if (googleName) setName(googleName);
      if (user.email) setEmail(user.email);
    });
  }, []);

  async function handleContinue() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('errors.generic'));
      return;
    }

    setError(null);
    setLoading(true);
    try {
      // Create the guardians row server-side.
      await createGuardian(trimmed);

      // touch_last_active() — now the row exists, will return true.
      try {
        const found = await touchLastActive();
        if (!found) console.warn('[name] touch_last_active returned false after create_guardian');
      } catch (e) {
        console.warn('[name] touch_last_active failed', e);
      }

      // Resume pending join flow if the user arrived via deep link.
      const pendingToken = await getJoinToken();
      if (pendingToken) {
        router.replace(`/join/${pendingToken}`);
        return;
      }

      // New users go through the notifications permission screen before home.
      router.replace('/(auth)/notifications-ask');
    } catch (e: any) {
      setError(e.message ?? t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView
        className="flex-1 px-6 justify-center"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Text className="text-3xl font-bold text-center mb-2">mi bagina</Text>
        <Text className="text-base text-gray-600 text-center mb-2">
          {t('auth.complete_profile')}
        </Text>

        {email ? (
          <Text className="text-sm text-gray-400 text-center mb-8">{email}</Text>
        ) : null}

        {error && (
          <Text className="text-red-500 text-sm mb-4 text-center">{error}</Text>
        )}

        <TextInput
          className="border border-gray-300 rounded-lg px-4 py-3 mb-6 text-base"
          value={name}
          onChangeText={setName}
          placeholder={t('auth.display_name_placeholder')}
          autoFocus
          editable={!loading}
          returnKeyType="done"
          onSubmitEditing={handleContinue}
        />

        <TouchableOpacity
          className="bg-green-600 rounded-lg py-4 items-center"
          onPress={handleContinue}
          disabled={loading || !name.trim()}
        >
          {loading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="text-white font-semibold text-base">{t('auth.login')}</Text>
          )}
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
