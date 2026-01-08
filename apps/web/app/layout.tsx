import type { Metadata } from "next";
import "./globals.css";
import { Barlow } from "next/font/google";
import Providers from "../components/providers";

const barlow = Barlow({ subsets: ["latin"], weight: ["400", "600", "700"] });

export const metadata: Metadata = {
  title: "Signature Auto Care",
  description: "Shop operations, inventory, and billing for Signature Auto Care"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${barlow.className}`}>
      <body className="bg-background text-foreground">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
