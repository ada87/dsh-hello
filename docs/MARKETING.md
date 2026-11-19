# Marketing site

The page for the DSH plugin suite is built and hosted from the mobile monorepo,
not from this repository:

- Source: `all-in-mobile/apps/app-dsh/market/site`
- Build: `pnpm --dir apps/app-dsh site:build` → `market/site/dist`
- Deploy: `pnpm --dir apps/app-dsh site:sync D:\xdnote\dsh-hello-pages`
- Pages branch: `gh-pages` in **this** repository ([`ada87/dsh-hello`](https://github.com/ada87/dsh-hello))
- Domain: `https://dsh.xdnote.com` (`CNAME` lives in `market/site/static/`)
- The `gh-pages` branch holds built files only; the source never lives there.

Rationale: dsh-hello is the only plugin with a phone app, so the page sits next
to that app and reuses its build tooling. This repository keeps the plugin and
its docs; the site links here for installation and compatibility details.

## Planned section: Advanced

The site has no extending/customization section yet. Its copy source is
[EXTENDING.md](EXTENDING.md); the last section of that file carries the outline
(three tiers: config, companion plugin, fork) to lift into the site's locale
files when the section ships.
