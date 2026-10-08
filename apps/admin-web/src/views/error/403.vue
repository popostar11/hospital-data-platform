<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<template>
  <div class="error-page">
    <div class="error-code">403</div>
    <h2 class="error-title">没有访问权限</h2>
    <p class="error-desc">当前账号缺少该页面的权限点，请联系系统管理员分配角色后重试。</p>
    <div class="gap-8">
      <el-button type="primary" @click="router.replace('/dashboard')">返回工作台</el-button>
      <el-button @click="router.back()">返回上一页</el-button>
    </div>
  </div>
</template>

<style scoped>
.error-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 420px;
  padding: 40px 16px;
}

.error-code {
  font-size: 72px;
  font-weight: 700;
  line-height: 1;
  color: var(--er-sidebar-active);
}

.error-title {
  margin: 16px 0 8px;
  font-size: 20px;
  color: var(--er-text-main);
}

.error-desc {
  margin: 0 0 20px;
  font-size: 13px;
  color: var(--er-text-sub);
}
</style>
