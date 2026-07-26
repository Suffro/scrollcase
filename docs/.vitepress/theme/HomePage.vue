<script setup lang="ts">
import { withBase } from 'vitepress'

const pillars = [
  {
    icon: 'shield',
    title: 'Signed and verifiable',
    text: 'Every box carries a manifest, content digests, and a signature. Consumers verify a box offline before unpacking it — no registry call, no trust in the download path.',
  },
  {
    icon: 'bolt',
    title: 'No container runtime',
    text: 'A box is a single archive that unpacks into a self-contained Python environment. No Docker, no daemon, no dependency resolution at install time.',
  },
  {
    icon: 'puzzle',
    title: 'One format, many targets',
    text: 'macOS Metal, Linux and Windows on CPU or CUDA — described by one target model that builders, signers, and clients agree on character for character.',
  },
]

const capabilities = [
  {
    icon: 'terminal',
    title: 'Build from a recipe',
    text: 'Describe the environment once. Scrollcase resolves it against conda-forge with pixi and produces a box per target, fully pinned.',
  },
  {
    icon: 'flow',
    title: 'Validated before shipping',
    text: 'Each build runs the recipe’s own validation on real inputs. A box that fails validation never gets an identity.',
  },
  {
    icon: 'spark',
    title: 'Accelerator-aware',
    text: 'The accelerator and CUDA ABI version are part of the box identity, so a CUDA 12.4 build can never be mistaken for a 12.8 one.',
  },
  {
    icon: 'layers',
    title: 'Reproducible identity',
    text: 'The target ID that appears in archive names, object keys, and registry routes is derived deterministically and locked by golden fixtures.',
  },
  {
    icon: 'plug',
    title: 'Portable contract',
    text: 'The box format ships as a reference implementation plus JSON Schemas and fixtures, so other languages can mirror it and stay in agreement.',
  },
  {
    icon: 'eye',
    title: 'Air-gapped installs',
    text: 'Download once, carry the archive across, verify and unpack anywhere. The same box works on a connected laptop and an isolated workstation.',
  },
]
</script>

<template>
  <div class="home">
    <!-- ── Hero ─────────────────────────────────────────────── -->
    <section class="hero">
      <div class="hero-glow" aria-hidden="true"></div>

      <div class="container hero-inner">
        <span class="status"><span class="status-dot" aria-hidden="true"></span>In active development · Coming soon</span>

        <h1 class="name">Scrollcase</h1>

        <p class="headline">Pack AI and scientific models<br>as self-contained boxes.</p>

        <p class="tagline">
          No docker, pinned, validated, signed, and installable offline on<br>macOS metal, Linux and Windows (CPU and CUDA).
        </p>

        <div class="actions">
          <a class="btn btn-brand" :href="withBase('/getting-started/quickstart')">Read the docs</a>
          <a class="btn btn-alt" href="https://github.com/Suffro/scrollcase">GitHub</a>
        </div>

        <p class="trust">Apache-2.0</p>
      </div>
    </section>

    <!-- ── Pillars ──────────────────────────────────────────── -->
    <section class="container band">
      <div class="pillars">
        <article v-for="p in pillars" :key="p.title" class="card pillar">
          <span class="icon-chip">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"
                 stroke-linecap="round" stroke-linejoin="round">
              <template v-if="p.icon === 'shield'">
                <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
                <path d="M9 12l2 2 4-4" />
              </template>
              <template v-else-if="p.icon === 'bolt'">
                <path d="M13 2L4 14h6l-1 8 9-12h-6z" />
              </template>
              <template v-else-if="p.icon === 'puzzle'">
                <path d="M9 4a2 2 0 114 0v1h3a1 1 0 011 1v3h1a2 2 0 110 4h-1v3a1 1 0 01-1 1h-3v-1a2 2 0 10-4 0v1H5a1 1 0 01-1-1v-3H3a2 2 0 110-4h1V6a1 1 0 011-1h4z" />
              </template>
            </svg>
          </span>
          <h3>{{ p.title }}</h3>
          <p>{{ p.text }}</p>
        </article>
      </div>
    </section>

    <!-- ── Capabilities ─────────────────────────────────────── -->
    <section class="container band">
      <div class="section-head">
        <h2>From recipe to installable box</h2>
        <p>Resolve, build, validate, sign — one pipeline, one format, every target.</p>
      </div>

      <div class="grid">
        <article v-for="c in capabilities" :key="c.title" class="card cap">
          <span class="icon-chip sm">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"
                 stroke-linecap="round" stroke-linejoin="round">
              <template v-if="c.icon === 'terminal'">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M7 9l3 3-3 3M13 15h4" />
              </template>
              <template v-else-if="c.icon === 'flow'">
                <circle cx="6" cy="6" r="2.5" />
                <circle cx="18" cy="6" r="2.5" />
                <circle cx="12" cy="18" r="2.5" />
                <path d="M8 7.5l3 8M16 7.5l-3 8" />
              </template>
              <template v-else-if="c.icon === 'spark'">
                <path d="M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15l-1.8-4.2L5.5 9l4.7-1.3z" />
                <path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" />
              </template>
              <template v-else-if="c.icon === 'layers'">
                <path d="M12 3l9 5-9 5-9-5z" />
                <path d="M3 13l9 5 9-5" />
              </template>
              <template v-else-if="c.icon === 'plug'">
                <path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 01-12 0z" />
                <path d="M12 17v4" />
              </template>
              <template v-else-if="c.icon === 'eye'">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                <circle cx="12" cy="12" r="2.5" />
              </template>
            </svg>
          </span>
          <div>
            <h3>{{ c.title }}</h3>
            <p>{{ c.text }}</p>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped>
