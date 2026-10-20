import { createRouter, createWebHashHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { ElMessage } from 'element-plus'
import { PERM } from '@hospital/shared'
import type { PermCode } from '@hospital/shared'
import { useUserStore } from '@/stores/user'

declare module 'vue-router' {
  interface RouteMeta {
    /** 页面标题（document.title + 面包屑 + 菜单高亮） */
    title?: string
    /** 访问所需权限点，任一满足即可 */
    perms?: PermCode[]
    /** 免登录访问 */
    anonymous?: boolean
  }
}

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/login/index.vue'),
    meta: { title: '登录', anonymous: true },
  },
  {
    path: '/',
    component: () => import('@/views/layout/index.vue'),
    redirect: '/dashboard',
    children: [
      {
        path: 'dashboard',
        name: 'dashboard',
        component: () => import('@/views/dashboard/index.vue'),
        meta: { title: '工作台' },
      },
      {
        path: 'cases',
        name: 'case-list',
        component: () => import('@/views/case/list.vue'),
        meta: { title: '病例列表', perms: [PERM.CASE_VIEW] },
      },
      {
        path: 'cases/new',
        name: 'case-create',
        component: () => import('@/views/case/form.vue'),
        meta: { title: '新增病例', perms: [PERM.CASE_CREATE] },
      },
      {
        path: 'cases/:id(\\d+)',
        name: 'case-detail',
        component: () => import('@/views/case/detail.vue'),
        meta: { title: '病例详情', perms: [PERM.CASE_VIEW] },
      },
      {
        path: 'cases/:id(\\d+)/edit',
        name: 'case-edit',
        component: () => import('@/views/case/form.vue'),
        meta: { title: '编辑病例', perms: [PERM.CASE_UPDATE] },
      },
      {
        path: 'patients',
        name: 'patient-list',
        component: () => import('@/views/patient/list.vue'),
        meta: { title: '患者管理', perms: [PERM.PATIENT_VIEW] },
      },
      {
        path: 'dicts',
        name: 'dict',
        component: () => import('@/views/dict/index.vue'),
        meta: { title: '字典维护', perms: [PERM.DICT_VIEW] },
      },
      {
        path: 'org/departments',
        name: 'org-department',
        component: () => import('@/views/org/department.vue'),
        meta: { title: '科室管理', perms: [PERM.ORG_VIEW] },
      },
      {
        path: 'org/users',
        name: 'org-user',
        component: () => import('@/views/org/user.vue'),
        meta: { title: '用户管理', perms: [PERM.ORG_VIEW] },
      },
      {
        path: 'screen-config',
        name: 'screen-config',
        component: () => import('@/views/screen/config.vue'),
        meta: { title: '大屏配置', perms: [PERM.SCREEN_CONFIG_VIEW] },
      },
      {
        path: 'reports/green-channel',
        name: 'report-green-channel',
        component: () => import('@/views/report/green-channel.vue'),
        meta: { title: '绿道报表', perms: [PERM.REPORT_VIEW] },
      },
      {
        path: 'reports/kpi',
        name: 'report-kpi',
        component: () => import('@/views/report/kpi.vue'),
        meta: { title: '质控 KPI', perms: [PERM.REPORT_VIEW] },
      },
      {
        path: 'audit/logs',
        name: 'audit-log',
        component: () => import('@/views/audit/log.vue'),
        meta: { title: '审计日志', perms: [PERM.AUDIT_VIEW] },
      },
      {
        path: '403',
        name: 'forbidden',
        component: () => import('@/views/error/403.vue'),
        meta: { title: '无访问权限' },
      },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/error/404.vue'),
    meta: { title: '页面不存在', anonymous: true },
  },
]

const router = createRouter({
  // hash 模式：后端在 /admin/ 下托管静态资源，无需为 history 回退做额外配置
  history: createWebHashHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

router.beforeEach(async (to) => {
  document.title = to.meta.title ? `${to.meta.title} · 急诊专科中心数据平台` : '急诊专科中心数据平台'

  if (to.meta.anonymous) return true

  const store = useUserStore()

  if (!store.token) {
    const redirect = to.fullPath
    return redirect && redirect !== '/' ? { path: '/login', query: { redirect } } : { path: '/login' }
  }

  // 有 token 但尚未拉取用户信息：先拉一次并缓存到 pinia
  if (!store.loaded) {
    try {
      await store.fetchMe()
    } catch {
      store.reset()
      return { path: '/login' }
    }
  }

  const need = to.meta.perms
  if (need && need.length > 0 && !store.hasPerm(need)) {
    ElMessage.warning('没有访问该页面的权限')
    return { path: '/403' }
  }

  return true
})

export default router
