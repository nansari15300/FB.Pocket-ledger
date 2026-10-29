
import type {Config} from 'tailwindcss';

export default {
  darkMode: ['class'],
  // Static production build may miss dynamically composed ribbon classes; safelist keeps them in final CSS.
  safelist: [
    // Shared ribbon utility classes used across dashboard + financial summary cards.
    'border-2',
    'bg-gradient-to-r',
    // Emerald ribbon
    'border-emerald-300/70', 'from-emerald-50', 'to-emerald-100/70', 'dark:from-emerald-950/25', 'dark:to-emerald-900/20',
    // Sky/Cyan ribbon
    'border-sky-300/70', 'from-sky-50', 'to-cyan-100/70', 'dark:from-sky-950/25', 'dark:to-cyan-900/20',
    // Violet/Fuchsia ribbon
    'border-violet-300/70', 'from-violet-50', 'to-fuchsia-100/70', 'dark:from-violet-950/25', 'dark:to-fuchsia-900/20',
    // Amber/Orange ribbon
    'border-amber-300/70', 'from-amber-50', 'to-orange-100/70', 'dark:from-amber-950/25', 'dark:to-orange-900/20',
    // Rose/Pink ribbon
    'border-rose-300/70', 'from-rose-50', 'to-pink-100/70', 'dark:from-rose-950/25', 'dark:to-pink-900/20',
    // Teal/Emerald ribbon
    'border-teal-300/70', 'from-teal-50', 'dark:from-teal-950/25',
    // Indigo/Blue ribbon
    'border-indigo-300/70', 'from-indigo-50', 'to-blue-100/70', 'dark:from-indigo-950/25', 'dark:to-blue-900/20',
    // Common gradient middle/ dark background tone.
    'via-white', 'dark:via-card',
    // Switch knob motion — voucher settings + header file preview
    'animate-file-hover-switch-on',
    'animate-file-hover-switch-off',
    'animate-file-hover-switch-to-hover',
    'animate-file-hover-switch-to-click',
    'animate-file-hover-switch-to-hover-from-end',
    'animate-file-hover-switch-to-off-from-mid',
    // Admin master-detail grids — content scan se admin exclude (build-static race); classes yahan safelist.
    'md:grid-cols-[360px_1fr]',
    'md:grid-cols-[320px_1fr]',
    // Admin settings page spacing (/admin/settings): 30px on PC, 3px side gap on phone.
    'px-[3px]', 'gap-3', 'md:gap-[30px]', 'md:p-[30px]',
  ],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/lib/**/*.{js,ts,jsx,tsx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    // No Tailwind in route handlers; scanning avoids Windows EBUSY if api/ is locked (dev + build-static)
    '!./src/app/api/**',
    // build-static temporarily moves (admin) out — dev + static build overlap par Tailwind ENOENT na kare.
    '!./src/app/(admin)/**',
    '!./src/components/admin/**',
  ],
  theme: {
    extend: {
      fontFamily: {
        /** `layout.tsx` me `next/font` CSS vars — CDN par depend mat karo */
        body: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        headline: ['var(--font-space-grotesk)', 'system-ui', 'sans-serif'],
        code: ['monospace'],
      },
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-background))',
          foreground: 'hsl(var(--sidebar-foreground))',
          primary: 'hsl(var(--sidebar-primary))',
          'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          border: 'hsl(var(--sidebar-border))',
          ring: 'hsl(var(--sidebar-ring))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: {
            height: '0',
          },
          to: {
            height: 'var(--radix-accordion-content-height)',
          },
        },
        'accordion-up': {
          from: {
            height: 'var(--radix-accordion-content-height)',
          },
          to: {
            height: '0',
          },
        },
        // GlobalFileHoverPreviewSwitch + ui/Switch — knob 32px, ON end left = 100% − 35px (32+3 pad)
        'file-hover-switch-on': {
          '0%': { left: '3px', width: '32px' },
          '45%': { left: '3px', width: 'calc(100% - 6px)' },
          '100%': { left: 'calc(100% - 35px)', width: '32px' },
        },
        'file-hover-switch-off': {
          '0%': { left: 'calc(100% - 35px)', width: '32px' },
          '45%': { left: '3px', width: 'calc(100% - 6px)' },
          '100%': { left: '3px', width: '32px' },
        },
        /* Header File preview 3-step — voucher Switch jaisa stretch, beech positions */
        'file-hover-switch-to-hover': {
          '0%': { left: '3px', width: '32px' },
          '45%': { left: '3px', width: 'calc(50% - 3px)' },
          '100%': { left: 'calc(50% - 16px)', width: '32px' },
        },
        /* Beech ↔ side: sirf apne segment tak stretch — poora left/right jump nahi */
        'file-hover-switch-to-click': {
          '0%': { left: 'calc(50% - 16px)', width: '32px' },
          '45%': { left: 'calc(50% - 16px)', width: 'calc(50% - 3px)' },
          '100%': { left: 'calc(100% - 35px)', width: '32px' },
        },
        'file-hover-switch-to-hover-from-end': {
          '0%': { left: 'calc(100% - 35px)', width: '32px' },
          '45%': { left: 'calc(50% - 16px)', width: 'calc(50% - 3px)' },
          '100%': { left: 'calc(50% - 16px)', width: '32px' },
        },
        'file-hover-switch-to-off-from-mid': {
          '0%': { left: 'calc(50% - 16px)', width: '32px' },
          '45%': { left: '3px', width: 'calc(50% - 3px)' },
          '100%': { left: '3px', width: '32px' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        // Voucher Settings Switch + header File preview — 400ms motion (switchMotion.SWITCH_ANIM_MS)
        'file-hover-switch-on': 'file-hover-switch-on 400ms linear forwards',
        'file-hover-switch-off': 'file-hover-switch-off 400ms linear forwards',
        'file-hover-switch-to-hover': 'file-hover-switch-to-hover 400ms linear forwards',
        'file-hover-switch-to-click': 'file-hover-switch-to-click 400ms linear forwards',
        'file-hover-switch-to-hover-from-end': 'file-hover-switch-to-hover-from-end 400ms linear forwards',
        'file-hover-switch-to-off-from-mid': 'file-hover-switch-to-off-from-mid 400ms linear forwards',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
} satisfies Config;
