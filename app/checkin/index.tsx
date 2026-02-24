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
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { getMyChildren, getMyPlaygrounds, searchPlayground, createPlayground, postCheckin, type ChildRow, type PlaygroundRow } from '../../lib/db/rpc';
import { normalizePlaygroundName } from '../../lib/playground';
import { enqueueGroupNotification } from '../../lib/notifications';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Step =
  | { name: 'pick_children' }
  | { name: 'pick_playground'; childIds: string[] }
  | { name: 'submitting' }
  | { name: 'success' };

// ---------------------------------------------------------------------------
// Check-in Screen
// ---------------------------------------------------------------------------
export default function CheckinScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  // URL params for "Switch playground" flow:
  //   step=playground   → skip child selection, go directly to playground step
  //   childIds=id1,id2  → pre-selected child IDs
  const { step: stepParam, childIds: childIdsParam } = useLocalSearchParams<{
    step?: string;
    childIds?: string;
  }>();

  const [children, setChildren]                 = useState<ChildRow[]>([]);
  const [playgrounds, setPlaygrounds]           = useState<PlaygroundRow[]>([]);
  const [selectedChildren, setSelectedChildren] = useState<Set<string>>(new Set());
  const [dataLoading, setDataLoading]           = useState(true);

  // Playground search state
  const [searchQuery, setSearchQuery]       = useState('');
  const [searchResults, setSearchResults]   = useState<PlaygroundRow[]>([]);
  const [searching, setSearching]           = useState(false);
  const [creating, setCreating]             = useState(false);

  // Determine initial step from URL params
  const [step, setStep] = useState<Step>(() => {
    if (stepParam === 'playground' && childIdsParam) {
      return { name: 'pick_playground', childIds: childIdsParam.split(',').filter(Boolean) };
    }
    return { name: 'pick_children' };
  });

  // ── Load data ─────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setDataLoading(true);
    try {
      const [kids, parks] = await Promise.all([getMyChildren(), getMyPlaygrounds()]);
      setChildren(kids);
      setPlaygrounds(parks);
      // Pre-select children from URL params
      if (childIdsParam) {
        const ids = childIdsParam.split(',').filter(Boolean);
        setSelectedChildren(new Set(ids));
      }
    } catch (e) {
      console.error('[checkin] load error', e);
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Reset search when entering pick_playground
  useEffect(() => {
    if (step.name === 'pick_playground') {
      setSearchQuery('');
      setSearchResults([]);
      setSearching(false);
    }
  }, [step.name]);

  // Debounced playground search
  useEffect(() => {
    if (step.name !== 'pick_playground' || !searchQuery.trim()) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    const normalized = normalizePlaygroundName(searchQuery.trim());
    if (!normalized) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const results = await searchPlayground(normalized);
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, step.name]);

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
      enqueueGroupNotification(playgroundId); // fire-and-forget — non-blocking
      setStep({ name: 'success' });
    } catch (e: any) {
      Alert.alert(t('errors.generic'), e.message);
      setStep({ name: 'pick_playground', childIds });
    }
  }

  // ── Create and check in to a new playground ───────────────────────────────
  // Called when user taps "Add [name] as new playground" from search results.
  // By the time we get here, we've already searched and found no matches,
  // so no "did you mean" prompt is needed.
  async function handleCreatePlayground(name: string, childIds: string[]) {
    const raw = name.trim();
    if (!raw) return;

    const normalized = normalizePlaygroundName(raw);
    if (!normalized) {
      Alert.alert(t('playground.name_too_generic'));
      return;
    }

    setCreating(true);
    try {
      const playgroundId = await createPlayground(raw, normalized);
      // Refresh playground list for future use
      getMyPlaygrounds().then(setPlaygrounds).catch(console.error);
      setStep({ name: 'submitting' });
      await postCheckin(childIds, playgroundId);
      enqueueGroupNotification(playgroundId); // fire-and-forget — non-blocking
      setStep({ name: 'success' });
    } catch (e: any) {
      Alert.alert(t('errors.generic'), e.message);
    } finally {
      setCreating(false);
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

  // ── Step: pick playground (with search) ───────────────────────────────────
  if (step.name === 'pick_playground') {
    const { childIds } = step;
    const trimmed      = searchQuery.trim();
    const normalized   = trimmed ? normalizePlaygroundName(trimmed) : '';
    const showAddNew   = trimmed.length > 0 && normalized.length > 0 && !searching && searchResults.length === 0;

    return (
      <SafeAreaView className="flex-1 bg-gray-50">
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* Header */}
          <View className="flex-row justify-between items-center px-4 py-4 bg-white border-b border-gray-200">
            <TouchableOpacity
              onPress={() => {
                // If launched with URL params (switch playground), go back to home instead
                if (stepParam === 'playground') {
                  router.back();
                } else {
                  setStep({ name: 'pick_children' });
                }
              }}
              disabled={creating}
            >
              <Text className="text-gray-500 text-base">{t('common.back')}</Text>
            </TouchableOpacity>
            <Text className="text-lg font-semibold">{t('checkin.select_playground')}</Text>
            <View style={{ width: 56 }} />
          </View>

          {/* Search input */}
          <View className="px-4 py-3 bg-white border-b border-gray-100">
            <TextInput
              className="bg-gray-100 rounded-lg px-4 py-2.5 text-base text-gray-900"
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={t('checkin.search_placeholder')}
              autoCapitalize="none"
              returnKeyType="search"
              editable={!creating}
            />
          </View>

          <ScrollView
            className="flex-1"
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingVertical: 12 }}
          >
            {/* Searching indicator */}
            {searching && (
              <ActivityIndicator color="#16a34a" style={{ marginTop: 16 }} />
            )}

            {/* Search results */}
            {!searching && trimmed.length > 0 && searchResults.map((p) => (
              <TouchableOpacity
                key={p.id}
                className="bg-white rounded-xl mx-4 mb-2 p-4 border border-gray-100 shadow-sm"
                onPress={() => handleSelectPlayground(p.id, childIds)}
                disabled={creating}
              >
                <Text className="text-base font-semibold text-gray-900">{p.name}</Text>
              </TouchableOpacity>
            ))}

            {/* "Add as new playground" option */}
            {showAddNew && (
              <TouchableOpacity
                className="bg-white rounded-xl mx-4 mb-2 p-4 border border-dashed border-green-400"
                onPress={() => handleCreatePlayground(trimmed, childIds)}
                disabled={creating}
              >
                {creating ? (
                  <ActivityIndicator color="#16a34a" />
                ) : (
                  <Text className="text-green-700 text-base font-medium">
                    {t('checkin.add_new_with_name', { name: trimmed })}
                  </Text>
                )}
              </TouchableOpacity>
            )}

            {/* Recent playgrounds (shown when search is empty) */}
            {trimmed.length === 0 && playgrounds.map((p) => (
              <TouchableOpacity
                key={p.id}
                className="bg-white rounded-xl mx-4 mb-2 p-4 border border-gray-100 shadow-sm"
                onPress={() => handleSelectPlayground(p.id, childIds)}
                disabled={creating}
              >
                <Text className="text-base font-semibold text-gray-900">{p.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return null;
}
