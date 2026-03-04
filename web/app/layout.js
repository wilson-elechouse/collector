import TopBar from './components/TopBar';

export const metadata = { title: 'Collector V3' };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0 }}>
        <TopBar />
        <div style={{ padding: 16 }}>{children}</div>
      </body>
    </html>
  );
}
