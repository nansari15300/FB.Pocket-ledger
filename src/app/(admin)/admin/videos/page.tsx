"use client";

import { adminServerWriteBlocked } from "@/lib/adminData/adminServerMode";
import { useCallback, useEffect, useMemo, useState } from "react";
import { doc, setDoc } from "firebase/firestore";
import { getDocFromServer } from "@/lib/pocketbaseData/pbReadSeam";
import { Video } from "lucide-react";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import { firestore } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  WEBSITE_VIDEO_CATEGORY_COPY,
  WEBSITE_VIDEO_LABEL_COPY,
  WEBSITE_VIDEO_LABELS,
  detectWebsiteVideoPlatform,
  sanitizeWebsiteVideos,
  visibleWebsiteVideoCategories,
  websiteVideoThumb,
  type WebsiteVideo,
  type WebsiteVideoCategory,
  type WebsiteVideoLabel,
} from "@/lib/websiteVideos";
import {
  emptyVideoEngagement,
  mergeVideoStatsDoc,
  type WebsiteVideoEngagement,
} from "@/lib/websiteVideoEngagement";
import { useCachedFeatureConfig } from "@/hooks/useCachedFeatureConfig";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const DOC_REF = () => doc(firestore, "app_settings", "website_videos");
const STATS_REF = () => doc(firestore, "app_settings", "website_video_stats");

