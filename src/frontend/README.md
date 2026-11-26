# Frontend (Next.js)

## Overview

Next.js (App Router), React 19, and TypeScript serve the exercise’s backend
health check page.

## Interface

- The Next.js rewrite matches `/api/:path*` and preserves the API path at the backend. [next.config.ts:rewrites]
- The package exposes `dev`, `build`, `start`, and `lint` scripts. [package.json:scripts]
- [Application source](./src/README.md) contains the App Router layout and health check page.

## Invariants

- `BACKEND_URL` sets the backend origin and defaults to `http://localhost:8080`. [next.config.ts:backendUrl]

## Side Effects

- Next.js forwards matching `/api/:path*` requests to the configured backend. [next.config.ts:rewrites]

## Local Development

Run these commands from `src/frontend`.

```bash
npm install
npm run dev
```

## Verification

- Run `npm run lint` from `src/frontend`. ESLint applies the Next.js Core Web Vitals and TypeScript configurations. [package.json:scripts.lint] [eslint.config.mjs:nextVitals] [eslint.config.mjs:nextTs]
