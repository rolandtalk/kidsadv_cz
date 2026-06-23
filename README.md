# 胡說亂畫

AI illustrated storybook generator built with React, TypeScript, Vite, and Cloudflare Pages Functions.

Production domain:

https://kidsadv-cz.pages.dev

## Development

```bash
npm install
npm run dev
```

The Vite dev server includes local `/api/*` middleware for Gemini calls.

## Build

```bash
npm run build
```

Cloudflare Pages settings:

- Project name: `kidsadv-cz`
- Build command: `npm run build`
- Build output directory: `dist`
- Production domain: `kidsadv-cz.pages.dev`

Required environment variable:

- `GEMINI_API_KEY`

Optional binding for cross-device library sync:

- KV namespace binding: `LIBRARY_KV`

## Deploy

```bash
npm run deploy
```
