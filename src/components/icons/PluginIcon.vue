<script setup>
defineProps({
  size: {
    type: [Number, String],
    default: 20
  }
})
</script>

<template>
  <!-- 插件入口：拼图块符号，采用实心风格与侧边栏其他图标保持一致 -->
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path
      d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-2 .9-2 2v3.5h1.5c1.38 0 2.5 1.12 2.5 2.5S4.88 15.5 3.5 15.5H2V19c0 1.1.9 2 2 2h4v-1.5C8 18.12 9.12 17 10.5 17s2.5 1.12 2.5 2.5V21h4c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11z"
    />
  </svg>
</template>
