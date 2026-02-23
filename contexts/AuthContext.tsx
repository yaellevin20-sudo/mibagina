import React, { createContext, useContext, useEffect, useState } from 'react';
import * as Linking from 'expo-linking';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { touchLastActive } from '../lib/db/rpc';
import { isInactive, signOut } from '../lib/auth';

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  recoveryMode: boolean;
  clearRecoveryMode: () => void;
};

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  loading: true,
  recoveryMode: false,
  clearRecoveryMode: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [recoveryMode, setRecoveryMode] = useState(false);

  useEffect(() => {
    // Restore existing session on mount
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      handleSessionRestore(s);
    });

    // Listen for future auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryMode(true);
        setSession(s);
        setLoading(false);
        return; // skip handleSessionRestore inactivity check
      }
      setRecoveryMode(false);
      setSession(s);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function handleSessionRestore(s: Session | null) {
    if (!s) {
      setSession(null);
      setLoading(false);
      return;
    }

    // If app was opened via a recovery deep link, skip inactivity check
    try {
      const initialUrl = await Linking.getInitialURL();
      const isRecoveryLink = !!initialUrl && (
        initialUrl.includes('type=recovery') || initialUrl.includes('reset-password')
      );
      if (isRecoveryLink) {
        setSession(s);
        setLoading(false);
        return;
      }
    } catch {
      // Non-fatal: proceed with normal restore
    }

    // Best-effort touch_last_active on session restore
    try {
      const found = await touchLastActive();
      if (!found) {
        console.warn('[auth] touch_last_active returned false on session restore — guardian row not found');
      }
    } catch (e) {
      console.warn('[auth] touch_last_active failed on session restore', e);
    }

    // Inactivity check: fetch last_active_at from guardians table
    try {
      const { data: guardian, error } = await supabase
        .from('guardians')
        .select('last_active_at')
        .eq('id', s.user.id)
        .single();

      if (!error && guardian && isInactive(guardian.last_active_at)) {
        console.warn('[auth] Guardian inactive > 6 months — signing out');
        await signOut();
        setSession(null);
        setLoading(false);
        return;
      }
    } catch (e) {
      // Non-fatal: if we can't check, proceed
      console.warn('[auth] Could not check inactivity', e);
    }

    setSession(s);
    setLoading(false);
  }

  function clearRecoveryMode() {
    setRecoveryMode(false);
  }

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, recoveryMode, clearRecoveryMode }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
