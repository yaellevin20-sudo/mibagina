import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { setPushToken } from './db/rpc';
import { supabase } from './supabase';

// -----------------------------------------------------------------------
// Payload types (match what the Edge Functions send in push data field)
// -----------------------------------------------------------------------

export type StillThereCheckIn = {
  check_in_id: string;
  first_name: string;
  age_years: number;
};

export type StillTherePayload = {
  type: 'still_there_prompt';
  session_token: string; // received from push but never forwarded — auth via JWT
  check_ins: StillThereCheckIn[];
};

export type GroupCheckinPayload = {
  type: 'group_checkin';
  playground_id: string;
  playground_name: string;
  group_name: string;
};

// -----------------------------------------------------------------------
// setupAndroidChannel
// -----------------------------------------------------------------------
export async function setupAndroidChannel(): Promise<void> {
  if (Device.osName !== 'Android') return;
  await Notifications.setNotificationChannelAsync('still-there', {
    name: 'Still There?',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    sound: 'default',
    showBadge: false,
  });
}

// -----------------------------------------------------------------------
// registerForPushNotifications
// Non-critical — all errors are console.warn. Skipped on simulator.
// -----------------------------------------------------------------------
export async function registerForPushNotifications(): Promise<void> {
  try {
    if (!Device.isDevice) {
      console.warn('[push] Skipping — not a physical device');
      return;
    }

    await setupAndroidChannel();

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      console.warn('[push] Notification permission denied');
      return;
    }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const { data: token } = await Notifications.getExpoPushTokenAsync({
      projectId,
    });

    await setPushToken(token);
  } catch (e) {
    console.warn('[push] registerForPushNotifications error', e);
  }
}

// -----------------------------------------------------------------------
// notifyGroupCheckin
// Fire-and-forget call to the notify-group-checkin Edge Function.
// Non-critical — silent on error.
// -----------------------------------------------------------------------
export async function notifyGroupCheckin(playgroundId: string): Promise<void> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const jwt = sessionData?.session?.access_token;
    if (!jwt) return;

    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) return;

    fetch(`${supabaseUrl}/functions/v1/notify-group-checkin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ playground_id: playgroundId }),
    }).catch((e) => console.warn('[push] notifyGroupCheckin fetch error', e));
  } catch (e) {
    console.warn('[push] notifyGroupCheckin error', e);
  }
}
