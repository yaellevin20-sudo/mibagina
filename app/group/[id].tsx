import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  Share,
  ActivityIndicator,
  Image,
  Modal,
  TextInput,
  Dimensions,
} from 'react-native';
import EmojiPicker, { type EmojiType } from 'rn-emoji-keyboard';

const { width: screenWidth } = Dimensions.get('window');
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import {
  getGroupMembers,
  renameGroup,
  setGroupEmoji as setGroupEmojiRpc,
  deleteGroup,
  removeGuardianFromGroup,
  removeChildFromGroup,
  getChildGroupContext,
  type GroupMember,
} from '../../lib/db/rpc';

const BRAND_GREEN = '#3D7A50';

// ---------------------------------------------------------------------------
// Delete Group Modal
// ---------------------------------------------------------------------------
function DeleteGroupModal({
  visible,
  groupName,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  groupName: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.43)', alignItems: 'center', justifyContent: 'center' }}
        activeOpacity={1}
        onPress={onClose}
      >
        <TouchableOpacity
          activeOpacity={1}
          style={{
            backgroundColor: 'white',
            borderRadius: 14,
            width: 295,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.3,
            shadowRadius: 8,
            elevation: 8,
            overflow: 'hidden',
          }}
        >
          {/* Body */}
          <View style={{ padding: 20, paddingBottom: 12 }}>
            {/* Header: RTL → title RIGHT (first), × LEFT (second) */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
              <Text style={{ fontSize: 18, fontWeight: '600', color: '#111', flex: 1, textAlign: 'right' }}>
                {t('groups.delete_group')}
              </Text>
              <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={{ fontSize: 20, color: '#9ca3af', lineHeight: 22 }}>×</Text>
              </TouchableOpacity>
            </View>
            <Text style={{ fontSize: 14, color: '#444', textAlign: 'right', lineHeight: 20 }}>
              {t('groups.confirm_delete_group', { name: groupName })}
            </Text>
          </View>

          {/* Actions: RTL flex-end = physical LEFT */}
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 20, paddingBottom: 20, paddingTop: 8, gap: 20 }}>
            {loading ? (
              <ActivityIndicator color={BRAND_GREEN} />
            ) : (
              <>
                {/* ביטול first → physical RIGHT in RTL */}
                <TouchableOpacity onPress={onClose}>
                  <Text style={{ fontSize: 16, fontWeight: '500', color: BRAND_GREEN }}>
                    {t('common.cancel')}
                  </Text>
                </TouchableOpacity>
                {/* מחיקה second → physical LEFT */}
                <TouchableOpacity onPress={handleDelete}>
                  <Text style={{ fontSize: 16, fontWeight: '600', color: '#ef4444' }}>
                    {t('groups.delete_group')}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Rename Group Modal
// ---------------------------------------------------------------------------
function RenameGroupModal({
  visible,
  groupName,
  groupEmoji,
  onClose,
  onSave,
}: {
  visible: boolean;
  groupName: string;
  groupEmoji: string;
  onClose: () => void;
  onSave: (name: string, emoji: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [draftName, setDraftName]   = useState(groupName);
  const [draftEmoji, setDraftEmoji] = useState(groupEmoji);
  const [emojiOpen, setEmojiOpen]   = useState(false);
  const [loading, setLoading]       = useState(false);

  useEffect(() => {
    if (visible) {
      setDraftName(groupName);
      setDraftEmoji(groupEmoji);
      setEmojiOpen(false);
    }
  }, [visible, groupName, groupEmoji]);

  async function handleSave() {
    const trimmed = draftName.trim();
    if (!trimmed) return;
    setLoading(true);
    try {
      await onSave(trimmed, draftEmoji);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.43)', alignItems: 'center', justifyContent: 'center' }}
          activeOpacity={1}
          onPress={onClose}
        >
          <TouchableOpacity
            activeOpacity={1}
            style={{
              backgroundColor: 'white',
              borderRadius: 14,
              width: screenWidth - 32,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.3,
              shadowRadius: 8,
              elevation: 8,
              overflow: 'hidden',
            }}
          >
            <View style={{ padding: 20, paddingBottom: 16 }}>
              {/* Header: RTL → title RIGHT (first), × LEFT (second) */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
                <Text style={{ fontSize: 18, fontWeight: '600', color: '#111' }}>
                  {t('groups.rename_title')}
                </Text>
                <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={{ fontSize: 20, color: '#9ca3af', lineHeight: 22 }}>×</Text>
                </TouchableOpacity>
              </View>

              {/* Input: RTL → emoji RIGHT (first), text LEFT (second) */}
              <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                borderWidth: 1,
                borderColor: BRAND_GREEN,
                borderRadius: 10,
                height: 48,
              }}>
                <TouchableOpacity
                  style={{ paddingHorizontal: 13, height: '100%', alignItems: 'center', justifyContent: 'center' }}
                  onPress={() => setEmojiOpen(true)}
                >
                  <Text style={{ fontSize: 22 }}>{draftEmoji || '🌳'}</Text>
                </TouchableOpacity>
                <View style={{ width: 1, height: 28, backgroundColor: '#d1d5db' }} />
                <TextInput
                  style={{ flex: 1, paddingHorizontal: 12, fontSize: 16, color: '#111', textAlign: 'right' }}
                  value={draftName}
                  onChangeText={setDraftName}
                  autoFocus
                  placeholder={t('groups.rename_placeholder')}
                  placeholderTextColor="#b0b7c0"
                  editable={!loading}
                  returnKeyType="done"
                  onSubmitEditing={handleSave}
                />
              </View>
            </View>

            {/* Actions: RTL flex-end → cancel RIGHT (first), save LEFT (second) */}
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 20, paddingBottom: 20, gap: 20 }}>
              <TouchableOpacity onPress={onClose} disabled={loading}>
                <Text style={{ fontSize: 16, fontWeight: '500', color: '#111' }}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleSave} disabled={loading || !draftName.trim()}>
                {loading ? (
                  <ActivityIndicator color={BRAND_GREEN} size="small" />
                ) : (
                  <Text style={{ fontSize: 16, fontWeight: '600', color: BRAND_GREEN }}>{t('common.save')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <View style={{ direction: 'ltr' }}>
        <EmojiPicker
          onEmojiSelected={(e: EmojiType) => { setDraftEmoji(e.emoji); setEmojiOpen(false); }}
          open={emojiOpen}
          onClose={() => setEmojiOpen(false)}
          categoryPosition="top"
          categoryOrder={['smileys_emotion', 'people_body', 'animals_nature', 'food_drink', 'travel_places', 'activities', 'objects', 'symbols', 'flags', 'recently_used', 'search']}
        />
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// Group Detail Screen
// ---------------------------------------------------------------------------
export default function GroupDetailScreen() {
  const {
    id,
    name: initialName,
    emoji,
    isAdmin,
    memberCount,
    inviteToken,
  } = useLocalSearchParams<{
    id: string;
    name: string;
    emoji: string;
    isAdmin: string;
    memberCount: string;
    inviteToken: string;
  }>();

  const router   = useRouter();
  const { t }    = useTranslation();
  const { user } = useAuth();
  const insets   = useSafeAreaInsets();

  const [members, setMembers]               = useState<GroupMember[]>([]);
  const [loading, setLoading]               = useState(true);
  const [groupName, setGroupName]           = useState(initialName ?? '');
  const [savedEmoji, setSavedEmoji]         = useState(emoji || '🌳');
  const [menuOpen, setMenuOpen]             = useState(false);
  const [showRename, setShowRename]         = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [editingAdmins, setEditingAdmins]   = useState(false);

  const isAdminBool = isAdmin === '1';

  const loadMembers = useCallback(() => {
    setLoading(true);
    getGroupMembers(id as string)
      .then(setMembers)
      .catch((e) => console.error('[group detail] load error', e))
      .finally(() => setLoading(false));
  }, [id]);

  useFocusEffect(useCallback(() => { loadMembers(); }, [loadMembers]));

  const admins      = members.filter((m) => m.is_admin);
  const allChildren = members.flatMap((m) =>
    m.children.map((c) => ({ ...c, guardianId: m.guardian_id }))
  );

  function confirmLeaveGroup() {
    if (isAdminBool && admins.length === 1) {
      Alert.alert(t('groups.last_admin_error'));
      return;
    }
    Alert.alert(
      t('groups.leave_group'),
      '',
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('groups.leave_group'),
          style: 'destructive',
          onPress: async () => {
            try {
              await removeGuardianFromGroup(id as string, user!.id);
              router.back();
            } catch (e: any) {
              Alert.alert(t('errors.generic'), e.message);
            }
          },
        },
      ]
    );
  }

  function handleShareInvite() {
    const link = `https://mibagina.co.il/join/${inviteToken}`;
    Share.share({ message: t('groups.share_message', { link }) });
  }

  function handleDeleteGroup() {
    setMenuOpen(false);
    setShowDeleteModal(true);
  }

  async function runDeleteGroup() {
    try {
      await deleteGroup(id as string);
      setShowDeleteModal(false);
      router.back();
    } catch (e: any) {
      setShowDeleteModal(false);
      const isCheckinError = e.message?.includes('Active check-ins exist');
      Alert.alert(
        isCheckinError ? t('groups.delete_active_checkins_error_title') : t('errors.generic'),
        isCheckinError ? t('groups.delete_active_checkins_error') : e.message
      );
    }
  }

  function confirmRemoveGuardian(memberId: string, memberName: string) {
    Alert.alert(
      t('groups.confirm_remove_guardian', { name: memberName }),
      '',
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          style: 'destructive',
          onPress: async () => {
            try {
              await removeGuardianFromGroup(id as string, memberId);
              loadMembers();
            } catch (e: any) {
              Alert.alert(
                e.message?.includes('last admin')
                  ? t('groups.last_admin_error')
                  : t('errors.generic'),
                e.message
              );
            }
          },
        },
      ]
    );
  }

  async function confirmRemoveChild(childId: string, childName: string) {
    try {
      const ctx = await getChildGroupContext(id as string, childId);
      const msg = ctx.is_last_child_for_me
        ? t('groups.confirm_remove_guardian', { name: childName })
        : t('groups.confirm_remove_child', { name: childName });
      Alert.alert(msg, '', [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          style: 'destructive',
          onPress: async () => {
            try {
              await removeChildFromGroup(id as string, childId);
              loadMembers();
            } catch (e: any) {
              Alert.alert(t('errors.generic'), e.message);
            }
          },
        },
      ]);
    } catch (e: any) {
      Alert.alert(t('errors.generic'), e.message);
    }
  }

  const sectionCardStyle = {
    backgroundColor: 'white',
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    shadowColor: '#a4a4a4',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 1,
  } as const;

  const avatarStyle = {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#E4F2EA',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    flexShrink: 0,
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: 'white' }}>

      {/* Top bar: RTL → back-btn RIGHT (first), dots LEFT (second) */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingVertical: 12,
          backgroundColor: 'white',
        }}
      >
        {/* Back button: RTL → arrow RIGHT (first), text LEFT (second) */}
        <TouchableOpacity
          onPress={() => router.back()}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={{ fontSize: 18 }}>→</Text>
          <Text style={{ fontSize: 15, fontWeight: '600' }}>{t('nav.back')}</Text>
        </TouchableOpacity>

        {/* 3-dot menu (admin only) */}
        {isAdminBool && (
          <TouchableOpacity
            onPress={() => setMenuOpen((v) => !v)}
            style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <View style={{ gap: 3, alignItems: 'center' }}>
              <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: '#333' }} />
              <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: '#333' }} />
              <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: '#333' }} />
            </View>
          </TouchableOpacity>
        )}
      </View>

      {/* Hero header */}
      <View
        style={{
          paddingHorizontal: 16,
          paddingVertical: 20,
          alignItems: 'center',
          backgroundColor: 'white',
          shadowColor: '#a4a4a4',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.25,
          shadowRadius: 5,
          elevation: 2,
        }}
      >
        <Text style={{ fontSize: 72 }}>{savedEmoji}</Text>
        <Text style={{ fontSize: 26, fontWeight: '600', color: '#111', marginTop: 4 }}>
          {groupName}
        </Text>
        <Text style={{ fontSize: 14, fontWeight: '500', color: '#555', marginTop: 2 }}>
          {t('groups.member_count', { count: loading && members.length === 0 ? Number(memberCount ?? 0) : members.length })}
        </Text>
      </View>

      <ScrollView style={{ flex: 1, backgroundColor: '#f1fdf5' }}>

        {/* ── Admins section ── */}
        <View style={sectionCardStyle}>
          {/* Section header: RTL → label RIGHT (first), edit btn LEFT (second) */}
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: '500', color: '#767d8b' }}>
              {t('groups.admins_section')}
            </Text>
            {isAdminBool && (
              <TouchableOpacity onPress={() => setEditingAdmins((v) => !v)}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: '#767d8b' }}>
                  {t('groups.edit')}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {loading ? (
            <ActivityIndicator size="small" color={BRAND_GREEN} />
          ) : (
            admins.map((admin, idx) => (
              <View
                key={admin.guardian_id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  paddingVertical: 8,
                  borderBottomWidth: idx < admins.length - 1 ? 1 : 0,
                  borderBottomColor: '#f3f4f6',
                }}
              >
                {/* Avatar: first → physical RIGHT in RTL */}
                <View style={avatarStyle}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: BRAND_GREEN }}>
                    {admin.name.charAt(0)}
                  </Text>
                </View>

                {/* Info: second → physical LEFT */}
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ fontSize: 16, fontWeight: '500', color: '#111' }}>
                      {admin.name}
                    </Text>
                    <View
                      style={{
                        backgroundColor: 'rgba(0, 215, 87, 0.26)',
                        borderRadius: 5,
                        paddingHorizontal: 7,
                        paddingVertical: 2,
                      }}
                    >
                      <Text style={{ fontSize: 10, fontWeight: '700' }}>
                        {t('groups.admin_badge')}
                      </Text>
                    </View>
                    {admin.guardian_id === user?.id && (
                      <Text style={{ fontSize: 12, color: '#767d8b' }}>{t('groups.you_indicator')}</Text>
                    )}
                  </View>
                </View>

                {/* Remove button (edit mode, not self) */}
                {editingAdmins && admin.guardian_id !== user?.id && (
                  <TouchableOpacity
                    onPress={() => confirmRemoveGuardian(admin.guardian_id, admin.name)}
                  >
                    <Text style={{ color: '#ef4444', fontSize: 13 }}>
                      {t('children.remove_child')}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            ))
          )}
        </View>

        {/* ── Members (children) section ── */}
        <View style={sectionCardStyle}>
          {/* Section header: RTL → label RIGHT (first), edit btn LEFT (second) */}
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: '500', color: '#767d8b' }}>
              {t('groups.members_section')}
            </Text>
            {isAdminBool && (
              <TouchableOpacity onPress={() => router.push({ pathname: '/group/edit-members', params: { id } })}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: '#767d8b' }}>
                  {t('groups.edit')}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {loading ? (
            <ActivityIndicator size="small" color={BRAND_GREEN} />
          ) : allChildren.length === 0 ? (
            <Text
              style={{ fontSize: 14, color: '#9ca3af', textAlign: 'center', paddingVertical: 8 }}
            >
              —
            </Text>
          ) : (
            allChildren.map((child, idx) => (
              <View
                key={child.child_id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  paddingVertical: 8,
                  borderBottomWidth: idx < allChildren.length - 1 ? 1 : 0,
                  borderBottomColor: '#f3f4f6',
                }}
              >
                {/* Avatar: first → physical RIGHT in RTL */}
                <View style={avatarStyle}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: BRAND_GREEN }}>
                    {child.first_name.charAt(0)}
                  </Text>
                </View>

                {/* Info: second → physical LEFT */}
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '500', color: '#111' }}>
                    {child.first_name} {child.last_name}
                  </Text>
                  <Text style={{ fontSize: 12, color: '#767d8b', marginTop: 1 }}>
                    {t('children.years_old', { age: child.age_years })}
                  </Text>
                </View>

              </View>
            ))
          )}
        </View>

        {/* Leave group */}
        <TouchableOpacity
          onPress={confirmLeaveGroup}
          style={{
            marginTop: 16,
            marginHorizontal: 16,
            borderWidth: 1,
            borderColor: '#fecaca',
            borderRadius: 10,
            padding: 14,
            alignItems: 'center',
            backgroundColor: 'white',
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: '500', color: '#ef4444' }}>
            {t('groups.leave_group')}
          </Text>
        </TouchableOpacity>

        <View style={{ height: 80 }} />
      </ScrollView>

      {/* Context menu (admin only) — anchored to left (near 3-dot button) */}
      {menuOpen && (
        <>
          <TouchableOpacity
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50 }}
            onPress={() => setMenuOpen(false)}
            activeOpacity={1}
          />
          <View
            style={{
              position: 'absolute',
              top: insets.top + 60,
              right: 16,
              zIndex: 51,
              backgroundColor: 'white',
              borderRadius: 10,
              overflow: 'hidden',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.15,
              shadowRadius: 8,
              elevation: 8,
            }}
          >
            {/* Rename: icon first → RIGHT in RTL, text second → LEFT */}
            <TouchableOpacity
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                paddingHorizontal: 14,
                paddingVertical: 12,
                borderBottomWidth: 1,
                borderBottomColor: '#f3f4f6',
              }}
              onPress={() => { setMenuOpen(false); setShowRename(true); }}
            >
              <Image
                source={require('../../assets/menu-edit-icon.png')}
                style={{ width: 18, height: 18 }}
                resizeMode="contain"
              />
              <Text style={{ fontSize: 14, fontWeight: '500', color: '#1d1b20' }}>
                {t('groups.rename_title')}
              </Text>
            </TouchableOpacity>

            {/* Invite */}
            <TouchableOpacity
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                paddingHorizontal: 14,
                paddingVertical: 12,
                borderBottomWidth: 1,
                borderBottomColor: '#f3f4f6',
              }}
              onPress={() => { setMenuOpen(false); handleShareInvite(); }}
            >
              <Image
                source={require('../../assets/menu-send-icon.png')}
                style={{ width: 18, height: 18 }}
                resizeMode="contain"
              />
              <Text style={{ fontSize: 14, fontWeight: '500', color: '#1d1b20' }}>
                {t('groups.invite_to_group')}
              </Text>
            </TouchableOpacity>

            {/* Delete */}
            <TouchableOpacity
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                paddingHorizontal: 14,
                paddingVertical: 12,
              }}
              onPress={() => { setMenuOpen(false); handleDeleteGroup(); }}
            >
              <Image
                source={require('../../assets/menu-trash-icon.png')}
                style={{ width: 18, height: 18 }}
                resizeMode="contain"
              />
              <Text style={{ fontSize: 14, fontWeight: '500', color: 'red' }}>
                {t('groups.delete_group')}
              </Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* Rename modal */}
      <RenameGroupModal
        visible={showRename}
        groupName={groupName}
        groupEmoji={savedEmoji}
        onClose={() => setShowRename(false)}
        onSave={async (name, newEmoji) => {
          await renameGroup(id as string, name);
          if (newEmoji !== savedEmoji) await setGroupEmojiRpc(id as string, newEmoji);
          setGroupName(name);
          setSavedEmoji(newEmoji);
          setShowRename(false);
        }}
      />

      {/* Delete group modal */}
      <DeleteGroupModal
        visible={showDeleteModal}
        groupName={groupName}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={runDeleteGroup}
      />

    </SafeAreaView>
  );
}
