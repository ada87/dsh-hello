# Marketing site

The page for the DSH plugin suite is built and hosted from the mobile monorepo,
not from this repository:

- Source: `all-in-mobile/apps/app-dsh-hello/market/site`
- Build: `pnpm --dir apps/app-dsh-hello site:build` → `market/site/dist`
- Deploy: `pnpm --dir apps/app-dsh-hello site:sync D:\xdnote\dsh-hello-pages`
- Pages branch: `gh-pages` in **this** repository ([`ada87/dsh-hello`](https://github.com/ada87/dsh-hello))
- Domain: `https://dsh.xdnote.com` (`CNAME` lives in `market/site/static/`)
- The `gh-pages` branch holds built files only; the source never lives there.

Rationale: dsh-hello is the only plugin with a phone app, so the page sits next
to that app and reuses its build tooling. This repository keeps the plugin and
its docs; the site links here for installation and compatibility details.
