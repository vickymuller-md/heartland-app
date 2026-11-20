import type { Metadata } from "next";
import { Sora, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { DisclaimerFooter } from "@/components/disclaimers/disclaimer-footer";
import { PublicWebAnalytics } from "@/components/analytics/public-web-analytics";

const sora = Sora({ subsets: ["latin"], variable: "--heartland-sans", display: "swap" });
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  variable: "--heartland-serif",
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://app.heartlandprotocol.org"),
  title: "HEARTLAND Protocol",
  description:
    "Clinical Implementation Companion for Rural Heart Failure Management",
  alternates: { canonical: "./" },
  openGraph: {
    type: "website",
    siteName: "HEARTLAND Protocol App",
    title: "HEARTLAND Protocol",
    description:
      "Educational implementation companion for rural heart failure management. Public tools and the sandbox use synthetic data.",
    url: "./",
  },
  twitter: { card: "summary" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${sora.variable} ${instrumentSerif.variable}`}>
      <body className="flex min-h-screen flex-col bg-background font-sans text-foreground antialiased">
        <div className="flex-1">{children}</div>
        <DisclaimerFooter />
        <PublicWebAnalytics />
      </body>
    </html>
  );
}
