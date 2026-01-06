import "./globals.css";

export const metadata = {
  title: "SolaMon Voice Loop",
  description: "HBIM terminal link",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
