import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ICD / KKF Train Operations Dashboard",
  description: "Train schedule dashboard powered directly by Google Sheets"
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}