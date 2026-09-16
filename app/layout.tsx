import type { Metadata } from "next";
import { Inter, Geist, Sora, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { DisclaimerFooter } from "@/components/disclaimers/disclaimer-footer";
import { PublicWebAnalytics } from "@/components/analytics/public-web-analytics";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-editorial",
  weight: ["200", "300", "400", "500", "600", "700", "800"],
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400"],
  style: ["normal", "italic"],
  display: "swap",
});

const jetbrains = Sora({
  subsets: ["latin"],
  variable: "--font-mono-editorial",
  weight: ["400", "500"],
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
    <html
      lang="en"
      className={cn(
        inter.className,
        "font-sans",
        geist.variable,
        sora.variable,
        instrumentSerif.variable,
        jetbrains.variable,
      )}
    >
      <body className="min-h-screen flex flex-col bg-white antialiased">
        <div className="flex-1">{children}</div>
        <DisclaimerFooter />
        <PublicWebAnalytics />
      </body>
    </html>
  );
}
