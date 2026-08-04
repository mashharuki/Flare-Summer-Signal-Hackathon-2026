import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./css/globals.css";

export const metadata: Metadata = {
  description: "Coston2 Testnet-only reserve attestation workspace.",
  title: "ReserveFlow Credit — Testnet",
};

export default function RootLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
