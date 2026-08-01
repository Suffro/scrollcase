<!-- .vitepress/theme/SubPagesList.vue -->
<script setup>
import { useData } from 'vitepress'
// Ensure the extension matches your actual file
import { data as allPages } from './subpages.data.js'
import { computed } from 'vue'

// Define the properties that can be passed from Markdown
const props = defineProps({
  title: {
    type: String,
    default: 'In this section'
  },
  subtitle: {
    type: String,
    default: ''
  }
})

const { page } = useData()

const currentSectionPages = computed(() => {
  const relativePath = page.value.relativePath
  const currentDir = relativePath.substring(0, relativePath.lastIndexOf('/') + 1)
  
  if (!currentDir) return []

  const basePath = '/' + currentDir

  return allPages.filter(p => {
    if (!p.url.startsWith(basePath)) return false

    const remainingPath = p.url.slice(basePath.length)
    const isDirectChild = !remainingPath.includes('/')
    const isNotIndex = !p.url.endsWith('index.html') && !p.url.endsWith('/')

    return isDirectChild && isNotIndex
  })
})
</script>

<template>
  <div v-if="currentSectionPages.length" class="subpages-container">
    <!-- Title styled like a VitePress H1 (#) -->
    <h1 class="subpages-title">{{ title }}</h1>
    
    <!-- Subtitle rendered only if provided -->
    <p v-if="subtitle" class="subpages-subtitle">{{ subtitle }}</p>
    
    <div class="subpages-grid">
      <a 
        v-for="subPage in currentSectionPages" 
        :key="subPage.url" 
        :href="subPage.url" 
        class="subpage-card"
      >
        <span class="subpage-title-text">{{ subPage.title }}</span>
        <span class="subpage-icon">→</span>
      </a>
    </div>
  </div>
</template>

<style scoped>
.subpages-container {
  margin: 48px 0;
}

/* Styled to match VitePress standard # (H1) */
.subpages-title {
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.5px;
  line-height: 40px;
  margin-bottom: 8px;
  color: var(--vp-c-text-1);
}

/* Subtitle styling */
.subpages-subtitle {
  font-size: 16px;
  color: var(--vp-c-text-2);
  margin-bottom: 24px;
  line-height: 24px;
}

/* Grid for the cards */
.subpages-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  margin-top: 24px;
}

/* Card styling matching VitePress aesthetic */
.subpage-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  background-color: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  text-decoration: none !important;
  transition: border-color 0.25s, background-color 0.25s;
}

.subpage-title-text {
  font-size: 14px;
  font-weight: 500;
  color: var(--vp-c-text-2);
  transition: color 0.25s;
}

.subpage-icon {
  font-size: 16px;
  color: var(--vp-c-text-3);
  transition: color 0.25s, transform 0.25s;
}

/* Hover effects */
.subpage-card:hover {
  border-color: var(--vp-c-brand-1);
  background-color: var(--vp-c-bg-mute);
}

.subpage-card:hover .subpage-title-text {
  color: var(--vp-c-brand-1);
}

.subpage-card:hover .subpage-icon {
  color: var(--vp-c-brand-1);
  transform: translateX(4px);
}
</style>