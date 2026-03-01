import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Share,
  ScrollView,
  Keyboard,
  Pressable,
} from 'react-native';
import { EmojiKeyboard } from 'rn-emoji-keyboard';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import { useAuth } from '../../contexts/AuthContext';
import {
  getMyGroups,
  getMyChildren,
  addChild,
  createGroup,
  renameGroup,
  setGroupEmoji,
  regenerateInviteToken,
  removeGuardianFromGroup,
  removeChildFromGroup,
  getGroupMembers,
  getChildGroupContext,
  transferGroupOwnership,
  addChildrenToGroup,
  demoteToMember,
  deleteGroup,
  type GroupRow,
  type GroupMember,
  type ChildRow,
} from '../../lib/db/rpc';

// ---------------------------------------------------------------------------
// Text input modal (reused for Create & Rename)
// ---------------------------------------------------------------------------
function TextInputModal({
  visible,
  title,
  placeholder,
  initialValue,
  submitLabel,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  title: string;
  placeholder?: string;
  initialValue?: string;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (value: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [value, setValue]   = useState(initialValue ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    if (visible) setValue(initialValue ?? '');
  }, [visible, initialValue]);

  async function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed) { setError(t('errors.generic')); return; }
    setError(null);
    setLoading(true);
    try {
      await onSubmit(trimmed);
      setValue('');
    } catch (e: any) {
      setError(e.message ?? t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView className="flex-1 bg-white">
        <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View className="flex-row justify-between items-center px-4 py-4 border-b border-gray-200">
            <TouchableOpacity onPress={onClose} disabled={loading}>
              <Text className="text-gray-500 text-base">{t('common.cancel')}</Text>
            </TouchableOpacity>
            <Text className="text-lg font-semibold">{title}</Text>
            <View style={{ width: 56 }} />
          </View>
          <View className="px-4 pt-6">
            {error && <Text className="text-red-500 text-sm mb-4">{error}</Text>}
            <TextInput
              className="border border-gray-300 rounded-lg px-4 py-3 mb-6 text-base"
              value={value}
              onChangeText={setValue}
              placeholder={placeholder}
              autoFocus
              editable={!loading}
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
            />
            <TouchableOpacity
              className="bg-green-600 rounded-lg py-4 items-center"
              onPress={handleSubmit}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text className="text-white font-semibold text-base">{submitLabel}</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Inline Add Child Form (mirrors join/[token].tsx InlineAddChildForm)
// ---------------------------------------------------------------------------
function InlineAddChildForm({ onAdded }: { onAdded: (child: ChildRow) => void }) {
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
    <View className="bg-gray-50 rounded-xl p-4 mb-4 border border-gray-200">
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
// Create Group Modal — single-step form with required child selection
// ---------------------------------------------------------------------------
function CreateGroupModal({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [groupName, setGroupName]           = useState('');
  const [children, setChildren]             = useState<ChildRow[]>([]);
  const [selectedChildIds, setSelectedChildIds] = useState<Set<string>>(new Set());
  const [showPicker, setShowPicker]         = useState(false);
  const [showAddChild, setShowAddChild]     = useState(false);
  const [pendingGroupId, setPendingGroupId] = useState<string | null>(null);
  const [loading, setLoading]               = useState(false);
  const [error, setError]                   = useState<string | null>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (visible) {
      setGroupName('');
      setSelectedChildIds(new Set());
      setPendingGroupId(null);
      setError(null);
      setShowPicker(false);
      setShowAddChild(false);
      getMyChildren().then(setChildren).catch(console.error);
    }
  }, [visible]);

  function toggleChild(id: string) {
    setSelectedChildIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleChildAdded(newChild: ChildRow) {
    setChildren((prev) => [...prev, newChild]);
    setSelectedChildIds((prev) => new Set([...prev, newChild.id]));
    setShowAddChild(false);
  }

  const canSubmit = groupName.trim().length > 0 && selectedChildIds.size > 0 && !loading;

  async function handleCreate() {
    if (submittingRef.current) return;
    const trimmed = groupName.trim();
    if (!trimmed || selectedChildIds.size === 0) return;
    submittingRef.current = true;
    setError(null);
    setLoading(true);
    try {
      const gid = pendingGroupId ?? await createGroup(trimmed);
      if (!pendingGroupId) setPendingGroupId(gid);
      await addChildrenToGroup(gid, [...selectedChildIds]);
      onCreated();
    } catch (e: any) {
      setError(e.message ?? t('errors.generic'));
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  }

  const selectedLabel =
    selectedChildIds.size === 0
      ? t('groups.select_child_placeholder')
      : children
          .filter((c) => selectedChildIds.has(c.id))
          .map((c) => c.first_name)
          .join(', ');

  if (!visible) return null;

  return (
    <>
      <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
        <SafeAreaView className="flex-1 bg-white">
          <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            {/* Header */}
            <View className="flex-row justify-between items-center px-4 py-4 border-b border-gray-200">
              <TouchableOpacity onPress={onClose} disabled={loading}>
                <Text className="text-gray-500 text-base">{t('common.cancel')}</Text>
              </TouchableOpacity>
              <Text className="text-lg font-semibold">{t('groups.create_group_title')}</Text>
              <View style={{ width: 56 }} />
            </View>

            {/* Form */}
            <ScrollView className="flex-1 px-4 pt-6">
              {error && <Text className="text-red-500 text-sm mb-4">{error}</Text>}

              <Text className="text-sm font-medium text-gray-700 mb-1">{t('groups.group_name')}</Text>
              <TextInput
                className="border border-gray-300 rounded-lg px-4 py-3 mb-6 text-base"
                value={groupName}
                onChangeText={setGroupName}
                placeholder={t('groups.group_name')}
                autoFocus
                editable={!loading}
                returnKeyType="done"
              />

              <Text className="text-sm font-medium text-gray-700 mb-1">{t('groups.select_child_label')}</Text>
              <TouchableOpacity
                className="border border-gray-300 rounded-lg px-4 py-3 mb-4 flex-row justify-between items-center"
                onPress={() => {
                  Keyboard.dismiss();
                  setShowPicker(true);
                }}
                disabled={loading}
              >
                <Text
                  className="text-base flex-1"
                  style={{ color: selectedChildIds.size === 0 ? '#9ca3af' : '#111827' }}
                >
                  {selectedLabel}
                </Text>
                <Text className="text-gray-400 text-sm ml-2">▼</Text>
              </TouchableOpacity>

              {showAddChild && <InlineAddChildForm onAdded={handleChildAdded} />}
            </ScrollView>

            {/* Footer */}
            <View className="px-4 pb-6 pt-2">
              <TouchableOpacity
                className={`rounded-lg py-4 items-center ${canSubmit ? 'bg-green-600' : 'bg-gray-300'}`}
                onPress={handleCreate}
                disabled={!canSubmit}
              >
                {loading ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text className="text-white font-semibold text-base">{t('groups.create_group_title')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* Child picker bottom sheet — sibling modal, RN renders to root window */}
      <Modal
        visible={showPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPicker(false)}
      >
        <Pressable
          style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}
          onPress={() => setShowPicker(false)}
        >
          <Pressable>
            <View className="bg-white rounded-t-2xl" style={{ maxHeight: '60%' }}>
              {/* Handle bar */}
              <View className="items-center pt-3 pb-2">
                <View className="w-10 rounded-full bg-gray-300" style={{ height: 4 }} />
              </View>

              {/* Picker header */}
              <View className="flex-row justify-between items-center px-4 pb-3 border-b border-gray-200">
                <Text className="text-base font-semibold">{t('groups.select_child_label')}</Text>
                <TouchableOpacity onPress={() => setShowPicker(false)}>
                  <Text className="text-green-600 font-semibold">{t('onboarding.done')}</Text>
                </TouchableOpacity>
              </View>

              <ScrollView>
                {children.map((child) => {
                  const isSelected = selectedChildIds.has(child.id);
                  return (
                    <TouchableOpacity
                      key={child.id}
                      className="flex-row items-center px-4 py-3 border-b border-gray-100"
                      onPress={() => toggleChild(child.id)}
                    >
                      <View
                        className={`w-6 h-6 rounded-full border-2 mr-3 items-center justify-center ${
                          isSelected ? 'bg-green-600 border-green-600' : 'border-gray-300'
                        }`}
                      >
                        {isSelected && <Text className="text-white text-xs font-bold">✓</Text>}
                      </View>
                      <Text className="text-base text-gray-900">
                        {child.first_name} {child.last_name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}

                {/* Add a child row */}
                <TouchableOpacity
                  className="flex-row items-center px-4 py-4"
                  onPress={() => {
                    setShowPicker(false);
                    setShowAddChild(true);
                  }}
                >
                  <Text className="text-green-600 text-base mr-2">+</Text>
                  <Text className="text-green-600 text-base">{t('groups.add_child_option')}</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
            {/* White fill for nav bar area — prevents parent modal showing through */}
            <View style={{ height: insets.bottom, backgroundColor: 'white' }} />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------------------
// Members Modal
// ---------------------------------------------------------------------------
function MembersModal({
  visible,
  groupId,
  isAdmin,
  currentUserId,
  onClose,
  onChanged,
}: {
  visible: boolean;
  groupId: string;
  isAdmin: boolean;
  currentUserId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    getGroupMembers(groupId)
      .then(setMembers)
      .catch((e) => console.error('[members] load error', e))
      .finally(() => setLoading(false));
  }, [visible, groupId]);

  function confirmRemoveGuardian(member: GroupMember) {
    Alert.alert(
      t('groups.confirm_remove_guardian', { name: member.name }),
      '',
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          style: 'destructive',
          onPress: async () => {
            try {
              await removeGuardianFromGroup(groupId, member.guardian_id);
              onChanged();
              onClose();
            } catch (e: any) {
              Alert.alert(
                e.message?.includes('last admin') ? t('groups.last_admin_error') : t('errors.generic'),
                e.message
              );
            }
          },
        },
      ]
    );
  }

  async function confirmRemoveChild(childName: string, childId: string) {
    try {
      const ctx = await getChildGroupContext(groupId, childId);
      const msg = ctx.is_last_child_for_me
        ? t('groups.confirm_remove_guardian', { name: childName })  // cascade removes guardian too
        : t('groups.confirm_remove_child', { name: childName });
      Alert.alert(
        msg,
        '',
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.confirm'),
            style: 'destructive',
            onPress: async () => {
              try {
                await removeChildFromGroup(groupId, childId);
                onChanged();
                getGroupMembers(groupId).then(setMembers).catch(console.error);
              } catch (e: any) {
                Alert.alert(t('errors.generic'), e.message);
              }
            },
          },
        ]
      );
    } catch (e: any) {
      Alert.alert(t('errors.generic'), e.message);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView className="flex-1 bg-white">
        <View className="flex-row justify-between items-center px-4 py-4 border-b border-gray-200">
          <TouchableOpacity onPress={onClose}>
            <Text className="text-gray-500 text-base">{t('common.cancel')}</Text>
          </TouchableOpacity>
          <Text className="text-lg font-semibold">{t('groups.view_members')}</Text>
          <View style={{ width: 56 }} />
        </View>

        {loading ? (
          <ActivityIndicator size="large" color="#16a34a" style={{ marginTop: 32 }} />
        ) : (
          <ScrollView className="flex-1 px-4 pt-4">
            {members.map((member) => (
              <View key={member.guardian_id} className="bg-gray-50 rounded-xl p-4 mb-3">
                <View className="flex-row justify-between items-center">
                  <View className="flex-row items-center gap-2">
                    <Text className="text-base font-semibold text-gray-900">{member.name}</Text>
                    {member.is_admin && (
                      <View className="bg-green-100 rounded px-2 py-0.5">
                        <Text className="text-green-700 text-xs">{t('groups.admin_badge')}</Text>
                      </View>
                    )}
                  </View>
                  {isAdmin && member.guardian_id !== currentUserId && (
                    <TouchableOpacity onPress={() => confirmRemoveGuardian(member)}>
                      <Text className="text-red-500 text-sm">{t('children.remove_child')}</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Children in this group */}
                {member.children.map((child) => (
                  <View key={child.child_id} className="flex-row justify-between items-center mt-2 pl-2">
                    <Text className="text-sm text-gray-600">
                      {child.first_name} {child.last_name} · {t('children.years_old', { age: child.age_years })}
                    </Text>
                    {isAdmin && (
                      <TouchableOpacity
                        onPress={() => confirmRemoveChild(child.first_name, child.child_id)}
                      >
                        <Text className="text-red-400 text-xs">{t('children.remove_child')}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Transfer Ownership Modal
// After transfer: ask "stay in group?" → yes = demoteToMember, no = leave
// ---------------------------------------------------------------------------
function TransferOwnershipModal({
  visible,
  group,
  currentUserId,
  onClose,
  onDone,
}: {
  visible: boolean;
  group: GroupRow;
  currentUserId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [members, setMembers]       = useState<GroupMember[]>([]);
  const [loading, setLoading]       = useState(false);
  const [transferring, setTransferring] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    getGroupMembers(group.id)
      .then(setMembers)
      .catch((e) => console.error('[transfer] load members error', e))
      .finally(() => setLoading(false));
  }, [visible, group.id]);

  const otherMembers = members.filter((m) => m.guardian_id !== currentUserId);

  function confirmTransfer(member: GroupMember) {
    Alert.alert(
      t('groups.transfer_ownership_title'),
      t('groups.transfer_ownership_confirm', { name: member.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          onPress: async () => {
            setTransferring(true);
            try {
              await transferGroupOwnership(group.id, member.guardian_id);
              // Ask if they want to stay in the group as a regular member
              Alert.alert(
                t('groups.stay_in_group'),
                '',
                [
                  {
                    text: t('groups.stay_in_group_yes'),
                    onPress: async () => {
                      try {
                        await demoteToMember(group.id);
                      } catch (e: any) {
                        console.warn('[transfer] demote error', e.message);
                      } finally {
                        setTransferring(false);
                        onDone();
                      }
                    },
                  },
                  {
                    text: t('groups.stay_in_group_no'),
                    style: 'destructive',
                    onPress: async () => {
                      try {
                        await removeGuardianFromGroup(group.id, currentUserId);
                      } catch (e: any) {
                        console.warn('[transfer] remove error', e.message);
                      } finally {
                        setTransferring(false);
                        onDone();
                      }
                    },
                  },
                ],
                { cancelable: false }
              );
            } catch (e: any) {
              setTransferring(false);
              Alert.alert(t('errors.generic'), e.message);
            }
          },
        },
      ]
    );
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView className="flex-1 bg-white">
        <View className="flex-row justify-between items-center px-4 py-4 border-b border-gray-200">
          <TouchableOpacity onPress={onClose} disabled={transferring}>
            <Text className="text-gray-500 text-base">{t('common.cancel')}</Text>
          </TouchableOpacity>
          <Text className="text-lg font-semibold">{t('groups.transfer_ownership_title')}</Text>
          <View style={{ width: 56 }} />
        </View>

        <Text className="px-4 pt-4 pb-2 text-sm text-gray-500">
          {t('groups.transfer_ownership_prompt')}
        </Text>

        {loading || transferring ? (
          <ActivityIndicator size="large" color="#16a34a" style={{ marginTop: 32 }} />
        ) : (
          <ScrollView className="flex-1 px-4 pt-2">
            {otherMembers.map((member) => (
              <TouchableOpacity
                key={member.guardian_id}
                className="bg-gray-50 rounded-xl p-4 mb-3 flex-row justify-between items-center"
                onPress={() => confirmTransfer(member)}
              >
                <Text className="text-base text-gray-900">{member.name}</Text>
                <Text className="text-green-600 text-sm font-semibold">
                  {t('groups.make_owner')}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Group Card
// ---------------------------------------------------------------------------
function GroupCard({
  group,
  currentUserId,
  onRefresh,
}: {
  group: GroupRow;
  currentUserId: string;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const [showRename, setShowRename]             = useState(false);
  const [showMembers, setShowMembers]           = useState(false);
  const [showTransferOwnership, setShowTransferOwnership] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker]   = useState(false);
  const [localEmoji, setLocalEmoji]             = useState<string | null>(group.emoji);

  useEffect(() => { setLocalEmoji(group.emoji); }, [group.emoji]);

  async function handleEmojiSelect(emoji: string | null) {
    const prev = localEmoji;
    setLocalEmoji(emoji);
    setShowEmojiPicker(false);
    try {
      await setGroupEmoji(group.id, emoji);
      onRefresh();
    } catch (e: any) {
      setLocalEmoji(prev);
      Alert.alert(t('errors.generic'), e.message);
    }
  }

  // Sole admin with no children in guardian_child_groups → show Delete only
  const isOnlyMember = group.is_admin && group.member_count <= 1;
  // Admin with no children enrolled (e.g. just created group) → keep Leave visible
  const isAdminWithNoChildren = group.is_admin && group.my_children.length === 0 && group.member_count > 1;

  function handleShareInvite() {
    Share.share({ message: `https://mibagina.co.il/join/${group.invite_token}` });
  }

  function handleRegenerateInvite() {
    Alert.alert(
      t('groups.regenerate_invite'),
      t('groups.confirm_regenerate'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          onPress: async () => {
            try {
              await regenerateInviteToken(group.id);
              onRefresh();
            } catch (e: any) {
              Alert.alert(t('errors.generic'), e.message);
            }
          },
        },
      ]
    );
  }

  function handleLeaveGroup() {
    if (group.is_admin && group.member_count > 1) {
      // Admin with other members must transfer ownership first
      setShowTransferOwnership(true);
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
              await removeGuardianFromGroup(group.id, currentUserId);
              onRefresh();
            } catch (e: any) {
              Alert.alert(t('errors.generic'), e.message);
            }
          },
        },
      ]
    );
  }

  async function handleRemoveMyChild(child: { child_id: string; first_name: string }) {
    try {
      const ctx = await getChildGroupContext(group.id, child.child_id);
      const willLeaveGroup = ctx.is_last_child_for_me;
      const msg = willLeaveGroup
        ? t('groups.confirm_remove_guardian', { name: child.first_name })
        : t('groups.confirm_remove_child', { name: child.first_name });

      Alert.alert(msg, '', [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          style: 'destructive',
          onPress: async () => {
            try {
              await removeChildFromGroup(group.id, child.child_id);
              onRefresh();
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

  function handleDeleteGroup() {
    Alert.alert(
      t('groups.delete_group'),
      t('groups.confirm_delete_group', { name: group.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('groups.delete_group'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteGroup(group.id);
              onRefresh();
            } catch (e: any) {
              const isCheckinError = e.message?.includes('Active check-ins exist');
              Alert.alert(
                isCheckinError
                  ? t('groups.delete_active_checkins_error_title')
                  : t('errors.generic'),
                isCheckinError
                  ? t('groups.delete_active_checkins_error')
                  : e.message
              );
            }
          },
        },
      ]
    );
  }

  const childLabel =
    group.child_count === 1
      ? t('groups.children_count_one')
      : t('groups.children_count_other', { count: group.child_count });

  return (
    <View className="bg-white rounded-xl mx-4 mb-3 p-4 shadow-sm border border-gray-100">
      {/* Title row */}
      <View className="flex-row justify-between items-center">
        <Text className="text-lg font-semibold text-gray-900 flex-1 mr-2">{group.name}</Text>
        <View className="flex-row items-center gap-2">
          {group.is_admin && (
            <View className="bg-green-100 rounded px-2 py-0.5">
              <Text className="text-green-700 text-xs">{t('groups.admin_badge')}</Text>
            </View>
          )}
          {group.is_admin ? (
            <TouchableOpacity onPress={() => setShowEmojiPicker(true)}>
              <Text className="text-2xl">{localEmoji ?? '\uFF0B'}</Text>
            </TouchableOpacity>
          ) : localEmoji ? (
            <Text className="text-2xl">{localEmoji}</Text>
          ) : null}
        </View>
      </View>

      <Text className="text-sm text-gray-500 mt-1">{childLabel}</Text>

      {/* My children in this group (with remove buttons for non-admin self-remove) */}
      {group.my_children.length > 0 && (
        <View className="mt-2">
          {group.my_children.map((c) => (
            <View key={c.child_id} className="flex-row justify-between items-center py-0.5">
              <Text className="text-sm text-gray-600">{c.first_name} {c.last_name}</Text>
              <TouchableOpacity onPress={() => handleRemoveMyChild(c)}>
                <Text className="text-red-400 text-xs">{t('children.remove_child')}</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {/* Actions */}
      <View className="mt-3 flex-row flex-wrap gap-2">
        <TouchableOpacity
          className="border border-green-600 rounded-lg px-3 py-2"
          onPress={handleShareInvite}
        >
          <Text className="text-green-600 text-sm">{t('groups.share_invite')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          className="border border-gray-300 rounded-lg px-3 py-2"
          onPress={() => setShowMembers(true)}
        >
          <Text className="text-gray-600 text-sm">{t('groups.view_members')}</Text>
        </TouchableOpacity>

        {group.is_admin && (
          <>
            <TouchableOpacity
              className="border border-gray-300 rounded-lg px-3 py-2"
              onPress={() => setShowRename(true)}
            >
              <Text className="text-gray-600 text-sm">{t('groups.rename')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              className="border border-orange-300 rounded-lg px-3 py-2"
              onPress={handleRegenerateInvite}
            >
              <Text className="text-orange-600 text-sm">{t('groups.regenerate_invite')}</Text>
            </TouchableOpacity>
          </>
        )}

        {/* Leave group — sole owner uses Delete. Admin with no children keeps Leave. */}
        {(isAdminWithNoChildren) && (
          <TouchableOpacity
            className="border border-red-200 rounded-lg px-3 py-2"
            onPress={handleLeaveGroup}
          >
            <Text className="text-red-500 text-sm">{t('groups.leave_group')}</Text>
          </TouchableOpacity>
        )}

        {/* Delete group — admin only */}
        {group.is_admin && (
          <TouchableOpacity
            className="border border-red-400 rounded-lg px-3 py-2"
            onPress={handleDeleteGroup}
          >
            <Text className="text-red-600 text-sm font-semibold">{t('groups.delete_group')}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Rename modal */}
      <TextInputModal
        visible={showRename}
        title={t('groups.rename_title')}
        initialValue={group.name}
        submitLabel={t('common.save')}
        onClose={() => setShowRename(false)}
        onSubmit={async (name) => {
          await renameGroup(group.id, name);
          setShowRename(false);
          onRefresh();
        }}
      />

      {/* Members modal */}
      <MembersModal
        visible={showMembers}
        groupId={group.id}
        isAdmin={group.is_admin}
        currentUserId={currentUserId}
        onClose={() => setShowMembers(false)}
        onChanged={onRefresh}
      />

      {/* Transfer ownership modal (admin leaving with other members) */}
      <TransferOwnershipModal
        visible={showTransferOwnership}
        group={group}
        currentUserId={currentUserId}
        onClose={() => setShowTransferOwnership(false)}
        onDone={() => {
          setShowTransferOwnership(false);
          onRefresh();
        }}
      />

      {/* Emoji picker modal */}
      <Modal
        visible={showEmojiPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowEmojiPicker(false)}
      >
        <View className="flex-1 justify-end bg-black/40">
          <View className="bg-white rounded-t-2xl" style={{ maxHeight: '65%' }}>
            <TouchableOpacity
              className="items-center py-3"
              onPress={() => handleEmojiSelect(null)}
            >
              <Text className="text-red-500">{t('groups.remove_emoji')}</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <EmojiKeyboard onEmojiSelected={(item) => handleEmojiSelect(item.emoji)} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Groups Screen
// ---------------------------------------------------------------------------
export default function GroupsScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [groups, setGroups]         = useState<GroupRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  // Track known group names by ID so we can toast when one disappears.
  const knownGroupsRef = useRef<Map<string, string>>(new Map());

  const load = useCallback(async () => {
    try {
      const data = await getMyGroups();

      // Show a toast for any group that was known but is now gone.
      if (knownGroupsRef.current.size > 0) {
        for (const [id, name] of knownGroupsRef.current) {
          if (!data.find((g) => g.id === id)) {
            Toast.show({ text1: t('groups.group_deleted_toast', { name }) });
          }
        }
      }
      knownGroupsRef.current = new Map(data.map((g) => [g.id, g.name]));

      setGroups(data);
    } catch (e) {
      console.error('[groups] load error', e);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      {/* Header */}
      <View className="flex-row justify-between items-center px-4 py-4 bg-white border-b border-gray-200">
        <Text className="text-xl font-bold text-gray-900">{t('nav.groups')}</Text>
        <TouchableOpacity onPress={() => setShowCreate(true)}>
          <Text className="text-green-600 font-semibold text-base">{t('groups.create')}</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#16a34a" style={{ marginTop: 48 }} />
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <GroupCard
              group={item}
              currentUserId={user?.id ?? ''}
              onRefresh={load}
            />
          )}
          contentContainerStyle={{ paddingVertical: 12 }}
          ListEmptyComponent={
            <View className="items-center justify-center mt-16 px-6">
              <Text className="text-gray-500 text-base text-center">{t('groups.no_groups')}</Text>
              <TouchableOpacity
                className="mt-6 bg-green-600 rounded-lg px-8 py-3"
                onPress={() => setShowCreate(true)}
              >
                <Text className="text-white font-semibold">{t('groups.create')}</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}

      {/* Create group modal */}
      <CreateGroupModal
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => { setShowCreate(false); load(); }}
      />
    </SafeAreaView>
  );
}
