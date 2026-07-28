const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="16" fill="#e8702a"/>
  <path d="M16 22 32 14l16 8-16 8-16-8Zm0 10 16 8 16-8M16 42l16 8 16-8"
    fill="none" stroke="#fff8ef" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

export function GET() {
  return new Response(favicon, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
