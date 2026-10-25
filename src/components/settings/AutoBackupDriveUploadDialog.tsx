"use client";



import { useCallback, useEffect, useMemo, useState } from "react";

import { Cloud, CheckCircle2, ChevronDown, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

import { Checkbox } from "@/components/ui/checkbox";

import { Input } from "@/components/ui/input";

import { Label } from "@/components/ui/label";

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { SettingsInfoTip } from "@/components/settings/SettingsInfoTip";

import { cn } from "@/lib/utils";

import {

  Dialog,

  DialogContent,

  DialogDescription,

  DialogFooter,

  DialogHeader,

  DialogTitle,

} from "@/components/ui/dialog";

import { useAuth } from "@/hooks/useAuth";

import { useToast } from "@/hooks/use-toast";

import { signInWithGoogleForApp } from "@/lib/googleFirebaseSignIn";

import {

  fetchGoogleDriveConnectionStatus,

  getGoogleDriveAuthUrl,

  openGoogleDriveOAuthUrl,

  resolveDriveOAuthReturnPath,

  type GoogleDriveConnectionStatus,

} from "@/lib/driveAuthClient";

import { readDriveOAuthConnectedMarker } from "@/lib/driveOAuthConnectedMarker";

import { getDriveApiUser, hasDriveApiAuthSession, isLocalSyntheticAuthUid } from "@/lib/firebaseAuthForApi";

import {

  readAutoBackupDrivePrefs,

  saveAutoBackupDrivePrefs,

  type AutoBackupDrivePrefs,

} from "@/lib/autoBackupDrivePrefs";
import { readAutoBackupPrefs } from "@/lib/autoBackupPrefs";
import { formatAutoBackupPathPreview, readBackupLocationDisplayLabel } from "@/lib/backupLocationDisplay";

import { runAutoBackupDriveUpload, type AutoBackupDriveUploadProgress } from "@/lib/autoBackupDriveUpload";
import { warmUpBackupFolderReadAccess } from "@/lib/autoBackupDriveList";

import { runAutoBackupDriveUploadWithRunner } from "@/lib/autoBackupDriveUploadRunner";

import { isBackupSaveLocationConfigured } from "@/lib/backupSaveLocation";

import {

  isLocalGoogleDriveSyncDisabled,

  LOCAL_GOOGLE_DRIVE_SYNC_DISABLED_MESSAGE,

} from "@/lib/localCloudSync/driveSyncDisabled";



type Props = {

  open: boolean;

  onOpenChange: (open: boolean) => void;

  companies: Array<{ id: string; name: string }>;

};



const NUM_INPUT_CLASS = "h-8 w-16 shrink-0 tabular-nums";
const UPLOAD_RANGE_TABLE_CELL = "border border-border/30 px-2 py-1.5 align-middle";
const UPLOAD_RANGE_TABLE_HEAD =
  "border border-border/30 bg-muted/30 px-2 py-1.5 text-left text-xs font-medium text-muted-foreground/80";
const DRIVE_DIALOG_BTN_CN = "pl-chrome-btn-drop text-primary hover:bg-primary/10";



export function AutoBackupDriveUploadDialog({ open, onOpenChange, companies }: Props) {

  const { user } = useAuth();

  const { toast } = useToast();

  const [draft, setDraft] = useState<AutoBackupDrivePrefs>(() => readAutoBackupDrivePrefs());

  const [busy, setBusy] = useState(false);

  const [driveBusy, setDriveBusy] = useState(false);

  const [progress, setProgress] = useState<AutoBackupDriveUploadProgress | null>(null);

  const [signedIn, setSignedIn] = useState(false);

  const [driveConnection, setDriveConnection] = useState<GoogleDriveConnectionStatus | null>(null);

  const [driveStatusLoading, setDriveStatusLoading] = useState(false);

  const [driveStatusError, setDriveStatusError] = useState<string | null>(null);



  const refreshDriveConnection = useCallback(async () => {

    if (!hasDriveApiAuthSession()) {

      setDriveConnection(null);

      setDriveStatusError(null);

      return;

    }

    setDriveStatusLoading(true);

    setDriveStatusError(null);

    try {

      const status = await fetchGoogleDriveConnectionStatus();

      setDriveConnection(status);

      if (!status.connected) {

        const marker = readDriveOAuthConnectedMarker();

        if (marker) {

          setDriveConnection({

            connected: true,

            email: marker.email ?? user?.email ?? null,

          });

        }

      }

    } catch (e) {

      const marker = readDriveOAuthConnectedMarker();

      if (marker) {

        setDriveConnection({

          connected: true,

          email: marker.email ?? user?.email ?? null,

        });

      } else {

        setDriveConnection({ connected: false, email: null });

        setDriveStatusError(e instanceof Error ? e.message : String(e));

      }

    } finally {

      setDriveStatusLoading(false);

    }

  }, [user?.email]);



  useEffect(() => {

    if (!open) return;

    const prefs = readAutoBackupDrivePrefs();

    const defaultCompanyIds =

      prefs.uploadCompanyIds.length > 0

        ? prefs.uploadCompanyIds

        : companies.map((c) => c.id).filter(Boolean);

    setDraft({ ...prefs, uploadCompanyIds: defaultCompanyIds });

    setProgress(null);

    setDriveStatusError(null);

    const isSignedIn = hasDriveApiAuthSession();

    setSignedIn(isSignedIn);

    if (isSignedIn) {

      void refreshDriveConnection();

    } else {

      setDriveConnection(null);

    }

    void warmUpBackupFolderReadAccess();

  }, [open, companies, refreshDriveConnection]);



  const backupFolderHint = useMemo(() => {

    const root = readBackupLocationDisplayLabel();

    const pathPreview = formatAutoBackupPathPreview(root, readAutoBackupPrefs().folderDateSystem);

    return pathPreview || root;

  }, [open]);



  const toggleUploadCompany = (companyId: string, checked: boolean) => {

    const id = String(companyId || "").trim();

    if (!id) return;

    const set = new Set(draft.uploadCompanyIds);

    if (checked) set.add(id);

    else set.delete(id);

    setDraft({ ...draft, uploadCompanyIds: [...set] });

  };



  const selectAllUploadCompanies = () => {

    setDraft({ ...draft, uploadCompanyIds: companyList.map((c) => c.id) });

  };



  useEffect(() => {

    if (!open || !signedIn) return;

    const onDriveConnectionChanged = () => {

      void refreshDriveConnection();

    };

    window.addEventListener("pl-drive-connection-changed", onDriveConnectionChanged);

    return () => window.removeEventListener("pl-drive-connection-changed", onDriveConnectionChanged);

  }, [open, signedIn, refreshDriveConnection]);



  const driveDisabled = isLocalGoogleDriveSyncDisabled();

  const backupLocationReady = isBackupSaveLocationConfigured();

  const localOnlyAuth = isLocalSyntheticAuthUid(user?.uid);



  const companyList = useMemo(

    () => companies.filter((c) => String(c.id || "").trim() && String(c.name || "").trim()),

    [companies]

  );



  const uploadCompanyTriggerLabel = useMemo(() => {

    const selected = companyList.filter((c) => draft.uploadCompanyIds.includes(c.id));

    if (!companyList.length) return "No companies";

    if (!selected.length) return "Select companies…";

    if (selected.length === 1) return selected[0]!.name;

    if (selected.length === companyList.length) return `All companies (${selected.length})`;

    return `${selected.length} companies selected`;

  }, [companyList, draft.uploadCompanyIds]);



  const savePrefs = useCallback(() => {

    saveAutoBackupDrivePrefs(draft);

    toast({ title: "Drive upload settings saved" });

  }, [draft, toast]);



  const signInGoogle = async () => {

    setBusy(true);

    try {

      await signInWithGoogleForApp();

      setSignedIn(hasDriveApiAuthSession());

      await refreshDriveConnection();

      toast({ title: "Signed in", description: "You can now connect Google Drive." });

    } catch (e) {

      toast({

        variant: "destructive",

        title: "Sign-in failed",

        description: e instanceof Error ? e.message : String(e),

      });

    } finally {

      setBusy(false);

    }

  };



  const connectDrive = async () => {

    if (driveDisabled) {

      toast({ title: "Drive disabled", description: LOCAL_GOOGLE_DRIVE_SYNC_DISABLED_MESSAGE });

      return;

    }

    setDriveBusy(true);

    try {

      const firebaseUser = await getDriveApiUser();

      const { url } = await getGoogleDriveAuthUrl({

        returnPath: resolveDriveOAuthReturnPath("/backup"),

        uid: firebaseUser.uid,

        email: firebaseUser.email ?? undefined,

      });

      await openGoogleDriveOAuthUrl(url);

    } catch (e) {

      toast({

        variant: "destructive",

        title: localOnlyAuth ? "Google sign-in required" : "Drive connect failed",

        description: e instanceof Error ? e.message : String(e),

      });

    } finally {

      setDriveBusy(false);

    }

  };



  const driveLinked = driveConnection?.connected === true;

  const driveEmail =

    driveConnection?.email?.trim() ||

    user?.email?.trim() ||

    user?.providerData?.find((p) => p?.email)?.email?.trim() ||

    null;



  const uploadNow = async () => {

    if (driveDisabled) {

      toast({ title: "Drive disabled", description: LOCAL_GOOGLE_DRIVE_SYNC_DISABLED_MESSAGE });

      return;

    }

    if (!signedIn) {

      toast({ variant: "destructive", title: "Sign in required", description: "Sign in with Google first." });

      return;

    }

    if (!driveLinked) {

      toast({ variant: "destructive", title: "Connect Google Drive", description: "Connect Drive before uploading backups." });

      return;

    }

    if (!backupLocationReady) {

      toast({

        variant: "destructive",

        title: "Backup folder not set",

        description: "Choose Backup location before uploading to Drive.",

      });

      return;

    }

    if (!draft.uploadCompanyIds.length) {

      toast({

        variant: "destructive",

        title: "Select companies",

        description: "Tick at least one company to upload backups for.",

      });

      return;

    }

    saveAutoBackupDrivePrefs(draft);

    setBusy(true);

    setProgress({ phase: "listing", total: 0, done: 0, uploaded: 0, skipped: 0, pruned: 0 });

    try {

      const result = await runAutoBackupDriveUploadWithRunner({

        companyName: companyList.length === 1 ? companyList[0]!.name : "All companies",

        run: (onProgress) =>

          runAutoBackupDriveUpload({

            prefs: draft,

            companies: companyList,

            onProgress: (p) => {

              setProgress(p);

              onProgress(p);

            },

          }),

      });

      if (result.phase === "error") {

        toast({

          variant: "destructive",

          title: "Drive upload failed",

          description: result.error ?? result.skipReason ?? "Unknown error",

        });

        return;

      }

      toast({

        title: "Drive upload complete",

        description: `Uploaded ${result.uploaded} file(s)${result.skipped ? `, skipped ${result.skipped}` : ""}${

          result.pruned ? `, pruned ${result.pruned} old` : ""

        }${result.skipReason ? ` — ${result.skipReason}` : ""}.`,

      });

    } finally {

      setBusy(false);

    }

  };



  return (

    <Dialog open={open} onOpenChange={onOpenChange}>

      <DialogContent className="max-w-md" data-pl-backup-dialog="sky">

        <DialogHeader>

          <DialogTitle className="flex items-center gap-1.5">

            <Cloud className="h-5 w-5 shrink-0" />

            Drive backup upload

            <SettingsInfoTip
              label="Drive backup upload"
              description={
                <>
                  Upload saved <code className="text-[11px]">.plbp</code> auto/manual backups from your backup folder to
                  a Google Drive folder. This is separate from live ledger Drive sync.
                </>
              }
            />

          </DialogTitle>

          <DialogDescription className="sr-only">

            Upload saved plbp backups to Google Drive. Separate from live ledger Drive sync.

          </DialogDescription>

        </DialogHeader>



        <div className="space-y-4 text-sm">

          {!signedIn ? (

            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">

              <p className="text-xs text-muted-foreground">Google account sign-in is required before Drive upload.</p>

              <Button type="button" variant="outline" size="sm" disabled={busy} className={DRIVE_DIALOG_BTN_CN} onClick={() => void signInGoogle()}>

                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}

                Sign in with Google

              </Button>

            </div>

          ) : driveStatusLoading ? (

            <div className="flex items-center gap-2 text-xs text-muted-foreground">

              <Loader2 className="h-4 w-4 animate-spin" />

              Checking Google Drive connection…

            </div>

          ) : driveLinked ? (

            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3">

              <div className="flex items-start gap-2">

                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />

                <div className="min-w-0">

                  <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">Connected</p>

                  {driveEmail ? (

                    <p className="text-xs text-muted-foreground break-all">{driveEmail}</p>

                  ) : null}

                </div>

              </div>

            </div>

          ) : (

            <div className="space-y-2">

              <div className="flex flex-wrap items-center gap-2">

                <Button type="button" variant="outline" size="sm" disabled={driveBusy || driveDisabled} className={DRIVE_DIALOG_BTN_CN} onClick={() => void connectDrive()}>

                  {driveBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}

                  Connect Google Drive

                </Button>

                <span className="text-xs text-muted-foreground">Required once per browser for Drive API access.</span>

              </div>

              {driveStatusError ? (

                <p className="text-xs text-destructive">{driveStatusError}</p>

              ) : null}

            </div>

          )}



          <div className="space-y-2">

            <Label htmlFor="drive-backup-main-folder">Main folder on Drive</Label>

            <Input

              id="drive-backup-main-folder"

              value={draft.mainFolderName}

              onChange={(e) => setDraft({ ...draft, mainFolderName: e.target.value })}

              placeholder="Pocket Ledger Backups"

              maxLength={80}

            />

          </div>



          <div className="space-y-2">

            <Label>Companies to upload</Label>

            {companyList.length ? (

              <Popover>

                <PopoverTrigger asChild>

                  <Button

                    type="button"

                    variant="outline"

                    className={cn("h-9 w-full justify-between px-3 font-normal", DRIVE_DIALOG_BTN_CN)}

                  >

                    <span className="truncate text-left">{uploadCompanyTriggerLabel}</span>

                    <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-60" />

                  </Button>

                </PopoverTrigger>

                <PopoverContent

                  className="z-[10050] w-[var(--radix-popover-trigger-width)] p-0"

                  align="start"

                  onOpenAutoFocus={(e) => e.preventDefault()}

                >

                  <div className="flex items-center justify-between border-b border-border/30 px-3 py-2">

                    <span className="text-xs font-medium text-muted-foreground">All my companies</span>

                    <button

                      type="button"

                      className="text-xs font-medium text-primary hover:underline"

                      onClick={selectAllUploadCompanies}

                    >

                      Select all

                    </button>

                  </div>

                  <div className="max-h-52 overflow-y-auto p-2 space-y-0.5">

                    {companyList.map((c) => {

                      const checked = draft.uploadCompanyIds.includes(c.id);

                      return (

                        <div

                          key={c.id}

                          className="flex items-center gap-2 rounded-sm px-1.5 py-1.5 hover:bg-muted/50"

                        >

                          <Checkbox

                            id={`drive-upload-co-${c.id}`}

                            checked={checked}

                            onCheckedChange={(v) => toggleUploadCompany(c.id, v === true)}

                          />

                          <Label

                            htmlFor={`drive-upload-co-${c.id}`}

                            className="min-w-0 flex-1 cursor-pointer truncate text-sm font-normal"

                          >

                            {c.name}

                          </Label>

                        </div>

                      );

                    })}

                  </div>

                </PopoverContent>

              </Popover>

            ) : (

              <p className="text-xs text-muted-foreground">No owned companies found.</p>

            )}

            <p className="text-[11px] leading-snug text-muted-foreground">

              Reads device backup folder: <span className="break-all font-medium text-foreground/80">{backupFolderHint}</span>

            </p>

          </div>



          <div className="space-y-2">

            <Label>Upload range</Label>

            <RadioGroup

              value={draft.uploadMode}

              onValueChange={(v) => setDraft({ ...draft, uploadMode: v === "all" ? "all" : "days" })}

            >

              <table className="w-full border-collapse rounded-md border border-border/30 text-sm">

                <thead>

                  <tr>

                    <th className={`${UPLOAD_RANGE_TABLE_HEAD} w-9`} scope="col" aria-hidden />

                    <th className={UPLOAD_RANGE_TABLE_HEAD} scope="col">

                      Label

                    </th>

                    <th className={`${UPLOAD_RANGE_TABLE_HEAD} w-[4.5rem]`} scope="col">

                      Input

                    </th>

                    <th className={UPLOAD_RANGE_TABLE_HEAD} scope="col">

                      Suffix

                    </th>

                  </tr>

                </thead>

                <tbody>

                  <tr>

                    <td className={`${UPLOAD_RANGE_TABLE_CELL} w-9`}>

                      <RadioGroupItem value="all" id="drive-upload-all" />

                    </td>

                    <td className={UPLOAD_RANGE_TABLE_CELL}>

                      <Label htmlFor="drive-upload-all" className="font-normal cursor-pointer">

                        Upload all backups in folder

                      </Label>

                    </td>

                    <td className={UPLOAD_RANGE_TABLE_CELL} />

                    <td className={UPLOAD_RANGE_TABLE_CELL} />

                  </tr>

                  <tr>

                    <td className={UPLOAD_RANGE_TABLE_CELL}>

                      <RadioGroupItem value="days" id="drive-upload-days" />

                    </td>

                    <td className={`${UPLOAD_RANGE_TABLE_CELL} whitespace-nowrap`}>

                      <Label htmlFor="drive-upload-days" className="font-normal cursor-pointer">

                        Upload only last

                      </Label>

                    </td>

                    <td className={UPLOAD_RANGE_TABLE_CELL}>

                      <Input

                        type="number"

                        min={1}

                        max={365}

                        className={NUM_INPUT_CLASS}

                        disabled={draft.uploadMode !== "days"}

                        value={draft.uploadDays}

                        onChange={(e) =>

                          setDraft({ ...draft, uploadDays: Math.max(1, Math.min(365, Number(e.target.value) || 7)) })

                        }

                      />

                    </td>

                    <td className={`${UPLOAD_RANGE_TABLE_CELL} text-muted-foreground`}>days</td>

                  </tr>

                  <tr>

                    <td className={UPLOAD_RANGE_TABLE_CELL} />

                    <td className={`${UPLOAD_RANGE_TABLE_CELL} whitespace-nowrap`}>

                      <Label htmlFor="drive-keep-per-co" className="font-normal">

                        Keep on Drive per company

                      </Label>

                    </td>

                    <td className={UPLOAD_RANGE_TABLE_CELL}>

                      <Input

                        id="drive-keep-per-co"

                        type="number"

                        min={1}

                        max={500}

                        className={NUM_INPUT_CLASS}

                        value={draft.keepPerCompany}

                        onChange={(e) =>

                          setDraft({

                            ...draft,

                            keepPerCompany: Math.max(1, Math.min(500, Number(e.target.value) || 30)),

                          })

                        }

                      />

                    </td>

                    <td className={`${UPLOAD_RANGE_TABLE_CELL} text-muted-foreground`}>newest `.plbp` files</td>

                  </tr>

                </tbody>

              </table>

            </RadioGroup>

          </div>



          {progress ? (

            <p className="text-xs text-muted-foreground">

              {progress.phase === "listing"

                ? "Scanning backup folder…"

                : progress.phase === "uploading"

                  ? `Uploading ${progress.done + 1}/${progress.total}: ${progress.currentFile ?? ""}`

                  : progress.phase === "done"

                    ? `Done — uploaded ${progress.uploaded}, skipped ${progress.skipped}.${
                        progress.skipReason ? ` ${progress.skipReason}` : ""
                      }`

                    : progress.error || progress.skipReason}

            </p>

          ) : null}

        </div>



        <DialogFooter className="flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">

          <div className="flex items-center gap-1.5">

            <Checkbox

              id="drive-auto-upload"

              checked={draft.autoUploadEnabled}

              onCheckedChange={(v) => setDraft({ ...draft, autoUploadEnabled: v === true })}

            />

            <Label htmlFor="drive-auto-upload" className="cursor-pointer text-sm font-normal">

              Auto upload

            </Label>

            <SettingsInfoTip

              label="Auto upload"

              description="Runs only when a new backup finishes (scheduled or manual). Progress shows in the header strip on PC."

            />

          </div>

          <div className="flex flex-wrap gap-2 sm:justify-end">

            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(DRIVE_DIALOG_BTN_CN)}
              onClick={savePrefs}
              disabled={busy}
            >

              Save settings

            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(DRIVE_DIALOG_BTN_CN)}
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >

              Close

            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(DRIVE_DIALOG_BTN_CN)}
              onClick={() => void uploadNow()}
              disabled={busy || !signedIn || !driveLinked}
            >

              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}

              Upload now

            </Button>

          </div>

        </DialogFooter>

      </DialogContent>

    </Dialog>

  );

}


