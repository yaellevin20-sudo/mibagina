import { useState, useEffect } from 'react';
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
import { getMyChildren, addChild, type ChildRow } from '../../lib/db/rpc';
import OnboardingProgress from '../../components/OnboardingProgress';

const BRAND_GREEN = '#3D7A50';
const BRAND_GREEN_SOFT = '#E4F2EA';

export default function ChildrenOnboardingScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [children, setChildren] = useState<ChildRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSheet, setShowSheet] = useState(false);

  // Add child form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dob, setDob] = useState('');
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    getMyChildren()
      .then(setChildren)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  function openSheet() {
    setFirstName('');
    setLastName('');
    setDob('');
    setFormError(null);
    setShowSheet(true);
  }

  async function handleAddChild() {
    const f = firstName.trim();
    const l = lastName.trim();
    const d = dob.trim();
    if (!f || !l || !d) { setFormError(t('errors.generic')); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { setFormError(t('children.date_of_birth_hint')); return; }
    if (new Date(d) > new Date()) { setFormError(t('errors.generic')); return; }

    setFormError(null);
    setFormLoading(true);
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
      setShowSheet(false);
    } catch (e: any) {
      setFormError(e.message ?? t('errors.generic'));
    } finally {
      setFormLoading(false);
    }
  }

  function handleContinue() {
    router.replace('/(auth)/groups-onboard');
  }

  function handleSkip() {
    router.replace('/(auth)/groups-onboard');
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      {/* Main content */}
      <View className="flex-1 px-6">
        {/* Back button */}
        <TouchableOpacity className="pt-4 pb-2" onPress={() => router.back()}>
          <Text className="font-rubik text-sm text-gray-500">{t('nav.back')}</Text>
        </TouchableOpacity>

        {/* Progress bar */}
        <View className="pt-4">
          <OnboardingProgress steps={4} current={2} />
        </View>

        {/* Header row */}
        <View className="flex-row justify-between items-center mb-1">
          <Text className="text-2xl font-rubik-bold text-brand-green-dark">
            {t('onboarding.children_title')}
          </Text>
          <TouchableOpacity onPress={handleSkip}>
            <Text className="font-rubik text-sm text-gray-400">{t('onboarding.skip')}</Text>
          </TouchableOpacity>
        </View>
        <Text className="font-rubik text-gray-500 mb-6">{t('onboarding.children_subtitle')}</Text>

        {loading ? (
          <ActivityIndicator size="large" color={BRAND_GREEN} style={{ marginTop: 48 }} />
        ) : children.length === 0 ? (
          /* Empty state */
          <View className="flex-1 items-center justify-center">
            <Image
              source={require('../../assets/kite.png')}
              style={{ width: 120, height: 120, marginBottom: 20 }}
              resizeMode="contain"
            />
            <Text className="text-lg font-rubik-semi text-gray-700 mb-2 text-center">
              {t('onboarding.children_empty')}
            </Text>
            <Text className="font-rubik text-gray-400 text-center mb-8">
              {t('onboarding.children_subtitle')}
            </Text>
            <TouchableOpacity
              className="rounded-xl py-3 px-8 items-center"
              style={{ backgroundColor: BRAND_GREEN_SOFT }}
              onPress={openSheet}
            >
              <Text className="font-rubik-semi text-base" style={{ color: BRAND_GREEN }}>
                {t('onboarding.add_child_cta')}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          /* Children list */
          <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
            {children.map((child) => (
              <View
                key={child.id}
                className="flex-row items-center px-4 py-3 rounded-xl mb-2"
                style={{ backgroundColor: BRAND_GREEN_SOFT }}
              >
                <Text className="font-rubik-semi text-base flex-1" style={{ color: BRAND_GREEN }}>
                  {child.first_name} {child.last_name}
                </Text>
                <Text className="font-rubik text-sm text-gray-500">
                  {t('children.years_old', { age: child.age_years })}
                </Text>
              </View>
            ))}

            <TouchableOpacity
              className="rounded-xl py-3 items-center mt-2"
              style={{ borderWidth: 1, borderColor: BRAND_GREEN }}
              onPress={openSheet}
            >
              <Text className="font-rubik-semi text-base" style={{ color: BRAND_GREEN }}>
                + {t('onboarding.add_child_cta')}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        )}
      </View>

      {/* Continue button — visible when children exist */}
      {children.length > 0 && (
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

      {/* Add child bottom sheet */}
      <Modal
        visible={showSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSheet(false)}
      >
        <Pressable
          style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}
          onPress={() => setShowSheet(false)}
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

                {formError && (
                  <Text className="text-red-500 text-sm mb-3 font-rubik">{formError}</Text>
                )}

                <Text className="text-sm font-rubik-semi text-gray-700 mb-1">{t('children.first_name')}</Text>
                <TextInput
                  className="border border-gray-300 rounded-xl px-4 py-3 mb-3 text-base font-rubik"
                  value={firstName}
                  onChangeText={setFirstName}
                  autoFocus
                  editable={!formLoading}
                />

                <Text className="text-sm font-rubik-semi text-gray-700 mb-1">{t('children.last_name')}</Text>
                <TextInput
                  className="border border-gray-300 rounded-xl px-4 py-3 mb-3 text-base font-rubik"
                  value={lastName}
                  onChangeText={setLastName}
                  editable={!formLoading}
                />

                <Text className="text-sm font-rubik-semi text-gray-700 mb-1">{t('children.date_of_birth')}</Text>
                <TextInput
                  className="border border-gray-300 rounded-xl px-4 py-3 mb-6 text-base font-rubik"
                  value={dob}
                  onChangeText={setDob}
                  placeholder={t('children.date_of_birth_hint')}
                  keyboardType="numeric"
                  editable={!formLoading}
                />

                <TouchableOpacity
                  className="rounded-xl py-4 items-center"
                  style={{ backgroundColor: BRAND_GREEN }}
                  onPress={handleAddChild}
                  disabled={formLoading}
                >
                  {formLoading ? (
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
