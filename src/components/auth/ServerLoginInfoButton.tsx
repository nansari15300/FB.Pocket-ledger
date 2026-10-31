"use client";

import { useState } from "react";
import { AppFreshInfoButton } from "@/components/ui/AppFreshInfoButton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Lang = "en" | "hi" | "ne";

const LANGS: { id: Lang; label: string }[] = [
  { id: "en", label: "English" },
  { id: "hi", label: "हिन्दी" },
  { id: "ne", label: "नेपाली" },
];

const COPY: Record<Lang, { title: string; points: string[] }> = {
  en: {
    title: "Signing in",
    points: [
      "The line above the server address shows which country server you are on and the exact address sign-in uses.",
      "Email sign-in works for both account types: accounts on your Pocket Ledger Server and older accounts.",
      "Server accounts are created by your administrator, or with Sign Up. A new Sign Up account can sign in only after the server admin approves it.",
      "Server address: only change it if your administrator gave you a different address. Leave it as it is otherwise.",
      "Sign in with Google is only for older accounts that were opened with Google.",
      "Company passwords stay the same. After you sign in, each company still asks for its own password.",
    ],
  },
  hi: {
    title: "साइन इन",
    points: [
      "सर्वर पते के ऊपर की पंक्ति बताती है कि आप किस देश के सर्वर पर हैं और साइन-इन किस पते का उपयोग करता है।",
      "ईमेल से साइन इन दोनों तरह के खातों के लिए काम करता है: आपके Pocket Ledger Server वाले खाते और पुराने खाते।",
      "सर्वर खाते आपके एडमिन बनाते हैं, या आप साइन अप से बना सकते हैं। साइन अप वाला नया खाता सर्वर एडमिन की मंज़ूरी के बाद ही साइन इन कर सकता है।",
      "सर्वर पता: इसे तभी बदलें जब एडमिन ने आपको कोई दूसरा पता दिया हो। नहीं तो जैसा है वैसा ही रहने दें।",
      "Google से साइन इन केवल उन पुराने खातों के लिए है जो Google से खोले गए थे।",
      "कंपनी के पासवर्ड वही रहेंगे। साइन इन के बाद हर कंपनी अपना पासवर्ड अलग से माँगेगी।",
    ],
  },
  ne: {
    title: "साइन इन",
    points: [
      "सर्भर ठेगानाको माथिको लाइनले तपाईं कुन देशको सर्भरमा हुनुहुन्छ र साइन-इनले कुन ठेगाना प्रयोग गर्छ भनेर देखाउँछ।",
      "इमेलबाट साइन इन दुवै किसिमका खाताका लागि चल्छ: तपाईंको Pocket Ledger Server का खाता र पुराना खाता।",
      "सर्भर खाता तपाईंको एडमिनले बनाउनुहुन्छ, वा साइन अपबाट बनाउन सकिन्छ। साइन अपबाट बनेको नयाँ खाताले सर्भर एडमिनले स्वीकृत गरेपछि मात्र साइन इन गर्न सक्छ।",
      "सर्भर ठेगाना: एडमिनले अर्को ठेगाना दिनुभएको छ भने मात्र बदल्नुहोस्। नत्र जस्तो छ त्यस्तै राख्नुहोस्।",
      "Google बाट साइन इन Google बाट खोलिएका पुराना खाताका लागि मात्र हो।",
      "कम्पनीका पासवर्ड उही रहन्छन्। साइन इन गरेपछि हरेक कम्पनीले आफ्नै पासवर्ड छुट्टै माग्छ।",
    ],
  },
};

/** (i) next to the login options: which sign-in to use (English / हिन्दी / नेपाली). */
export function ServerLoginInfoButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState<Lang>("en");
  return (
    <>
      <AppFreshInfoButton
        size="sm"
        className={className}
        aria-label="Sign-in help"
        onClick={(e) => {
          e.preventDefault();
          setLang("en");
          setOpen(true);
        }}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[min(85vh,34rem)] w-[min(96vw,30rem)] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:rounded-lg">
          <DialogHeader className="space-y-1 border-b px-4 pb-3 pt-4 text-left">
            <DialogTitle className="text-base">{COPY[lang].title}</DialogTitle>
            <DialogDescription className="text-xs">English · हिन्दी · नेपाली</DialogDescription>
          </DialogHeader>
          <Tabs value={lang} onValueChange={(v) => setLang(v as Lang)} className="flex min-h-0 flex-1 flex-col">
            <div className="border-b px-3 pt-2">
              <TabsList className="grid h-9 w-full grid-cols-3">
                {LANGS.map((l) => (
                  <TabsTrigger key={l.id} value={l.id} className="text-xs">
                    {l.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {LANGS.map((l) => (
                <TabsContent key={l.id} value={l.id} className="m-0 focus-visible:outline-none">
                  <ul className="list-disc space-y-1.5 pl-4 text-sm leading-relaxed">
                    {COPY[l.id].points.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </TabsContent>
              ))}
            </div>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}
