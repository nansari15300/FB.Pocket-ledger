"use client";

import { LoginForm } from '@/components/auth/LoginForm';
import { CountryAppLoginHint } from '@/components/country/CountryAppLoginHint';
import { SavedAccountsLoginPanel, hasSavedAccountsForLoginPanel } from '@/components/auth/SavedAccountsLoginPanel';
import { useAuth } from '@/hooks/useAuth';
import { useLivePlans } from '@/hooks/useLivePlans';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { LoadingSpinner } from '@/components/layout/LoadingSpinner';
import { resolvePostAuthCompanyRoute } from '@/lib/postAuthCompanyRoute';
import { isStaticAppBuild } from '@/lib/isStaticAppBuild';
import { isCapacitorNativeApp } from '@/lib/isCapacitorNative';
import { isElectronEnvironment } from '@/hooks/use-mobile';
import { isEmbeddedLoginAccountSwitchShell } from '@/lib/embeddedLoginAccountSwitchShell';
import { AuthLangChrome } from '@/components/layout/LanguageGlobeButton';

export default function LoginPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const livePlans = useLivePlans();
  const [showSavedAccounts, setShowSavedAccounts] = useState(false);
  /** `loading`/`user` dobara fire hone par sirf ek replace — kai baar SPA "refresh" jaisa dikhta tha */
  const postAuthNavigateOnceRef = useRef(false);
  const savedAccountsAvailable =
    isEmbeddedLoginAccountSwitchShell() && hasSavedAccountsForLoginPanel(livePlans);

  useEffect(() => {
    if (loading || !user) {
      postAuthNavigateOnceRef.current = false;
      return;
    }
    if (postAuthNavigateOnceRef.current) return;
    postAuthNavigateOnceRef.current = true;
    // Valid offline/cloud "remember" ho to `/company` skip; warna company picker — web + static dono par same rule.
    const next = resolvePostAuthCompanyRoute(user.uid, user.email);
    router.replace(next);
  }, [user, loading, router]);

  // Auth restore / Firestore user-doc bootstrap: `user` null + `loading` true — login form mat dikhao (1s flash band).
  if (loading) {
    return <LoadingSpinner />;
  }
  // Session mil gaya: embedded shell par lamba circle kam — route replace tak blank background (device-lock overlay alag se).
  if (user) {
    const embeddedQuick =
      typeof window !== 'undefined' &&
      (isStaticAppBuild() || isCapacitorNativeApp() || isElectronEnvironment());
    if (embeddedQuick) {
      return <div className="min-h-screen bg-background" aria-busy="true" />;
    }
    return <LoadingSpinner />;
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <AuthLangChrome />
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          {/* Login brand: sidebar/Electron jaisa sirf app icon (`object-contain`) — alag text logo web vs static confuse na kare. */}
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border-2 border-border bg-muted/40 shadow-sm">
            <img
              src="/app-icon.png"
              alt="Pocket Ledger"
              className="h-full w-full object-contain p-1"
              width={80}
              height={80}
              loading="eager"
            />
          </div>
          <h1 className="sr-only">Pocket Ledger</h1>
          <p className="text-muted-foreground" data-pl-intro="">
            Sign in to access your account.
          </p>
          <div className="mt-2">
            <CountryAppLoginHint />
          </div>
        </div>
        {showSavedAccounts && savedAccountsAvailable ? (
          <SavedAccountsLoginPanel onBack={() => setShowSavedAccounts(false)} />
        ) : (
          <>
            <LoginForm
              onChangeAccount={savedAccountsAvailable ? () => setShowSavedAccounts(true) : undefined}
            />
          </>
        )}
        <div className="text-center text-sm text-muted-foreground" data-pl-intro="">
          <p>© {new Date().getFullYear()} Pocket Ledger. All rights reserved.</p>
        </div>
      </div>
    </main>
  );
}
