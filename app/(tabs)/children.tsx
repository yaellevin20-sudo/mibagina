import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Switch,
  Alert,
  Modal,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { getJoinToken } from '../../lib/auth';
import {
  getMyChildren,
  addChild,
  removeChild,
  setCoGuardianVisibility,
  type ChildRow,
  type CoGuardianInfo,
} from '../../lib/db/rpc';

// ---------------------------------------------------------------------------
// Add Child Modal
// ---------------------------------------------------------------------------
function AddChildModal({
  visible,
  onClose,
  onSuccess,
}: {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName]   = useState('');
  const [dob, setDob]             = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  function reset() {
    setFirstName('');
    setLastName('');
    setDob('');
    setError(null);
    setLoading(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit() {
    const f = firstName.trim();
    const l = lastName.trim();
    const d = dob.trim();

    if (!f || !l || !d) {
      setError(t('errors.generic'));
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      setError(t('children.date_of_birth_hint'));
      return;
    }
    if (new Date(d) > new Date()) {
      setError(t('errors.generic'));
      return;
    }

    setError(null);
    setLoading(true);
    try {
      await addChild(f, l, d);
      reset();
      onSuccess();
    } catch (e: any) {
      setError(e.message ?? t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <SafeAreaView className="flex-1 bg-white">
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* Header */}
          <View className="flex-row justify-between items-center px-4 py-4 border-b border-gray-200">
            <TouchableOpacity onPress={handleClose} disabled={loading}>
              <Text className="text-gray-500 text-base">{t('common.cancel')}</Text>
            </TouchableOpacity>
            <Text className="text-lg font-semibold">{t('children.add_child_title')}</Text>
            <View style={{ width: 56 }} />
          </View>

          <View className="px-4 pt-6">
            {error && (
              <Text className="text-red-500 text-sm mb-4">{error}</Text>
            )}

            <Text className="text-sm font-medium text-gray-700 mb-1">{t('children.first_name')}</Text>
            <TextInput
              className="border border-gray-300 rounded-lg px-4 py-3 mb-4 text-base"
              value={firstName}
              onChangeText={setFirstName}
              autoFocus
              editable={!loading}
            />

            <Text className="text-sm font-medium text-gray-700 mb-1">{t('children.last_name')}</Text>
            <TextInput
              className="border border-gray-300 rounded-lg px-4 py-3 mb-4 text-base"
              value={lastName}
              onChangeText={setLastName}
              editable={!loading}
            />

            <Text className="text-sm font-medium text-gray-700 mb-1">{t('children.date_of_birth')}</Text>
            <TextInput
              className="border border-gray-300 rounded-lg px-4 py-3 mb-6 text-base"
              value={dob}
              onChangeText={setDob}
              placeholder={t('children.date_of_birth_hint')}
              keyboardType="numeric"
              editable={!loading}
            />

            <TouchableOpacity
              className="bg-green-600 rounded-lg py-4 items-center"
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
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Child Card
// ---------------------------------------------------------------------------
function ChildCard({
  child,
  onRemove,
  onToggleVisibility,
}: {
  child: ChildRow;
  onRemove: () => void;
  onToggleVisibility: (coGuardianId: string, value: boolean) => void;
}) {
  const { t } = useTranslation();

  return (
    <View className="bg-white rounded-xl mx-4 mb-3 p-4 shadow-sm border border-gray-100">
      {/* Name + age */}
      <View className="flex-row justify-between items-center">
        <Text className="text-lg font-semibold text-gray-900">
          {child.first_name} {child.last_name}
        </Text>
        <Text className="text-sm text-gray-500">
          {t('children.years_old', { age: child.age_years })}
        </Text>
      </View>

      {/* Groups */}
      {child.groups.length > 0 ? (
        <Text className="text-xs text-gray-400 mt-1">
          {child.groups.map((g) => g.name).join(', ')}
        </Text>
      ) : (
        <Text className="text-xs text-gray-400 mt-1">
          {t('profile.setup_incomplete')}
        </Text>
      )}

      {/* Co-guardians */}
      {child.co_guardians.length > 0 && (
        <View className="mt-3 pt-3 border-t border-gray-100">
          {child.co_guardians.map((cg: CoGuardianInfo) => (
            <View key={cg.guardian_id} className="flex-row justify-between items-center py-1.5">
              <Text className="text-sm text-gray-700 flex-1">{cg.name}</Text>
              <View className="flex-row items-center gap-2">
                <Text className="text-xs text-gray-400">{t('children.sees_checkins')}</Text>
                <Switch
                  value={cg.can_see_my_checkins}
                  onValueChange={(v) => onToggleVisibility(cg.guardian_id, v)}
                  trackColor={{ false: '#d1d5db', true: '#16a34a' }}
                  thumbColor="white"
                />
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Remove */}
      <TouchableOpacity
        className="mt-3 border border-red-200 rounded-lg py-2 items-center"
        onPress={onRemove}
      >
        <Text className="text-red-500 text-sm">{t('children.remove_child')}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Children Screen
// ---------------------------------------------------------------------------
export default function ChildrenScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [children, setChildren]       = useState<ChildRow[]>([]);
  const [loading, setLoading]         = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [pendingJoinToken, setPendingJoinToken] = useState<string | null>(null);

  useEffect(() => {
    getJoinToken().then(setPendingJoinToken).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await getMyChildren();
      setChildren(data);
    } catch (e) {
      console.error('[children] load error', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleRemoveChild(child: ChildRow) {
    Alert.alert(
      t('children.confirm_remove', { name: child.first_name }),
      '',
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('children.remove_child'),
          style: 'destructive',
          onPress: async () => {
            try {
              await removeChild(child.id);
              await load();
            } catch (e: any) {
              Alert.alert(t('errors.generic'), e.message);
            }
          },
        },
      ]
    );
  }

  async function handleToggleVisibility(child: ChildRow, coGuardianId: string, value: boolean) {
    // Optimistic update
    setChildren((prev) =>
      prev.map((c) =>
        c.id !== child.id
          ? c
          : {
              ...c,
              co_guardians: c.co_guardians.map((cg) =>
                cg.guardian_id === coGuardianId ? { ...cg, can_see_my_checkins: value } : cg
              ),
            }
      )
    );

    try {
      await setCoGuardianVisibility(child.id, coGuardianId, value);
    } catch (e: any) {
      // Revert on failure
      await load();
      Alert.alert(t('errors.generic'), e.message);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f1fdf5' }}>
      {/* App bar */}
      <View className="bg-white px-6 py-3 flex-row justify-between items-center">
        <Text className="text-2xl font-semibold text-black">{t('common.app_name')} 🌳</Text>
        <TouchableOpacity>
          <Ionicons name="menu" size={24} color="black" />
        </TouchableOpacity>
      </View>

      {/* Screen title + add button */}
      <View className="flex-row justify-between items-center px-6 pt-4 pb-2">
        <TouchableOpacity onPress={() => setShowAddModal(true)}>
          <Ionicons name="add-circle-outline" size={28} color="#16a34a" />
        </TouchableOpacity>
        <Text className="text-3xl font-semibold text-black">
          {t('onboarding.children_title')}
        </Text>
      </View>

      {pendingJoinToken && (
        <TouchableOpacity
          className="bg-green-50 border-b border-green-200 px-4 py-3 flex-row justify-between items-center"
          onPress={() => router.replace(`/join/${pendingJoinToken}`)}
        >
          <Text className="text-green-800 text-sm font-medium">{t('children.back_to_join')}</Text>
          <Text className="text-green-600 text-sm">→</Text>
        </TouchableOpacity>
      )}

      {loading ? (
        <ActivityIndicator size="large" color="#16a34a" style={{ marginTop: 48 }} />
      ) : (
        <FlatList
          data={children}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ChildCard
              child={item}
              onRemove={() => handleRemoveChild(item)}
              onToggleVisibility={(cgId, v) => handleToggleVisibility(item, cgId, v)}
            />
          )}
          contentContainerStyle={{ paddingVertical: 12 }}
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center pt-16 pb-8 px-6">
              <Image
                source={require('../../assets/kite.png')}
                style={{ width: 202, height: 202, transform: [{ rotate: '-20deg' }] }}
                resizeMode="contain"
              />
              <Text className="text-xl font-semibold text-black text-center mt-8">
                {t('children.empty_title')}
              </Text>
              <Text className="text-base text-black text-center mt-3 w-56">
                {t('children.empty_subtitle')}
              </Text>
              <TouchableOpacity
                className="mt-10 bg-green-600 rounded-lg px-10 py-3 items-center"
                onPress={() => setShowAddModal(true)}
              >
                <Text className="text-white font-semibold text-base">{t('children.add_children_cta')}</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}

      <AddChildModal
        visible={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSuccess={() => { setShowAddModal(false); load(); }}
      />
    </SafeAreaView>
  );
}
