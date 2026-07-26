<script setup lang="ts">
import { nextTick, provide, ref, useId } from 'vue'

type TabData = {
  id: number
  title: string
}

const props = defineProps<{
  titles: string[]
}>()

const tabs = ref<TabData[]>(
  props.titles.map((title, id) => ({
    id,
    title
  }))
)
const activeTab = ref(0)
const tablist = ref<HTMLElement | null>(null)
const instanceId = `scrollcase-tabs-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`

const tabButtonId = (id: number) => `${instanceId}-tab-${id}`
const tabPanelId = (id: number) => `${instanceId}-panel-${id}`

function registerTab(title: string) {
  const existing = tabs.value.find((tab) => tab.title === title)

  if (existing) {
    return existing.id
  }

  throw new Error(`<Tab title="${title}"> is missing from the parent <Tabs> titles`)
}

async function activate(id: number, focus = false) {
  activeTab.value = id
  if (!focus) return
  await nextTick()
  tablist.value?.querySelector<HTMLElement>(`#${tabButtonId(id)}`)?.focus()
}

function onKeydown(event: KeyboardEvent, id: number) {
  let next = id
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (id + 1) % tabs.value.length
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    next = (id - 1 + tabs.value.length) % tabs.value.length
  } else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = tabs.value.length - 1
  else return
  event.preventDefault()
  void activate(next, true)
}

provide('tabsContext', {
  tabs,
  activeTab,
  registerTab,
  tabButtonId,
  tabPanelId
})
</script>

<template>
  <div class="vp-tabs">
    <div ref="tablist" class="vp-tabs__nav" role="tablist" aria-label="Examples">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        class="vp-tabs__button"
        :class="{ 'is-active': activeTab === tab.id }"
        role="tab"
        :id="tabButtonId(tab.id)"
        :aria-controls="tabPanelId(tab.id)"
        :aria-selected="activeTab === tab.id"
        :tabindex="activeTab === tab.id ? 0 : -1"
        @click="activate(tab.id)"
        @keydown="onKeydown($event, tab.id)"
      >
        {{ tab.title }}
      </button>
    </div>

    <div class="vp-tabs__content">
      <slot />
    </div>
  </div>
</template>
