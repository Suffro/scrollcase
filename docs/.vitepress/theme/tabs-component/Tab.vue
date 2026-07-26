<script setup lang="ts">
import { computed, inject } from 'vue'
import type { Ref } from 'vue'

const props = defineProps<{
  title: string
}>()

const tabsContext = inject<{
  tabs: Ref<Array<{ id: number; title: string }>>
  activeTab: Ref<number>
  registerTab: (title: string) => number
  tabButtonId: (id: number) => string
  tabPanelId: (id: number) => string
}>('tabsContext')

if (!tabsContext) {
  throw new Error('<Tab> must be used inside <Tabs>')
}

const tabId = tabsContext.registerTab(props.title)

const isActive = computed(() => {
  return tabId === tabsContext.activeTab.value
})
</script>

<template>
  <div
    v-show="isActive"
    class="vp-tabs__panel"
    role="tabpanel"
    :id="tabsContext.tabPanelId(tabId)"
    :aria-labelledby="tabsContext.tabButtonId(tabId)"
    tabindex="0"
    markdown="1"
  >
    <slot />
  </div>
</template>
