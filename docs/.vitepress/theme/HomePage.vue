<script setup lang="ts">
import { useData, withBase } from 'vitepress'
import { globalStore } from './store.ts'

const { theme } = useData()

const pillars = [
  {
    icon: 'feather',
    title: 'Signed and verifiable',
    text: 'Every archive is paired with a signed release document carrying its identity and content digest. Consumers verify both offline — no registry call and no trust in the download path.',
  },
  {
    icon: 'box',
    title: 'No container runtime',
    text: 'A box is a single archive that unpacks into a self-contained Python environment. No Docker, no daemon, no dependency resolution at install time.',
  },
  {
    icon: 'network',
    title: 'One format, many targets',
    text: 'macOS Metal, Linux and Windows on CPU or CUDA — described by one target model that builders, signers, and clients agree on character for character.',
  },
]

const capabilities = [
  {
    icon: 'scroll',
    title: 'Build from a scroll.json',
    text: 'Describe the environment once. Scrollcase resolves it against conda-forge with pixi and produces a box per target, fully pinned.',
  },
  {
    icon: 'shield-check',
    title: 'Validated before shipping',
    text: 'Every build checks target and imports; scrolls can add Python assertions, required files, and numerical parity gates. A failed gate produces no box.',
  },
  {
    icon: 'cpu',
    title: 'Accelerator-aware',
    text: 'The accelerator and CUDA ABI version are part of the box identity, so a CUDA 12.4 build can never be mistaken for a 12.8 one.',
  },
  {
    icon: 'hash',
    title: 'Reproducible identity',
    text: 'The target ID used in archive names and object paths is derived deterministically and locked by golden fixtures.',
  },
  {
    icon: 'book-open',
    title: 'Portable contract',
    text: 'The box format ships as a reference implementation plus JSON Schemas and fixtures, so other languages can mirror it and stay in agreement.',
  },
  {
    icon: 'wifi-off',
    title: 'Air-gapped installs',
    text: 'Download once, carry the archive across, verify and unpack anywhere. The same box works on a connected laptop and an isolated workstation.',
  },
]
</script>

