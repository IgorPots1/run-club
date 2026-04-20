import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import AppLaunchScreen from "@/components/AppLaunchScreen";
import ThemePersistence from "@/components/ThemePersistence";
import UnreadBadgeSync from "@/components/chat/UnreadBadgeSync";
import MobileTabBar from "../components/MobileTabBar";
import Navbar from "../components/Navbar";
import PwaRegister from "../components/PwaRegister";
import VoiceStreamLifecycle from "../components/VoiceStreamLifecycle";
import { requireAppAccess } from "@/lib/auth/requireAppAccess";
import { getAuthenticatedUser } from "@/lib/supabase-server";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const themeInitScript = `
(() => {
  const storageKey = 'theme'
  const root = document.documentElement

  const resolveTheme = (preference) => {
    if (preference === 'light' || preference === 'dark') {
      return preference
    }

    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }

  try {
    const storedPreference = window.localStorage.getItem(storageKey)
    const nextPreference =
      storedPreference === 'light' || storedPreference === 'dark' || storedPreference === 'system'
        ? storedPreference
        : 'system'
    const nextTheme = resolveTheme(nextPreference)

    root.classList.toggle('dark', nextTheme === 'dark')
  } catch {
    root.classList.toggle('dark', resolveTheme('system') === 'dark')
  }
})()
`

export const metadata: Metadata = {
  title: "Run Club",
  applicationName: "Run Club",
  description: "Клубное приложение для бега, челленджей и рейтинга.",
  manifest: "/manifest.json",
  formatDetection: {
    telephone: false,
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Run Club",
  },
  icons: {
    icon: [
      { url: "/favicon.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const requestHeaders = await headers()
  const pathname = requestHeaders.get("x-run-club-pathname") ?? ""
  const isBlockedRoute = pathname === "/blocked"
  const isRunDetailRoute = /^\/runs\/[^/]+$/.test(pathname)

  if (isBlockedRoute) {
    return (
      <html lang="ru" suppressHydrationWarning>
        <head>
          <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        </head>
        <body className={`min-h-screen ${geistSans.variable} ${geistMono.variable} antialiased`}>
          <ThemePersistence />
          <AppLaunchScreen />
          {children}
        </body>
      </html>
    )
  }

  const shouldEnforceAppAccess =
    pathname !== "/" &&
    pathname !== "/login" &&
    pathname !== "/register" &&
    pathname !== "/blocked" &&
    !pathname.startsWith("/auth")
  const shouldHideNavbar =
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/blocked" ||
    pathname === "/onboarding" ||
    pathname.startsWith("/auth")

  let resolvedNavbarUser: { id: string; email: string | null } | null = null

  if (shouldEnforceAppAccess) {
    const { user } = await requireAppAccess()
    resolvedNavbarUser = user
      ? {
          id: user.id,
          email: user.email ?? null,
        }
      : null
  } else if (!shouldHideNavbar) {
    const { user } = await getAuthenticatedUser()
    resolvedNavbarUser = user
      ? {
          id: user.id,
          email: user.email ?? null,
        }
      : null
  }

  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen">
        <ThemePersistence />
        <PwaRegister />
        <VoiceStreamLifecycle />
        <UnreadBadgeSync />
        <AppLaunchScreen />
        <div
          className={`app-shell mx-auto min-h-screen max-w-xl overflow-x-hidden ${
            isRunDetailRoute ? "pb-0" : "pb-[calc(5.75rem+env(safe-area-inset-bottom))]"
          } md:max-w-7xl md:pb-0 ${geistSans.variable} ${geistMono.variable} antialiased`}
        >
          {resolvedNavbarUser ? (
            <div className="hidden md:block">
              <Navbar initialUser={resolvedNavbarUser} />
            </div>
          ) : null}
          {children}
          <MobileTabBar />
        </div>
      </body>
    </html>
  );
}
