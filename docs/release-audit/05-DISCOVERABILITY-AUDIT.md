# 05 - Discoverability audit

Date: 2026-11-05
Website: `https://bytos.dev`
Source inspected: `C:\Users\TT\Desktop\bytos-website` (Git remote
`https://github.com/Balahurra/web2.git`)

The website source is a **separate repository**. Changes in this pass are local
only. They were not committed or deployed from this task, and nothing was
submitted to Google Search Console or Bing Webmaster Tools.

## 1. Live checks before changes

| Check | Result |
| --- | --- |
| `https://bytos.dev/` | HTTP 200, `text/html; charset=utf-8` |
| HTTPS | Working; no HSTS header observed |
| `https://bytos.dev/features.html` | HTTP 308 redirect (clean route is `/features`) |
| `https://bytos.dev/features` | HTTP 200 |
| `https://bytos.dev/robots.txt` | HTTP 200 but `text/html` — the host returns the SPA fallback; no real robots file |
| `https://bytos.dev/sitemap.xml` | HTTP 200 but `text/html` — no real sitemap |
| Canonical | Missing |
| Open Graph / Twitter metadata | Missing |
| JSON-LD | Missing |
| Title | `BYTOS` followed by mojibake (broken dash) on the live page |
| Meta description | Present, but contained the same mojibake |
| Favicon | Present (`icon.png`) |
| Internal links | `features.html` redirects to `/features`; no 404 observed |
| Marketplace link | None (correct: listing does not exist yet) |

## 2. Changes prepared

### 2.1 `index.html`

- Title rewritten: `Bytos - Open-Source AI Coding Agent for VS Code`.
- Meta description rewritten around the actual product and BYOK model.
- Added canonical: `https://bytos.dev/`.
- Added Open Graph (`og:type`, `og:site_name`, `og:title`, `og:description`,
  `og:url`, `og:image`, `og:image:alt`) and Twitter card metadata.
- Added JSON-LD `SoftwareApplication` with name, category, OS, version `1.0.0`,
  Apache-2.0 licence, repository, free offer, and `sameAs` GitHub. No ratings,
  reviews, pricing claims, or company details were invented.
- Replaced the dead `href="#"` install button with
  `https://github.com/Balahurra/Bytos#install` (Marketplace listing is pending).
- Corrected the GitHub link from `github.com/bytos-dev` to
  `github.com/Balahurra/Bytos`.
- Rewrote hero copy: open-source AI coding agent, approvals, sequential Auto
  Phase, free BYOK build, no Bytos account.
- Removed mojibake from the title, hero badge, body copy, and CTA note.

### 2.2 `features.html`

- Title/meta description rewritten for the Auto Phase page.
- Added canonical `https://bytos.dev/features`, Open Graph, Twitter card, and
  `WebPage` JSON-LD.
- Rewrote the page copy to say **sequential** multi-phase orchestration, with
  approvals still applying and a stop control. Removed "fully automatic" and
  "without you" phrasing.
- Replaced the sign-up CTA with a GitHub install link and the note "Free BYOK
  build. No Bytos account required. Marketplace listing pending."
- Corrected the GitHub link and removed mojibake.

### 2.3 `robots.txt`

```
User-agent: *
Allow: /

Sitemap: https://bytos.dev/sitemap.xml
```

### 2.4 `sitemap.xml`

Contains only the two canonical public pages:

- `https://bytos.dev/`
- `https://bytos.dev/features`

Authentication pages are excluded.

### 2.5 Auth pages

`account.html`, `signin.html`, `signup.html`, `forgot-password.html`, and
`reset-password.html` now carry `<meta name="robots" content="noindex, nofollow">`
so account screens do not compete with product pages in search.

## 3. Content and search intent

The pages now target real product intent rather than keyword stuffing:

- open-source AI coding agent for VS Code
- bring-your-own-key coding assistant
- sequential multi-phase AI orchestration
- MCP and approval-based coding workflow

No doorway pages, duplicate keyword pages, fake reviews, or invented user counts
were created. The pages describe capabilities that exist in the 1.0.0 build.

## 4. Heading and accessibility review

- One `h1` per page.
- Product copy is in the HTML, not injected by JavaScript, so crawlers see it.
- Images have descriptive `alt` text, including the hero, feature screenshot,
  logo, and social image.
- `html lang="en"`, viewport meta, and favicon links are present.
- Feature cards use `h3` under the page `h1`; adding an intermediate `h2` in a
  future content pass would improve semantic hierarchy. This is a **Low** item,
  not a blocker.
- Mobile behaviour was not re-measured in a browser in this pass; the existing
  viewport meta and responsive CSS are unchanged.

## 5. Performance and indexing

No Lighthouse or Core Web Vitals measurement was run on this host. The page is a
small static HTML/CSS site with a local Supabase client and pinned vendor bundle;
the demo GIF is 1.3 MB and is the main optional payload.

Search Console and Bing Webmaster Tools submission is **manual** and requires
account access. After deployment:

1. Verify `https://bytos.dev/robots.txt` returns `text/plain`.
2. Verify `https://bytos.dev/sitemap.xml` returns XML.
3. Submit the sitemap in Google Search Console and Bing Webmaster Tools.
4. Request indexing for `/` and `/features`.
5. Re-check the live title/meta for mojibake after deploy.

## 6. Findings

| ID | Finding | Severity | Status |
| --- | --- | --- | --- |
| SEO-01 | Live title/meta contained mojibake | High | **Fixed in source** |
| SEO-02 | No canonical, Open Graph, Twitter, or JSON-LD | Medium | **Fixed in source** |
| SEO-03 | `robots.txt` and `sitemap.xml` served SPA HTML | Medium | **Created; deploy required** |
| SEO-04 | Dead `href="#"` install button | High | **Fixed** |
| SEO-05 | Wrong GitHub organisation in site links | Medium | **Fixed** |
| SEO-06 | Features page overclaimed full automation | Medium | **Fixed** |
| SEO-07 | No HSTS header | Low | Deployment config; manual |
| SEO-08 | Heading hierarchy skips `h2` on feature cards | Low | Future content pass |
| SEO-09 | Search Console/Bing not submitted | Manual | Requires account access |
| SEO-10 | Changes are local to `Balahurra/web2`; not deployed | Manual | Deploy separately |
