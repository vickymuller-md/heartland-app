import type { Metadata } from "next";
import { Inter, Geist, Sora, Instrument_Serif } from "next/font/google";
import { GoogleAnalytics } from "@next/third-parties/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { DisclaimerFooter } from "@/components/disclaimers/disclaimer-footer";

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
  title: "HEARTLAND Protocol",
  description:
    "Clinical Decision Support Tool for Rural Heart Failure Management",
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
        <main className="flex-1">{children}</main>
        <DisclaimerFooter />
      </body>
      {process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID && (
        <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID} />
      )}
    </html>
  );
}
