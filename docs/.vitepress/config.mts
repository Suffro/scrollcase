import { defineConfig } from 'vitepress'

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

    ['script', { async: '', src: 'https://www.googletagmanager.com/gtag/js?id=G-QY4HT9GE1P' }],
    ['script', {}, `
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-QY4HT9GE1P');
    `],
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
      { text: 'Guides', link: '/guides/managing-weights', activeMatch: '/guides/' },
      { text: 'Reference', link: '/reference/cli', activeMatch: '/reference/' },
      { text: 'Concepts', link: '/concepts/architecture', activeMatch: '/concepts/' }
    ],

    sidebar: [
      {
        text: 'Getting Started',
        collapsed: false,
        items: [
          { text: 'Installation', link: '/getting-started/installation' },
          { text: 'Quickstart', link: '/getting-started/quickstart' }
        ]
      },
      {
        text: 'Guides',
        collapsed: false,
        items: [
          { text: 'Managing Model Weights', link: '/guides/managing-weights' },
          { text: 'Packaging CUDA Boxes', link: '/guides/packaging-cuda' },
          { text: 'Accelerator Parity', link: '/guides/accelerator-parity' },
          { text: 'Signing & Key Custody', link: '/guides/signing-and-custody' },
          { text: 'Offline / Air-Gapped Installs', link: '/guides/offline-airgap' },
          { text: 'Distributing Boxes', link: '/guides/distributing-boxes' }
        ]
      },
      {
        text: 'Reference',
        collapsed: false,
        items: [
          { text: 'CLI Commands', link: '/reference/cli' },
          { text: 'Workspace Configuration', link: '/reference/configuration' },
          { text: 'The Recipe (recipe.json)', link: '/reference/recipe' },
          { text: 'The Box Format', link: '/reference/box-format' },
          { text: 'Node API', link: '/reference/api' }
        ]
      },
      {
        text: 'Concepts',
        collapsed: false,
        items: [
          { text: 'Architecture', link: '/concepts/architecture' },
          { text: 'Why Pixi & Conda-Forge', link: '/concepts/why-pixi' },
          { text: 'Design Decisions', link: '/concepts/design-decisions' }
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/Suffro/scrollcase' }
    ],

    outline: {
      level: [2, 3]
    }
  }
})
