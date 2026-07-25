<template>
  <div class="floating-share">
    <!-- ShareThis BEGINS -->
    <div class="sharethis-share-buttons" data-type="inline-share-buttons" data-labels="none" data-show_total="false" data-size="small">
    <span data-network="sharethis"></span>
    </div>
    <!-- ShareThis ENDS -->
  </div>
</template>

<style scoped>
.nav-share-container {
  display: flex;
  align-items: center;
  margin-left: 12px;
  padding-left: 12px;
  border-left: 1px solid var(--vp-c-divider);
}
/* Hide on mobile where the buttons crowd the nav bar. */
@media (max-width: 768px) {
  .nav-share-container { display: none; }
}
</style>
