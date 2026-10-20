<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormItemRule } from 'element-plus'
import { Lock, User } from '@element-plus/icons-vue'
import type { LoginRequest } from '@hospital/shared'
import { DEFAULT_HOSPITAL_NAME } from '@hospital/shared'
import * as authApi from '@/api/auth'
import { DEMO_MODE } from '@/api/client'
import { useUserStore } from '@/stores/user'

interface DemoAccount {
  username: string
  role: string
  desc: string
}

/** 内置演示账号（密码统一 Hospital@123），点击卡片一键填充 */
const DEMO_PASSWORD = 'Hospital@123'
const DEMO_ACCOUNTS: DemoAccount[] = [
  { username: 'admin', role: '系统管理员', desc: '全部权限，含用户与字典维护' },
  { username: 'eradmin', role: '急诊科管理员', desc: '本病区病例全量管理、报表与导出' },
  { username: 'doctor01', role: '急诊医生', desc: '病例录入、编辑、补录时间节点' },
  { username: 'nurse01', role: '急诊护士', desc: '病例录入与查看' },
  { username: 'qc01', role: '质控员', desc: '全量只读 + 报表 + 质控指标' },
  { username: 'leader01', role: '院领导', desc: '全院只读 + 报表' },
]

const REMEMBER_KEY = 'hospital_remember_username'

const route = useRoute()
const router = useRouter()
const store = useUserStore()

const formRef = ref<FormInstance>()
const loading = ref(false)
const remember = ref(false)
const form = reactive({
  username: '',
  password: '',
  captchaCode: '',
})

const rules: Record<string, FormItemRule[]> = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

/** 验证码：默认 enabled=false，不显示验证码输入 */
const captchaEnabled = ref(false)
const captchaId = ref('')
const captchaSvg = ref('')

async function loadCaptcha(): Promise<void> {
  try {
    const res = await authApi.captcha()
    captchaEnabled.value = res.enabled
    captchaId.value = res.captchaId ?? ''
    captchaSvg.value = res.svg ?? ''
    form.captchaCode = ''
  } catch {
    captchaEnabled.value = false
  }
}

function useDemo(account: DemoAccount): void {
  form.username = account.username
  form.password = DEMO_PASSWORD
  formRef.value?.clearValidate()
}

async function handleSubmit(): Promise<void> {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  if (captchaEnabled.value && !form.captchaCode.trim()) {
    ElMessage.warning('请输入验证码')
    return
  }

  loading.value = true
  try {
    const payload: LoginRequest = {
      username: form.username.trim(),
      password: form.password,
    }
    if (captchaEnabled.value) {
      payload.captchaId = captchaId.value
      payload.captchaCode = form.captchaCode.trim()
    }
    await store.login(payload)
    if (remember.value) localStorage.setItem(REMEMBER_KEY, form.username.trim())
    else localStorage.removeItem(REMEMBER_KEY)
    ElMessage.success('登录成功')
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/dashboard'
    await router.replace(redirect)
  } catch {
    // 错误提示由请求拦截器统一处理，这里只需刷新验证码
    if (captchaEnabled.value) await loadCaptcha()
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  const remembered = localStorage.getItem(REMEMBER_KEY)
  if (remembered) {
    form.username = remembered
    remember.value = true
  }
  void loadCaptcha()
})
</script>