export default function WebsiteVideosAdminPage() {
  useAdminAccess(["SuperAdmin"]);
  const { toast } = useToast();
  const { featureConfig } = useCachedFeatureConfig();
  const [videos, setVideos] = useState<WebsiteVideo[]>([]);
  const [engagement, setEngagement] = useState<Record<string, WebsiteVideoEngagement>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState<WebsiteVideoLabel>("howto");
  const [category, setCategory] = useState<WebsiteVideoCategory>("getting-started");
  const [published, setPublished] = useState(true);
  const [platformTab, setPlatformTab] = useState<"all" | "youtube" | "facebook" | "tiktok">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [videoToRemove, setVideoToRemove] = useState<WebsiteVideo | null>(null);

  const visibleCategories = useMemo(
    () => visibleWebsiteVideoCategories(featureConfig),
    [featureConfig]
  );

  useEffect(() => {
    if (!visibleCategories.includes(category)) {
      setCategory("getting-started");
    }
  }, [visibleCategories, category]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [snap, statsSnap] = await Promise.all([
        getDocFromServer(DOC_REF()),
        getDocFromServer(STATS_REF()).catch(() => null),
      ]);
      setVideos(sanitizeWebsiteVideos(snap.exists() ? snap.data() : undefined));
      setEngagement(mergeVideoStatsDoc(statsSnap && statsSnap.exists() ? statsSnap.data() : undefined));
    } catch {
      setVideos([]);
      setEngagement({});
      toast({
        title: "Could not load website videos",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const platformCounts = useMemo(
    () => ({
      youtube: videos.filter((v) => v.platform === "youtube").length,
      facebook: videos.filter((v) => v.platform === "facebook").length,
      tiktok: videos.filter((v) => v.platform === "tiktok").length,
    }),
    [videos]
  );

  const filteredVideos = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return videos.filter((video) => {
      if (platformTab !== "all" && video.platform !== platformTab) return false;
      if (!q) return true;
      return [
        video.title,
        video.url,
        WEBSITE_VIDEO_CATEGORY_COPY[video.category],
        WEBSITE_VIDEO_LABEL_COPY[video.label],
        video.platform,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [videos, platformTab, searchQuery]);

  async function persist(next: WebsiteVideo[]) {
    if (adminServerWriteBlocked()) return;
    setSaving(true);
    try {
      await setDoc(DOC_REF(), { videos: next, updatedAt: Date.now() }, { merge: true });
      setVideos(next);
      toast({ title: "Website videos saved" });
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function addVideo() {
    const platform = detectWebsiteVideoPlatform(url);
    if (!platform) {
      toast({
        title: "Paste a YouTube, Facebook, or TikTok link",
        variant: "destructive",
      });
      return;
    }
    if (!visibleCategories.includes(category)) {
      toast({
        title: "Category hidden in Add/Remove Features",
        variant: "destructive",
      });
      return;
    }
    const next: WebsiteVideo[] = [
      ...videos,
      {
        id: `vid-${Date.now()}`,
        title: title.trim() || "Pocket Ledger video",
        url: url.trim(),
        platform,
        label,
        category,
        published,
        sort: videos.length,
      },
    ];
    await persist(next);
    setPlatformTab(platform);
    setTitle("");
    setUrl("");
    setPublished(true);
    setLabel("howto");
    setCategory("getting-started");
  }

  async function togglePublished(id: string, value: boolean) {
    await persist(videos.map((video) => (video.id === id ? { ...video, published: value } : video)));
  }

  async function removeVideo(id: string) {
    await persist(videos.filter((video) => video.id !== id));
    setVideoToRemove(null);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Video className="h-5 w-5" />
            Website videos
          </CardTitle>
          <CardDescription>
            Add YouTube, Facebook, or TikTok links, then choose the folder where visitors can find the video.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="website-video-title">Title</Label>
            <Input
              id="website-video-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="How to create a company"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="website-video-url">Video URL</Label>
            <Input
              id="website-video-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
            />
          </div>
          <div className="space-y-2">
            <Label>Label</Label>
            <Select value={label} onValueChange={(value) => setLabel(value as WebsiteVideoLabel)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WEBSITE_VIDEO_LABELS.map((key) => (
                  <SelectItem key={key} value={key}>
                    {WEBSITE_VIDEO_LABEL_COPY[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Category</Label>
            <Select value={category} onValueChange={(value) => setCategory(value as WebsiteVideoCategory)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {visibleCategories.map((key) => (
                  <SelectItem key={key} value={key}>
                    {WEBSITE_VIDEO_CATEGORY_COPY[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end justify-between gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={published} onCheckedChange={setPublished} />
              Show on website
            </label>
            <Button type="button" onClick={() => void addVideo()} disabled={saving || !url.trim()}>
              Add video
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="capitalize">{platformTab === "all" ? "All videos" : platformTab}</CardTitle>
              <CardDescription>
                {filteredVideos.length} video{filteredVideos.length === 1 ? "" : "s"}
              </CardDescription>
            </div>
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search title, category, URL…"
              className="sm:max-w-xs"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {([
              ["all", "All"],
              ["youtube", "YouTube"],
              ["facebook", "Facebook"],
              ["tiktok", "TikTok"],
            ] as const).map(([key, label]) => (
              <Button
                key={key}
                type="button"
                size="sm"
                variant={platformTab === key ? "default" : "outline"}
                onClick={() => setPlatformTab(key)}
              >
                {label} {key === "all" ? videos.length : platformCounts[key]}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : filteredVideos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {searchQuery.trim()
                ? "No videos match this search."
                : platformTab === "all"
                  ? "No videos yet."
                  : `No ${platformTab} videos yet.`}
            </p>
          ) : (
            filteredVideos.map((video) => (
              <div
                key={video.id}
                className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  {(() => {
                    const thumb = websiteVideoThumb(video);
                    return (
                      <div
                        className={
                          video.platform === "facebook"
                            ? "h-16 w-28 shrink-0 overflow-hidden rounded-md bg-gradient-to-br from-[#1877f2] to-[#0b1f3a] text-[10px] font-bold text-white grid place-items-center"
                            : video.platform === "tiktok"
                              ? "h-16 w-28 shrink-0 overflow-hidden rounded-md bg-gradient-to-br from-[#25f4ee] via-[#fe2c55] to-[#142033] text-[10px] font-bold text-white grid place-items-center"
                              : "h-16 w-28 shrink-0 overflow-hidden rounded-md bg-slate-900"
                        }
                      >
                        {thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                        ) : (
                          <span>{video.platform === "facebook" ? "FB" : video.platform === "tiktok" ? "TT" : "▶"}</span>
                        )}
                      </div>
                    );
                  })()}
                  <div className="min-w-0">
                    <p className="font-medium break-words">{video.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {WEBSITE_VIDEO_CATEGORY_COPY[video.category]} · {WEBSITE_VIDEO_LABEL_COPY[video.label]} · {video.url}
                    </p>
                    {(() => {
                      const e = engagement[video.id] || emptyVideoEngagement();
                      return (
                        <p className="text-xs text-muted-foreground">
                          Views {e.views} · Likes {e.likes} · Rating{" "}
                          {e.ratingCount ? `${e.ratingAvg.toFixed(1)} (${e.ratingCount})` : "—"}
                        </p>
                      );
                    })()}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <label className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={video.published}
                      disabled={saving}
                      onCheckedChange={(value) => void togglePublished(video.id, value)}
                    />
                    Live
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={saving}
                    onClick={() => setVideoToRemove(video)}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!videoToRemove} onOpenChange={(open) => !open && setVideoToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this video?</AlertDialogTitle>
            <AlertDialogDescription>
              {videoToRemove
                ? `"${videoToRemove.title}" will be deleted from the website videos list.`
                : "This video will be deleted from the website videos list."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving || !videoToRemove}
              onClick={() => {
                if (videoToRemove) void removeVideo(videoToRemove.id);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
