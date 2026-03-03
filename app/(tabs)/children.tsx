import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Switch,
  Alert,
  ActivityIndicator,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { getJoinToken } from '../../lib/auth';
import {
  getMyChildren,
  removeChild,
  setCoGuardianVisibility,
  type ChildRow,
  type CoGuardianInfo,
} from '../../lib/db/rpc';

const BRAND_GREEN = '#3D7A50';

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
    <View
      className="bg-white mx-4 mb-3 px-4 py-5"
      style={{ borderWidth: 1, borderColor: '#d9d9d9', borderRadius: 10 }}
    >
      {/* Name + age combined */}
      <Text className="text-lg font-rubik-medium text-black">
        {child.first_name} {child.last_name} ({t('children.years_old', { age: child.age_years })})
      </Text>

      {/* Groups / hint */}
      {child.groups.length > 0 ? (
        <Text className="text-sm font-rubik text-gray-500 mt-1">
          {child.groups.map((g) => g.name).join(', ')}
        </Text>
      ) : (
        <Text className="text-sm font-rubik text-gray-500 mt-1">
          {t('children.no_groups_hint')}
        </Text>
      )}

      {/* Co-guardians */}
      {child.co_guardians.length > 0 && (
        <View className="mt-3 pt-3 border-t border-gray-100">
          {child.co_guardians.map((cg: CoGuardianInfo) => (
            <View key={cg.guardian_id} className="flex-row justify-between items-center py-1.5">
              <Text className="text-sm font-rubik text-gray-700 flex-1">{cg.name}</Text>
              <View className="flex-row items-center gap-2">
                <Text className="text-xs font-rubik text-gray-400">{t('children.sees_checkins')}</Text>
                <Switch
                  value={cg.can_see_my_checkins}
                  onValueChange={(v) => onToggleVisibility(cg.guardian_id, v)}
                  trackColor={{ false: '#d1d5db', true: BRAND_GREEN }}
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
        <Text className="text-red-500 text-sm font-rubik">{t('children.remove_child')}</Text>
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
  const [children, setChildren]           = useState<ChildRow[]>([]);
  const [loading, setLoading]             = useState(true);
  const [pendingJoinToken, setPendingJoinToken] = useState<string | null>(null);

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

  // Reload whenever this screen comes into focus (e.g. returning from add-child)
  useFocusEffect(
    useCallback(() => {
      load();
      getJoinToken().then(setPendingJoinToken).catch(() => {});
    }, [load])
  );

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
      await load();
      Alert.alert(t('errors.generic'), e.message);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f1fdf5' }}>

      {/* App bar — same background as screen, tree first (→ right in RTL), menu on left */}
      <View style={{ backgroundColor: '#f1fdf5' }} className="px-6 py-3 flex-row justify-between items-center">
        <View className="flex-row items-center" style={{ gap: 4 }}>
          <Image source={require('../../assets/tree.png')} style={{ width: 26, height: 26 }} />
          <Text className="text-2xl font-rubik-semi text-black">{t('common.app_name')}</Text>
        </View>
        <TouchableOpacity hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="menu" size={24} color="black" />
        </TouchableOpacity>
      </View>

      {/* Title */}
      <View className="px-6 pt-5 pb-3">
        <Text className="text-3xl font-rubik-semi text-black">
          {t('onboarding.children_title')}
        </Text>
      </View>

      {pendingJoinToken && (
        <TouchableOpacity
          className="bg-green-50 border-b border-green-200 px-4 py-3 flex-row justify-between items-center"
          onPress={() => router.replace(`/join/${pendingJoinToken}`)}
        >
          <Text className="text-green-800 text-sm font-rubik-medium">{t('children.back_to_join')}</Text>
          <Text style={{ color: BRAND_GREEN }} className="text-sm">→</Text>
        </TouchableOpacity>
      )}

      {loading ? (
        <ActivityIndicator size="large" color={BRAND_GREEN} style={{ marginTop: 48 }} />
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
              <Text className="text-xl font-rubik-semi text-black text-center mt-8">
                {t('children.empty_title')}
              </Text>
              <Text className="text-base font-rubik text-black text-center mt-3 w-56">
                {t('children.empty_subtitle')}
              </Text>
              <TouchableOpacity
                style={{ backgroundColor: BRAND_GREEN }}
                className="mt-10 rounded-lg px-10 py-3 items-center"
                onPress={() => router.push('/add-child')}
              >
                <Text className="text-white font-rubik-semi text-base">{t('children.add_children_cta')}</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}

      {/* FAB — home icon */}
      <TouchableOpacity
        onPress={() => router.push('/(tabs)')}
        style={{
          position: 'absolute',
          bottom: 80,
          left: 20,
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: 'white',
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.3,
          shadowRadius: 8,
          elevation: 8,
        }}
      >
        <Ionicons name="home-outline" size={24} color={BRAND_GREEN} />
      </TouchableOpacity>

    </SafeAreaView>
  );
}