<template>
  <div class="home">
    <!-- ── Hero ─────────────────────────────────────────────── -->
    <section class="hero">
      <!-- Stardust Dot Pattern -->
      <div class="tech-grid" aria-hidden="true"></div>
      <!-- Alchemical Sigil -->
      <div class="arcane-sigil" aria-hidden="true">
        <svg width="100%" height="100%" viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-width="0.4">
          <circle cx="100" cy="100" r="98" stroke-dasharray="2 3" />
          <circle cx="100" cy="100" r="80" />
          <circle cx="100" cy="100" r="60" stroke-dasharray="1 2" />
          <polygon points="100,25 165,132 35,132" />
          <polygon points="100,175 35,68 165,68" />
          <circle cx="100" cy="100" r="24" />
          <circle cx="100" cy="100" r="8" stroke-width="0.8"/>
          <line x1="0" y1="100" x2="200" y2="100" stroke-dasharray="1 5" />
          <line x1="100" y1="0" x2="100" y2="200" stroke-dasharray="1 5" />
          <line x1="29" y1="29" x2="171" y2="171" stroke-dasharray="1 8" />
          <line x1="171" y1="29" x2="29" y2="171" stroke-dasharray="1 8" />
        </svg>
      </div>
      <!-- Monochrome Ambient Spotlight -->
      <div class="tech-glow" aria-hidden="true"></div>

      <div class="container hero-inner">
        <!-- Left Column: Content -->
        <div class="hero-content">
          <span class="status-badge">
            <span class="status-dot"></span>
            v{{ globalStore.packageVersion }} · schema v1
          </span>

          <h1 class="name hero-title">Scrollcase</h1>

          <p class="headline">Pack AI and scientific models<br>as self-contained boxes.</p>

          <p class="tagline">
            Pinned, validated, signed, no Docker, and usable offline on macOS Metal, Linux and Windows (CPU and CUDA).
          </p>

          <div class="actions">
            <a class="btn btn-primary" :href="withBase('/getting-started/quickstart')">
              <span class="btn-text">Read the docs</span>
            </a>
            <a class="btn btn-ghost" target="_blank" href="https://github.com/suffro/scrollcase">
              <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2c-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.27-1.69-1.27-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.62 1.59.23 2.76.11 3.05.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.68.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z"/></svg>
              <span>GitHub</span>
            </a>
          </div>

          <p class="trust">Licence: Apache-2.0</p>
        </div>

        <!-- Right Column: Terminal Window -->
        <div class="hero-visual" aria-hidden="true">
          <div class="window-chrome">
            <span class="dot"></span>
            <span class="dot"></span>
            <span class="dot"></span>
            <span class="window-title">arthas@Arthas-MacbookAir ~ % scrollcase</span>
          </div>
          <div class="window-body">
            <div class="code-line"><span class="c-prompt">$</span> <span class="c-cmd">scrollcase init</span></div>
            <div class="code-line"><span class="c-muted">Which target? ❯ macos-aarch64-metal</span></div>
            <div class="code-line"><span class="c-success">✓</span> Created <span class="c-muted">scrollcase.config.json</span></div>
            <div class="code-line"><span class="c-success">✓</span> Installed <span class="c-info">pixi 0.74.0</span> and <span class="c-info">conda-pack</span></div>
            
            <div class="code-line mt"><span class="c-prompt">$</span> <span class="c-cmd">scrollcase lock example-box</span></div>
            <div class="code-line"><span class="c-muted">  + C python           3.11.15 h0c9c016_1_cpython</span></div>
            <div class="code-line"><span class="c-muted">  + C pytorch          2.2.0   h0c9c016_1_cuda</span></div>
            <div class="code-line"><span class="c-success">✓</span> Updated <span class="c-muted">pixi.lock</span></div>
            
            <div class="code-line mt"><span class="c-prompt">$</span> <span class="c-cmd">scrollcase keygen</span></div>
            <div class="code-line"><span class="c-success">✓</span> Created signing key <span class="c-info">scrollcase-fa120ac69c</span></div>
            
            <div class="code-line mt"><span class="c-prompt">$</span> <span class="c-cmd">scrollcase build example-box</span></div>
            <div class="code-line"><span class="c-muted">→ Building example-box/macos-aarch64-metal (beta, embed)</span></div>
            <div class="code-line"><span class="c-muted">[########################################] 100%</span></div>
            <div class="code-line"><span class="c-success">✓ Build complete</span> <span class="c-muted">— your box is ready</span></div>
          </div>
        </div>
      </div>
    </section>

    <!-- ── Pillars ──────────────────────────────────────────── -->
    <section class="container band">
      <div class="pillars">
        <article v-for="p in pillars" :key="p.title" class="card tech-card pillar">
          <span class="tech-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
                 stroke-linecap="round" stroke-linejoin="round">
              <template v-if="p.icon === 'feather'">
                <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" />
                <line x1="16" y1="8" x2="2" y2="22" />
                <line x1="17.5" y1="15" x2="9" y2="15" />
              </template>
              <template v-else-if="p.icon === 'box'">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </template>
              <template v-else-if="p.icon === 'network'">
                <circle cx="5" cy="12" r="3" />
                <circle cx="19" cy="5" r="3" />
                <circle cx="19" cy="12" r="3" />
                <circle cx="19" cy="19" r="3" />
                <path d="M8 12h8M12 12V7a2 2 0 0 1 2-2h2M12 12v5a2 2 0 0 0 2 2h2" />
              </template>
            </svg>
          </span>
          <h3 class="card-title">{{ p.title }}</h3>
          <p>{{ p.text }}</p>
        </article>
      </div>
    </section>

    <!-- ── Capabilities ─────────────────────────────────────── -->
    <section class="container band">
      <div class="section-head">
        <h2 class="section-title">A scroll for all your spells</h2>
        <p>Resolve, build, validate, sign — one pipeline, one format, every target.</p>
      </div>

      <div class="grid">
        <article v-for="c in capabilities" :key="c.title" class="card tech-card cap">
          <span class="tech-icon sm">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
                 stroke-linecap="round" stroke-linejoin="round">
              <template v-if="c.icon === 'scroll'">
                <path d="M8 21h12a2 2 0 0 0 2-2v-2H10v2a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v3h4" />
                <path d="M19 17V5a2 2 0 0 0-2-2H4" />
              </template>
              <template v-else-if="c.icon === 'shield-check'">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <path d="M9 12l2 2 4-4" />
              </template>
              <template v-else-if="c.icon === 'cpu'">
                <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
                <rect x="9" y="9" width="6" height="6" />
                <line x1="9" y1="1" x2="9" y2="4" />
                <line x1="15" y1="1" x2="15" y2="4" />
                <line x1="9" y1="20" x2="9" y2="23" />
                <line x1="15" y1="20" x2="15" y2="23" />
                <line x1="20" y1="9" x2="23" y2="9" />
                <line x1="20" y1="14" x2="23" y2="14" />
                <line x1="1" y1="9" x2="4" y2="9" />
                <line x1="1" y1="14" x2="4" y2="14" />
              </template>
              <template v-else-if="c.icon === 'hash'">
                <line x1="4" y1="9" x2="20" y2="9" />
                <line x1="4" y1="15" x2="20" y2="15" />
                <line x1="10" y1="3" x2="8" y2="21" />
                <line x1="16" y1="3" x2="14" y2="21" />
              </template>
              <template v-else-if="c.icon === 'book-open'">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </template>
              <template v-else-if="c.icon === 'wifi-off'">
                <line x1="2" y1="2" x2="22" y2="22" />
                <path d="M8.5 16.5a5 5 0 0 1 7 0" />
                <path d="M2 8.82a15 15 0 0 1 4.17-2.65" />
                <path d="M10.66 5C11.1 4.93 11.54 4.9 12 4.9c4.25 0 8.1 1.76 10.85 4.59" />
              </template>
            </svg>
          </span>
          <div>
            <h3 class="card-title">{{ c.title }}</h3>
            <p>{{ c.text }}</p>
          </div>
        </article>
      </div>
    </section>

    <!-- ── Incantations (CLI) ──────────────────────────────── -->
    <section class="container band surface">
      <div class="section-head">
        <h2 class="section-title">Core CLI Commands</h2>
        <p>Seven focused verbs, plus public modules for consumers and integrations.</p>
      </div>
      <div class="incantation-list">
        <span class="incantation"><code>init</code></span>
        <span class="incantation"><code>doctor</code></span>
        <span class="incantation"><code>keygen</code></span>
        <span class="incantation"><code>lock</code></span>
        <span class="incantation"><code>audit</code></span>
        <span class="incantation"><code>build</code></span>
        <span class="incantation"><code>verify</code></span>
      </div>
      <div class="incantation-list secondary">
        <span class="incantation"><code>scrollcase/contract</code></span>
        <span class="incantation"><code>scrollcase/build</code></span>
        <span class="incantation"><code>scrollcase/sign</code></span>
        <span class="incantation"><code>scrollcase/contract/types</code></span>
      </div>
      <p class="surface-note">Scrollcase stops at a signed, verified box on disk. Distribution,
        promotion, registries, and installation policy belong to the consuming project.</p>
    </section>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');

/* Override VitePress default font families for a more modern look */
.home {
  --vp-font-family-base: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
  --vp-font-family-mono: 'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  font-family: var(--vp-font-family-base);
  padding-bottom: 96px;
}

.container {
  max-width: 1152px;
  margin: 0 auto;
  padding-inline: 24px;
}

.band {
  margin-top: 96px;
}

/* ── Hero & Tech Background ──────────────────────────────── */
.hero {
  position: relative;
  overflow: hidden;
  padding-top: 120px;
  padding-bottom: 80px;
  border-bottom: 1px solid var(--vp-c-divider);
}

/* Subtle stardust dot pattern background */
.tech-grid {
  position: absolute;
  inset: 0;
  z-index: 0;
  background-image: radial-gradient(rgba(0, 0, 0, 0.1) 1.5px, transparent 1.5px);
  background-size: 32px 32px;
  mask-image: radial-gradient(ellipse 80% 60% at 50% 40%, black 30%, transparent 80%);
  -webkit-mask-image: radial-gradient(ellipse 80% 60% at 50% 40%, black 30%, transparent 80%);
  opacity: 0.5;
  pointer-events: none;
}

html.dark .tech-grid {
  background-image: radial-gradient(rgba(255, 255, 255, 0.08) 1.5px, transparent 1.5px);
  opacity: 0.4;
}

/* Arcane Sigil rotating slowly in the hero background (Left aligned) */
.arcane-sigil {
  position: absolute;
  top: 50%;
  left: 100%; 
  transform: translate(-50%, -50%);
  width: 1100px;
  height: 1100px;
  color: black;
  opacity: 0;
  z-index: 0;
  pointer-events: none;
  animation: rotate-sigil 180s linear infinite;
}

html.dark .arcane-sigil {
  color: white;
  opacity: 0;
}

@keyframes rotate-sigil {
  100% { transform: translate(-50%, -50%) rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .arcane-sigil {
    animation: none;
  }
}

/* Monochrome ambient spotlight (Sostituisce il glow giallo sporco) */
.tech-glow {
  position: absolute;
  top: -15%;
  left: -20%; 
  width: 700px;
  height: 700px;
  background: radial-gradient(circle, rgba(0, 0, 0, 0) 0%, transparent 70%);
  filter: blur(80px);
  z-index: 0;
  pointer-events: none;
}

html.dark .tech-glow {
  background: radial-gradient(circle, rgba(255, 255, 255, 0) 0%, transparent 70%);
}

.hero-inner {
  position: relative;
  z-index: 1;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 64px;
}

.hero-content {
  max-width: 600px;
  text-align: left;
}

/* ── Status Badge ───────────────────────────────── */
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-family: var(--vp-font-family-mono);
  font-size: 0.8rem;
  letter-spacing: 0.02em;
  color: var(--vp-c-text-2);
  background: color-mix(in srgb, var(--vp-c-bg-soft) 80%, transparent);
  border: 1px solid var(--vp-c-divider);
  padding: 6px 14px;
  border-radius: 20px;
  backdrop-filter: blur(8px);
}

.status-dot {
  width: 8px;
  height: 8px;
  background: var(--vp-c-brand-1);
  border-radius: 50%;
  box-shadow: 0 0 10px var(--vp-c-brand-1);
  animation: pulse-dot 2s infinite ease-in-out;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.6; transform: scale(0.8); }
}

