import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  Image,
  FlatList,
  TouchableOpacity,
  AppState,
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  TextInput,
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
  leaveCheckin,
  getMyPlaygrounds,
  postCheckin,
  createPlayground,
  type GroupRow,
  type HomeFeedItem,
  type HomeNamedChild,
  type ActiveCheckinResult,
  type PlaygroundRow,
} from '../../lib/db/rpc';

const BTN_SHADOW = {
  shadowColor: '#3D7A50',
  shadowOffset: { width: 0, height: 3 },
  shadowOpacity: 0.28,
  shadowRadius: 7,
  elevation: 6,
};

const POLL_INTERVAL_MS = 30_000;

function timeAgo(ts: string): string {
  const min = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (min < 1) return 'עכשיו';
  if (min < 60) return `לפני ${min} דק'`;
  const hr = Math.floor(min / 60);
  const rem = min % 60;
  if (hr === 1) return rem > 0 ? `לפני שעה ו-${rem} דק'` : 'לפני שעה';
  return `לפני ${hr} שעות`;
}

type GroupedFeedItem = HomeFeedItem & {
  group_id: string;
  group_name: string;
  group_emoji: string | null;
};

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
    function update() { setElapsed(timeAgo(active.checked_in_at)); }
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
        <Text style={{ fontSize: 17, fontWeight: '600', color: '#1a1a1a', lineHeight: 24, marginBottom: 6 }}>
          {active.child_names.join(', ')} ב{active.playground_name}
        </Text>
        <Text style={{ fontSize: 14, color: '#767d8b', marginBottom: 14 }}>{elapsed}</Text>
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
// FamilyRow: one guardian's children within a playground card
// ---------------------------------------------------------------------------
function FamilyRow({
  checkins,
  isLast,
}: {
  checkins: HomeNamedChild[];
  isLast: boolean;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const first = checkins[0];
  const isMultiple = checkins.length > 1;

  const nameLabel = isMultiple
    ? `משפחת ${first.last_name} (${checkins.length} ילדים)`
    : `${first.first_name} ${first.last_name} (${t('children.years_old', { age: first.age_years })})`;

  return (
    <View style={{ borderBottomWidth: isLast ? 0 : 1, borderBottomColor: '#f8f8f8' }}>
      <TouchableOpacity
        onPress={isMultiple ? () => setExpanded((e) => !e) : undefined}
        activeOpacity={isMultiple ? 0.7 : 1}
        style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 8 }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: '500', color: '#1a1a1a', marginBottom: 2 }}>
            {nameLabel}
          </Text>
          <Text style={{ fontSize: 12, color: '#9ca3af' }}>{timeAgo(first.checked_in_at)}</Text>
        </View>
        {isMultiple && (
          <View style={{ width: 20, height: 20, backgroundColor: '#f3f4f6', borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
            <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={11} color="#9ca3af" />
          </View>
        )}
      </TouchableOpacity>

      {isMultiple && expanded && (
        <View style={{ paddingRight: 4, paddingBottom: 8 }}>
          {checkins.map((c) => (
            <Text key={c.child_id} style={{ fontSize: 13, color: '#374151', lineHeight: 22 }}>
              <Text style={{ fontWeight: '600' }}>{c.first_name}</Text>
              <Text style={{ color: '#9ca3af' }}> ({t('children.years_old', { age: c.age_years })})</Text>
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// PlaygroundSection — one playground sub-section within a group card
// ---------------------------------------------------------------------------
function PlaygroundSection({ item, isLast }: { item: GroupedFeedItem; isLast: boolean }) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);

  const byGuardian = useMemo(() => {
    const map = new Map<string, HomeNamedChild[]>();
    for (const c of item.named) {
      if (!map.has(c.posted_by)) map.set(c.posted_by, []);
      map.get(c.posted_by)!.push(c);
    }
    return map;
  }, [item.named]);

  const childCount = item.named.length + item.anonymous_ages.length;
  const childLabel = childCount === 1 ? 'ילד אחד' : `${childCount} ילדים`;
  const guardianEntries = [...byGuardian.entries()];

  return (
    <View style={{ borderBottomWidth: isLast ? 0 : 1, borderBottomColor: '#f0f0f0' }}>
      {/* Playground header */}
      <TouchableOpacity
        onPress={() => setCollapsed((c) => !c)}
        activeOpacity={0.7}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 }}
      >
        <Text style={{ fontSize: 13, opacity: 0.7 }}>📍</Text>
        <Text style={{ fontSize: 13, fontWeight: '600', color: '#3D7A50', flexShrink: 0 }}>
          {item.playground_name}
        </Text>
        <View style={{ backgroundColor: '#f3f4f6', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, flexShrink: 0 }}>
          <Text style={{ fontSize: 11, fontWeight: '500', color: '#767d8b' }}>{childLabel}</Text>
        </View>
        <View style={{ flex: 1 }} />
        <View style={{ width: 20, height: 20, backgroundColor: '#f3f4f6', borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={collapsed ? 'chevron-down' : 'chevron-up'} size={10} color="#9ca3af" />
        </View>
      </TouchableOpacity>

      {/* Children list */}
      {!collapsed && (
        <View style={{ paddingHorizontal: 16 }}>
          {guardianEntries.map(([guardianId, checkins], idx) => (
            <FamilyRow
              key={guardianId}
              checkins={checkins}
              isLast={idx === guardianEntries.length - 1 && item.anonymous_ages.length === 0}
            />
          ))}
          {item.anonymous_ages.map((age, i) => (
            <Text
              key={i}
              style={{
                fontSize: 12, color: '#767d8b', paddingVertical: 8,
                borderTopWidth: i === 0 && guardianEntries.length > 0 ? 1 : 0,
                borderTopColor: '#f3f4f6',
              }}
            >
              {t('home.anonymous_age', { age })}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// GroupCard — one collapsible card per group, with playground sub-sections
// ---------------------------------------------------------------------------
type GroupFeedData = {
  group_id: string;
  group_name: string;
  group_emoji: string | null;
  items: GroupedFeedItem[];
};

function GroupCard({ group }: { group: GroupFeedData }) {
  const [collapsed, setCollapsed] = useState(false);

  const totalChildren = group.items.reduce(
    (sum, item) => sum + item.named.length + item.anonymous_ages.length, 0
  );
  const childLabel = totalChildren === 1 ? 'ילד אחד בגינה' : `${totalChildren} ילדים בגינה`;

  return (
    <View style={{ backgroundColor: 'white', borderWidth: 1, borderColor: '#d9d9d9', borderRadius: 14, marginHorizontal: 16, marginBottom: 10, overflow: 'hidden' }}>
      {/* Card header */}
      <TouchableOpacity
        onPress={() => setCollapsed((c) => !c)}
        activeOpacity={0.7}
        style={{ flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10, minHeight: 68 }}
      >
        <View style={{ width: 36, height: 36, backgroundColor: '#fef7ff', borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 18 }}>{group.group_emoji ?? '🌳'}</Text>
        </View>
        <Text style={{ flex: 1, fontSize: 17, fontWeight: '500', color: '#1a1a1a' }}>
          {group.group_name} · {childLabel}
        </Text>
        <View style={{ width: 30, height: 30, backgroundColor: '#f3f4f6', borderRadius: 15, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={collapsed ? 'chevron-down' : 'chevron-up'} size={14} color="#6b7280" />
        </View>
      </TouchableOpacity>

      {/* Playground sub-sections */}
      {!collapsed && (
        <View style={{ borderTopWidth: 1, borderTopColor: '#f3f4f6' }}>
          {group.items.map((item, idx) => (
            <PlaygroundSection
              key={item.playground_id}
              item={item}
              isLast={idx === group.items.length - 1}
            />
          ))}
        </View>
      )}
    </View>
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
  const [feed, setFeed]                   = useState<GroupedFeedItem[]>([]);
  const [activeCheckin, setActiveCheckin] = useState<ActiveCheckinResult>(null);
  const [hasChildren, setHasChildren]     = useState(false);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [feedLoading, setFeedLoading]     = useState(false);
  const [notifStatus, setNotifStatus]     = useState<string | null>(null);
  const [notifBannerDismissed, setNotifBannerDismissed] = useState(false);
  const [profileName, setProfileName]     = useState('');
  const [menuOpen, setMenuOpen]           = useState(false);
  const [showEndVisit, setShowEndVisit]   = useState(false);
  const [showSwitchPG, setShowSwitchPG]   = useState(false);
  const [playgrounds, setPlaygrounds]     = useState<PlaygroundRow[]>([]);
  const [pgListLoading, setPGListLoading] = useState(false);
  const [selectedPGId, setSelectedPGId]   = useState<string | null>(null);
  const [switchPGLoading, setSwitchPGLoading] = useState(false);
  const [addingNewPG, setAddingNewPG]     = useState(false);
  const [newPGName, setNewPGName]         = useState('');
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
        })
        .catch(console.error);
    }, [user])
  );

  // ── Poll feed + active checkin (30s, AppState-aware) ─────────────────────
  const poll = useCallback(async () => {
    if (groups.length === 0) return;
    try {
      const [groupResults, active] = await Promise.all([
        Promise.all(
          groups.map(g =>
            getGroupActiveCheckins(g.id)
              .then(items => items.map(item => ({
                ...item,
                group_id: g.id,
                group_name: g.name,
                group_emoji: g.emoji,
              })))
              .catch((e) => {
                console.warn('[home] poll failed for group', g.id, e);
                return [] as GroupedFeedItem[];
              })
          )
        ),
        getMyActiveCheckin(),
      ]);
      setFeed(groupResults.flat());
      setActiveCheckin(active);
    } finally {
      setFeedLoading(false);
    }
  }, [groups]);

  useEffect(() => {
    if (groups.length === 0) return;
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

  // ── End visit modal ───────────────────────────────────────────────────────
  function handleEndVisit() {
    if (!activeCheckin) return;
    setShowEndVisit(true);
  }

  async function handleConfirmEndVisit() {
    if (!activeCheckin) return;
    setShowEndVisit(false);
    await Promise.allSettled(activeCheckin.check_in_ids.map((id) => leaveCheckin(id)));
    setActiveCheckin(null);
    poll();
  }

  // ── Switch playground modal ───────────────────────────────────────────────
  async function handleSwitchPlayground() {
    if (!activeCheckin) return;
    setSelectedPGId(null);
    setAddingNewPG(false);
    setNewPGName('');
    setShowSwitchPG(true);
    setPGListLoading(true);
    try {
      const pgs = await getMyPlaygrounds();
      setPlaygrounds(pgs);
    } catch (e) {
      console.error(e);
    } finally {
      setPGListLoading(false);
    }
  }

  async function handleConfirmSwitchPG() {
    if (!activeCheckin || !selectedPGId) return;
    setSwitchPGLoading(true);
    try {
      await Promise.allSettled(activeCheckin.check_in_ids.map((id) => leaveCheckin(id)));
      await postCheckin(activeCheckin.child_ids, selectedPGId);
      setShowSwitchPG(false);
      poll();
    } catch (e: any) {
      Alert.alert(t('errors.generic'), e.message);
    } finally {
      setSwitchPGLoading(false);
    }
  }

  async function handleAddNewPG() {
    const name = newPGName.trim();
    if (!name) return;
    try {
      const normalized = name.toLowerCase().replace(/\s+/g, ' ');
      const id = await createPlayground(name, normalized);
      setPlaygrounds(prev => [...prev, { id, name }]);
      setSelectedPGId(id);
      setAddingNewPG(false);
      setNewPGName('');
    } catch (e: any) {
      Alert.alert(t('errors.generic'), e.message);
    }
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

  const groupedFeed = useMemo<GroupFeedData[]>(() => {
    const map = new Map<string, GroupFeedData>();
    for (const item of feed) {
      if (!map.has(item.group_id)) {
        map.set(item.group_id, {
          group_id: item.group_id,
          group_name: item.group_name,
          group_emoji: item.group_emoji,
          items: [],
        });
      }
      map.get(item.group_id)!.items.push(item);
    }
    return [...map.values()].sort((a, b) => a.group_name.localeCompare(b.group_name));
  }, [feed]);

  // ── Render: loading ───────────────────────────────────────────────────────
  if (groupsLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#f1fdf5', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color="#3D7A50" />
      </SafeAreaView>
    );
  }

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

      {/* Greeting — always visible when profile loaded */}
      {profileName ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 14 }}>
          <Text style={{ fontSize: 30, fontWeight: '600', color: '#1a1a1a', marginBottom: 4 }}>
            {t('home.empty_greeting', { name: profileName })}
          </Text>
          <Text style={{ fontSize: 17, color: '#4a4a4a' }}>{t('home.empty_sub')}</Text>
        </View>
      ) : null}


      {/* Active session card */}
      {activeCheckin && (
        <ActiveSessionCard
          active={activeCheckin}
          onSwitchPlayground={handleSwitchPlayground}
          onEndVisit={handleEndVisit}
        />
      )}

      {/* Onboarding empty states */}
      {!hasGroups && !hasChildren ? (
        <View className="flex-1 items-center px-6" style={{ paddingTop: 8 }}>
          <Text style={{ fontSize: 22, fontWeight: '700', color: '#1a1a1a', textAlign: 'center', lineHeight: 32, marginBottom: 20 }}>
            {t('home.onboarding_quote')}
          </Text>
          <Image
            source={require('../../assets/fence.png')}
            style={{ width: 200, height: 200, marginBottom: 22 }}
            resizeMode="contain"
          />
          <Text style={{ fontSize: 16, color: '#4a4a4a', textAlign: 'center', lineHeight: 26, marginBottom: 32 }}>
            {t('home.no_children_groups_body')}
          </Text>
          <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
            <TouchableOpacity
              style={{ flex: 1, backgroundColor: '#3D7A50', borderRadius: 12, paddingVertical: 15, alignItems: 'center', ...BTN_SHADOW }}
              onPress={() => router.push('/(tabs)/children')}
            >
              <Text style={{ color: 'white', fontSize: 15, fontWeight: '600' }}>{t('home.add_child_btn')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ flex: 1, backgroundColor: 'white', borderWidth: 1.5, borderColor: '#3D7A50', borderRadius: 12, paddingVertical: 15, alignItems: 'center' }}
              onPress={() => router.push('/(tabs)/groups')}
            >
              <Text style={{ color: '#3D7A50', fontSize: 15, fontWeight: '600' }}>{t('home.add_group_btn')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : !hasGroups ? (
        <View className="flex-1 items-center px-6" style={{ paddingTop: 8 }}>
          <Text style={{ fontSize: 22, fontWeight: '700', color: '#1a1a1a', textAlign: 'center', lineHeight: 32, marginBottom: 20 }}>
            {t('home.onboarding_quote')}
          </Text>
          <Image
            source={require('../../assets/fence.png')}
            style={{ width: 200, height: 200, marginBottom: 22 }}
            resizeMode="contain"
          />
          <Text style={{ fontSize: 16, color: '#4a4a4a', textAlign: 'center', lineHeight: 26, marginBottom: 32 }}>
            {t('home.no_groups_body')}
          </Text>
          <TouchableOpacity
            style={{ width: '100%', backgroundColor: '#3D7A50', borderRadius: 12, paddingVertical: 15, alignItems: 'center', ...BTN_SHADOW }}
            onPress={() => router.push('/(tabs)/groups')}
          >
            <Text style={{ color: 'white', fontSize: 15, fontWeight: '600' }}>{t('home.add_group_btn')}</Text>
          </TouchableOpacity>
        </View>
      ) : feedLoading ? (
        <ActivityIndicator size="large" color="#16a34a" style={{ marginTop: 48 }} />
      ) : groupedFeed.length === 0 ? (
        /* Empty feed state — greeting already shown above */
        <View className="flex-1 items-center justify-center px-6" style={{ marginTop: -40 }}>
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
      ) : (
        /* Feed with content */
        <FlatList
          data={groupedFeed}
          keyExtractor={(group) => group.group_id}
          contentContainerStyle={{ paddingBottom: 16 }}
          renderItem={({ item: group }) => <GroupCard group={group} />}
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
      {/* ── End Visit modal ────────────────────────────────────────────── */}
      <Modal visible={showEndVisit} transparent animationType="fade" onRequestClose={() => setShowEndVisit(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.42)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
          <View style={{ backgroundColor: 'white', borderRadius: 18, width: '100%', padding: 28, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 24 }, shadowOpacity: 0.22, shadowRadius: 32, elevation: 12 }}>
            <Text style={{ fontSize: 38, marginBottom: 14 }}>👋</Text>
            <Text style={{ fontSize: 19, fontWeight: '700', color: '#1a1a1a', textAlign: 'center', marginBottom: 8, lineHeight: 28 }}>
              {t('home.confirm_end_visit', { name: activeCheckin?.playground_name })}
            </Text>
            <Text style={{ fontSize: 14, color: '#767d8b', textAlign: 'center', marginBottom: 24, lineHeight: 22 }}>
              {t('home.end_visit_subtitle', { names: activeCheckin?.child_names.join(', ') })}
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: 'white', borderWidth: 1.5, borderColor: '#e5e7eb', borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}
                onPress={() => setShowEndVisit(false)}
              >
                <Text style={{ fontSize: 15, fontWeight: '500', color: '#374151' }}>{t('home.confirm_end_visit_no')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: '#dc2626', borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}
                onPress={handleConfirmEndVisit}
              >
                <Text style={{ fontSize: 15, fontWeight: '600', color: 'white' }}>{t('home.confirm_end_visit_yes')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Switch Playground modal ─────────────────────────────────────── */}
      <Modal visible={showSwitchPG} transparent animationType="fade" onRequestClose={() => setShowSwitchPG(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.42)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
          <View style={{ backgroundColor: 'white', borderRadius: 18, width: '100%', overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 24 }, shadowOpacity: 0.22, shadowRadius: 32, elevation: 12 }}>
            {/* Title */}
            <View style={{ paddingVertical: 18, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: '#f3f4f6', alignItems: 'center' }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: '#1a1a1a' }}>{t('home.switch_pg_title')}</Text>
            </View>

            {pgListLoading ? (
              <ActivityIndicator size="small" color="#3D7A50" style={{ paddingVertical: 24 }} />
            ) : (
              <>
                {/* Current playground — non-selectable */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 15, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: '#f5f5f5' }}>
                  <Text style={{ fontSize: 14 }}>📍</Text>
                  <Text style={{ flex: 1, fontSize: 15, color: '#9ca3af' }}>{activeCheckin?.playground_name}</Text>
                  <View style={{ backgroundColor: '#E4F2EA', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }}>
                    <Text style={{ fontSize: 11, fontWeight: '500', color: '#3D7A50' }}>{t('home.switch_pg_here_now')}</Text>
                  </View>
                </View>

                {/* Other playgrounds */}
                {playgrounds
                  .filter(pg => pg.id !== activeCheckin?.playground_id)
                  .map(pg => (
                    <TouchableOpacity
                      key={pg.id}
                      onPress={() => setSelectedPGId(pg.id)}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 15, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: '#f5f5f5', backgroundColor: selectedPGId === pg.id ? '#f0faf4' : 'white' }}
                    >
                      <Text style={{ fontSize: 14, opacity: 0.5 }}>📍</Text>
                      <Text style={{ flex: 1, fontSize: 15, color: selectedPGId === pg.id ? '#3D7A50' : '#1a1a1a', fontWeight: selectedPGId === pg.id ? '600' : '400' }}>{pg.name}</Text>
                      {selectedPGId === pg.id && <Ionicons name="checkmark" size={18} color="#3D7A50" />}
                    </TouchableOpacity>
                  ))
                }

                {/* Add new playground */}
                <TouchableOpacity
                  onPress={() => setAddingNewPG(v => !v)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 15, paddingHorizontal: 20 }}
                >
                  <View style={{ width: 26, height: 26, backgroundColor: '#E4F2EA', borderRadius: 13, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: '#3D7A50', lineHeight: 20 }}>+</Text>
                  </View>
                  <Text style={{ fontSize: 15, color: '#3D7A50', fontWeight: '500' }}>{t('home.add_new_playground')}</Text>
                </TouchableOpacity>

                {addingNewPG && (
                  <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingBottom: 12 }}>
                    <TextInput
                      value={newPGName}
                      onChangeText={setNewPGName}
                      placeholder={t('home.add_playground_placeholder')}
                      onSubmitEditing={handleAddNewPG}
                      autoFocus
                      style={{ flex: 1, borderWidth: 1.5, borderColor: '#d1d5db', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, textAlign: 'right' }}
                    />
                    <TouchableOpacity
                      onPress={handleAddNewPG}
                      style={{ backgroundColor: '#3D7A50', borderRadius: 8, paddingHorizontal: 14, justifyContent: 'center' }}
                    >
                      <Text style={{ color: 'white', fontSize: 13, fontWeight: '600' }}>{t('common.add')}</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </>
            )}

            {/* Text buttons */}
            <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#f3f4f6' }}>
              <TouchableOpacity
                style={{ flex: 1, paddingVertical: 14, alignItems: 'center', borderEndWidth: 1, borderEndColor: '#f3f4f6' }}
                onPress={() => setShowSwitchPG(false)}
              >
                <Text style={{ fontSize: 15, fontWeight: '500', color: '#6b7280' }}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, paddingVertical: 14, alignItems: 'center' }}
                onPress={handleConfirmSwitchPG}
                disabled={!selectedPGId || switchPGLoading}
              >
                <Text style={{ fontSize: 15, fontWeight: '600', color: selectedPGId && !switchPGLoading ? '#3D7A50' : '#9ca3af' }}>
                  {switchPGLoading ? t('common.loading') : t('common.save')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}
