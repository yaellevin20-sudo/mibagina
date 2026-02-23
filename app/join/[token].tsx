import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import { useAuth } from '../../contexts/AuthContext';
import { storeJoinToken, clearJoinToken } from '../../lib/auth';
import { getMyChildren, type ChildRow } from '../../lib/db/rpc';
import { validateInviteToken, joinGroup, type DuplicateInfo } from '../../lib/db/join';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Phase =
  | { name: 'loading' }
  | { name: 'error'; messageKey: string }
  | { name: 'pick'; groupId: string; groupName: string }
  | { name: 'submitting' };

// ---------------------------------------------------------------------------
// Join Screen
// ---------------------------------------------------------------------------
export default function JoinScreen() {
  const { t } = useTranslation();
  const { token } = useLocalSearchParams<{ token: string }>();
  const { session } = useAuth();
  const router = useRouter();

  const [phase, setPhase]           = useState<Phase>({ name: 'loading' });
  const [children, setChildren]     = useState<ChildRow[]>([]);
  const [selected, setSelected]     = useState<Set<string>>(new Set());

  // ── Handle unauthenticated deep link ──────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    if (!session) {
      storeJoinToken(token)
        .catch(console.error)
        .finally(() => router.replace('/(auth)/login'));
    }
  }, [session, token]);

  // ── Validate token and load children in parallel ──────────────────────────
  const initialize = useCallback(async () => {
    if (!token || !session) return;

    try {
      const [groupInfo, myChildren] = await Promise.all([
        validateInviteToken(token),
        getMyChildren(),
      ]);
      setChildren(myChildren);
      setPhase({ name: 'pick', groupId: groupInfo.group_id, groupName: groupInfo.group_name });
    } catch (e: any) {
      const msg = e.message ?? '';
      if (msg.includes('rate_limited'))    setPhase({ name: 'error', messageKey: 'join.rate_limited' });
      else if (msg.includes('expired'))    setPhase({ name: 'error', messageKey: 'join.expired_token' });
      else                                 setPhase({ name: 'error', messageKey: 'join.invalid_token' });
    }
  }, [token, session]);

  useEffect(() => {
    if (session) initialize();
  }, [session, initialize]);

  // ── Toggle child selection ────────────────────────────────────────────────
  function toggleChild(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // ── Execute join, handling duplicates sequentially ────────────────────────
  async function handleJoin() {
    if (phase.name !== 'pick') return;
    if (selected.size === 0) return;

    const { groupId, groupName } = phase;
    const childIds = [...selected];
    setPhase({ name: 'submitting' });

    try {
      const result = await joinGroup({ token, group_id: groupId, child_ids: childIds });

      if (result.status === 'done') {
        await clearJoinToken();
        Toast.show({ type: 'success', text1: t('join.success_toast'), position: 'top', visibilityTime: 3000 });
        router.replace('/(tabs)/groups');
        return;
      }

      // Collect duplicate confirmations sequentially via Alert.
      const confirmations: Record<string, string | null> = {};

      for (const dup of (result as { status: 'needs_confirmation'; duplicates: DuplicateInfo[] }).duplicates) {
        const confirmed = await new Promise<boolean>((resolve) => {
          Alert.alert(
            t('join.duplicate_title'),
            t('join.duplicate_message', { name: dup.match.first_name, year: dup.match.birth_year }),
            [
              { text: t('join.merge_decline'), onPress: () => resolve(false) },
              { text: t('join.merge_confirm'), style: 'default', onPress: () => resolve(true) },
            ],
            { cancelable: false }
          );
        });
        confirmations[dup.my_child_id] = confirmed ? dup.match.child_id : null;
      }

      const final = await joinGroup({
        token,
        group_id: groupId,
        child_ids: childIds,
        confirmed_merges: confirmations,
      });

      if (final.status === 'done') {
        await clearJoinToken();
        Toast.show({ type: 'success', text1: t('join.success_toast'), position: 'top', visibilityTime: 3000 });
        router.replace('/(tabs)/groups');
      }
    } catch (e: any) {
      Alert.alert(t('errors.generic'), e.message);
      setPhase({ name: 'pick', groupId, groupName });
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (!session) return null; // waiting for redirect

  if (phase.name === 'loading') {
    return (
      <SafeAreaView className="flex-1 bg-gray-50 items-center justify-center">
        <ActivityIndicator size="large" color="#16a34a" />
      </SafeAreaView>
    );
  }

  if (phase.name === 'error') {
    return (
      <SafeAreaView className="flex-1 bg-gray-50 items-center justify-center px-6">
        <Text className="text-gray-700 text-base text-center mb-6">{t(phase.messageKey)}</Text>
        <TouchableOpacity
          className="bg-green-600 rounded-lg px-8 py-3"
          onPress={() => router.replace('/(tabs)')}
        >
          <Text className="text-white font-semibold">{t('common.back_home')}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (phase.name === 'submitting') {
    return (
      <SafeAreaView className="flex-1 bg-gray-50 items-center justify-center">
        <ActivityIndicator size="large" color="#16a34a" />
        <Text className="text-gray-500 text-sm mt-4">{t('join.joining')}</Text>
      </SafeAreaView>
    );
  }

  // 'pick' phase
  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      {/* Header */}
      <View className="px-4 py-6 bg-white border-b border-gray-200">
        <Text className="text-xl font-bold text-gray-900">{t('join.title')}</Text>
        <Text className="text-green-700 font-semibold text-base mt-1">{phase.groupName}</Text>
        <Text className="text-gray-500 text-sm mt-2">{t('join.select_children')}</Text>
      </View>

      {children.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-gray-500 text-base text-center mb-6">{t('join.no_children_hint')}</Text>
          <TouchableOpacity
            className="bg-green-600 rounded-lg px-8 py-3"
            onPress={() => router.replace('/(tabs)/children')}
          >
            <Text className="text-white font-semibold">{t('join.go_add_children')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <FlatList
            data={children}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: 16 }}
            renderItem={({ item }) => {
              const isSelected = selected.has(item.id);
              return (
                <TouchableOpacity
                  className={`flex-row items-center bg-white rounded-xl p-4 mb-3 border ${
                    isSelected ? 'border-green-500' : 'border-gray-100'
                  } shadow-sm`}
                  onPress={() => toggleChild(item.id)}
                >
                  <View
                    className={`w-6 h-6 rounded-full border-2 mr-3 items-center justify-center ${
                      isSelected ? 'bg-green-600 border-green-600' : 'border-gray-300'
                    }`}
                  >
                    {isSelected && <Text className="text-white text-xs font-bold">✓</Text>}
                  </View>
                  <View className="flex-1">
                    <Text className="text-base font-semibold text-gray-900">
                      {item.first_name} {item.last_name}
                    </Text>
                    <Text className="text-sm text-gray-500">
                      {t('children.years_old', { age: item.age_years })}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            }}
          />

          <View className="px-4 pb-6">
            <TouchableOpacity
              className={`rounded-lg py-4 items-center ${
                selected.size === 0 ? 'bg-gray-200' : 'bg-green-600'
              }`}
              onPress={handleJoin}
              disabled={selected.size === 0}
            >
              <Text
                className={`font-semibold text-base ${
                  selected.size === 0 ? 'text-gray-400' : 'text-white'
                }`}
              >
                {t('join.join_button')}
              </Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}