/* ── Typography ───────────────────────────────── */
.name {
  margin: 24px 0 0;
  font-size: clamp(3rem, 7vw, 4.5rem);
  line-height: 1;
  letter-spacing: -0.03em;
  font-weight: 800;
  color: var(--vp-c-text-1);
  font-family: var(--vp-font-family-base);
}

.headline {
  margin: 24px 0 0;
  max-width: 480px;
  font-size: clamp(1.2rem, 2.5vw, 1.6rem);
  line-height: 1.4;
  font-weight: 600;
  color: var(--vp-c-text-1);
  letter-spacing: -0.01em;
}

.tagline {
  margin: 16px 0 0;
  max-width: 520px;
  font-size: 1rem;
  line-height: 1.6;
  color: var(--vp-c-text-2);
}

/* ── Actions ───────────────────────────────────────────── */
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 40px;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 44px;
  padding: 0 20px;
  font-size: 0.9rem;
  font-weight: 600;
  transition: all 0.2s ease;
  border-radius: 8px;
  font-family: var(--vp-font-family-base);
}

.btn svg {
  width: 18px; height: 18px;
}

.btn-primary {
  color: var(--vp-c-bg);
  background: var(--vp-c-brand-1);
  border: 1px solid var(--vp-c-brand-1);
}

