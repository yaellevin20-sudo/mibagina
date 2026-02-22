import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { getMyChildren, getMyPlaygrounds, searchPlayground, createPlayground, postCheckin, type ChildRow, type PlaygroundRow } from '../../lib/db/rpc';
import { normalizePlaygroundName } from '../../lib/playground';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Step =
  | { name: 'pick_children' }
  | { name: 'pick_playground'; childIds: string[] }
  | { name: 'add_playground'; childIds: string[] }
  | { name: 'submitting' }
  | { name: 'success' };

// ---------------------------------------------------------------------------
// Check-in Screen
// ---------------------------------------------------------------------------
export default function CheckinScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const [step, setStep]                   = useState<Step>({ name: 'pick_children' });
  const [children, setChildren]           = useState<ChildRow[]>([]);
  const [playgrounds, setPlaygrounds]     = useState<PlaygroundRow[]>([]);
  const [selectedChildren, setSelectedChildren] = useState<Set<string>>(new Set());
  const [dataLoading, setDataLoading]     = useState(true);

  // Add playground form state
  const [playgroundInput, setPlaygroundInput] = useState('');
  const [playgroundBusy, setPlaygroundBusy]   = useState(false);

  // ── Load data ─────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setDataLoading(true);
    try {
      const [kids, parks] = await Promise.all([getMyChildren(), getMyPlaygrounds()]);
      setChildren(kids);
      setPlaygrounds(parks);
    } catch (e) {
      console.error('[checkin] load error', e);
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Child selection ───────────────────────────────────────────────────────
  function toggleChild(id: string) {
    setSelectedChildren((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function proceedToPlayground() {
    if (selectedChildren.size === 0) return;
    setStep({ name: 'pick_playground', childIds: [...selectedChildren] });
  }

  // ── Playground selection ──────────────────────────────────────────────────
  async function handleSelectPlayground(playgroundId: string, childIds: string[]) {
    setStep({ name: 'submitting' });
    try {
      await postCheckin(childIds, playgroundId);
      setStep({ name: 'success' });
    } catch (e: any) {
      Alert.alert(t('errors.generic'), e.message);
      setStep({ name: 'pick_playground', childIds });
    }
  }

  // ── Add new playground ────────────────────────────────────────────────────
  async function handleAddPlayground(childIds: string[]) {
    const raw = playgroundInput.trim();
    if (!raw) return;

    const normalized = normalizePlaygroundName(raw);
    if (!normalized) {
      Alert.alert(t('playground.name_too_generic'));
      return;
    }

    setPlaygroundBusy(true);
    try {
      // Search for existing playground with same normalized name
      const matches = await searchPlayground(normalized);

      let playgroundId: string;

      if (matches.length > 0) {
        // "Did you mean [name]?" — always confirm, never auto-merge
        const match = matches[0];
        const useExisting = await new Promise<boolean>((resolve) => {
          Alert.alert(
            t('playground.did_you_mean', { name: match.name }),
            '',
            [
              { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
              { text: t('common.confirm'), onPress: () => resolve(true) },
            ]
          );
        });

        if (useExisting) {
          playgroundId = match.id;
        } else {
          playgroundId = await createPlayground(raw, normalized);
        }
      } else {
        playgroundId = await createPlayground(raw, normalized);
      }

      // Reload playground list for future use
      getMyPlaygrounds().then(setPlaygrounds).catch(console.error);

      setStep({ name: 'submitting' });
      await postCheckin(childIds, playgroundId);
      setStep({ name: 'success' });
    } catch (e: any) {
      Alert.alert(t('errors.generic'), e.message);
    } finally {
      setPlaygroundBusy(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (dataLoading) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50 items-center justify-center">
        <ActivityIndicator size="large" color="#16a34a" />
      </SafeAreaView>
    );
  }

  if (step.name === 'submitting') {
    return (
      <SafeAreaView className="flex-1 bg-gray-50 items-center justify-center">
        <ActivityIndicator size="large" color="#16a34a" />
        <Text className="text-gray-500 text-sm mt-4">{t('checkin.submitting')}</Text>
      </SafeAreaView>
    );
  }

  if (step.name === 'success') {
    return (
      <SafeAreaView className="flex-1 bg-gray-50 items-center justify-center px-6">
        <Text className="text-3xl mb-2">✅</Text>
        <Text className="text-xl font-bold text-gray-900 mb-2">{t('checkin.success_title')}</Text>
        <Text className="text-gray-500 text-base text-center mb-8">{t('checkin.success_body')}</Text>
        <TouchableOpacity
          className="bg-green-600 rounded-lg px-8 py-3"
          onPress={() => router.replace('/(tabs)')}
        >
          <Text className="text-white font-semibold">{t('checkin.done')}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ── Step: pick children ───────────────────────────────────────────────────
  if (step.name === 'pick_children') {
    return (
      <SafeAreaView className="flex-1 bg-gray-50">
        <View className="flex-row justify-between items-center px-4 py-4 bg-white border-b border-gray-200">
          <TouchableOpacity onPress={() => router.back()}>
            <Text className="text-gray-500 text-base">{t('common.cancel')}</Text>
          </TouchableOpacity>
          <Text className="text-lg font-semibold">{t('checkin.select_children')}</Text>
          <View style={{ width: 56 }} />
        </View>

        {children.length === 0 ? (
          <View className="flex-1 items-center justify-center px-6">
            <Text className="text-gray-500 text-base text-center">{t('checkin.no_children')}</Text>
          </View>
        ) : (
          <>
            <FlatList
              data={children}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ padding: 16 }}
              renderItem={({ item }) => {
                const isSelected = selectedChildren.has(item.id);
                return (
                  <TouchableOpacity
                    className={`flex-row items-center bg-white rounded-xl p-4 mb-3 border shadow-sm ${
                      isSelected ? 'border-green-500' : 'border-gray-100'
                    }`}
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
                  selectedChildren.size === 0 ? 'bg-gray-200' : 'bg-green-600'
                }`}
                onPress={proceedToPlayground}
                disabled={selectedChildren.size === 0}
              >
                <Text
                  className={`font-semibold text-base ${
                    selectedChildren.size === 0 ? 'text-gray-400' : 'text-white'
                  }`}
                >
                  {t('checkin.next')}
                </Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </SafeAreaView>
    );
  }

  // ── Step: pick playground ─────────────────────────────────────────────────
  if (step.name === 'pick_playground') {
    const { childIds } = step;
    return (
      <SafeAreaView className="flex-1 bg-gray-50">
        <View className="flex-row justify-between items-center px-4 py-4 bg-white border-b border-gray-200">
          <TouchableOpacity onPress={() => setStep({ name: 'pick_children' })}>
            <Text className="text-gray-500 text-base">{t('common.back')}</Text>
          </TouchableOpacity>
          <Text className="text-lg font-semibold">{t('checkin.select_playground')}</Text>
          <View style={{ width: 56 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: 16 }}>
          {playgrounds.map((p) => (
            <TouchableOpacity
              key={p.id}
              className="bg-white rounded-xl p-4 mb-3 border border-gray-100 shadow-sm"
              onPress={() => handleSelectPlayground(p.id, childIds)}
            >
              <Text className="text-base font-semibold text-gray-900">{p.name}</Text>
            </TouchableOpacity>
          ))}

          {/* Add new playground */}
          <TouchableOpacity
            className="border-2 border-dashed border-green-400 rounded-xl p-4 mb-3 items-center"
            onPress={() => {
              setPlaygroundInput('');
              setStep({ name: 'add_playground', childIds });
            }}
          >
            <Text className="text-green-600 font-semibold">{t('checkin.add_playground')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Step: add playground ──────────────────────────────────────────────────
  if (step.name === 'add_playground') {
    const { childIds } = step;
    return (
      <SafeAreaView className="flex-1 bg-gray-50">
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View className="flex-row justify-between items-center px-4 py-4 bg-white border-b border-gray-200">
            <TouchableOpacity
              onPress={() => setStep({ name: 'pick_playground', childIds })}
              disabled={playgroundBusy}
            >
              <Text className="text-gray-500 text-base">{t('common.back')}</Text>
            </TouchableOpacity>
            <Text className="text-lg font-semibold">{t('checkin.add_playground')}</Text>
            <View style={{ width: 56 }} />
          </View>

          <View className="px-4 pt-6">
            <Text className="text-sm font-medium text-gray-700 mb-2">
              {t('checkin.playground_name_label')}
            </Text>
            <TextInput
              className="border border-gray-300 rounded-lg px-4 py-3 mb-6 text-base bg-white"
              value={playgroundInput}
              onChangeText={setPlaygroundInput}
              placeholder={t('checkin.playground_name_placeholder')}
              autoFocus
              editable={!playgroundBusy}
              returnKeyType="done"
              onSubmitEditing={() => handleAddPlayground(childIds)}
            />

            <TouchableOpacity
              className={`rounded-lg py-4 items-center ${
                !playgroundInput.trim() || playgroundBusy ? 'bg-gray-200' : 'bg-green-600'
              }`}
              onPress={() => handleAddPlayground(childIds)}
              disabled={!playgroundInput.trim() || playgroundBusy}
            >
              {playgroundBusy ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text
                  className={`font-semibold text-base ${
                    !playgroundInput.trim() ? 'text-gray-400' : 'text-white'
                  }`}
                >
                  {t('checkin.submit')}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return null;
}
