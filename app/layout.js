import './globals.css';

// Loaded via plain <link> tags below instead of next/font/google: next/font
// fetches font files from Google over the network *at build time*, which
// fails the whole build on any machine/CI whose network can't reach
// fonts.googleapis.com. A <link> tag fetches at runtime in the browser
// instead, same as the original prototype did, so `npm run build` never
// needs network access.
export const metadata = {
  title: 'Building Picker',
  description: 'Clickable 3D buildings across Richmond, Vancouver, and UBC, as a calm open-world driving sim.'
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
