<script setup lang="ts">
import { provide, ref } from 'vue'

type TabData = {
  id: number
  title: string
}

const tabs = ref<TabData[]>([])
const activeTab = ref(0)

function registerTab(title: string) {
  const existing = tabs.value.find((tab) => tab.title === title)

  if (existing) {
    return existing.id
  }

  const id = tabs.value.length

  tabs.value.push({
    id,
    title
  })

  return id
}

provide('tabsContext', {
  tabs,
  activeTab,
  registerTab
})
</script>

<template>
  <div class="vp-tabs">
    <div class="vp-tabs__nav" role="tablist">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        class="vp-tabs__button"
        :class="{ 'is-active': activeTab === tab.id }"
        role="tab"
        :aria-selected="activeTab === tab.id"
        @click="activeTab = tab.id"
      >
        {{ tab.title }}
      </button>
    </div>

    <div class="vp-tabs__content">
      <slot />
    </div>
  </div>
</template>