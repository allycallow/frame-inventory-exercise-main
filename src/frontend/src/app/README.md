# App Router

## Overview

The root layout wraps the app. The home page displays the outcome of a backend
health check.

## Interface

- `RootLayout` renders route content within an English-language HTML document. `metadata` sets the page title and favicon. [layout.tsx:RootLayout] [layout.tsx:metadata]
- `Home` renders `/` and shows a loading message, the returned JSON, or an error message. [page.tsx:Home] [page.tsx:FetchState]

## Invariants

- The frontend types the health response with string fields for `status`, `service`, and `timestamp`. [page.tsx:HealthResponse]
- An HTTP response outside the 2xx range enters the error state. [page.tsx:Home]

## Side Effects

- `Home` requests `/api/health` on mount and updates the displayed state when the request resolves or fails. [page.tsx:Home]
- Cleanup aborts the request, and the error handler ignores `AbortError`. [page.tsx:Home]

## Verification

- Run `npm run lint` from `src/frontend`. [../../package.json:scripts.lint]
- With both services running, open `/` and confirm the page displays the backend health response. [page.tsx:Home]
