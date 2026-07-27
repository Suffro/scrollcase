import DefaultTheme from 'vitepress/theme'
import { useData } from 'vitepress'
import { h, nextTick, watch } from 'vue'
import { createMermaidRenderer } from 'vitepress-mermaid-renderer'
import 'vitepress-mermaid-renderer/css'
import HomePage from './HomePage.vue'
import Tabs from './tabs-component/Tabs.vue'
import Tab from './tabs-component/Tab.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  // Wrap the default layout so ```mermaid fences become interactive diagrams
  // that follow the active colour scheme.
  Layout() {
    const { isDark } = useData()

    const initMermaid = () =>
      createMermaidRenderer({ theme: isDark.value ? 'dark' : 'default' })

    nextTick(() => initMermaid())
    watch(() => isDark.value, () => initMermaid())

    return h(DefaultTheme.Layout, null, {})
  },
  enhanceApp({ app }) {
    app.component('HomePage', HomePage),
    app.component('Tabs', Tabs),
    app.component('Tab', Tab)
  },
}