<template>
  <div class="login-page">
    <div class="login-panel">
      <!-- 左侧品牌区 -->
      <div class="login-brand">
        <div class="brand-logo">急</div>
        <h1 class="brand-title">急诊专科中心数据平台</h1>
        <p class="brand-hospital">{{ DEFAULT_HOSPITAL_NAME }}</p>
        <p class="brand-desc">胸痛 / 卒中 / 创伤 / 危重孕产妇 / 危重新生儿急救绿道全流程数据管理与质控</p>
        <ul class="brand-points">
          <li>病例登记 · 时间节点补录 · 闭环质控</li>
          <li>实时大屏 · 报表统计 · KPI 指标</li>
          <li>患者信息脱敏 · 明文查看留痕审计</li>
        </ul>
      </div>

      <!-- 右侧表单区 -->
      <div class="login-form">
        <el-alert
          v-if="DEMO_MODE"
          class="demo-alert"
          type="warning"
          :closable="false"
          show-icon
          title="静态演示：数据为导出的快照，任意账号密码均可登录；新增/编辑/删除等写操作不会生效"
        />
        <h2 class="form-title">账号登录</h2>
        <el-form ref="formRef" :model="form" :rules="rules" size="large" @keyup.enter="handleSubmit">
          <el-form-item prop="username">
            <el-input v-model="form.username" placeholder="请输入用户名" clearable>
              <template #prefix>
                <el-icon><User /></el-icon>
              </template>
            </el-input>
          </el-form-item>
          <el-form-item prop="password">
            <el-input v-model="form.password" type="password" show-password placeholder="请输入密码">
              <template #prefix>
                <el-icon><Lock /></el-icon>
              </template>
            </el-input>
          </el-form-item>
          <el-form-item v-if="captchaEnabled" prop="captchaCode">
            <div class="captcha-row">
              <el-input v-model="form.captchaCode" placeholder="请输入验证码" maxlength="6" />
              <div class="captcha-image" title="点击刷新" @click="loadCaptcha" v-html="captchaSvg" />
            </div>
          </el-form-item>
          <div class="form-options">
            <el-checkbox v-model="remember">记住用户名</el-checkbox>
          </div>
          <el-button class="submit-btn" type="primary" :loading="loading" @click="handleSubmit">登 录</el-button>
        </el-form>

        <el-divider content-position="left">演示账号（点击填充 · 密码 {{ DEMO_PASSWORD }}）</el-divider>
        <div class="demo-grid">
          <div v-for="item in DEMO_ACCOUNTS" :key="item.username" class="demo-card" @click="useDemo(item)">
            <div class="demo-role">{{ item.role }}</div>
            <div class="demo-username">{{ item.username }}</div>
            <div class="demo-desc">{{ item.desc }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100%;
  padding: 24px;
  background: linear-gradient(135deg, #14263d 0%, #1f4a7d 45%, #2a7fb8 100%);
}

.login-panel {
  display: grid;
  grid-template-columns: 420px 480px;
  width: 900px;
  max-width: 100%;
  overflow: hidden;
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 18px 60px rgb(8 20 36 / 45%);
}

.login-brand {
  padding: 40px 32px;
  color: #fff;
  background: linear-gradient(160deg, #14263d 0%, #1a3b63 100%);
}

.brand-logo {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  font-size: 24px;
  font-weight: 700;
  background: #1f6feb;
  border-radius: 8px;
}

.brand-title {
  margin: 20px 0 0;
  font-size: 24px;
  letter-spacing: 2px;
}

.brand-hospital {
  margin: 8px 0 0;
  font-size: 13px;
  color: #9fb6d1;
}

.brand-desc {
  margin: 24px 0 0;
  font-size: 13px;
  line-height: 22px;
  color: #c2d3e6;
}

.brand-points {
  padding-left: 18px;
  margin: 18px 0 0;
  font-size: 12px;
  line-height: 24px;
  color: #8fa9c9;
}

.login-form {
  padding: 36px 36px 28px;
}

.demo-alert {
  margin-bottom: 16px;
}

.form-title {
  margin: 0 0 22px;
  font-size: 20px;
  color: var(--er-text-main);
}

.form-options {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
}

.submit-btn {
  width: 100%;
  letter-spacing: 4px;
}

.captcha-row {
  display: flex;
  gap: 8px;
  width: 100%;
}

.captcha-image {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 120px;
  height: 40px;
  overflow: hidden;
  cursor: pointer;
  background: #f5f7fa;
  border: 1px solid var(--er-border);
  border-radius: 4px;
}

.demo-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.demo-card {
  padding: 8px 10px;
  cursor: pointer;
  border: 1px solid var(--er-border);
  border-radius: 6px;
  transition: all 0.15s;
}

.demo-card:hover {
  background: #f0f7ff;
  border-color: #1f6feb;
}

.demo-role {
  font-size: 13px;
  font-weight: 600;
  color: var(--er-text-main);
}

.demo-username {
  margin-top: 2px;
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
  color: #1f6feb;
}

.demo-desc {
  margin-top: 4px;
  font-size: 11px;
  line-height: 16px;
  color: var(--er-text-sub);
}
</style>
