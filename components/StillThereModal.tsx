import { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { respondStillThere, leaveCheckin } from '../lib/db/rpc';
import type { StillTherePayload } from '../lib/notifications';

type Props = {
  payload: StillTherePayload | null;
  onDismiss: () => void;
};

export function StillThereModal({ payload, onDismiss }: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!payload) return null;

  async function handleStillHere() {
    if (!payload) return;
    setError(null);
    setLoading(true);
    try {
      await Promise.all(payload.check_ins.map((c) => respondStillThere(c.check_in_id)));
      onDismiss();
    } catch (e: any) {
      setError(e.message ?? t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }

  async function handleLeaving() {
    if (!payload) return;
    setError(null);
    setLoading(true);
    try {
      await Promise.all(payload.check_ins.map((c) => leaveCheckin(c.check_in_id)));
      onDismiss();
    } catch (e: any) {
      setError(e.message ?? t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal transparent animationType="fade" visible={true} onRequestClose={() => {}}>
      <View className="flex-1 bg-black/50 items-center justify-center px-6">
        <View className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-lg">
          <Text className="text-xl font-bold text-gray-900 text-center mb-4">
            {t('home.still_there_prompt')}
          </Text>

          {/* List of children */}
          <View className="mb-4">
            {payload.check_ins.map((c) => (
              <Text key={c.check_in_id} className="text-base text-gray-700 text-center">
                {c.first_name} · {c.age_years}
              </Text>
            ))}
          </View>

          {error && (
            <Text className="text-red-500 text-sm text-center mb-3">{error}</Text>
          )}

          <View className="flex-row gap-3">
            {/* Leaving */}
            <TouchableOpacity
              className="flex-1 border-2 border-red-400 rounded-lg py-3 items-center"
              onPress={handleLeaving}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#f87171" />
              ) : (
                <Text className="text-red-500 font-semibold text-base">
                  {t('checkin.leaving')}
                </Text>
              )}
            </TouchableOpacity>

            {/* Still here */}
            <TouchableOpacity
              className="flex-1 bg-green-600 rounded-lg py-3 items-center"
              onPress={handleStillHere}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text className="text-white font-semibold text-base">
                  {t('checkin.still_there')}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
