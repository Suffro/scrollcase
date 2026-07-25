<script setup lang="ts">
withDefaults(
  defineProps<{
    href?: string
    label?: string
  }>(),
  {
    href: 'https://www.patreon.com/16427094/join',
    label: 'Support scrollcase on Patreon'
  }
)
</script>

<template>
  <div class="patreon-cta">
    <a class="patreon-btn" :href="href" target="_blank" rel="noopener noreferrer">
      <svg
        class="patreon-btn__icon"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 512 512"
        aria-hidden="true"
        focusable="false"
      >
        <path
          fill="currentColor"
          d="M489.7 153.8c-.1-65.4-51-119-110.7-138.3C304.8-8.5 207-5 136.1 28.4C50.3 68.9 23.3 157.7 22.3 246.2C21.5 319 28.7 510.6 136.9 512c80.3 1 92.3-102.5 129.5-152.3c26.4-35.5 60.5-45.5 102.4-55.9c72-17.8 121-74.7 120.9-150"
        />
      </svg>
      <span>{{ label }}</span>
    </a>
  </div>
</template>

<style scoped>
.patreon-cta {
  display: flex;
  justify-content: center;
  padding: 48px 0;
}

.patreon-btn {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 14px 28px;
  border-radius: 10px;
  background-color: #0a948b;
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.2;
  text-decoration: none;
  transition: background-color 0.2s ease, box-shadow 0.2s ease, transform 0.1s ease;
}

.patreon-btn:hover {
  background-color: #087f77;
  color: #fff;
  text-decoration: none;
  box-shadow: 0 6px 16px rgba(10, 148, 139, 0.35);
}

.patreon-btn:active {
  transform: translateY(1px);
}

.patreon-btn:focus-visible {
  outline: 2px solid #0a948b;
  outline-offset: 3px;
}

.patreon-btn__icon {
  width: 17px;
  height: 17px;
  flex: 0 0 auto;
  margin-top: -1px;
}
</style>