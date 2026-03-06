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
  Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { getMyProfile, updateDisplayName, deleteMyAccount, type ProfileData } from '../../lib/db/rpc';
import { signOut, changePassword } from '../../lib/auth';
import { callDeleteAccount } from '../../lib/profile';

const BRAND_GREEN = '#3D7A50';

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
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <TextInput
          style={{
            flex: 1,
            borderWidth: 1,
            borderColor: '#d1d5db',
            borderRadius: 8,
            paddingHorizontal: 10,
            paddingVertical: 6,
            fontSize: 15,
            color: '#111',
            backgroundColor: 'white',
          }}
          value={value}
          onChangeText={setValue}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={handleSave}
        />
        <TouchableOpacity
          style={{ backgroundColor: BRAND_GREEN, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <Text style={{ color: 'white', fontWeight: '600', fontSize: 13 }}>{t('common.save')}</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={{ paddingHorizontal: 8, paddingVertical: 6 }}
          onPress={() => { setValue(profile.name); setEditing(false); }}
        >
          <Text style={{ color: '#6b7280', fontSize: 13 }}>{t('common.cancel')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={{ fontSize: 16, color: '#111' }}>{profile.name}</Text>
      <TouchableOpacity onPress={() => setEditing(true)}>
        <Text style={{ fontSize: 14, fontWeight: '500', color: BRAND_GREEN }}>{t('profile.edit_name')}</Text>
      </TouchableOpacity>
    </View>
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
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}>
        <View style={{ backgroundColor: 'white', borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingHorizontal: 24, paddingTop: 24, paddingBottom: 40 }}>
          <Text style={{ fontSize: 17, fontWeight: '600', color: '#111', marginBottom: 20 }}>{t('profile.change_password')}</Text>

          <Text style={{ fontSize: 13, color: '#4A5C4E', marginBottom: 6 }}>{t('profile.new_password')}</Text>
          <TextInput
            style={{ borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.10)', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, backgroundColor: '#F7FAF8', marginBottom: 14 }}
            value={newPwd}
            onChangeText={setNewPwd}
            secureTextEntry
            autoComplete="new-password"
          />

          <Text style={{ fontSize: 13, color: '#4A5C4E', marginBottom: 6 }}>{t('profile.confirm_password')}</Text>
          <TextInput
            style={{ borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.10)', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, backgroundColor: '#F7FAF8', marginBottom: 20 }}
            value={confirmPwd}
            onChangeText={setConfirmPwd}
            secureTextEntry
            autoComplete="new-password"
          />

          <TouchableOpacity
            style={{ backgroundColor: BRAND_GREEN, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginBottom: 12 }}
            onPress={handleSubmit}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={{ color: 'white', fontWeight: '700', fontSize: 15 }}>{t('common.save')}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={{ paddingVertical: 10, alignItems: 'center' }} onPress={onClose}>
            <Text style={{ color: '#6b7280', fontSize: 14 }}>{t('common.cancel')}</Text>
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
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await getMyProfile();
      if (!data) {
        router.replace('/(auth)/name');
        return;
      }
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
      await deleteMyAccount();
      await callDeleteAccount();
      await signOut().catch(() => {});
    } catch (e: any) {
      setDeleting(false);
      Alert.alert(t('errors.generic'), e.message);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#f1fdf5', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={BRAND_GREEN} />
      </SafeAreaView>
    );
  }

  if (deleting) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#f1fdf5', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
        <ActivityIndicator size="large" color={BRAND_GREEN} />
        <Text style={{ color: '#6b7280', marginTop: 16, fontSize: 15 }}>{t('profile.deleting')}</Text>
      </SafeAreaView>
    );
  }

  if (!profile) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#f1fdf5', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
        <Text style={{ color: '#6b7280', fontSize: 15, textAlign: 'center' }}>{t('errors.generic')}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f1fdf5' }}>

      {/* App bar */}
      <View style={{ backgroundColor: '#f1fdf5', paddingHorizontal: 24, paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Image source={require('../../assets/tree.png')} style={{ width: 26, height: 26 }} />
          <Text className="text-2xl font-rubik-semi text-black">{t('common.app_name')}</Text>
        </View>
        <TouchableOpacity hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} onPress={() => setMenuOpen((v) => !v)}>
          <Ionicons name="menu" size={24} color="black" />
        </TouchableOpacity>
      </View>

      {/* Title row */}
      <View style={{ paddingHorizontal: 24, paddingTop: 20, paddingBottom: 12 }}>
        <Text className="text-3xl font-rubik-semi text-black">{t('profile.title')}</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 80 }}>

        {/* Grouped profile card */}
        <View style={{ backgroundColor: 'white', borderWidth: 1, borderColor: '#d9d9d9', borderRadius: 10, overflow: 'hidden', marginBottom: 32 }}>

          {/* Display name row */}
          <View style={{ padding: 14, paddingHorizontal: 16 }}>
            <Text className="font-rubik-medium" style={{ fontSize: 12, color: '#9ca3af', marginBottom: 5 }}>
              {t('profile.display_name')}
            </Text>
            <NameRow
              profile={profile}
              onSaved={(name) => setProfile((p) => p ? { ...p, name } : p)}
            />
          </View>

          <View style={{ height: 1, backgroundColor: '#e5e7eb' }} />

          {/* Email row — display only */}
          <View style={{ padding: 14, paddingHorizontal: 16 }}>
            <Text className="font-rubik-medium" style={{ fontSize: 12, color: '#9ca3af', marginBottom: 5 }}>
              {t('profile.email_label')}
            </Text>
            <Text style={{ fontSize: 14, color: '#555' }} numberOfLines={1}>{profile.email}</Text>
          </View>

          <View style={{ height: 1, backgroundColor: '#e5e7eb' }} />

          {/* Change password row */}
          <TouchableOpacity style={{ padding: 16, paddingHorizontal: 16 }} onPress={() => setShowPasswordModal(true)}>
            <Text className="font-rubik-medium" style={{ fontSize: 15, color: BRAND_GREEN }}>{t('profile.change_password')}</Text>
          </TouchableOpacity>

        </View>

        {/* Sign out — green outline secondary button */}
        <TouchableOpacity
          style={{ borderWidth: 1.5, borderColor: BRAND_GREEN, borderRadius: 10, padding: 16, alignItems: 'center', backgroundColor: 'white' }}
          onPress={handleSignOut}
        >
          <Text className="font-rubik-semi" style={{ fontSize: 15, color: BRAND_GREEN }}>{t('profile.sign_out')}</Text>
        </TouchableOpacity>

        {/* Delete account — separated, destructive */}
        <View style={{ marginTop: 36 }}>
          <TouchableOpacity
            style={{ borderWidth: 1, borderColor: '#fecaca', borderRadius: 10, padding: 16, alignItems: 'center', backgroundColor: 'white' }}
            onPress={confirmDeleteAccount}
          >
            <Text className="font-rubik-medium" style={{ fontSize: 15, color: '#ef4444' }}>{t('profile.delete_account')}</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>


      {/* Hamburger dropdown menu */}
      {menuOpen && (
        <>
          <TouchableOpacity
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50 }}
            onPress={() => setMenuOpen(false)}
            activeOpacity={1}
          />
          <View style={{
            position: 'absolute',
            top: insets.top + 56,
            right: 12,
            zIndex: 51,
            backgroundColor: 'white',
            borderRadius: 10,
            width: 160,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.15,
            shadowRadius: 8,
            elevation: 8,
            overflow: 'hidden',
          }}>
            {([
              { labelKey: 'menu.home',         icon: require('../../assets/Home-menu.png'),    route: '/(tabs)'          },
              { labelKey: 'menu.my_children', icon: require('../../assets/icons/Heart.png'),  route: '/(tabs)/children' },
              { labelKey: 'menu.my_groups',   icon: require('../../assets/icons/groups.png'), route: '/(tabs)/groups'   },
              { labelKey: 'menu.my_profile',  icon: require('../../assets/person.png'), route: '/(tabs)/profile'  },
            ] as const).map(({ labelKey, icon, route }, idx) => (
              <TouchableOpacity
                key={labelKey}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 14,
                  gap: 10,
                  height: 48,
                  borderTopWidth: idx > 0 ? 1 : 0,
                  borderTopColor: '#f3f4f6',
                }}
                onPress={() => { setMenuOpen(false); router.replace(route); }}
              >
                <Image source={icon} style={{ width: 20, height: 20 }} resizeMode="contain" />
                <Text style={{ flex: 1, fontSize: 14, fontWeight: '500', color: '#111827', textAlign: 'right' }}>
                  {t(labelKey)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      <ChangePasswordModal
        visible={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
      />

    </SafeAreaView>
  );
}
