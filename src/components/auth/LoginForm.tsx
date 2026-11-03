"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useEffect, useLayoutEffect, useCallback } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  REMEMBER_EMAIL_ENABLED_KEY,
  REMEMBER_EMAIL_KEY,
  readRememberEmailEnabled,
  readRememberedEmail,
} from "@/lib/loginRememberEmail";
import { resolvePostAuthCompanyRoute } from "@/lib/postAuthCompanyRoute";
import { isElectronDesktopApp } from "@/lib/isElectronDesktop";
import { stashSessionPasswordForSavedAccount } from "@/lib/savedLoginSessionPassword";
import { ServerLoginInfoButton } from "@/components/auth/ServerLoginInfoButton";
import {
  getPocketBaseServerUrl,
  pocketBaseApprovalState,
  pocketBaseErrorCode,
  pocketBaseResendSignUpOtp,
  pocketBaseSignIn,
  pocketBaseGoogleSignIn,
  GOOGLE_LOGIN_NOT_CONFIGURED_MESSAGE,
  PocketBaseGoogleLoginError,
  pocketBaseSignOut,
  pocketBaseSignUp,
  pocketBaseVerifySignUpOtp,
  PocketBaseRequestError,
} from "@/lib/pocketbaseData/pbClient";
import { checkRecoveryAccess } from "@/lib/recovery/recoveryUpload";
import {
  isSuperAdminEmail,
  RECOVERY_ROUTE,
  recoveryModeSupported,
  writeRecoveryMode,
} from "@/lib/recovery/recoveryMode";
import {
  clearPocketBaseAppSession,
  pocketBaseSessionUid,
  readPocketBaseAppProfile,
  startPocketBaseAppSession,
} from "@/lib/pocketbaseData/pbAppSession";
import {
  readCachedOnlineDataServerSettings,
  resolvePocketBaseServer,
  writeCachedOnlineDataServerSettings,
} from "@/lib/onlineDataServer";

// One-time handling of redirect result (survives Strict Mode double-mount so we don't consume result twice)

const formSchema = z.object({
  email: z.string().email({ message: "Please enter a valid email." }),
  password: z.string().min(6, { message: "Password must be at least 6 characters." }),
});

/** Never add a key for password — only email may be persisted when "Remember email" is on. */

/** Server sign-in must not hold up the older-account sign-in for long. */
const SERVER_SIGN_IN_TIMEOUT_MS = 12_000;

/** "Pocket Ledger Server login only" choice, remembered on this device. */
const SERVER_ONLY_LOGIN_KEY = "pl_login_server_only_v1";

function readServerOnlyLoginEnabled(): boolean {
  // Pocket Ledger Server is the only login now (no Firebase sign-in).
  return true;
}

/** Server sign-in error -> the same codes the toast already explains. */
function serverSignInErrorCode(reason: unknown): string {
  const status = reason instanceof PocketBaseRequestError ? reason.status : 0;
  const approval = pocketBaseApprovalState(reason);
  if (approval === "pending") return "pl-account-pending";
  if (approval === "rejected") return "pl-account-rejected";
  if (approval === "otp") return "pl-account-otp";
  if (status === 403) return "pl-account-disabled";
  if (status === 400) return "auth/invalid-credential";
  return "sign-in-failed";
}

/** Email code step (server with Email/SMTP set up). The password stays in memory only for the code check. */
type OtpStep = { email: string; password: string; note: string; resendAtMs: number };

/** Readable text for the server's email-code error codes. */
function otpErrorText(code: string, left?: number): string {
  switch (code) {
    case "otp_invalid":
      return typeof left === "number" && left > 0
        ? `The code is not correct. ${left} ${left === 1 ? "try" : "tries"} left.`
        : "The code or the password is not correct.";
    case "otp_expired":
      return "The code has expired. Press Resend code.";
    case "otp_too_many":
      return "Too many wrong codes. Press Resend code to get a new one.";
    case "otp_none":
      return "No code is waiting for this email. Press Resend code.";
    case "otp_cooldown":
    case "otp_hourly":
      return "Please wait before asking for a new code.";
    case "smtp_off":
      return "Email is not set up on this server, so no code can be sent. Ask the server admin.";
    case "mail_failed":
    case "smtp_failed":
      return "The email could not be sent. Try Resend code, or ask the server admin.";
    case "rate_limited":
      return "Too many tries from this network. Try again later.";
    default:
      return "Could not check the code. Please try again.";
  }
}

