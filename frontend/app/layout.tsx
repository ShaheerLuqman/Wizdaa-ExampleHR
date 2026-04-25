import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ExampleHR Time-Off API Console',
  description: 'Frontend test console for the Time-Off microservice APIs.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
