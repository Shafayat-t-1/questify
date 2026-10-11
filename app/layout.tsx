import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Questify · Web3 & Micro-Task Rewards",
  description:
    "Complete micro-tasks, earn Quest Coins and USDT, climb the leaderboard, and withdraw to BEP-20 or TON.",
  applicationName: "Questify",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Questify" },
};

export const viewport: Viewport = {
  themeColor: "#0B0E14",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      </head>
      <body className="app-bg min-h-full text-white selection:bg-neon-orange/30">
        {children}
      </body>
    </html>
  );
}
