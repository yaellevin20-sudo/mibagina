import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { getMyProfile, updateDisplayName, deleteMyAccount, type ProfileData } from '../../lib/db/rpc';
import { signOut, changePassword } from '../../lib/auth';
import { changeEmail, callDeleteAccount } from '../../lib/profile';

// ---------------------------------------------------------------------------
// Inline-edit name row
// ---------------------------------------------------------------------------
function NameRow({ profile, onSaved }: { profile: ProfileData; onSaved: (name: string) => void }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(profile.name);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    const trimmed = value.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await updateDisplayName(trimmed);
      onSaved(trimmed);
      setEditing(false);
    } catch (e: any) {
      Alert.alert(t('errors.generic'), e.message);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <View className="flex-row items-center gap-3">
        <TextInput
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-base text-gray-900 bg-white"
          value={value}
          onChangeText={setValue}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={handleSave}
        />
        <TouchableOpacity
          className="bg-green-600 rounded-lg px-3 py-2"
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <Text className="text-white font-semibold text-sm">{t('common.save')}</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          className="px-3 py-2"
          onPress={() => { setValue(profile.name); setEditing(false); }}
        >
          <Text className="text-gray-500 text-sm">{t('common.cancel')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View className="flex-row items-center justify-between">
      <Text className="text-base text-gray-900">{profile.name}</Text>
      <TouchableOpacity onPress={() => setEditing(true)}>
        <Text className="text-green-600 text-sm">{t('profile.edit_name')}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Change Email Modal
// ---------------------------------------------------------------------------
function ChangeEmailModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [newEmail, setNewEmail] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    const trimmed = newEmail.trim().toLowerCase();
    if (!trimmed) return;
    setSaving(true);
    try {
      await changeEmail(trimmed);
      Alert.alert(t('common.confirm'), 'Email updated successfully.');
      setNewEmail('');
      onClose();
    } catch (e: any) {
      if (e.message === 'email_in_use') {
        Alert.alert(t('errors.generic'), t('errors.email_in_use'));
      } else {
        Alert.alert(t('errors.generic'), e.message);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/40">
        <View className="bg-white rounded-t-2xl px-6 pt-6 pb-10">
          <Text className="text-lg font-semibold text-gray-900 mb-4">{t('profile.change_email')}</Text>

          <Text className="text-sm text-gray-600 mb-1">{t('profile.new_email')}</Text>
          <TextInput
            className="border border-gray-300 rounded-lg px-3 py-2 text-base text-gray-900 bg-white mb-4"
            value={newEmail}
            onChangeText={setNewEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />

          <TouchableOpacity
            className="bg-green-600 rounded-lg py-3 items-center mb-3"
            onPress={handleSubmit}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="text-white font-semibold">{t('common.save')}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity className="py-2 items-center" onPress={onClose}>
            <Text className="text-gray-500">{t('common.cancel')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Change Password Modal
// ---------------------------------------------------------------------------
function ChangePasswordModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    if (newPwd !== confirmPwd) {
      Alert.alert(t('errors.generic'), t('profile.password_mismatch'));
      return;
    }
    if (newPwd.length < 6) {
      Alert.alert(t('errors.generic'), 'Password must be at least 6 characters.');
      return;
    }
    setSaving(true);
    try {
      await changePassword(newPwd);
      Alert.alert(t('common.confirm'), 'Password updated successfully.');
      setNewPwd('');
      setConfirmPwd('');
      onClose();
    } catch (e: any) {
      Alert.alert(t('errors.generic'), e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/40">
        <View className="bg-white rounded-t-2xl px-6 pt-6 pb-10">
          <Text className="text-lg font-semibold text-gray-900 mb-4">{t('profile.change_password')}</Text>

          <Text className="text-sm text-gray-600 mb-1">{t('profile.new_password')}</Text>
          <TextInput
            className="border border-gray-300 rounded-lg px-3 py-2 text-base text-gray-900 bg-white mb-3"
            value={newPwd}
            onChangeText={setNewPwd}
            secureTextEntry
            autoComplete="new-password"
          />

          <Text className="text-sm text-gray-600 mb-1">{t('profile.confirm_password')}</Text>
          <TextInput
            className="border border-gray-300 rounded-lg px-3 py-2 text-base text-gray-900 bg-white mb-4"
            value={confirmPwd}
            onChangeText={setConfirmPwd}
            secureTextEntry
            autoComplete="new-password"
          />

          <TouchableOpacity
            className="bg-green-600 rounded-lg py-3 items-center mb-3"
            onPress={handleSubmit}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="text-white font-semibold">{t('common.save')}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity className="py-2 items-center" onPress={onClose}>
            <Text className="text-gray-500">{t('common.cancel')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Profile Screen
// ---------------------------------------------------------------------------
export default function ProfileScreen() {
  const { t } = useTranslation();

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await getMyProfile();
      setProfile(data);
    } catch (e: any) {
      Alert.alert(t('errors.generic'), e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSignOut() {
    try {
      await signOut();
    } catch (e: any) {
      Alert.alert(t('errors.generic'), e.message);
    }
  }

  function confirmDeleteAccount() {
    Alert.alert(
      t('profile.delete_account'),
      t('profile.delete_confirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('profile.delete_account'), style: 'destructive', onPress: runDeleteAccount },
      ]
    );
  }

  async function runDeleteAccount() {
    setDeleting(true);
    try {
      // Step 1: DB-side cleanup (cascade via guardians delete)
      await deleteMyAccount();
      // Step 2: auth.users deletion via Admin API (Edge Function, retries internally)
      await callDeleteAccount();
      // Step 3: sign out locally (session is gone, best-effort)
      await signOut().catch(() => {});
    } catch (e: any) {
      setDeleting(false);
      Alert.alert(t('errors.generic'), e.message);
    }
  }

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50 items-center justify-center">
        <ActivityIndicator size="large" color="#16a34a" />
      </SafeAreaView>
    );
  }

  if (deleting) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50 items-center justify-center px-6">
        <ActivityIndicator size="large" color="#16a34a" />
        <Text className="text-gray-500 mt-4 text-base">{t('profile.deleting')}</Text>
      </SafeAreaView>
    );
  }

  if (!profile) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50 items-center justify-center px-6">
        <Text className="text-gray-500 text-base text-center">{t('errors.generic')}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      {/* Header */}
      <View className="px-4 py-4 bg-white border-b border-gray-200">
        <Text className="text-xl font-bold text-gray-900">{t('profile.title')}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {/* Display name */}
        <View className="bg-white rounded-xl p-4 mb-3 shadow-sm border border-gray-100">
          <Text className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
            {t('profile.display_name')}
          </Text>
          <NameRow
            profile={profile}
            onSaved={(name) => setProfile((p) => p ? { ...p, name } : p)}
          />
        </View>

        {/* Email */}
        <View className="bg-white rounded-xl p-4 mb-3 shadow-sm border border-gray-100">
          <Text className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
            {t('profile.email_label')}
          </Text>
          <View className="flex-row items-center justify-between">
            <Text className="text-base text-gray-900 flex-1 mr-2" numberOfLines={1}>
              {profile.email}
            </Text>
            <TouchableOpacity onPress={() => setShowEmailModal(true)}>
              <Text className="text-green-600 text-sm">{t('profile.change_email')}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Password */}
        <View className="bg-white rounded-xl p-4 mb-6 shadow-sm border border-gray-100">
          <TouchableOpacity onPress={() => setShowPasswordModal(true)}>
            <Text className="text-base text-green-600">{t('profile.change_password')}</Text>
          </TouchableOpacity>
        </View>

        {/* Sign out */}
        <TouchableOpacity
          className="bg-white rounded-xl p-4 mb-3 shadow-sm border border-gray-100 items-center"
          onPress={handleSignOut}
        >
          <Text className="text-base font-semibold text-gray-700">{t('profile.sign_out')}</Text>
        </TouchableOpacity>

        {/* Delete account */}
        <TouchableOpacity
          className="bg-white rounded-xl p-4 mb-6 shadow-sm border border-red-100 items-center"
          onPress={confirmDeleteAccount}
        >
          <Text className="text-base font-semibold text-red-500">{t('profile.delete_account')}</Text>
        </TouchableOpacity>
      </ScrollView>

      <ChangeEmailModal
        visible={showEmailModal}
        onClose={() => setShowEmailModal(false)}
      />
      <ChangePasswordModal
        visible={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
      />
    </SafeAreaView>
  );
}
