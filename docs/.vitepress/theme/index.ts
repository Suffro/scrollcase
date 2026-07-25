import DefaultTheme from 'vitepress/theme'
import { h } from 'vue'
import ShareThis from './ShareThis.vue'
import HomePage from './HomePage.vue'
import CookieBanner from './CookieBanner.vue'
import PatreonButton from './PatreonButton.vue'
import Tabs from './tabs-component/Tabs.vue'
import Tab from './tabs-component/Tab.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  // Wrap the default layout so the cookie banner is rendered on every page
  // via the persistent `layout-bottom` slot.
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'layout-bottom': () => h(CookieBanner),
      'nav-bar-content-after': () => h(ShareThis),
    })
  },
  enhanceApp({ app }) {
    app.component('HomePage', HomePage),
    app.component('PatreonButton', PatreonButton),
    app.component('Tabs', Tabs),
    app.component('Tab', Tab)
  },
}
