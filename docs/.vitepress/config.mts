import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "Scrollcase",
  description: "Self-contained AI runtime packaging",
  
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Quickstart', link: '/getting-started/quickstart' },
      { text: 'CLI Reference', link: '/reference/cli' }
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
          { text: 'Packaging CUDA Models', link: '/guides/packaging-cuda' },
          { text: 'Managing Model Weights', link: '/guides/managing-weights' },
          { text: 'Offline / Air-Gapped Setup', link: '/guides/offline-airgap' }
        ]
      },
      {
        text: 'Reference',
        collapsed: false,
        items: [
          { text: 'CLI Commands', link: '/reference/cli' },
          { text: 'Configuration File', link: '/reference/configuration' }
        ]
      },
      {
        text: 'Concepts',
        collapsed: false,
        items: [
          { text: 'Architecture & Design', link: '/concepts/architecture' },
          { text: 'Why Pixi & Conda-Forge', link: '/concepts/why-pixi' }
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/suffro/scrollcase' }
    ],

    search: {
      provider: 'local'
    }
  }
})