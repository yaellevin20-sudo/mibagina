import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import { useAuth } from '../../contexts/AuthContext';
import { storeJoinToken, clearJoinToken } from '../../lib/auth';
import { getMyChildren, addChild, type ChildRow } from '../../lib/db/rpc';
import { validateInviteToken, joinGroup, type DuplicateInfo } from '../../lib/db/join';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Phase =
  | { name: 'loading' }
  | { name: 'error'; messageKey: string }
  | { name: 'already_member'; groupName: string }
  | { name: 'pick'; groupId: string; groupName: string; inviterName?: string | null }
  | { name: 'submitting' };

// ---------------------------------------------------------------------------
// Inline Add Child Form
// ---------------------------------------------------------------------------
function InlineAddChildForm({
  onAdded,
}: {
  onAdded: (child: ChildRow) => void;
}) {
  const { t } = useTranslation();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName]   = useState('');
  const [dob, setDob]             = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  async function handleSubmit() {
    const f = firstName.trim();
    const l = lastName.trim();
    const d = dob.trim();
    if (!f || !l || !d) { setError(t('errors.generic')); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { setError(t('children.date_of_birth_hint')); return; }
    if (new Date(d) > new Date()) { setError(t('errors.generic')); return; }

    setError(null);
    setLoading(true);
    try {
      const childId = await addChild(f, l, d);
      const newChild: ChildRow = {
        id: childId,
        first_name: f,
        last_name: l,
        age_years: new Date().getFullYear() - parseInt(d.slice(0, 4)),
        created_at: new Date().toISOString(),
        co_guardians: [],
        groups: [],
      };
      onAdded(newChild);
    } catch (e: any) {
      setError(e.message ?? t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <View className="bg-gray-50 rounded-xl p-4 mx-4 mb-4 border border-gray-200">
      {error && <Text className="text-red-500 text-sm mb-3">{error}</Text>}

      <Text className="text-sm font-medium text-gray-700 mb-1">{t('children.first_name')}</Text>
      <TextInput
        className="border border-gray-300 rounded-lg px-3 py-2 mb-3 text-base bg-white"
        value={firstName}
        onChangeText={setFirstName}
        autoFocus
        editable={!loading}
      />

      <Text className="text-sm font-medium text-gray-700 mb-1">{t('children.last_name')}</Text>
      <TextInput
        className="border border-gray-300 rounded-lg px-3 py-2 mb-3 text-base bg-white"
        value={lastName}
        onChangeText={setLastName}
        editable={!loading}
      />

      <Text className="text-sm font-medium text-gray-700 mb-1">{t('children.date_of_birth')}</Text>
      <TextInput
        className="border border-gray-300 rounded-lg px-3 py-2 mb-4 text-base bg-white"
        value={dob}
        onChangeText={setDob}
        placeholder={t('children.date_of_birth_hint')}
        keyboardType="numeric"
        editable={!loading}
      />

      <TouchableOpacity
        className="bg-green-600 rounded-lg py-3 items-center"
        onPress={handleSubmit}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text className="text-white font-semibold text-base">{t('children.add_child')}</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Join Screen
// ---------------------------------------------------------------------------
export default function JoinScreen() {
  const { t } = useTranslation();
  const { token } = useLocalSearchParams<{ token: string }>();
  const { session } = useAuth();
  const router = useRouter();

  const [phase, setPhase]               = useState<Phase>({ name: 'loading' });
  const [children, setChildren]         = useState<ChildRow[]>([]);
  const [selected, setSelected]         = useState<Set<string>>(new Set());
  const [showAddChild, setShowAddChild] = useState(false);

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

      if (myChildren.length === 0) setShowAddChild(true);

      setPhase({
        name: 'pick',
        groupId: groupInfo.group_id,
        groupName: groupInfo.group_name,
        inviterName: groupInfo.inviter_name,
      });
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

  // ── Inline add child ──────────────────────────────────────────────────────
  function handleChildAdded(child: ChildRow) {
    setChildren((prev) => [...prev, child]);
    setSelected((prev) => new Set([...prev, child.id]));
    setShowAddChild(false);
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

      if (result.status === 'already_member') {
        setPhase({ name: 'already_member', groupName: result.group_name });
        return;
      }

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
      if (phase.name === 'submitting') {
        setPhase({ name: 'pick', groupId, groupName });
      }
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

  if (phase.name === 'already_member') {
    return (
      <SafeAreaView className="flex-1 bg-gray-50 items-center justify-center px-6">
        <Text className="text-gray-700 text-base text-center mb-6">
          {t('join.already_member')}
        </Text>
        <TouchableOpacity
          className="bg-green-600 rounded-lg px-8 py-3"
          onPress={() => router.replace('/(tabs)/groups')}
        >
          <Text className="text-white font-semibold">{t('join.view_group')}</Text>
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
        {phase.inviterName && (
          <Text className="text-sm text-gray-500 mb-1">
            {t('join.invited_by', { name: phase.inviterName })}
          </Text>
        )}
        <Text className="text-xl font-bold text-gray-900">{phase.groupName}</Text>
        <Text className="text-gray-500 text-sm mt-1">{t('join.select_children')}</Text>
      </View>

      <ScrollView className="flex-1">
        {/* Existing children */}
        {children.map((item) => {
          const isSelected = selected.has(item.id);
          return (
            <TouchableOpacity
              key={item.id}
              className={`flex-row items-center bg-white mx-4 mt-3 rounded-xl p-4 border ${
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
        })}

        {/* Inline add child form */}
        {showAddChild ? (
          <View className="mt-3">
            <InlineAddChildForm onAdded={handleChildAdded} />
          </View>
        ) : (
          <TouchableOpacity
            className="mx-4 mt-3 mb-2 py-3 items-center"
            onPress={() => setShowAddChild(true)}
          >
            <Text className="text-green-600 text-sm">{t('join.add_child_first')}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <View className="px-4 pb-6 pt-2">
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
    </SafeAreaView>
  );
}