/** Sign-up makes a Pocket Ledger Server account (pl_users); the server needs 8+ characters. */
const SIGN_UP_MIN_PASSWORD = 8;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("SERVER_SIGN_IN_TIMEOUT")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

/** `http(s)://host[:port]` only; returns "" when not valid. */
function cleanServerAddress(raw: string): string {
  const s = raw.trim().replace(/\/+$/, "");
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return `${u.protocol}//${u.host}${u.pathname === "/" ? "" : u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return "";
  }
}

export function LoginForm({ onChangeAccount }: { onChangeAccount?: () => void }) {
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [rememberEmail, setRememberEmail] = useState(() => readRememberEmailEnabled());
  /** Server-only login: no Firebase sign-in, Firestore stays off for the whole session. */
  const [serverOnlyLogin] = useState(() => readServerOnlyLoginEnabled());
  const [showServerAddress, setShowServerAddress] = useState(false);
  const [serverAddress, setServerAddress] = useState("");
  /** Which country server the sign-in really calls (same resolver as `getPocketBaseServerUrl`). Set after mount (no SSR mismatch). */
  const [serverInfo, setServerInfo] = useState<{ name: string; url: string; notLiveName: string } | null>(null);
  const refreshServerInfo = useCallback(() => {
    try {
      const r = resolvePocketBaseServer();
      setServerInfo({
        name: r.serverCountry?.name ?? "Nepal",
        url: getPocketBaseServerUrl(),
        notLiveName: r.chosenCountryLive ? "" : r.chosenCountry?.name ?? "",
      });
    } catch {
      setServerInfo(null);
    }
  }, []);
  useEffect(() => {
    refreshServerInfo();
  }, [refreshServerInfo]);
  /** "Login as recovery mode?" (desktop app, super admin email only; never remembered). */
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [otpStep, setOtpStep] = useState<OtpStep | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpError, setOtpError] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());
  /** Browsers may autofill after paint; setters stay so login never crashes. Fields stay typeable (no readOnly). */
  const [, setEmailAutofillGuard] = useState(false);
  const [, setPasswordAutofillGuard] = useState(false);
  const router = useRouter();
  const { toast } = useToast();
  // Post-login: `resolvePostAuthCompanyRoute` — web = remember/empty → `/company`; static/APK = last company → `/dashboard`.
  const navigateAfterAuth = useCallback((firebaseUid: string | undefined, userEmail?: string | null, replace?: boolean) => {
    const next = resolvePostAuthCompanyRoute(firebaseUid, userEmail);
    if (replace) {
      router.replace(next);
      return;
    }
    router.push(next);
  }, [router]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const typedEmail = form.watch("email");
  /** Shown only in the desktop app, only on sign-in, only when the typed email is the super admin's. */
  const canRecover = !isSignUp && recoveryModeSupported() && isSuperAdminEmail(typedEmail);
  const recoveryActive = recoveryMode && canRecover;

  // Resend-code countdown (only while the code step is open).
  useEffect(() => {
    if (!otpStep) return;
    const t = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [otpStep]);

  function openOtpStep(email: string, password: string, note: string, waitSec = 60) {
    setOtpCode("");
    setOtpError("");
    setNowMs(Date.now());
    setOtpStep({ email: email.trim().toLowerCase(), password, note, resendAtMs: Date.now() + waitSec * 1000 });
  }

  function closeOtpStep(email?: string) {
    setOtpStep(null);
    setOtpCode("");
    setOtpError("");
    setIsSignUp(false);
    form.reset({ email: email ?? "", password: "" });
    setEmailAutofillGuard(false);
    setPasswordAutofillGuard(false);
  }

  async function verifyOtp() {
    if (!otpStep) return;
    const code = otpCode.replace(/\D/g, "");
    if (code.length !== 6) {
      setOtpError("Enter the 6-digit code from the email.");
      return;
    }
    setOtpBusy(true);
    setOtpError("");
    try {
      const r = await pocketBaseVerifySignUpOtp(otpStep.email, code, otpStep.password);
      const email = otpStep.email;
      closeOtpStep(email);
      toast(
        r.status === "approved"
          ? { title: "Email confirmed", description: "Your email is confirmed. You can sign in now." }
          : {
              title: "Email confirmed: pending approval",
              description: "Your email is confirmed. A server admin must approve the account before you can sign in.",
            },
      );
    } catch (e) {
      const d = e instanceof PocketBaseRequestError ? (e.data as { code?: unknown; left?: unknown } | null) : null;
      const status = e instanceof PocketBaseRequestError ? e.status : 0;
      setOtpError(
        status === 0
          ? "Could not reach the Pocket Ledger Server. Check the internet connection and the server address."
          : otpErrorText(String(d?.code || ""), typeof d?.left === "number" ? d.left : undefined),
      );
    } finally {
      setOtpBusy(false);
    }
  }

  async function resendOtp() {
    if (!otpStep || nowMs < otpStep.resendAtMs) return;
    setOtpBusy(true);
    setOtpError("");
    try {
      await pocketBaseResendSignUpOtp(otpStep.email);
      setOtpStep({ ...otpStep, note: "A new code was sent. It works for about 10 minutes.", resendAtMs: Date.now() + 60_000 });
      setNowMs(Date.now());
    } catch (e) {
      const d = e instanceof PocketBaseRequestError ? (e.data as { code?: unknown; retryAfter?: unknown } | null) : null;
      const code = String(d?.code || "");
      const wait = typeof d?.retryAfter === "number" ? d.retryAfter : 0;
      if (wait > 0) setOtpStep({ ...otpStep, resendAtMs: Date.now() + wait * 1000 });
      const status = e instanceof PocketBaseRequestError ? e.status : 0;
      setOtpError(
        status === 0
          ? "Could not reach the Pocket Ledger Server. Check the internet connection and the server address."
          : otpErrorText(code),
      );
    } finally {
      setOtpBusy(false);
    }
  }

  useLayoutEffect(() => {
    const enabled = readRememberEmailEnabled();
    setRememberEmail(enabled);
    if (!enabled) {
      form.reset({ email: "", password: "" });
      setEmailAutofillGuard(true);
      setPasswordAutofillGuard(true);
    } else {
      const saved = readRememberedEmail();
      form.reset({ email: saved, password: "" });
      setEmailAutofillGuard(false);
      setPasswordAutofillGuard(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- login entry: sync storage once before paint
  }, []);

  // Browsers often autofill after layout; clear again if user did not opt in to remembered email.
  useEffect(() => {
    if (readRememberEmailEnabled()) return;
    const timeouts = [50, 200, 600].map((ms) =>
      window.setTimeout(() => {
        if (!readRememberEmailEnabled()) {
          form.setValue("email", "");
          form.setValue("password", "");
        }
      }, ms)
    );
    return () => timeouts.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Saves the typed server address (if changed). Returns false when it is not a valid address. */
  function applyServerAddress(): boolean {
    if (!showServerAddress) return true;
    const typed = serverAddress.trim();
    if (!typed) return true;
    const clean = cleanServerAddress(typed);
    if (!clean) {
      toast({
        variant: "destructive",
        title: "Server address",
        description: "Enter a full address, for example https://server.example.com or http://192.168.1.10:8090",
      });
      return false;
    }
    // Unchanged from the address in use (e.g. the country server) -> keep nothing saved, so a later country change still applies.
    if (clean !== getPocketBaseServerUrl()) {
      const cur = readCachedOnlineDataServerSettings();
      if (cur.pocketbaseUrl !== clean) {
        writeCachedOnlineDataServerSettings({ ...cur, pocketbaseUrl: clean });
      }
    }
    refreshServerInfo();
    return true;
  }

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!applyServerAddress()) return;
    setIsLoading(true);
    try {
      let serverOnly = false;
      if (isSignUp) {
        // Self-registration on the Pocket Ledger Server: depending on the server's
        // "New account approval" setting the account is active at once (Auto) or
        // pending until a server admin approves it (Manual).
        if (values.password.length < SIGN_UP_MIN_PASSWORD) {
          throw Object.assign(new Error("SIGN_UP_FAILED"), { code: "pl-password-short" });
        }
        let signUpStatus: "pending" | "approved" | "otp" = "pending";
        try {
          signUpStatus = (await pocketBaseSignUp(values.email, values.password)).status;
        } catch (e) {
          const code = pocketBaseErrorCode(e);
          const status = e instanceof PocketBaseRequestError ? e.status : 0;
          const errData = e instanceof PocketBaseRequestError ? (e.data as { status?: unknown; retryAfter?: unknown } | null) : null;
          if (errData?.status === "otp" || code === "otp_cooldown" || code === "otp_hourly") {
            // Account is waiting for its email code, but this email could not be (re)sent right now.
            const wait = typeof errData?.retryAfter === "number" ? errData.retryAfter : 60;
            openOtpStep(values.email, values.password, otpErrorText(code || "mail_failed"), wait);
            return;
          }
          throw Object.assign(new Error(e instanceof Error ? e.message.replace(/^Pocket Ledger Server:\s*/, "") : "SIGN_UP_FAILED"), {
            code:
              code === "email_in_use"
                ? "auth/email-already-in-use"
                : code === "password_short"
                ? "pl-password-short"
                : status === 0
                ? "auth/network-request-failed"
                : "pl-sign-up",
          });
        }
        if (signUpStatus === "otp") {
          openOtpStep(values.email, values.password, "We sent a 6-digit code to this email. It works for about 10 minutes.");
          return;
        }
        setIsSignUp(false);
        form.reset({ email: values.email.trim(), password: "" });
        setEmailAutofillGuard(false);
        setPasswordAutofillGuard(false);
        toast(
          signUpStatus === "approved"
            ? {
                title: "Account created",
                description: "Your account was created on the Pocket Ledger Server. You can sign in now.",
              }
            : {
                title: "Account created: pending approval",
                description:
                  "Your account was created on the Pocket Ledger Server. A server admin must approve it before you can sign in.",
              },
        );
        return;
      } else if (recoveryActive) {
        // Recovery mode (desktop app, super admin only): opens only the /recovery page.
        // Pocket Ledger Server sign-in is checked by the server (main admin); the older account
        // sign-in counts for the super admin email when the server is not reachable.
        const [serverRes] = await Promise.allSettled([
          withTimeout(pocketBaseSignIn(values.email, values.password), SERVER_SIGN_IN_TIMEOUT_MS),
        ]);
        let serverVerified = false;
        if (serverRes.status === "fulfilled") {
          const chk = await checkRecoveryAccess();
          serverVerified = chk.ok;
          if (!chk.ok) pocketBaseSignOut();
        }
        if (!serverVerified) {
          throw Object.assign(new Error("RECOVERY_NOT_ALLOWED"), {
            code:
              serverRes.status === "fulfilled"
                ? "pl-recovery-not-allowed"
                : serverSignInErrorCode(serverRes.reason),
          });
        }
        clearPocketBaseAppSession();
        writeRecoveryMode({ email: values.email.trim().toLowerCase(), atMs: Date.now(), serverVerified });
        try {
          if (rememberEmail) {
            localStorage.setItem(REMEMBER_EMAIL_ENABLED_KEY, "1");
            localStorage.setItem(REMEMBER_EMAIL_KEY, values.email.trim());
          }
        } catch (_) {}
        form.setValue("password", "");
        window.location.assign(RECOVERY_ROUTE);
        return;
      } else {
        // Pocket Ledger Server login only: no Firebase sign-in, so this session never uses Firestore
        // (only Pocket Ledger Server companies plus local ones are listed).
        try {
          await withTimeout(pocketBaseSignIn(values.email, values.password), SERVER_SIGN_IN_TIMEOUT_MS);
        } catch (e) {
          throw Object.assign(new Error("SIGN_IN_FAILED"), { code: serverSignInErrorCode(e) });
        }
        try {
          await startPocketBaseAppSession();
        } catch (e) {
          pocketBaseSignOut();
          throw Object.assign(new Error(e instanceof Error ? e.message : "SIGN_IN_FAILED"), {
            code: "pl-server-profile",
          });
        }
        serverOnly = true;
      }

      // Logout save-account: isi session ka password memory me (plain storage nahi).
      if (!isSignUp && !serverOnly) {
        stashSessionPasswordForSavedAccount(values.email, values.password);
      }

      // After successful auth only: persist email if opted in — password is never written to storage.
      try {
        if (rememberEmail) {
          localStorage.setItem(REMEMBER_EMAIL_ENABLED_KEY, "1");
          localStorage.setItem(REMEMBER_EMAIL_KEY, values.email.trim());
        } else {
          localStorage.setItem(REMEMBER_EMAIL_ENABLED_KEY, "0");
          localStorage.removeItem(REMEMBER_EMAIL_KEY);
          setEmailAutofillGuard(true);
          setPasswordAutofillGuard(true);
        }
      } catch (_) {}

      form.setValue("password", "");
      if (serverOnly) {
        const p = readPocketBaseAppProfile();
        // Full page load: Firestore starts in its "off" mode for a server-login session.
        window.location.assign(
          resolvePostAuthCompanyRoute(p ? pocketBaseSessionUid(p) : undefined, p?.email ?? values.email)
        );
        return;
      }
      // Email/password login: choose dashboard directly when remember window for last company is valid.
      {
        const p = readPocketBaseAppProfile();
        navigateAfterAuth(p ? pocketBaseSessionUid(p) : undefined, p?.email ?? values.email);
      }

    } catch (error: any) {
      if (error.code === "pl-account-otp") {
        // Account made with email code, code not entered yet: show the code step (password stays in memory only).
        openOtpStep(
          values.email,
          values.password,
          "This account waits for the 6-digit code from the sign-up email. Enter it, or press Resend code.",
          0,
        );
        return;
      }
      toast({
        variant: "destructive",
        title:
          error.code === "pl-account-pending"
            ? "Account pending approval"
            : isSignUp
            ? "Sign Up Failed"
            : "Authentication Failed",
        description:
            error.code === "pl-account-pending"
            ? "Your account is waiting for approval by the server admin. You can sign in after it is approved."
            : error.code === "pl-account-rejected"
            ? "This account was not approved by the server admin. Please contact the server admin."
            : error.code === "pl-password-short"
            ? `Password must be at least ${SIGN_UP_MIN_PASSWORD} characters.`
            : error.code === "pl-sign-up"
            ? String(error.message || "Could not create the account. Please try again.")
            : error.code === "auth/email-already-in-use"
            ? "This email is already registered."
            : error.code === "auth/invalid-credential"
            ? "Invalid email or password."
            : error.code === "pl-account-disabled"
            ? "This server account is turned off. Please ask the server admin."
            : error.code === "pl-recovery-not-allowed"
            ? "Recovery mode is only for the server's main admin. Sign in normally, or use the main admin account."
            : error.code === "pl-server-profile"
            ? String(error.message || "Could not open your server account. Please try again.")
            : error.code === "auth/network-request-failed"
            ? "Could not reach the sign-in servers. Check the internet connection and the server address."
            : "An error occurred. Please try again.",
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    setIsGoogleLoading(true);
    try {
      // Login with Google on the Pocket Ledger Server (PocketBase OAuth2): no Firebase sign-in,
      // every read / write after this uses the server only.
      await pocketBaseGoogleSignIn();
      try {
        await startPocketBaseAppSession();
      } catch (e) {
        pocketBaseSignOut();
        throw Object.assign(new Error(e instanceof Error ? e.message : "SIGN_IN_FAILED"), { code: "pl-server-profile" });
      }
      const p = readPocketBaseAppProfile();
      // Full page load: the server-login session starts clean (no Firestore).
      window.location.assign(resolvePostAuthCompanyRoute(p ? pocketBaseSessionUid(p) : undefined, p?.email ?? undefined));
    } catch (error: unknown) {
      const approval = pocketBaseApprovalState(error);
      const gCode = error instanceof PocketBaseGoogleLoginError ? error.code : "";
      const eCode = String((error as { code?: unknown })?.code || "");
      let description = "Could not sign in with Google. Please try again.";
      if (approval === "pending") {
        description = "Your account is waiting for approval by the server admin. You can sign in after it is approved.";
      } else if (approval === "rejected") {
        description = "This account was not approved by the server admin. Please contact the server admin.";
      } else if (gCode === "popup_blocked") {
        description = "The Google window was blocked. Allow pop-ups for this app and try again.";
      } else if (gCode === "not_configured") {
        description = GOOGLE_LOGIN_NOT_CONFIGURED_MESSAGE;
      } else if (gCode === "denied") {
        description = "Google sign-in was cancelled.";
      } else if (gCode === "timeout") {
        description = "Google sign-in took too long (3 minutes). Please try again.";
      } else if (gCode === "unsupported") {
        description = "Google sign-in is not available in this window. Use the email and password form.";
      } else if (eCode === "pl-server-profile") {
        description = String((error as Error).message || "Could not open your server account. Please try again.");
      } else if (error instanceof PocketBaseRequestError) {
        description =
          error.status === 0
            ? "Could not reach the server. Check the internet connection and the server address."
            : error.status === 403
            ? "This account cannot sign in (turned off or not allowed). Please ask the server admin."
            : "Google sign-in failed on the server. Please try again.";
      }
      toast({ variant: "destructive", title: "Google Sign-In Failed", description });
    } finally {
      setIsGoogleLoading(false);
    }
  }
  const GoogleIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
      <path fill="#FF3D00" d="M6.306 14.691c-1.218 2.296-1.921 4.88-1.921 7.639s.703 5.343 1.921 7.639l-5.657 5.657C.803 32.748 0 28.59 0 24s.803-8.748 2.57-11.961l5.736 2.652z"/>
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0124 36c-4.635 0-8.527-2.64-10.37-6.309l-5.657 5.657C6.155 38.303 14.136 44 24 44z"/>
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.447-2.274 4.481-4.244 5.962l6.19 5.238C42.015 35.19 44 30.026 44 24c0-1.341-.138-2.65-.389-3.917z"/>
    </svg>
  );

  if (otpStep) {
    const waitSec = Math.max(0, Math.ceil((otpStep.resendAtMs - nowMs) / 1000));
    return (
      <div className="space-y-4 rounded-lg border bg-card p-6 shadow-sm">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Check your email</h2>
          <p className="text-sm text-muted-foreground">
            Code for <span className="font-medium text-foreground">{otpStep.email}</span>
          </p>
          {otpStep.note ? <p className="text-sm text-muted-foreground">{otpStep.note}</p> : null}
        </div>
        <Input
          value={otpCode}
          onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          onKeyDown={(e) => {
            if (e.key === "Enter") void verifyOtp();
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="6-digit code"
          maxLength={6}
          className="text-center text-lg tracking-[0.5em]"
          disabled={otpBusy}
          autoFocus
          aria-label="6-digit code"
        />
        {otpError ? <p className="text-sm text-destructive">{otpError}</p> : null}
        <Button type="button" className="w-full" onClick={() => void verifyOtp()} disabled={otpBusy || otpCode.length !== 6}>
          {otpBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Verify
        </Button>
        <div className="flex items-center justify-between text-sm">
          <Button type="button" variant="link" className="h-auto p-0" onClick={() => closeOtpStep(otpStep.email)} disabled={otpBusy}>
            Back to sign in
          </Button>
          <Button type="button" variant="link" className="h-auto p-0" onClick={() => void resendOtp()} disabled={otpBusy || waitSec > 0}>
            {waitSec > 0 ? `Resend code (${waitSec}s)` : "Resend code"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          After the code is checked, every company and membership already shared with this email on the server shows up
          when you sign in.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <Form {...form}>
        <form autoComplete="off" onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="email"
            render={({ field }: any) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input
                    placeholder="name@example.com"
                    {...field}
                    autoComplete={rememberEmail ? "username" : "off"}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field }: any) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <Input
                    type="password"
                    placeholder="••••••••"
                    {...field}
                    autoComplete={
                      isSignUp ? "new-password" : rememberEmail ? "current-password" : "new-password"
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            {/* Local remember toggle for email convenience in desktop/web login forms. */}
            <input
              type="checkbox"
              checked={rememberEmail}
              onChange={(event) => {
                const next = event.target.checked;
                setRememberEmail(next);
                try {
                  localStorage.setItem(REMEMBER_EMAIL_ENABLED_KEY, next ? "1" : "0");
                  if (next) {
                    const saved = localStorage.getItem(REMEMBER_EMAIL_KEY);
                    if (saved) form.setValue("email", saved);
                  } else {
                    localStorage.removeItem(REMEMBER_EMAIL_KEY);
                  }
                } catch (_) {}
              }}
              className="h-4 w-4 rounded border-input"
            />
            Remember email
          </label>
          <p className="text-xs text-muted-foreground">
            Only the email can be saved on this device. Your password is never stored.
          </p>
          {!isSignUp ? (
            <>
              {canRecover ? (
                <>
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={recoveryMode}
                      onChange={(event) => setRecoveryMode(event.target.checked)}
                      className="h-4 w-4 rounded border-input"
                    />
                    Login as recovery mode?
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Opens only the recovery page: the companies saved on this PC (any account) and an upload to the Pocket
                    Ledger Server for each one.
                  </p>
                </>
              ) : null}
            </>
          ) : null}
          {isSignUp ? (
            <p className="text-xs text-muted-foreground">
              New accounts are created on the Pocket Ledger Server. If the server has email set up, a 6-digit code is sent
              to your email to confirm it. Companies already shared with this email show up after you sign in. The server
              admin may still need to approve the account.
            </p>
          ) : null}
          <div className="space-y-2">
            {serverInfo ? (
              <p className="text-xs text-muted-foreground" data-testid="login-server-info">
                {serverInfo.notLiveName ? `${serverInfo.notLiveName} is not live yet. ` : ""}
                {`You are on ${serverInfo.name} server \u00b7 ${serverInfo.url}`}
              </p>
            ) : null}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <button
                type="button"
                className="underline-offset-2 hover:underline"
                onClick={() => {
                  setShowServerAddress((v) => {
                    if (!v) setServerAddress(getPocketBaseServerUrl());
                    return !v;
                  });
                }}
              >
                {showServerAddress ? "Hide server address" : "Server address"}
              </button>
              <ServerLoginInfoButton />
            </div>
            {showServerAddress ? (
              <Input
                value={serverAddress}
                onChange={(e) => setServerAddress(e.target.value)}
                placeholder="https://server.example.com"
                autoComplete="off"
                spellCheck={false}
                aria-label="Server address"
              />
            ) : null}
          </div>
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isSignUp ? "Sign Up with Email" : "Sign In with Email"}
          </Button>
        </form>
      </Form>
       <div className="mt-4 text-center text-sm">
          <p className="text-muted-foreground">
            {isSignUp ? "Already have an account?" : "Don't have an account?"}{' '}
            <Button variant="link" className="p-0 h-auto" onClick={() => {
                setIsSignUp(!isSignUp);
                form.reset({ email: "", password: "" });
                try {
                  const enabled = readRememberEmailEnabled();
                  setRememberEmail(enabled);
                  if (enabled) {
                    const saved = readRememberedEmail();
                    if (saved) form.setValue("email", saved);
                    setEmailAutofillGuard(false);
                    setPasswordAutofillGuard(false);
                  } else {
                    setEmailAutofillGuard(true);
                    setPasswordAutofillGuard(true);
                  }
                } catch (_) {}
            }}>
                {isSignUp ? "Sign In" : "Sign Up"}
            </Button>
          </p>
        </div>
      <div className="relative my-6">
        <Separator />
        <span className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-sm text-muted-foreground">
          OR
        </span>
      </div>
      <p className="mb-2 text-center text-xs text-muted-foreground">Older accounts (Google)</p>
      <div className="flex w-full items-center gap-2">
        <Button
          variant="outline"
          className="min-w-0 flex-1"
          onClick={handleGoogleSignIn}
          disabled={isGoogleLoading}
        >
          {/* Guest login removed: local-first now runs under authenticated user session only. */}
          {isGoogleLoading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <GoogleIcon />
          )}
          {isElectronDesktopApp() ? "Sign in with Google (browser)" : "Sign in with Google"}
        </Button>
        {onChangeAccount ? (
          <Button type="button" variant="outline" className="shrink-0" onClick={onChangeAccount}>
            Change account
          </Button>
        ) : null}
      </div>
    </div>
  );
}
