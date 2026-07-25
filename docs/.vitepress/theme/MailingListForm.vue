<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'

// Cloudflare Turnstile site key (public, safe to commit). Override at build
// time with VITE_TURNSTILE_SITE_KEY if needed.
const SITE_KEY =
  (import.meta as any).env?.VITE_TURNSTILE_SITE_KEY || '0x4AAAAAADvCPLxcKZIoTjUr'

// Endpoint served by the Cloudflare Pages Function (docs/functions/api/subscribe.ts).
const ENDPOINT = '/api/subscribe'

type State = 'idle' | 'submitting' | 'success' | 'error'

const email = ref('')
const state = ref<State>('idle')
const message = ref('')
const turnstileToken = ref('')
const widgetEl = ref<HTMLElement | null>(null)

let widgetId: string | undefined
let scriptEl: HTMLScriptElement | undefined

const TURNSTILE_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

function renderWidget() {
  const turnstile = (window as any).turnstile
  if (!turnstile || !widgetEl.value) return
  widgetId = turnstile.render(widgetEl.value, {
    sitekey: SITE_KEY,
    theme: 'auto',
    callback: (token: string) => {
      turnstileToken.value = token
    },
    'expired-callback': () => {
      turnstileToken.value = ''
    },
    'error-callback': () => {
      turnstileToken.value = ''
    },
  })
}

onMounted(() => {
  // onMounted only runs client-side, so no SSR guard needed.
  if ((window as any).turnstile) {
    renderWidget()
    return
  }
  scriptEl = document.createElement('script')
  scriptEl.src = TURNSTILE_SRC
  scriptEl.async = true
  scriptEl.defer = true
  scriptEl.onload = renderWidget
  document.head.appendChild(scriptEl)
})

onBeforeUnmount(() => {
  const turnstile = (window as any).turnstile
  if (turnstile && widgetId !== undefined) {
    try {
      turnstile.remove(widgetId)
    } catch {
      /* ignore */
    }
  }
})

function resetWidget() {
  const turnstile = (window as any).turnstile
  if (turnstile && widgetId !== undefined) {
    turnstile.reset(widgetId)
  }
  turnstileToken.value = ''
}

const emailValid = () => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())

async function submit() {
  if (state.value === 'submitting') return

  if (!emailValid()) {
    state.value = 'error'
    message.value = 'Please enter a valid email address.'
    return
  }
  if (!turnstileToken.value) {
    state.value = 'error'
    message.value = 'Please complete the verification.'
    return
  }

  state.value = 'submitting'
  message.value = ''

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email.value.trim(),
        turnstileToken: turnstileToken.value,
      }),
    })

    if (res.ok) {
      state.value = 'success'
      message.value = "You're subscribed — we'll keep you posted on progress and the launch."
      email.value = ''
    } else {
      const data = await res.json().catch(() => ({}))
      state.value = 'error'
      message.value = (data && data.error) || 'Something went wrong. Please try again.'
    }
  } catch {
    state.value = 'error'
    message.value = 'Network error. Please try again.'
  } finally {
    if (state.value !== 'success') resetWidget()
  }
}
</script>

<template>
  <div class="mlist">
    <form v-if="state !== 'success'" class="wl-form" @submit.prevent="submit">
      <div class="wl-row">
        <input
          v-model="email"
          type="email"
          class="wl-input"
          placeholder="youremail@example.com"
          autocomplete="email"
          aria-label="Email address"
          :disabled="state === 'submitting'"
        />
        <button class="btn btn-brand wl-submit" type="submit" :disabled="state === 'submitting'">
          {{ state === 'submitting' ? 'Joining…' : 'Join the waiting list' }}
        </button>
      </div>

      <div ref="widgetEl" class="wl-turnstile"></div>

      <p v-if="state === 'error'" class="wl-msg wl-error">{{ message }}</p>
    </form>

    <p v-else class="wl-msg wl-success">✓ {{ message }}</p>
  </div>
</template>

<style scoped>
.mlist {
  max-width: 460px;
  margin: 26px auto 0;
}

.wl-form {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

.wl-row {
  display: flex;
  gap: 10px;
  width: 100%;
}

.wl-input {
  flex: 1;
  height: 46px;
  padding: 0 16px;
  border-radius: 999px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-size: 0.95rem;
  transition: border-color 0.15s ease;
}

.wl-input:focus {
  outline: none;
  border-color: var(--vp-c-brand-1);
}

.wl-submit {
  flex-shrink: 0;
  border: none;
  cursor: pointer;
  background-color: var(--vp-c-brand-1) !important;
  border-radius: 1000px !important;
  padding-left: 20px;
  padding-right: 20px;
  margin-top: 2px;
  margin-bottom: 2px;
  transition: transform 0.15s ease, background-color 0.15s ease, border-color 0.15s ease;
  color: white !important;
}


.wl-submit:hover {
  background-color: var(--vp-c-brand-1) !important;
  transform: translateY(-2px);
}

.wl-submit:disabled {
  opacity: 0.6;
  cursor: default;
}

.wl-turnstile {
  min-height: 65px;
  display: flex;
  justify-content: center;
  margin-top: 30px;
}

.wl-msg {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.5;
}

.wl-error {
  color: var(--vp-c-danger-1, #e5484d);
}

.wl-success {
  color: var(--vp-c-brand-1);
  font-weight: 600;
  text-align: center;
}

@media (max-width: 520px) {
  .wl-row {
    flex-direction: column;
  }

  .wl-submit {
    width: 100%;
    justify-content: center;
  }
}
</style>
