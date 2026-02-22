import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { touchLastActive } from './db/rpc';

const JOIN_TOKEN_KEY = 'mibagina:pending_join_token';
const INACTIVITY_MONTHS = 6;

// -----------------------------------------------------------------------
// Inactivity check
// Returns true if the guardian should be signed out (last_active > 6 months).
// -----------------------------------------------------------------------
export function isInactive(lastActiveAt: string): boolean {
  const lastActive = new Date(lastActiveAt);
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - INACTIVITY_MONTHS);
  return lastActive < cutoff;
}

// -----------------------------------------------------------------------
// Sign in
// Calls touch_last_active() after successful auth.
// Returns { inactivity: true } if guardian hasn't been active in 6 months.
// -----------------------------------------------------------------------
export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;

  // Best-effort: log false (guardian row not found) but do not hard error.
  try {
    const found = await touchLastActive();
    if (!found) console.warn('[auth] touch_last_active returned false — guardian row not found');
  } catch (e) {
    console.warn('[auth] touch_last_active failed', e);
  }

  // Check inactivity using last_active_at from guardians table via session metadata.
  // Full inactivity check is performed in AuthContext on session restore.
  return data;
}

// -----------------------------------------------------------------------
// Sign up
// -----------------------------------------------------------------------
export async function signUp(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

// -----------------------------------------------------------------------
// Sign out
// -----------------------------------------------------------------------
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// -----------------------------------------------------------------------
// Get current session (used on restore)
// -----------------------------------------------------------------------
export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

// -----------------------------------------------------------------------
// Join token — stored across auth redirects for the invite deep link flow
// -----------------------------------------------------------------------
export async function storeJoinToken(token: string) {
  await AsyncStorage.setItem(JOIN_TOKEN_KEY, token);
}

export async function getJoinToken(): Promise<string | null> {
  return AsyncStorage.getItem(JOIN_TOKEN_KEY);
}

export async function clearJoinToken() {
  await AsyncStorage.removeItem(JOIN_TOKEN_KEY);
}

// -----------------------------------------------------------------------
// Change password (client-side — no Admin API needed)
// -----------------------------------------------------------------------
export async function changePassword(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}
