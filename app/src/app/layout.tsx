import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { EndpointFooter, FictionBanner, TopNav } from "@/components/Chrome";
import { Aurora } from "@/components/Aurora";
import { ChainEnergy } from "@/components/ChainEnergy";

export const metadata: Metadata = {
  title: "SINBAZAAR",
  description:
    "A private real-time market where the traded asset is a secret confession. Fiction mode: startup village sins only.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Aurora />
        {/* Writes --chain-energy when the rollup moves. Renders nothing. */}
        <ChainEnergy />
        <Providers>
          <a className="skip-link" href="#content">
            Skip to content
          </a>
          <FictionBanner />
          <TopNav />
          <main className="shell" id="content">
            {children}
          </main>
          <EndpointFooter />
        </Providers>
      </body>
    </html>
  );
}
