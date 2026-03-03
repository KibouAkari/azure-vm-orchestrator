import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Azure VM Orchestrator",
  description: "Modern dashboard for short-lived Azure VMs"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