.home {
  padding-bottom: 96px;
}

.container {
  max-width: 1152px;
  margin: 0 auto;
  padding-inline: 24px;
}

.band {
  margin-top: 72px;
}

/* ── Hero ──────────────────────────────────────────────── */
.hero {
  position: relative;
  overflow: hidden;
  padding-top: 88px;
  padding-bottom: 8px;
}

.hero-glow {
  position: absolute;
  top: -220px;
  left: 50%;
  transform: translateX(-50%);
  width: 900px;
  height: 600px;
  background: radial-gradient(
    circle at center,
    color-mix(in srgb, var(--vp-c-brand-1) 26%, transparent) 0%,
    transparent 62%
  );
  filter: blur(20px);
  pointer-events: none;
  z-index: 0;
}

.hero-inner {
  position: relative;
  z-index: 1;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.eyebrow {
  display: inline-block;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-bg-soft);
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 22%, transparent);
  padding: 6px 14px;
  border-radius: 999px;
}

/* ── Status pill (coming soon) ─────────────────────────── */
.status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 22%, transparent);
  padding: 6px 14px 6px 12px;
  border-radius: 999px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--vp-c-brand-1);
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--vp-c-brand-1) 60%, transparent);
  animation: status-pulse 2s ease-out infinite;
}

@keyframes status-pulse {
  0% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--vp-c-brand-1) 55%, transparent);
  }
  70% {
    box-shadow: 0 0 0 7px color-mix(in srgb, var(--vp-c-brand-1) 0%, transparent);
  }
  100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--vp-c-brand-1) 0%, transparent);
  }
}

@media (prefers-reduced-motion: reduce) {
  .status-dot {
    animation: none;
  }
}

.name {
  margin: 30px 0 0;
  font-size: clamp(3.25rem, 9vw, 5.5rem);
  line-height: 1;
  font-weight: 800;
  letter-spacing: -0.03em;
  background: linear-gradient(135deg, var(--vp-c-brand-1) 0%, var(--vp-c-brand-1) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.headline {
  margin: 20px auto 0;
  max-width: 620px;
  font-size: clamp(1.25rem, 2.6vw, 1.6rem);
  line-height: 1.3;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.tagline {
  margin: 16px auto 0;
  max-width: 560px;
  font-size: 1.02rem;
  line-height: 1.65;
  color: var(--vp-c-text-2);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  justify-content: center;
  margin-top: 34px;
}

.btn {
  display: inline-flex;
  align-items: center;
  height: 46px;
  padding: 0 24px;
  border-radius: 999px;
  font-size: 0.95rem;
  font-weight: 600;
  transition: transform 0.15s ease, background-color 0.15s ease, border-color 0.15s ease;
}

.btn:hover {
  transform: translateY(-2px);
}

.btn-brand {
  color: var(--vp-c-bg);
  background: var(--vp-c-brand-1);
  border: 1px solid var(--vp-c-brand-1);
}

.btn-brand:hover {
  background: var(--vp-c-brand-2);
  border-color: var(--vp-c-brand-2);
}

.btn-alt {
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
}

.btn-alt:hover {
  border-color: var(--vp-c-brand-1);
}

.trust {
  margin-top: 26px;
  font-size: 0.85rem;
  letter-spacing: 0.01em;
  color: var(--vp-c-text-3);
}

/* ── Section heads ─────────────────────────────────────── */
.section-head {
  text-align: center;
  margin-bottom: 36px;
}

.section-head h2 {
  font-size: clamp(1.5rem, 3.5vw, 2rem);
  font-weight: 700;
  letter-spacing: -0.02em;
  margin: 0;
}

.section-head p {
  margin: 10px auto 0;
  max-width: 520px;
  color: var(--vp-c-text-2);
}

/* ── Cards ─────────────────────────────────────────────── */
.card {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 16px;
  padding: 26px;
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}

.card:hover {
  transform: translateY(-3px);
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 45%, var(--vp-c-divider));
  box-shadow: 0 12px 30px color-mix(in srgb, var(--vp-c-brand-1) 12%, transparent);
}

.card h3 {
  margin: 0 0 6px;
  font-size: 1.05rem;
  font-weight: 650;
  letter-spacing: -0.01em;
  color: var(--vp-c-text-1);
}

.card p {
  margin: 0;
  font-size: 0.93rem;
  line-height: 1.6;
  color: var(--vp-c-text-2);
}

.pillars {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}

.pillar h3 {
  margin-top: 18px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}

.cap {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

/* ── Icon chips ────────────────────────────────────────── */
.icon-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  border-radius: 12px;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 18%, transparent);
  flex-shrink: 0;
}

.icon-chip svg {
  width: 24px;
  height: 24px;
}

.icon-chip.sm {
  width: 40px;
  height: 40px;
  border-radius: 10px;
}

.icon-chip.sm svg {
  width: 21px;
  height: 21px;
}

/* ── Responsive ────────────────────────────────────────── */
@media (max-width: 860px) {
  .pillars,
  .grid {
    grid-template-columns: 1fr;
  }

  .band {
    margin-top: 56px;
  }
}
</style>