.btn-primary:hover {
  background: var(--vp-c-brand-2);
  border-color: var(--vp-c-brand-2);
}

.btn-ghost {
  color: var(--vp-c-text-1);
  background: transparent;
  border: 1px solid var(--vp-c-divider);
}

.btn-ghost:hover {
  border-color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
}

.trust {
  margin-top: 32px;
  font-family: var(--vp-font-family-mono);
  font-size: 0.75rem;
  color: var(--vp-c-text-3);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* ── Hero Visual (Terminal) ─────────────────────────── */
.hero-visual {
  flex: 1;
  max-width: 520px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  box-shadow: 0 20px 40px -20px rgba(0,0,0,0.2);
  overflow: hidden;
  font-family: var(--vp-font-family-mono);
  position: relative;
}

/* Subtle scanline effect on terminal */
.hero-visual::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(transparent 50%, rgba(0,0,0,0.02) 50%);
  background-size: 100% 4px;
  pointer-events: none;
}

.window-chrome {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 16px;
  background: color-mix(in srgb, var(--vp-c-bg-soft) 50%, var(--vp-c-bg));
  border-bottom: 1px solid var(--vp-c-divider);
}

.window-chrome .dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--vp-c-divider);
}

.window-chrome .dot:nth-child(1) { background: #ff5f56; }
.window-chrome .dot:nth-child(2) { background: #ffbd2e; }
.window-chrome .dot:nth-child(3) { background: #27c93f; }

.window-title {
  margin-left: 12px;
  font-size: 0.75rem;
  color: var(--vp-c-text-3);
  letter-spacing: 0.02em;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}

.window-body {
  padding: 20px;
  font-size: 0.78rem;
  line-height: 1.65;
}

.code-line {
  color: var(--vp-c-text-2);
  word-break: break-all;
  white-space: pre-wrap;
}

.code-line.mt {
  margin-top: 12px;
}

.c-prompt { color: var(--vp-c-brand-1); font-weight: bold; }
.c-cmd { color: var(--vp-c-text-1); font-weight: 600; }
.c-muted { color: var(--vp-c-text-3); }
.c-success { color: #27c93f; font-weight: 600; }
.c-info { color: var(--vp-c-brand-1); }

/* ── Light Mode Terminal Accents ───────────────────── */
/* Forziamo colori leggibili per il terminale in light mode invece del giallo di default */
html:not(.dark) .c-prompt,
html:not(.dark) .c-info {
  color: #2563eb; /* Azzurro tech molto leggibile */
}

html:not(.dark) .c-success {
  color: #16a34a; /* Verde scuro leggibile */
}

html:not(.dark) .c-muted {
  color: #6b7280; /* Grigio scuro */
}

/* ── Section Heads ──────────────────────────────────────── */
.section-head {
  text-align: center;
  margin-bottom: 56px;
}

.section-title {
  font-family: var(--vp-font-family-base);
  font-size: clamp(1.8rem, 3vw, 2.4rem);
  margin: 0;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--vp-c-text-1);
}

.section-head p {
  margin: 12px auto 0;
  max-width: 520px;
  color: var(--vp-c-text-2);
}

/* ── Cards (Tech Cards) ─────────────────────────────────── */
.tech-card {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  padding: 28px;
  transition: all 0.2s ease;
  position: relative;
  overflow: hidden;
}

/* Hover sheen effect */
.tech-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--vp-c-brand-1), transparent);
  opacity: 0;
  transition: opacity 0.3s ease;
}

