<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormItemRule } from 'element-plus'
import { ArrowDown, Expand, Fold, Lock, SwitchButton } from '@element-plus/icons-vue'
import { MENUS } from '@/router/menu'
import type { MenuItem } from '@/router/menu'
import { useUserStore } from '@/stores/user'
import * as authApi from '@/api/auth'

const route = useRoute()
const router = useRouter()
const store = useUserStore()

const collapsed = ref(false)

/** 按权限点过滤菜单，空分组自动隐藏 */
function filterMenus(list: MenuItem[]): MenuItem[] {
  const out: MenuItem[] = []
  for (const item of list) {
    if (item.perms && item.perms.length > 0 && !store.hasPerm(item.perms)) continue
    if (item.children && item.children.length > 0) {
      const children = filterMenus(item.children)
      if (children.length === 0) continue
      out.push({ ...item, children })
      continue
    }
    out.push({ ...item })
  }
  return out
}

const menus = computed<MenuItem[]>(() => filterMenus(MENUS))

/** 病例详情/编辑页高亮到「病例列表」 */
const activeMenu = computed<string>(() => (/^\/cases\/\d+/.test(route.path) ? '/cases' : route.path))

const breadcrumbs = computed<string[]>(() => {
  const titles: string[] = []
  for (const record of route.matched) {
    if (record.meta.title) titles.push(record.meta.title)
  }
  return titles
})

/* ------------------------------------------------------------ 修改密码 */
const pwdVisible = ref(false)
const pwdFormRef = ref<FormInstance>()
const pwdForm = reactive({ oldPassword: '', password: '', confirm: '' })
const pwdRules: Record<string, FormItemRule[]> = {
  oldPassword: [{ required: true, message: '请输入原密码', trigger: 'blur' }],
  password: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 8, message: '密码长度不少于 8 位', trigger: 'blur' },
  ],
  confirm: [{ required: true, message: '请再次输入新密码', trigger: 'blur' }],
}

function openPasswordDialog(): void {
  pwdForm.oldPassword = ''
  pwdForm.password = ''
  pwdForm.confirm = ''
  pwdVisible.value = true
}

async function submitPassword(): Promise<void> {
  const valid = await pwdFormRef.value?.validate().catch(() => false)
  if (!valid) return
  if (pwdForm.password !== pwdForm.confirm) {
    ElMessage.warning('两次输入的密码不一致')
    return
  }
  await authApi.changePassword({ oldPassword: pwdForm.oldPassword, newPassword: pwdForm.password })
  ElMessage.success('密码已修改，请重新登录')
  pwdVisible.value = false
  await store.logout()
  await router.replace('/login')
}

/* -------------------------------------------------------------- 退出 */
async function handleLogout(): Promise<void> {
  try {
    await ElMessageBox.confirm('确认退出当前账号吗？', '提示', {
      type: 'warning',
      confirmButtonText: '退出登录',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  await store.logout()
  ElMessage.success('已退出登录')
  await router.replace('/login')
}

function handleCommand(command: string | number | object): void {
  if (command === 'password') openPasswordDialog()
  else if (command === 'logout') void handleLogout()
}
</script>

<template>
  <el-container class="layout">
    <el-aside class="layout-aside" :width="collapsed ? '64px' : '212px'">
      <div class="brand">
        <span class="brand-mark">急</span>
        <span v-show="!collapsed" class="brand-text">急救绿道管理平台</span>
      </div>
      <el-menu
        class="layout-menu"
        :default-active="activeMenu"
        :collapse="collapsed"
        :collapse-transition="false"
        router
        background-color="#14263d"
        text-color="#c2d3e6"
        active-text-color="#ffffff"
      >
        <template v-for="item in menus" :key="item.path">
          <el-sub-menu v-if="item.children && item.children.length > 0" :index="item.path">
            <template #title>
              <el-icon><component :is="item.icon" /></el-icon>
              <span>{{ item.title }}</span>
            </template>
            <el-menu-item v-for="child in item.children" :key="child.path" :index="child.path">
              <el-icon><component :is="child.icon" /></el-icon>
              <span>{{ child.title }}</span>
            </el-menu-item>
          </el-sub-menu>
          <el-menu-item v-else :index="item.path">
            <el-icon><component :is="item.icon" /></el-icon>
            <span>{{ item.title }}</span>
          </el-menu-item>
        </template>
      </el-menu>
    </el-aside>

    <el-container class="layout-body">
      <el-header class="layout-header">
        <div class="header-left">
          <el-icon class="collapse-btn" @click="collapsed = !collapsed">
            <Expand v-if="collapsed" />
            <Fold v-else />
          </el-icon>
          <el-breadcrumb separator="/">
            <el-breadcrumb-item :to="{ path: '/dashboard' }">首页</el-breadcrumb-item>
            <el-breadcrumb-item v-for="(title, index) in breadcrumbs" :key="index">{{ title }}</el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        <div class="header-right">
          <span class="user-meta">{{ store.user?.deptName || '未分配科室' }}</span>
          <el-dropdown @command="handleCommand">
            <span class="user-trigger">
              {{ store.user?.realName || store.user?.username || '未登录' }}
              <el-icon><ArrowDown /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="password">
                  <el-icon><Lock /></el-icon>修改密码
                </el-dropdown-item>
                <el-dropdown-item command="logout" divided>
                  <el-icon><SwitchButton /></el-icon>退出登录
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <el-main class="layout-main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>

  <el-dialog v-model="pwdVisible" title="修改密码" width="420px" append-to-body>
    <el-form ref="pwdFormRef" :model="pwdForm" :rules="pwdRules" label-width="90px">
      <el-form-item label="原密码" prop="oldPassword">
        <el-input v-model="pwdForm.oldPassword" type="password" show-password placeholder="请输入当前密码" />
      </el-form-item>
      <el-form-item label="新密码" prop="password">
        <el-input v-model="pwdForm.password" type="password" show-password placeholder="至少 8 位" />
      </el-form-item>
      <el-form-item label="确认密码" prop="confirm">
        <el-input v-model="pwdForm.confirm" type="password" show-password placeholder="请再次输入新密码" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="pwdVisible = false">取消</el-button>
      <el-button type="primary" @click="submitPassword">确定</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.layout {
  height: 100%;
}

.layout-aside {
  display: flex;
  flex-direction: column;
  overflow-x: hidden;
  background: var(--er-sidebar-bg);
  transition: width 0.2s;
}

.brand {
  display: flex;
  align-items: center;
  height: 56px;
  padding: 0 14px;
  overflow: hidden;
  color: #fff;
  white-space: nowrap;
  background: var(--er-sidebar-sub-bg);
}

.brand-mark {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  font-size: 15px;
  font-weight: 700;
  background: var(--er-sidebar-active);
  border-radius: 4px;
}

.brand-text {
  margin-left: 10px;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 1px;
}

.layout-menu {
  flex: 1;
  border-right: none;
}

.layout-menu :deep(.el-menu-item.is-active) {
  background: var(--er-sidebar-active);
}

.layout-body {
  min-width: 0;
}

.layout-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 56px;
  padding: 0 16px;
  background: #fff;
  border-bottom: 1px solid var(--er-border);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.collapse-btn {
  font-size: 18px;
  color: var(--er-text-sub);
  cursor: pointer;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.user-meta {
  font-size: 13px;
  color: var(--er-text-sub);
}

.user-trigger {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
  color: var(--er-text-main);
  cursor: pointer;
  outline: none;
}

.layout-main {
  padding: 0;
  overflow-y: auto;
  background: var(--er-content-bg);
}
</style>
