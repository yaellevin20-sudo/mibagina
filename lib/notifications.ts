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

export type GroupDeletedPayload = {
  type: 'group_deleted';
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

    // Register still_there category for quick-action buttons (no app open needed).
    // categoryId in the push payload must match this identifier exactly.
    await Notifications.setNotificationCategoryAsync('still_there', [
      {
        identifier: 'still_here',
        buttonTitle: 'עדיין כאן',
        options: { isDestructive: false, isAuthenticationRequired: false, opensAppToForeground: false },
      },
      {
        identifier: 'leaving',
        buttonTitle: 'יוצאת',
        options: { isDestructive: true, isAuthenticationRequired: false, opensAppToForeground: false },
      },
    ]);

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
// enqueueGroupNotification
// Fire-and-forget RPC call that inserts a pending batch into notification_queue.
// The dispatch-notifications edge function (runs every minute) claims due
// batches and sends bundled Expo pushes. Non-critical — silent on error.
// -----------------------------------------------------------------------
export async function enqueueGroupNotification(playgroundId: string): Promise<void> {
  try {
    const { error } = await supabase.rpc('enqueue_group_notification', {
      p_playground_id: playgroundId,
    });
    if (error) console.warn('[notify] enqueueGroupNotification error:', error.message);
  } catch (e) {
    console.warn('[notify] enqueueGroupNotification error:', e);
  }
}