.tech-card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 40%, var(--vp-c-divider));
}

.tech-card:hover::before {
  opacity: 1;
}

.tech-card h3 {
  margin: 0 0 12px;
  font-size: 1.15rem;
  color: var(--vp-c-text-1);
  font-weight: 600;
  font-family: var(--vp-font-family-base);
}

.tech-card p {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.6;
  color: var(--vp-c-text-2);
}

.pillars, .grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}

.pillar h3 { margin-top: 20px; }
.cap { display: flex; gap: 16px; align-items: flex-start; }

/* ── Tech Icons ─────────────────────────────────────────── */
.tech-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px; height: 44px;
  color: var(--vp-c-brand-1);
  background: color-mix(in srgb, var(--vp-c-brand-1) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 20%, transparent);
  border-radius: 8px;
  flex-shrink: 0;
  transition: all 0.2s ease;
}

.tech-icon svg {
  width: 22px; height: 22px;
}

.tech-card:hover .tech-icon {
  background: color-mix(in srgb, var(--vp-c-brand-1) 15%, transparent);
  border-color: var(--vp-c-brand-1);
}

.tech-icon.sm {
  width: 38px; height: 38px;
  border-radius: 6px;
}
.tech-icon.sm svg {
  width: 18px; height: 18px;
}

/* ── Surface / Incantations ────────────────────────────── */
.surface { text-align: center; }

.incantation-list {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  margin: 24px 0;
}

.incantation-list.secondary {
  gap: 8px;
  opacity: 0.7;
}

.incantation code {
  font-family: var(--vp-font-family-mono);
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 0.85rem;
  color: var(--vp-c-text-1);
  transition: all 0.2s ease;
  cursor: default;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
}

/* Fantasy rune glyph before incantations */
.incantation code::before {
  content: '◇';
  margin-right: 8px;
  color: var(--vp-c-brand-1);
  opacity: 0.7;
  font-size: 0.75rem;
}

.incantation-list.secondary code::before {
  content: '·';
  font-size: 1rem;
  opacity: 0.5;
}

.incantation:hover code {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
  background: color-mix(in srgb, var(--vp-c-brand-1) 10%, var(--vp-c-bg-soft));
  transform: translateY(-1px);
}

.incantation:hover code::before {
  opacity: 1;
}

.surface-note {
  max-width: 600px;
  margin: 40px auto 0;
  color: var(--vp-c-text-3);
  font-size: 0.85rem;
  line-height: 1.6;
  font-style: italic;
}

/* ── Responsive ────────────────────────────────────────── */
@media (max-width: 960px) {
  .hero-inner {
    flex-direction: column;
    align-items: flex-start;
    gap: 48px;
  }
  .hero-visual {
    width: 100%;
    max-width: 100%;
  }
  .hero-content {
    max-width: 100%;
  }
}

@media (max-width: 860px) {
  .pillars, .grid { grid-template-columns: 1fr; }
  .band { margin-top: 64px; }
  .name { font-size: 2.8rem; }
}
</style>