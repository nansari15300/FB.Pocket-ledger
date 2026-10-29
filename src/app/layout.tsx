
import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Toaster } from '@/components/ui/toaster';
import { Providers } from './providers';
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { PocketSerwistProvider } from "@/components/serwist/PocketSerwistProvider";
import { Phase1bRuntimeVerifyShim } from "@/components/Phase1bRuntimeVerifyShim";
import { StatementCheckedBlinkPrefsBootstrap } from "@/components/vouchers/StatementCheckedBlinkPrefsBootstrap";
import { CLIENT_HEALTH_EARLY_BOOT_SCRIPT } from "@/lib/clientHealthEarlyBootScript";
import { RecoveryModeGate } from "@/components/recovery/RecoveryModeGate";

export const metadata: Metadata = {
  applicationName: 'Pocket Ledger',
  title: 'Pocket Ledger',
  description: 'Modern Accounting Software',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Pocket Ledger',
  },
  // Browser tab / bookmark / PWA: same asset as Electron `public/app-icon.png` (EXE icon)
  icons: {
    icon: [{ url: '/app-icon.png', type: 'image/png' }],
    apple: '/app-icon.png',
    shortcut: '/app-icon.png',
  },
};

/** WebView/APK: light-only declare + `theme-color` dark (#0f172a) kabhi document ko "dark" hint de kar Samsung WebView tint alag kar deta tha */
export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#f1f5f9',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1, user-scalable=no" />
        <meta name="color-scheme" content="light only" />
        <meta name="theme-color" content="#f1f5f9" />
      </head>
      <body className="font-body antialiased theme-pro primary-pro">
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{localStorage.removeItem("pl-color-mode");var R="pl-theme-default-rev",V="2",TK="theme",PK="primaryColor";var rev=localStorage.getItem(R),t=localStorage.getItem(TK),p=localStorage.getItem(PK);if(!rev||rev!==V){if(!t||t==="theme-pure-white"){t="theme-pro";p="primary-pro";}localStorage.setItem(R,V);localStorage.setItem(TK,t);localStorage.setItem(PK,p||"primary-pro");}if(!t){t="theme-pro";p="primary-pro";}var dark=t==="theme-pl-dark";document.body.className="font-body antialiased "+t+" "+(p||"primary-pro")+(dark?" dark":"");}catch(e){}})();`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var C=window.Capacitor,native=C&&((C.isNativePlatform&&C.isNativePlatform())||(C.getPlatform&&/android|ios/i.test(String(C.getPlatform()))));var ua=navigator.userAgent||"",wv=/Android/i.test(ua)&&/; wv\\)|\\bwv\\b|Capacitor|Ionic/i.test(ua);var root=document.documentElement;if(native||wv)root.dataset.plEmbeddedShell="1";if(!native)return;var raw=localStorage.getItem("pl_app_ui_zoom_v1"),z=raw?parseFloat(raw):1;if(!isFinite(z))z=1;z=Math.min(1.75,Math.max(0.75,Math.round(z*100)/100));root.dataset.plAppUiZoom=String(z);root.style.setProperty("--pl-app-ui-zoom",String(z));var ios=/iPhone|iPad|iPod/i.test(ua)||(/Macintosh/i.test(ua)&&navigator.maxTouchPoints>1);if(ios){if(z!==1)root.style.fontSize=(16*z)+"px";return;}if(z===1)return;root.dataset.plAppUiZoomShell="android-zoom";root.style.setProperty("--pl-screen-h","calc(100dvh / "+z+")");root.style.setProperty("--pl-screen-w","calc(100vw / "+z+")");}catch(e){}})();`,
          }}
        />
        {/* localhost static test (serve out): purana SW Firestore Listen/Write tod deta — React se pehle hatao */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var h=location.hostname;if(h!=="localhost"&&h!=="127.0.0.1")return;if("serviceWorker"in navigator){navigator.serviceWorker.getRegistrations().then(function(r){r.forEach(function(x){x.unregister();});});}if("caches"in window){caches.keys().then(function(names){names.forEach(function(n){var l=String(n).toLowerCase();if(l.indexOf("serwist")>-1||l.indexOf("workbox")>-1||l.indexOf("precache")>-1||l.indexOf("pl-navigate-shell")>-1)caches.delete(n);});});}}catch(e){}})();`,
          }}
        />
        {/* Naya deploy + purana SW/cache: ChunkLoadError par ek baar SW/cache clear + reload */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var KEY="pl_chunk_reload_v1";function chunkMsg(m){m=String(m||"");return/ChunkLoadError|Loading chunk \\d+ failed/i.test(m);}async function recover(){if(sessionStorage.getItem(KEY)==="1")return;sessionStorage.setItem(KEY,"1");try{if("serviceWorker"in navigator){var regs=await navigator.serviceWorker.getRegistrations();await Promise.all(regs.map(function(r){return r.unregister();}));}if("caches"in window){var names=await caches.keys();await Promise.all(names.map(function(n){return caches.delete(n);}));}}catch(e){}location.reload();}window.addEventListener("error",function(e){var t=e.target;if(t&&t.tagName==="SCRIPT"&&t.src&&/_next\\/static\\/chunks\\//.test(t.src)){recover();return;}if(chunkMsg(e.message))recover();},true);window.addEventListener("unhandledrejection",function(e){var r=e.reason;var m=r&&(r.message||r);if(chunkMsg(m))recover();});}catch(e){}})();`,
          }}
        />
        {/* Hosted web: React hydrate na ho to bhi protected route se login par — party jaisi heavy chunks */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var REDIR_KEY="pl_web_auth_gate_redirect_v1";var p=location.pathname||"/";var base=(p==="/app"||p.indexOf("/app/")===0)?"/app":"";var inner=base?p.slice(base.length)||"/":p;var seg=(inner.replace(/^\\/+|\\/+$/g,"").split("/")[0]||"").toLowerCase();if(!seg||seg==="billing"||inner==="/")return;var routes=["dashboard","party","staff","bank-cash","items","tax","incomes","gate","settings","reports","payment-in","payment-out","sale","purchase","journal","contra","notes","gallery","messages","admin","backup","recycle-bin","reconciliation","import-export","production","quotations","add-salary","inter-company","sale-note","purchase-note","company","loans","not-authorized","embed"];if(routes.indexOf(seg)<0)return;setTimeout(function(){try{if(sessionStorage.getItem(REDIR_KEY)==="1")return;var txt=(document.body&&document.body.innerText)||"";var gate=document.querySelector("[data-pl-web-auth-gate]");var stuck=gate||/Loading session|Opening sign in|Redirecting to sign in/i.test(txt);if(!stuck)return;sessionStorage.setItem(REDIR_KEY,"1");location.assign(base+"/");}catch(e){}},9000);}catch(e){}})();`,
          }}
        />
        {/* UI health: React se pehle click/stall track — party navigate freeze par bhi */}
        <script dangerouslySetInnerHTML={{ __html: CLIENT_HEALTH_EARLY_BOOT_SCRIPT }} />
        <PocketSerwistProvider>
          <Providers>
            <StatementCheckedBlinkPrefsBootstrap />
            <RecoveryModeGate />
            {children}
          </Providers>
        </PocketSerwistProvider>
        <Phase1bRuntimeVerifyShim />
        <Toaster />
        <SonnerToaster />
      </body>
    </html>
  );
}
