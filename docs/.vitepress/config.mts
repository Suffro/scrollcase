import { defineConfig } from 'vitepress'
import pkg from '../../package.json'

const packageVersion = pkg.version

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "Scrollcase",
  description: "Signed, self-contained Python environment boxes for scientific and AI models",
  base: '/',

  markdown: {
    // Render mathematical notation in Markdown pages.
    math: true
  },

  // Generate links without the .html suffix (Cloudflare Pages serves clean URLs).
  cleanUrls: true,

  // Generate sitemap.xml at build time so search engines can crawl every page.
  // `hostname` must be the production domain — it prefixes every URL entry.
  sitemap: {
    hostname: 'https://scrollcase.dev',
  },

  head: [
    // The tab icon is the bare mark, following the browser's colour scheme. icon.ico comes first
    // as the universal fallback — it carries its own gold plate, so it stays legible on any tab
    // in browsers that ignore `media` on icon links.
    ['link', { rel: 'icon', href: '/static/icon.ico', sizes: '256x256' }],
    // ['link', { rel: 'icon', type: 'image/svg+xml', href: '/static/svg/logo-dark.svg', media: '(prefers-color-scheme: light)' }],
    // ['link', { rel: 'icon', type: 'image/svg+xml', href: '/static/svg/logo-light.svg', media: '(prefers-color-scheme: dark)' }]

    // No third-party scripts. The site set analytics and sharing cookies while telling readers it
    // used only essential ones, and loaded them before the notice could be read. Measurement, if
    // wanted, belongs at the edge where it needs no cookie and no consent dialogue.
  ],

  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    // In the site itself the mark is used bare, without the plate: the dark mark on a light
    // background and the light mark on a dark one.
    logo: {
      light: '/static/svg/logo-dark.svg',
      dark: '/static/svg/logo-light.svg',
      alt: 'Scrollcase Logo',
    },

    siteTitle: 'Scrollcase',
    search: { provider: 'local' },

    nav: [
      { text: 'Home', link: '/' },
      { text: 'Quickstart', link: '/getting-started/quickstart' },
      { text: 'Resources', activeMatch: "(^/(?!getting-started/quickstart(?:/|$))[^/]+/[^/]+/?$)", items: [
        { text: 'Overview', link: '/getting-started/overview' },
        { text: 'TL;DR', link: '/getting-started/tl-dr' },
        { text: 'Architecture', link: '/concepts/architecture' },
        { text: 'Concepts', link: '/concepts/' },
        { text: 'Guides', link: '/guides/' },
        { text: 'Reference', link: '/reference/' },
        { text: 'Security & trust', link: '/concepts/security-and-trust' },
        { text: 'Other tools', link: '/concepts/tool-comparison' },
        { text: 'White Paper', link: '/white-paper' },
      ] }
    ],

    sidebar: [
      {
        text: 'Getting Started',
        link: '/getting-started',
        collapsed: false,
        items: [
          { text: 'Overview', link: '/getting-started/overview' },
          { text: 'Why Scrollcase?', link: '/getting-started/why-scrollcase' },
          { text: 'Quickstart', link: '/getting-started/quickstart' },
          { text: 'Installation', link: '/getting-started/installation' },
          { text: 'TL;DR', link: '/getting-started/tl-dr' }
        ]
      },
      {
        text: 'Guides',
        link: '/guides',
        collapsed: false,
        items: [
          { text: 'Managing Model Weights', link: '/guides/managing-weights' },
          { text: 'Packaging CUDA Boxes', link: '/guides/packaging-cuda' },
          { text: 'Accelerator Parity', link: '/guides/accelerator-parity' },
          { text: 'Signing & Key Custody', link: '/guides/signing-and-custody' },
          { text: 'Offline / Air-Gapped Installs', link: '/guides/offline-airgap' },
          { text: 'Distributing Boxes', link: '/guides/distributing-boxes' },
          { text: 'Platform Examples', link: '/guides/platform-examples' },
          { text: 'Troubleshooting', link: '/guides/troubleshooting' }
        ]
      },
      {
        text: 'Reference',
        link: '/reference',
        collapsed: false,
        items: [
          { text: 'CLI Commands', link: '/reference/cli' },
          { text: 'Workspace Configuration', link: '/reference/configuration' },
          { text: 'The Scroll (scroll.json)', link: '/reference/scroll' },
          { text: 'The Box Format', link: '/reference/box-format' },
          { text: 'JSON Schemas', link: '/reference/schemas' },
          { text: 'Library APIs', link: '/reference/api' }
        ]
      },
      {
        text: 'Concepts',
        link: '/concepts',
        collapsed: false,
        items: [
          { text: 'Architecture', link: '/concepts/architecture' },
          { text: 'Security & Trust', link: '/concepts/security-and-trust' },
          { text: 'Why Pixi & Conda-Forge', link: '/concepts/why-pixi' },
          { text: 'Design Decisions', link: '/concepts/design-decisions' },
          { text: 'Tool Comparison', link: '/concepts/tool-comparison' }
        ]
      },
      {
        // One page, deliberately: the white paper is meant to be downloaded and studied as a
        // single artefact, so it is a top-level entry rather than a section of its own.
        text: 'White Paper',
        collapsed: false,
        link: '/white-paper'
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/suffro/scrollcase' }
    ],

    outline: {
      level: [2, 2]
    },

    footer: {
      message: `Scrollcase v${packageVersion} · schema version 2 · <a href="/privacy" target="_blank">Privacy</a> · <a href="https://github.com/suffro/scrollcase/blob/main/CHANGELOG.md" target="_blank">Changelog</a>`,
      copyright: 'Licensed under Apache-2.0'
    }
  }
})
