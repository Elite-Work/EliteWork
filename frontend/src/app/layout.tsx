// src/app/layout.tsx
import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";

import "./globals.css";
import { Geist, Geist_Mono } from "next/font/google";
import { AppShell } from "@/components/layout/AppShell";
import { AuthProvider } from "@/hooks/useAuth";
import { AnalyticsProvider } from "@/components/AnalyticsProvider";
import { ToastContainer } from "@/components/ui/ToastContainer";
import { ToastProvider } from "@/hooks/useToast";
import { ThemeProvider } from "@/hooks/useTheme";
import RegisterSW from "@/components/RegisterSW";
import { FeatureFlagsProvider } from "@/components/FeatureFlagsProvider";
import { FlagDebugPanel } from "@/components/admin/FlagDebugPanel";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const manrope = Manrope({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-manrope",
});

export const metadata: Metadata = {
  title: "Amana — Secure Agricultural Escrow",
  description: "Blockchain-powered agricultural trade settlement",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Amana",
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#0B1A14",
};

/**
 * Inline script that runs before paint to apply the persisted theme class
 * on <html>, preventing a flash of the wrong theme (FOUC).
 * Reads from localStorage; falls back to system preference.
 */
const themeScript = `
(function(){
  try {
    var stored = localStorage.getItem('amana-theme-preference');
    var pref = stored || 'system';
    var dark;
    if (pref === 'system') {
      dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    } else {
      dark = pref === 'dark';
    }
    document.documentElement.classList.add(dark ? 'dark' : 'light');
  } catch(e) {
    document.documentElement.classList.add('dark');
  }
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${manrope.variable} font-sans bg-primary text-text-primary antialiased`}
      >
        <ThemeProvider>
          <AnalyticsProvider>
            <AuthProvider>
              <ToastProvider>
                <FeatureFlagsProvider>
                  <AppShell>{children}</AppShell>
                  <RegisterSW />
                  <ToastContainer />
                  <FlagDebugPanel />
                </FeatureFlagsProvider>
              </ToastProvider>
            </AuthProvider>
          </AnalyticsProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
