# ClearView website

Live site: https://www.clearviewas.com · Blog editor: https://www.clearviewas.com/admin/

## How it fits together
- `site/` holds the finished pages, images and Netlify settings (`_redirects`, `_headers`, `robots.txt`).
- `content/blog/` holds one Markdown file per blog post. The blog editor writes here.
- `admin/` is the blog editor (Decap CMS). `admin/config.yml` sets its fields and login.
- `templates/` holds the shared page layout used to build blog pages.
- `scripts/build.mjs` runs on every Netlify deploy. It copies `site/` to `dist/`, then builds the blog list,
  each post page, the home page blog cards and the sitemap from `content/blog/`.

Build locally with `node scripts/build.mjs` (Node 18+, no installs needed). Output goes to `dist/`.

## Changing the design
Design changes are made by Haggerty Media and uploaded to `site/` and `templates/`. Blog posts never need code changes.
