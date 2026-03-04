import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  Image,
  FlatList,
  TouchableOpacity,
  ScrollView,
  AppState,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as Notifications from 'expo-notifications';
import { useAuth } from '../../contexts/AuthContext';
import { registerForPushNotifications } from '../../lib/notifications';
import {
  getMyGroups,
  getGroupActiveCheckins,
  getMyActiveCheckin,
  getMyChildren,
  getMyProfile,
  respondStillThere,
  leaveCheckin,
  type GroupRow,
  type HomeFeedItem,
  type HomeNamedChild,
  type ActiveCheckinResult,
} from '../../lib/db/rpc';

const BTN_SHADOW = {
  shadowColor: '#3D7A50',
  shadowOffset: { width: 0, height: 3 },
  shadowOpacity: 0.28,
  shadowRadius: 7,
  elevation: 6,
};

const POLL_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// Active session card — shown when user is currently checked in
// ---------------------------------------------------------------------------
function ActiveSessionCard({
  active,
  onSwitchPlayground,
  onEndVisit,
}: {
  active: NonNullable<ActiveCheckinResult>;
  onSwitchPlayground: () => void;
  onEndVisit: () => void;
}) {
  const { t } = useTranslation();
  const [elapsed, setElapsed] = useState('');

  // Live duration counter
  useEffect(() => {
    function update() {
      const ms  = Date.now() - new Date(active.checked_in_at).getTime();
      const min = Math.floor(ms / 60000);
      const hr  = Math.floor(min / 60);
      setElapsed(hr > 0 ? `${hr}ש ${min % 60}ד` : `${min}ד`);
    }
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, [active.checked_in_at]);

  return (
    <View
      className="mx-4 mb-3 bg-white rounded-xl overflow-hidden"
      style={{ borderWidth: 1, borderColor: '#e5ddd5', borderTopWidth: 3, borderTopColor: '#E07B30' }}
    >
      <View className="p-4">
        <Text className="text-base font-rubik-bold text-gray-900 mb-1">
          {active.child_names.join(', ')} ב{active.playground_name}
        </Text>
        <Text className="text-sm font-rubik text-gray-400 mb-3">{elapsed}</Text>
        <View className="flex-row gap-2">
          <TouchableOpacity
            className="flex-1 rounded-lg py-3 items-center"
            style={{ backgroundColor: '#3D7A50' }}
            onPress={onSwitchPlayground}
          >
            <Text className="text-white text-sm font-rubik-bold">
              {t('home.switch_playground')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="flex-1 rounded-lg py-3 items-center bg-white"
            style={{ borderWidth: 1.5, borderColor: '#3D7A50' }}
            onPress={onEndVisit}
          >
            <Text className="text-sm font-rubik-bold" style={{ color: '#3D7A50' }}>
              {t('home.end_visit')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// SiblingGroup: one guardian's children at a playground
// ---------------------------------------------------------------------------
function SiblingGroup({
  checkins,
  isOwn,
  playgroundName,
  onStillHere,
  onLeave,
}: {
  checkins: HomeNamedChild[];
  isOwn: boolean;
  playgroundName: string;
  onStillHere: (ids: string[]) => void;
  onLeave: (ids: string[], playgroundName: string) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const first = checkins[0];
  const rest  = checkins.slice(1);

  return (
    <View className="mt-2">
      <View className="flex-row items-center justify-between">
        <View>
          <Text className="text-sm font-medium text-gray-800">
            {first.first_name} {first.last_name}
            <Text className="text-gray-400 font-normal">
              {' · '}{t('children.years_old', { age: first.age_years })}
            </Text>
          </Text>

          {rest.length > 0 && (
            <TouchableOpacity onPress={() => setExpanded((e) => !e)}>
              <Text className="text-xs text-green-600 mt-0.5">
                {expanded
                  ? t('home.collapse_siblings')
                  : t('children.siblings_collapsed', { count: rest.length })}
              </Text>
            </TouchableOpacity>
          )}

          {expanded && rest.map((c) => (
            <Text key={c.child_id} className="text-sm text-gray-600 mt-0.5 pl-2">
              {c.first_name} {c.last_name} · {t('children.years_old', { age: c.age_years })}
            </Text>
          ))}
        </View>

        {isOwn && (
          <View className="flex-row gap-2">
            <TouchableOpacity
              className="border border-green-500 rounded-lg px-2 py-1"
              onPress={() => onStillHere(checkins.map((c) => c.check_in_id))}
            >
              <Text className="text-green-600 text-xs">{t('checkin.still_there')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="border border-red-300 rounded-lg px-2 py-1"
              onPress={() => onLeave(checkins.map((c) => c.check_in_id), playgroundName)}
            >
              <Text className="text-red-500 text-xs">{t('checkin.leaving')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// PlaygroundCard
// ---------------------------------------------------------------------------
function PlaygroundCard({
  item,
  currentUserId,
  onAction,
  onPress,
}: {
  item: HomeFeedItem;
  currentUserId: string;
  onAction: () => void;
  onPress: () => void;
}) {
  const { t } = useTranslation();

  // Group named check-ins by posted_by (siblings share a guardian)
  const byGuardian = useMemo(() => {
    const map = new Map<string, HomeNamedChild[]>();
    for (const c of item.named) {
      if (!map.has(c.posted_by)) map.set(c.posted_by, []);
      map.get(c.posted_by)!.push(c);
    }
    return map;
  }, [item.named]);

  async function handleStillHere(checkInIds: string[]) {
    try {
      await Promise.allSettled(checkInIds.map((id) => respondStillThere(id)));
      onAction();
    } catch (e: any) {
      Alert.alert(t('errors.generic'), e.message);
    }
  }

  function handleLeave(checkInIds: string[], playgroundName: string) {
    Alert.alert(
      t('checkin.leaving_confirm', { name: playgroundName }),
      '',
      [
        { text: t('home.confirm_end_visit_no'), style: 'cancel' },
        {
          text: t('home.confirm_end_visit_yes'),
          style: 'destructive',
          onPress: async () => {
            const results = await Promise.allSettled(checkInIds.map((id) => leaveCheckin(id)));
            const failed = results.filter((r) => r.status === 'rejected');
            if (failed.length > 0) {
              console.warn('[home] some leaveCheckin calls failed', failed);
            }
            onAction();
          },
        },
      ]
    );
  }

  return (
    <TouchableOpacity
      className="bg-white rounded-xl mx-4 mb-3 p-4 shadow-sm border border-gray-100"
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Text className="text-base font-bold text-gray-900 mb-1">
        🌳 {item.playground_name}
      </Text>

      {/* Named children grouped by guardian (siblings) */}
      {[...byGuardian.entries()].map(([guardianId, checkins]) => (
        <SiblingGroup
          key={guardianId}
          checkins={checkins}
          isOwn={guardianId === currentUserId}
          playgroundName={item.playground_name}
          onStillHere={handleStillHere}
          onLeave={handleLeave}
        />
      ))}

      {/* Anonymous ages */}
      {item.anonymous_ages.map((age, i) => (
        <Text key={i} className="text-sm text-gray-400 mt-1">
          {t('home.anonymous_age', { age })}
        </Text>
      ))}
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Home Screen
// ---------------------------------------------------------------------------
export default function HomeScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const router = useRouter();

  const [groups, setGroups]               = useState<GroupRow[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [feed, setFeed]                   = useState<HomeFeedItem[]>([]);
  const [activeCheckin, setActiveCheckin] = useState<ActiveCheckinResult>(null);
  const [hasChildren, setHasChildren]     = useState(false);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [feedLoading, setFeedLoading]     = useState(false);
  const [notifStatus, setNotifStatus]     = useState<string | null>(null);
  const [notifBannerDismissed, setNotifBannerDismissed] = useState(false);
  const [profileName, setProfileName]     = useState('');
  const [menuOpen, setMenuOpen]           = useState(false);
  const insets = useSafeAreaInsets();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load groups + active checkin + children on mount ─────────────────────
  useEffect(() => {
    if (!user) return;
    Promise.all([
      getMyGroups(),
      getMyActiveCheckin(),
      getMyChildren(),
      getMyProfile(),
    ])
      .then(([groupsData, active, children, profile]) => {
        setGroups(groupsData);
        setActiveCheckin(active);
        setHasChildren(children.length > 0);
        setProfileName(profile?.name?.split(' ')[0] ?? '');
        if (groupsData.length > 0) setSelectedGroupId(groupsData[0].id);
      })
      .catch(console.error)
      .finally(() => setGroupsLoading(false));

    // Check notification permission
    Notifications.getPermissionsAsync()
      .then(({ status }) => setNotifStatus(status))
      .catch(() => {});
  }, [user]);

  // ── Re-fetch groups + active check-in on tab focus ───────────────────────
  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      Promise.all([getMyGroups(), getMyActiveCheckin()])
        .then(([groupsData, active]) => {
          setGroups(groupsData);
          setActiveCheckin(active);
          setSelectedGroupId(prev => {
            // Keep current selection if still valid; otherwise pick first available
            if (prev && groupsData.some(g => g.id === prev)) return prev;
            return groupsData.length > 0 ? groupsData[0].id : null;
          });
        })
        .catch(console.error);
    }, [user])
  );

  // ── Poll feed + active checkin (30s, AppState-aware) ─────────────────────
  const poll = useCallback(async () => {
    if (!selectedGroupId) return;
    try {
      const [data, active] = await Promise.all([
        getGroupActiveCheckins(selectedGroupId),
        getMyActiveCheckin(),
      ]);
      setFeed(data);
      setActiveCheckin(active);
    } catch (e) {
      console.error('[home] poll error', e);
    } finally {
      setFeedLoading(false);
    }
  }, [selectedGroupId]);

  useEffect(() => {
    if (!selectedGroupId) return;
    setFeedLoading(true);

    const start = () => {
      if (intervalRef.current) return;
      poll();
      intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);
    };

    const stop = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    start();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') start();
      else stop();
    });

    return () => {
      stop();
      sub.remove();
    };
  }, [poll]);

  // ── End visit ─────────────────────────────────────────────────────────────
  function handleEndVisit() {
    if (!activeCheckin) return;
    Alert.alert(
      t('home.confirm_end_visit', { name: activeCheckin.playground_name }),
      '',
      [
        { text: t('home.confirm_end_visit_no'), style: 'cancel' },
        {
          text: t('home.confirm_end_visit_yes'),
          style: 'destructive',
          onPress: async () => {
            await Promise.allSettled(activeCheckin.check_in_ids.map((id) => leaveCheckin(id)));
            setActiveCheckin(null);
            poll();
          },
        },
      ]
    );
  }

  // ── Switch playground (go to check-in step 2 with same children) ──────────
  function handleSwitchPlayground() {
    if (!activeCheckin) return;
    const childParam = activeCheckin.child_ids.join(',');
    router.push(`/checkin?step=playground&childIds=${childParam}`);
  }

  // ── Notification banner CTA ───────────────────────────────────────────────
  async function handleNotifCta() {
    if (notifStatus === 'denied') {
      Linking.openSettings();
    } else {
      await registerForPushNotifications();
      const { status } = await Notifications.getPermissionsAsync();
      setNotifStatus(status);
      if (status === 'granted') setNotifBannerDismissed(true);
    }
  }

  // ── Derived state ─────────────────────────────────────────────────────────
  const hasGroups   = groups.length > 0;
  const isOnboarded = hasGroups && hasChildren;

  // ── Render: loading ───────────────────────────────────────────────────────
  if (groupsLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#f1fdf5', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color="#3D7A50" />
      </SafeAreaView>
    );
  }

  const selectedGroup = groups.find((g) => g.id === selectedGroupId);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f1fdf5' }}>
      {/* App bar — matches children tab: tree + name on right, menu on left (RTL) */}
      <View style={{ backgroundColor: '#f1fdf5' }} className="px-6 py-3 flex-row justify-between items-center">
        <View className="flex-row items-center" style={{ gap: 4 }}>
          <Image source={require('../../assets/tree.png')} style={{ width: 26, height: 26 }} />
          <Text className="text-2xl font-rubik-semi text-black">{t('common.app_name')}</Text>
        </View>
        <TouchableOpacity
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() => setMenuOpen((v) => !v)}
        >
          <Ionicons name="menu" size={24} color="black" />
        </TouchableOpacity>
      </View>

      {/* Group selector — shown only when multiple groups */}
      {groups.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ backgroundColor: '#f1fdf5' }}
          className="px-5 pb-2"
          contentContainerStyle={{ paddingHorizontal: 4, gap: 8 }}
        >
          {groups.map((g) => (
            <TouchableOpacity
              key={g.id}
              className={`px-3 py-1.5 rounded-full border ${
                g.id === selectedGroupId
                  ? 'border-green-600'
                  : 'border-gray-300 bg-white'
              }`}
              style={g.id === selectedGroupId ? { backgroundColor: '#3D7A50' } : {}}
              onPress={() => setSelectedGroupId(g.id)}
            >
              <Text
                className={`text-sm font-rubik-medium ${
                  g.id === selectedGroupId ? 'text-white' : 'text-gray-700'
                }`}
              >
                {g.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Notification permission banner — card style */}
      {notifStatus && notifStatus !== 'granted' && !notifBannerDismissed && (
        <View
          style={{
            marginHorizontal: 14,
            marginTop: 12,
            backgroundColor: '#F1FDF5',
            borderWidth: 1,
            borderColor: '#afafaf',
            borderRadius: 10,
            overflow: 'hidden',
          }}
        >
          <View className="flex-row items-start px-3 pt-2.5 pb-2" style={{ gap: 8 }}>
            <View className="flex-1">
              <Text className="text-sm font-rubik-medium text-gray-900 mb-1">
                {t('home.notif_banner_title')}
              </Text>
              <Text className="font-rubik text-gray-700" style={{ fontSize: 11, lineHeight: 16 }}>
                {t('home.notif_banner_body')}
              </Text>
            </View>
            <Image
              source={require('../../assets/message.png')}
              style={{ width: 30, height: 30, marginTop: 2 }}
              resizeMode="contain"
            />
          </View>
          <View style={{ height: 1, backgroundColor: '#afafaf' }} />
          <View className="flex-row justify-between items-center px-3.5 py-2.5">
            <TouchableOpacity onPress={() => setNotifBannerDismissed(true)}>
              <Text className="font-rubik-medium text-sm" style={{ color: '#767d8b' }}>
                {t('home.notif_banner_dismiss')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleNotifCta}>
              <Text className="font-rubik-medium text-sm" style={{ color: '#008234' }}>
                {t('home.notif_banner_cta')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Setup banner — Path B */}
      {!isOnboarded && (
        <TouchableOpacity
          className="mx-3.5 mb-2 rounded-xl px-4 py-3 flex-row justify-between items-center"
          style={{ backgroundColor: '#d1fae5', borderWidth: 1, borderColor: '#6ee7b7' }}
          onPress={() => {
            if (!hasChildren) router.push('/(tabs)/children');
            else router.push('/(tabs)/groups');
          }}
        >
          <Text className="text-green-800 text-sm font-rubik-medium flex-1 mr-2">
            {t('home.setup_banner')} — {!hasChildren
              ? t('home.setup_add_children')
              : t('home.setup_join_group')}
          </Text>
          <Text className="text-green-600 text-sm">→</Text>
        </TouchableOpacity>
      )}

      {/* Active session card */}
      {activeCheckin && (
        <View className="pt-3">
          <ActiveSessionCard
            active={activeCheckin}
            onSwitchPlayground={handleSwitchPlayground}
            onEndVisit={handleEndVisit}
          />
        </View>
      )}

      {/* No groups empty state */}
      {groups.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-gray-500 text-base text-center mb-6">{t('home.no_groups')}</Text>
          <TouchableOpacity
            className="bg-green-600 rounded-lg px-8 py-3"
            onPress={() => router.push('/(tabs)/groups')}
          >
            <Text className="text-white font-semibold">{t('groups.create')}</Text>
          </TouchableOpacity>
        </View>
      ) : feedLoading ? (
        <ActivityIndicator size="large" color="#16a34a" style={{ marginTop: 48 }} />
      ) : feed.length === 0 ? (
        /* Full-screen empty state */
        <View style={{ flex: 1 }}>
          {/* Greeting — left-aligned */}
          <View className="px-6 pt-5 items-start">
            {profileName ? (
              <Text className="text-2xl font-rubik-bold text-gray-900">
                {t('home.empty_greeting', { name: profileName })}
              </Text>
            ) : null}
            <Text className="font-rubik text-sm text-gray-400 mt-0.5">
              {t('home.empty_sub')}
            </Text>
          </View>

          {/* Illustration + title + CTA */}
          <View className="flex-1 items-center justify-center px-6" style={{ marginTop: -24 }}>
            <Image
              source={require('../../assets/playground.png')}
              style={{ width: 220, height: 220, marginBottom: 20 }}
              resizeMode="contain"
            />
            <Text className="text-xl font-rubik-bold text-gray-900 text-center mb-2">
              {t('home.empty_no_kids_title')}
            </Text>
            <Text className="font-rubik text-gray-500 text-center mb-8" style={{ fontSize: 14 }}>
              {t('home.empty_no_kids_sub')}
            </Text>
            {isOnboarded && (
              <TouchableOpacity
                className="w-full rounded-xl py-4 items-center"
                style={{ backgroundColor: '#3D7A50', ...BTN_SHADOW }}
                onPress={() => router.push('/checkin')}
              >
                <Text className="text-white font-rubik-bold text-base">
                  {t('home.empty_cta')}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      ) : (
        /* Feed with content */
        <FlatList
          data={feed}
          keyExtractor={(item) => item.playground_id}
          contentContainerStyle={{ paddingVertical: 12 }}
          renderItem={({ item }) => (
            <PlaygroundCard
              item={item}
              currentUserId={user?.id ?? ''}
              onAction={poll}
              onPress={() => router.push(`/playground/${item.playground_id}`)}
            />
          )}
        />
      )}
      {/* Hamburger dropdown menu */}
      {menuOpen && (
        <>
          {/* Backdrop */}
          <TouchableOpacity
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50 }}
            onPress={() => setMenuOpen(false)}
            activeOpacity={1}
          />

          {/* Dropdown card */}
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
              { labelKey: 'menu.my_children', icon: require('../../assets/Heart.png'),  route: '/(tabs)/children' },
              { labelKey: 'menu.my_groups',   icon: require('../../assets/groups.png'), route: '/(tabs)/groups'   },
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
                onPress={() => { setMenuOpen(false); router.push(route); }}
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
    </SafeAreaView>
  );
}
