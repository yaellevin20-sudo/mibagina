import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { supabase } from './supabase';

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
// Sign in (email/password)
// touchLastActive() is called in routeAfterAuth (login.tsx) to avoid
// double-calling for Google OAuth which also triggers onAuthStateChange.
// -----------------------------------------------------------------------
export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

// -----------------------------------------------------------------------
// Sign in with Google (OAuth)
// Opens an in-app browser, parses tokens from result URL, calls setSession.
// maybeCompleteAuthSession() must be called at the screen level, not here.
// -----------------------------------------------------------------------
export async function signInWithGoogle(): Promise<void> {
  const redirectTo = Linking.createURL('auth/callback');

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data.url) throw new Error('No OAuth URL returned');

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

  if (result.type === 'cancel') {
    throw new Error('cancelled'); // caught silently by caller
  }

  if (result.type === 'success' && result.url) {
    // Parse access_token + refresh_token from the fragment
    const fragment = result.url.split('#')[1] ?? '';
    const params = new URLSearchParams(fragment);
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');

    if (!access_token || !refresh_token) {
      // Fallback: the Linking deep link handler in _layout.tsx will handle it
      return;
    }

    const { error: sessionError } = await supabase.auth.setSession({ access_token, refresh_token });
    if (sessionError) throw sessionError;
    // onAuthStateChange SIGNED_IN → AuthContext updates → screen useEffect routes
  }
}

// -----------------------------------------------------------------------
// Send password reset email
// -----------------------------------------------------------------------
export async function sendPasswordReset(email: string): Promise<void> {
  const redirectTo = Linking.createURL('reset-password');
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
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
