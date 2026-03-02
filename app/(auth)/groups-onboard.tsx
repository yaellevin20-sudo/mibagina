import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Modal,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  getMyChildren,
  createGroup,
  addChildrenToGroup,
  addChild,
  type ChildRow,
} from '../../lib/db/rpc';
import OnboardingProgress from '../../components/OnboardingProgress';

const BRAND_GREEN = '#3D7A50';
const BRAND_GREEN_SOFT = '#E4F2EA';

type CreatedGroup = { id: string; name: string };

export default function GroupsOnboardScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [groups, setGroups] = useState<CreatedGroup[]>([]);
  const [children, setChildren] = useState<ChildRow[]>([]);
  const [showCreateSheet, setShowCreateSheet] = useState(false);
  const [showAddChildSheet, setShowAddChildSheet] = useState(false);

  // Create group form
  const [groupName, setGroupName] = useState('');
  const [selectedChildIds, setSelectedChildIds] = useState<Set<string>>(new Set());
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const submittingRef = useRef(false);

  // Add child form (nested within create group)
  const [childFirstName, setChildFirstName] = useState('');
  const [childLastName, setChildLastName] = useState('');
  const [childDob, setChildDob] = useState('');
  const [childFormLoading, setChildFormLoading] = useState(false);
  const [childFormError, setChildFormError] = useState<string | null>(null);

  useEffect(() => {
    getMyChildren().then(setChildren).catch(console.error);
  }, []);

  function toggleChild(id: string) {
    setSelectedChildIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function openCreateSheet() {
    setGroupName('');
    setSelectedChildIds(new Set());
    setCreateError(null);
    setShowCreateSheet(true);
  }

  function openAddChildSheet() {
    setChildFirstName('');
    setChildLastName('');
    setChildDob('');
    setChildFormError(null);
    setShowAddChildSheet(true);
  }

  async function handleAddChild() {
    const f = childFirstName.trim();
    const l = childLastName.trim();
    const d = childDob.trim();
    if (!f || !l || !d) { setChildFormError(t('errors.generic')); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { setChildFormError(t('children.date_of_birth_hint')); return; }
    if (new Date(d) > new Date()) { setChildFormError(t('errors.generic')); return; }

    setChildFormError(null);
    setChildFormLoading(true);
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
      setChildren((prev) => [...prev, newChild]);
      // Auto-select the new child
      setSelectedChildIds((prev) => new Set([...prev, childId]));
      setShowAddChildSheet(false);
    } catch (e: any) {
      setChildFormError(e.message ?? t('errors.generic'));
    } finally {
      setChildFormLoading(false);
    }
  }

  async function handleCreateGroup() {
    if (submittingRef.current) return;
    const trimmed = groupName.trim();
    if (!trimmed) return;
    submittingRef.current = true;
    setCreateError(null);
    setCreateLoading(true);
    try {
      const gid = await createGroup(trimmed);
      // Add children only if any are selected (optional in onboarding)
      if (selectedChildIds.size > 0) {
        await addChildrenToGroup(gid, [...selectedChildIds]);
      }
      setGroups((prev) => [...prev, { id: gid, name: trimmed }]);
      setShowCreateSheet(false);
    } catch (e: any) {
      setCreateError(e.message ?? t('errors.generic'));
    } finally {
      setCreateLoading(false);
      submittingRef.current = false;
    }
  }

  function handleContinue() {
    router.replace('/(auth)/notifications-ask');
  }

  function handleSkip() {
    router.replace('/(auth)/notifications-ask');
  }

  const canCreate = groupName.trim().length > 0 && !createLoading;

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 px-6">
        {/* Back button */}
        <TouchableOpacity className="pt-4 pb-2" onPress={() => router.back()}>
          <Text className="font-rubik text-sm text-gray-500">{t('nav.back')}</Text>
        </TouchableOpacity>

        {/* Progress bar */}
        <View className="pt-4">
          <OnboardingProgress steps={4} current={3} />
        </View>

        {/* Header row */}
        <View className="flex-row justify-between items-center mb-1">
          <Text className="text-2xl font-rubik-bold text-brand-green-dark">
            {t('onboarding.groups_title')}
          </Text>
          <TouchableOpacity onPress={handleSkip}>
            <Text className="font-rubik text-sm text-gray-400">{t('onboarding.skip')}</Text>
          </TouchableOpacity>
        </View>
        <Text className="font-rubik text-gray-500 mb-6">{t('onboarding.groups_subtitle')}</Text>

        {groups.length === 0 ? (
          /* Empty state */
          <View className="flex-1 items-center justify-center">
            <Image
              source={require('../../assets/seesaw.png')}
              style={{ width: 120, height: 120, marginBottom: 20 }}
              resizeMode="contain"
            />
            <Text className="text-lg font-rubik-semi text-gray-700 mb-2 text-center">
              {t('onboarding.groups_empty')}
            </Text>
            <Text className="font-rubik text-gray-400 text-center mb-8">
              {t('onboarding.groups_subtitle')}
            </Text>
            <TouchableOpacity
              className="rounded-xl py-3 px-8 items-center"
              style={{ backgroundColor: BRAND_GREEN_SOFT }}
              onPress={openCreateSheet}
            >
              <Text className="font-rubik-semi text-base" style={{ color: BRAND_GREEN }}>
                {t('onboarding.create_group_cta')}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          /* Groups list */
          <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
            {groups.map((group) => (
              <View
                key={group.id}
                className="flex-row items-center px-4 py-3 rounded-xl mb-2"
                style={{ backgroundColor: BRAND_GREEN_SOFT }}
              >
                <Text className="font-rubik-semi text-base flex-1" style={{ color: BRAND_GREEN }}>
                  {group.name}
                </Text>
              </View>
            ))}

            <TouchableOpacity
              className="rounded-xl py-3 items-center mt-2"
              style={{ borderWidth: 1, borderColor: BRAND_GREEN }}
              onPress={openCreateSheet}
            >
              <Text className="font-rubik-semi text-base" style={{ color: BRAND_GREEN }}>
                + {t('onboarding.create_group_cta')}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        )}
      </View>

      {/* Continue button — visible when groups exist */}
      {groups.length > 0 && (
        <View className="px-6 pb-6 pt-2">
          <TouchableOpacity
            className="rounded-xl py-4 items-center"
            style={{ backgroundColor: BRAND_GREEN }}
            onPress={handleContinue}
          >
            <Text className="text-white font-rubik-bold text-base">{t('onboarding.continue')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Create group bottom sheet */}
      <Modal
        visible={showCreateSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCreateSheet(false)}
      >
        <Pressable
          style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}
          onPress={() => setShowCreateSheet(false)}
        >
          <Pressable>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
              <View className="bg-white rounded-t-2xl px-6 pt-4"
                    style={{ paddingBottom: insets.bottom + 16 }}>
                {/* Handle */}
                <View className="items-center mb-4">
                  <View className="w-10 bg-gray-300 rounded-full" style={{ height: 4 }} />
                </View>

                <Text className="text-xl font-rubik-bold text-brand-green-dark mb-6">
                  {t('groups.create_group_title')}
                </Text>

                {createError && (
                  <Text className="text-red-500 text-sm mb-3 font-rubik">{createError}</Text>
                )}

                <Text className="text-sm font-rubik-semi text-gray-700 mb-1">{t('groups.group_name')}</Text>
                <TextInput
                  className="border border-gray-300 rounded-xl px-4 py-3 mb-4 text-base font-rubik"
                  value={groupName}
                  onChangeText={setGroupName}
                  placeholder={t('onboarding.group_name_placeholder')}
                  autoFocus
                  editable={!createLoading}
                  returnKeyType="done"
                />

                {/* Child chip selector */}
                {children.length > 0 && (
                  <>
                    <Text className="text-sm font-rubik-semi text-gray-700 mb-2">
                      {t('groups.select_child_label')}
                    </Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-4">
                      <View className="flex-row gap-2" style={{ gap: 8 }}>
                        {children.map((child) => {
                          const selected = selectedChildIds.has(child.id);
                          return (
                            <TouchableOpacity
                              key={child.id}
                              className="rounded-full px-4 py-2"
                              style={{
                                backgroundColor: selected ? BRAND_GREEN : BRAND_GREEN_SOFT,
                              }}
                              onPress={() => toggleChild(child.id)}
                            >
                              <Text
                                className="font-rubik-semi text-sm"
                                style={{ color: selected ? '#fff' : BRAND_GREEN }}
                              >
                                {child.first_name}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                        {/* Add child chip */}
                        <TouchableOpacity
                          className="rounded-full px-4 py-2 border"
                          style={{ borderColor: BRAND_GREEN }}
                          onPress={openAddChildSheet}
                        >
                          <Text className="font-rubik-semi text-sm" style={{ color: BRAND_GREEN }}>
                            + {t('children.add_child')}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </ScrollView>
                  </>
                )}

                {children.length === 0 && (
                  <TouchableOpacity
                    className="rounded-xl py-3 items-center mb-4 border"
                    style={{ borderColor: BRAND_GREEN }}
                    onPress={openAddChildSheet}
                  >
                    <Text className="font-rubik-semi text-sm" style={{ color: BRAND_GREEN }}>
                      + {t('children.add_child')}
                    </Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  className="rounded-xl py-4 items-center"
                  style={{ backgroundColor: canCreate ? BRAND_GREEN : '#D1D5DB' }}
                  onPress={handleCreateGroup}
                  disabled={!canCreate}
                >
                  {createLoading ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text className="text-white font-rubik-bold text-base">
                      {t('common.save')}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Add child nested bottom sheet */}
      <Modal
        visible={showAddChildSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAddChildSheet(false)}
      >
        <Pressable
          style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}
          onPress={() => setShowAddChildSheet(false)}
        >
          <Pressable>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
              <View className="bg-white rounded-t-2xl px-6 pt-4"
                    style={{ paddingBottom: insets.bottom + 16 }}>
                {/* Handle */}
                <View className="items-center mb-4">
                  <View className="w-10 bg-gray-300 rounded-full" style={{ height: 4 }} />
                </View>

                <Text className="text-xl font-rubik-bold text-brand-green-dark mb-6">
                  {t('children.add_child_title')}
                </Text>

                {childFormError && (
                  <Text className="text-red-500 text-sm mb-3 font-rubik">{childFormError}</Text>
                )}

                <Text className="text-sm font-rubik-semi text-gray-700 mb-1">{t('children.first_name')}</Text>
                <TextInput
                  className="border border-gray-300 rounded-xl px-4 py-3 mb-3 text-base font-rubik"
                  value={childFirstName}
                  onChangeText={setChildFirstName}
                  autoFocus
                  editable={!childFormLoading}
                />

                <Text className="text-sm font-rubik-semi text-gray-700 mb-1">{t('children.last_name')}</Text>
                <TextInput
                  className="border border-gray-300 rounded-xl px-4 py-3 mb-3 text-base font-rubik"
                  value={childLastName}
                  onChangeText={setChildLastName}
                  editable={!childFormLoading}
                />

                <Text className="text-sm font-rubik-semi text-gray-700 mb-1">{t('children.date_of_birth')}</Text>
                <TextInput
                  className="border border-gray-300 rounded-xl px-4 py-3 mb-6 text-base font-rubik"
                  value={childDob}
                  onChangeText={setChildDob}
                  placeholder={t('children.date_of_birth_hint')}
                  keyboardType="numeric"
                  editable={!childFormLoading}
                />

                <TouchableOpacity
                  className="rounded-xl py-4 items-center"
                  style={{ backgroundColor: BRAND_GREEN }}
                  onPress={handleAddChild}
                  disabled={childFormLoading}
                >
                  {childFormLoading ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text className="text-white font-rubik-bold text-base">{t('children.add_child')}</Text>
                  )}
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
