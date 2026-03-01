# MediaGuard Landing Page

Astro-based landing page for MediaGuard. Deployed to GitHub Pages via `.github/workflows/deploy.yml`.

## Commands

From project root:

| Command | Action |
|---------|--------|
| `npm run web:dev` | Start dev server at http://localhost:4321 |
| `npm run web:build` | Build to `./dist/` |
| `npm run web:preview` | Preview production build locally |

## Structure

- `src/pages/` — Routes (index, documentation, team)
- `src/components/` — Astro/React components
- `public/` — Static assets (logo, etc.)

## Environment

No environment variables required for static build. For GitHub Pages deployment, ensure repository settings point to the `gh-pages` branch and the workflow is enabled.
