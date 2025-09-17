import localFont from "next/font/local";
import "./globals.css";

const geistSans = localFont({
  src: [
    {
      path: "../fonts/Geist.woff2",
      weight: "400",
      style: "normal",
    },
  ],
  variable: "--font-geist",
});

const geistMono = localFont({
  src: [
    {
      path: "../fonts/GeistMono.woff2",
      weight: "400",
      style: "normal",
    },
  ],
  variable: "--font-geist-mono",
});

export const metadata = {
  title: "Data Offload App",
  description: "Utility for offloading data",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
