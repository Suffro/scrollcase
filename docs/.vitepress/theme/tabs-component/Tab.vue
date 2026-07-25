<script setup lang="ts">
import { computed, inject, onBeforeMount, ref } from 'vue'
import type { Ref } from 'vue'

const props = defineProps<{
  title: string
}>()

const tabsContext = inject<{
  tabs: Ref<Array<{ id: number; title: string }>>
  activeTab: Ref<number>
  registerTab: (title: string) => number
}>('tabsContext')

if (!tabsContext) {
  throw new Error('<Tab> must be used inside <Tabs>')
}

const tabId = ref<number | null>(null)

onBeforeMount(() => {
  tabId.value = tabsContext.registerTab(props.title)
})

const isActive = computed(() => {
  return tabId.value === tabsContext.activeTab.value
})
</script>

<template>
  <div
    v-show="isActive"
    class="vp-tabs__panel"
    role="tabpanel"
    markdown="1"
  >
    <slot />
  </div>
</template>