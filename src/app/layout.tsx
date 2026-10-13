import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const description =
  "A vault contract on Monad that enforces the owner's rules on every payment an AI agent makes. Try to rob our agent: no wallet needed.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://agentshield.munashemudabura.com"),
  title: "AgentShield | Give your AI agent a wallet, not a blank cheque",
  description,
  openGraph: {
    title: "AgentShield",
    description,
    siteName: "AgentShield",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: "AgentShield", description },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
