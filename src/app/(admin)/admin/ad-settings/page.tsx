"use client";

import { setDoc } from "@/lib/writeGateway/pbWrites";
import { useCallback, useEffect, useState } from "react";
import { doc } from "@/lib/pbCompat/firestore";
import { getDocFromServer } from "@/lib/pocketbaseData/pbReadSeam";
import { ChevronDown, Info, Loader2, Megaphone, Save, ShieldCheck } from "lucide-react";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import { firestore } from "@/lib/plClientSession";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AD_FEATURE_LOCK_SCREENS,
  AD_SETTINGS_DOC,
  AD_SERVER_SYNC_HOURS_OPTIONS,
  adServerSyncIntro,
  adServerSyncLabel,
  adUnlockIntro,
  adUnlockSwitchIntro,
  DEFAULT_AD_SETTINGS,
  normalizeAdSettings,
  type AdSettings,
  type AdUnlockId,
} from "@/lib/adSettings";
import { cn } from "@/lib/utils";

const settingsRef = () => doc(firestore, AD_SETTINGS_DOC);

function numberValue(value: string, fallback: number): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function FeatureInfoTip({ intro, label }: { intro: string; label: string }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            aria-label={`About ${label}`}
          >
            <Info className="h-4 w-4" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[22rem] text-xs leading-snug">
          {intro}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default function AdSettingsPage() {
  useAdminAccess(["SuperAdmin"]);
  const { toast } = useToast();
  const [settings, setSettings] = useState<AdSettings>(DEFAULT_AD_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDocFromServer(settingsRef());
      setSettings(normalizeAdSettings(snap.exists() ? snap.data() : undefined));
    } catch {
      setSettings(DEFAULT_AD_SETTINGS);
      toast({ title: "Could not load Ad Settings", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(next: AdSettings, message = "Ad Settings saved") {
    setSaving(true);
    try {
      const normalized = normalizeAdSettings({ ...next, updatedAtMs: Date.now() });
      await setDoc(settingsRef(), normalized, { merge: true });
      setSettings(normalized);
      toast({ title: message });
    } catch {
      toast({ title: "Could not save Ad Settings", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  function updateRewardPoints(id: string, value: string) {
    setSettings((current) => ({
      ...current,
      rewardTiers: current.rewardTiers.map((tier) =>
        tier.id === id ? { ...tier, points: numberValue(value, tier.points) } : tier
      ),
    }));
  }

  function updateOffer(id: string, field: "pointsCost" | "durationHours", value: string) {
    setSettings((current) => ({
      ...current,
      unlockOffers: current.unlockOffers.map((offer) =>
        offer.id === id
          ? { ...offer, [field]: numberValue(value, offer[field]) }
          : offer
      ),
    }));
  }

  const selectedLockLabels = AD_FEATURE_LOCK_SCREENS.filter((row) =>
    settings.placements.featureLockScreens.includes(row.id)
  ).map((row) => row.label);

  const lockedScreensIntro = settings.placements.featureLock
    ? settings.placements.featureLockScreens.length === 0
      ? "Tick locations where a rewarded ad may appear when that feature is locked. No screens are ticked yet — no locked-feature ads will show."
      : `Tick locations where a rewarded ad may appear when that feature is locked. Currently selected: ${selectedLockLabels.join(", ")}.`
    : "Tick locations where a rewarded ad may appear when that feature is locked. Master switch for locked screens is OFF.";

  if (loading) {
    return (
      <div className="grid min-h-[50vh] place-items-center">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5" />
            Ad Settings
            <FeatureInfoTip
              intro="Configure Rewarded Ads for APK users. Ads are disabled by default, so the app stays exactly as it is until this switch is enabled."
              label="Ad Settings"
            />
          </CardTitle>
          <div className="flex items-center gap-3 rounded-lg border px-3 py-2">
            <div className="flex items-center gap-1 text-right">
              <p className="text-sm font-medium">{settings.enabled ? "Ads ON" : "Ads OFF"}</p>
              <FeatureInfoTip
                intro={
                  settings.enabled
                    ? "Reward configuration is active. Turn OFF to restore current app behavior with no ad or points UI."
                    : "No ad or point UI is active. Turn ON to use the settings below."
                }
                label="Ads master switch"
              />
            </div>
            <Switch
              checked={settings.enabled}
              disabled={saving}
              onCheckedChange={(enabled) => {
                const next = { ...settings, enabled };
                setSettings(next);
                void save(next, enabled ? "Ads enabled" : "Ads disabled — current app behavior restored");
              }}
              aria-label="Enable ads"
            />
          </div>
        </CardHeader>
      </Card>

      <Card className={settings.enabled ? "" : "opacity-60"}>
        <CardHeader>
          <CardTitle className="flex items-center gap-1 text-base">
            Where to show rewarded ads
            <FeatureInfoTip
              intro="These placements are used only when the master Ads switch is ON."
              label="Where to show rewarded ads"
            />
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="space-y-3 rounded-lg border p-3 md:col-span-1">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-1">
                <Label className="text-sm font-medium">Locked feature screens</Label>
                <FeatureInfoTip intro={lockedScreensIntro} label="Locked feature screens" />
              </div>
              <Switch
                checked={settings.placements.featureLock}
                disabled={saving || !settings.enabled}
                onCheckedChange={(checked) =>
                  setSettings((current) => ({
                    ...current,
                    placements: { ...current.placements, featureLock: checked },
                  }))
                }
                aria-label="Enable locked feature screen ads"
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-between"
                  disabled={saving || !settings.enabled || !settings.placements.featureLock}
                >
                  <span className="truncate">
                    {settings.placements.featureLockScreens.length === 0
                      ? "Select screens…"
                      : `${settings.placements.featureLockScreens.length} screen${
                          settings.placements.featureLockScreens.length === 1 ? "" : "s"
                        } selected`}
                  </span>
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-72 w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
              >
                <DropdownMenuLabel>Show ad on these locked screens</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {AD_FEATURE_LOCK_SCREENS.map((screen) => {
                  const checked = settings.placements.featureLockScreens.includes(screen.id);
                  return (
                    <DropdownMenuCheckboxItem
                      key={screen.id}
                      checked={checked}
                      onSelect={(event) => event.preventDefault()}
                      onCheckedChange={(next) => {
                        setSettings((current) => {
                          const set = new Set(current.placements.featureLockScreens);
                          if (next) set.add(screen.id);
                          else set.delete(screen.id);
                          return {
                            ...current,
                            placements: {
                              ...current.placements,
                              featureLockScreens: AD_FEATURE_LOCK_SCREENS.map((row) => row.id).filter((id) =>
                                set.has(id)
                              ),
                            },
                          };
                        });
                      }}
                    >
                      {screen.label}
                    </DropdownMenuCheckboxItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {([
            ["billing", "Billing & Plans", "Show the reward-points entry in the billing screen."],
            ["settings", "Settings", "Show wallet and reward information in Settings."],
          ] as const).map(([key, label, description]) => (
            <div key={key} className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="flex min-w-0 items-center gap-1">
                <Label className="text-sm font-medium">{label}</Label>
                <FeatureInfoTip intro={description} label={label} />
              </div>
              <Switch
                checked={settings.placements[key]}
                disabled={saving || !settings.enabled}
                onCheckedChange={(checked) =>
                  setSettings((current) => ({
                    ...current,
                    placements: { ...current.placements, [key]: checked },
                  }))
                }
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className={settings.enabled ? "" : "opacity-60"}>
        <CardHeader>
          <CardTitle className="flex items-center gap-1 text-base">
            Reward points for completed ads
            <FeatureInfoTip
              intro="AdMob decides exact creative duration. These tiers define the points your verified completion callback awards."
              label="Reward points"
            />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {settings.rewardTiers.map((tier) => (
              <div key={tier.id} className="flex flex-col gap-3 rounded-lg border p-3">
                <div className="flex items-center gap-1">
                  <Label className="text-sm font-medium">{tier.label}</Label>
                  <FeatureInfoTip
                    intro={`Completed ad of about ${tier.minimumSeconds} seconds. Set how many points to award when this tier is enabled.`}
                    label={tier.label}
                  />
                </div>
                <div className="mt-auto flex items-center gap-2">
                  <Input
                    aria-label={`${tier.label} reward points`}
                    type="number"
                    min={0}
                    value={tier.points}
                    disabled={saving || !settings.enabled || !tier.enabled}
                    onChange={(event) => updateRewardPoints(tier.id, event.target.value)}
                    className="w-20"
                  />
                  <span className="text-xs text-muted-foreground">points</span>
                  <Switch
                    className="ml-auto"
                    checked={tier.enabled}
                    disabled={saving || !settings.enabled}
                    onCheckedChange={(enabled) =>
                      setSettings((current) => ({
                        ...current,
                        rewardTiers: current.rewardTiers.map((row) =>
                          row.id === tier.id ? { ...row, enabled } : row
                        ),
                      }))
                    }
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 p-3">
            <div className="flex items-center gap-1">
              <Label htmlFor="dailyMaxPoints">Daily maximum per user</Label>
              <FeatureInfoTip
                intro="Maximum reward points a single user can earn from ads in one day. Helps limit abuse and Firebase cost."
                label="Daily maximum"
              />
            </div>
            <div className="flex items-center gap-2">
              <Input
                id="dailyMaxPoints"
                type="number"
                min={0}
                value={settings.dailyMaxPoints}
                disabled={saving || !settings.enabled}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    dailyMaxPoints: numberValue(event.target.value, current.dailyMaxPoints),
                  }))
                }
                className="w-24"
              />
              <span className="text-xs text-muted-foreground">points / day</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className={settings.enabled ? "" : "opacity-60"}>
        <CardHeader>
          <CardTitle className="flex items-center gap-1 text-base">
            Unlock catalog
            <FeatureInfoTip
              intro="Plan / quota unlocks plus app menu features (Parties, Reports, Gate, etc.). Toggle each offer on when you want it available for points. Title (i) = pts / hrs unlock meaning. Switch (i) = what applies when that offer is ON or OFF (OFF = feature stays allowed with no points barrier). App unlock wiring stays inactive until ads are enabled and integrated."
              label="Unlock catalog"
            />
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {settings.unlockOffers.map((offer) => {
            const unlockId = offer.id as AdUnlockId;
            const intro = adUnlockIntro(
              unlockId,
              offer.pointsCost,
              offer.durationHours,
              offer.label
            );
            const switchIntro = adUnlockSwitchIntro(
              unlockId,
              offer.enabled,
              offer.pointsCost,
              offer.durationHours,
              offer.label
            );
            return (
              <div key={offer.id} className="space-y-2 rounded-lg border p-3">
                <div className="flex min-w-0 items-center gap-1">
                  <Label className="truncate text-sm font-medium">{offer.label}</Label>
                  <FeatureInfoTip intro={intro} label={offer.label} />
                </div>
                <div className="flex flex-nowrap items-center gap-2">
                  <Input
                    aria-label={`${offer.label} points cost`}
                    type="number"
                    min={0}
                    value={offer.pointsCost}
                    disabled={saving || !settings.enabled || !offer.enabled}
                    onChange={(event) => updateOffer(offer.id, "pointsCost", event.target.value)}
                    className="h-9 w-16 shrink-0"
                  />
                  <span className="shrink-0 text-xs text-muted-foreground">pts</span>
                  <span className="shrink-0 text-xs text-muted-foreground">upto</span>
                  <Input
                    aria-label={`${offer.label} duration hours`}
                    type="number"
                    min={1}
                    value={offer.durationHours}
                    disabled={saving || !settings.enabled || !offer.enabled}
                    onChange={(event) => updateOffer(offer.id, "durationHours", event.target.value)}
                    className="h-9 w-16 shrink-0"
                  />
                  <span className="shrink-0 text-xs text-muted-foreground">hrs</span>
                  <div className="ml-auto flex shrink-0 flex-col items-center gap-0.5">
                    <FeatureInfoTip intro={switchIntro} label={`${offer.label} switch`} />
                    <Switch
                      checked={offer.enabled}
                      disabled={saving || !settings.enabled}
                      onCheckedChange={(enabled) =>
                        setSettings((current) => ({
                          ...current,
                          unlockOffers: current.unlockOffers.map((row) =>
                            row.id === offer.id ? { ...row, enabled } : row
                          ),
                        }))
                      }
                      aria-label={`Enable ${offer.label}`}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className={settings.enabled ? "" : "opacity-60"}>
        <CardHeader>
          <CardTitle className="flex items-center gap-1 text-base">
            When to save ad data on the server
            <FeatureInfoTip
              intro={`${adServerSyncIntro(settings.serverSyncHours)} Choose Live for immediate server writes (stronger anti-cheat), or 1–12 hours so rewards stay on the device first and sync in a batch. Users still see points instantly on device.`}
              label="server sync timing"
            />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {AD_SERVER_SYNC_HOURS_OPTIONS.map((hours) => {
              const selected = settings.serverSyncHours === hours;
              return (
                <button
                  key={hours}
                  type="button"
                  disabled={saving || !settings.enabled}
                  onClick={() =>
                    setSettings((current) => ({
                      ...current,
                      serverSyncHours: hours,
                    }))
                  }
                  className={cn(
                    "rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "bg-background hover:bg-muted/60",
                    (saving || !settings.enabled) && "cursor-not-allowed opacity-60"
                  )}
                  aria-pressed={selected}
                >
                  {adServerSyncLabel(hours)}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card className={settings.enabled ? "" : "opacity-60"}>
        <CardHeader>
          <CardTitle className="flex items-center gap-1 text-base">
            <ShieldCheck className="h-4 w-4" />
            AdMob APK setup
            <FeatureInfoTip
              intro="Keep Test mode ON until the Rewarded Ad integration and Google test-ad verification are complete. Paste your rewarded ad unit ID for the APK."
              label="AdMob APK setup"
            />
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <div className="space-y-2">
            <div className="flex items-center gap-1">
              <Label htmlFor="rewardedUnitId">Rewarded ad unit ID</Label>
              <FeatureInfoTip
                intro="AdMob rewarded ad unit ID for the APK (format ca-app-pub-…/…). Required for real rewarded ads after Test mode is turned OFF."
                label="Rewarded ad unit ID"
              />
            </div>
            <Input
              id="rewardedUnitId"
              placeholder="ca-app-pub-…/…"
              value={settings.admob.rewardedUnitId}
              disabled={saving || !settings.enabled}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  admob: { ...current.admob, rewardedUnitId: event.target.value },
                }))
              }
            />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3 md:min-w-48">
            <div className="flex items-center gap-1">
              <Label className="text-sm font-medium">Test mode</Label>
              <FeatureInfoTip
                intro="Use Google test ads only. Keep ON until Rewarded Ad integration and verification are complete."
                label="Test mode"
              />
            </div>
            <Switch
              checked={settings.admob.testMode}
              disabled={saving || !settings.enabled}
              onCheckedChange={(testMode) =>
                setSettings((current) => ({
                  ...current,
                  admob: { ...current.admob, testMode },
                }))
              }
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button disabled={saving} onClick={() => void save(settings)}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save Ad Settings
        </Button>
      </div>
    </div>
  );
}
