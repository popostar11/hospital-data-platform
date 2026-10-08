import { PERM } from '@hospital/shared'
import type { PermCode } from '@hospital/shared'

/**
 * 侧边栏菜单。图标名对应 @element-plus/icons-vue 的全局注册组件名。
 * perms 为访问所需权限点（任一满足即可）；未配置表示登录即可见。
 */
export interface MenuItem {
  /** 路由路径，分组菜单留空 */
  path: string
  title: string
  icon: string
  perms?: PermCode[]
  children?: MenuItem[]
}

export const MENUS: MenuItem[] = [
  { path: '/dashboard', title: '工作台', icon: 'Odometer' },
  {
    path: '/cases',
    title: '病例管理',
    icon: 'Tickets',
    perms: [PERM.CASE_VIEW],
    children: [
      { path: '/cases', title: '病例列表', icon: 'List', perms: [PERM.CASE_VIEW] },
      { path: '/cases/new', title: '新增病例', icon: 'CirclePlus', perms: [PERM.CASE_CREATE] },
    ],
  },
  { path: '/patients', title: '患者管理', icon: 'User', perms: [PERM.PATIENT_VIEW] },
  { path: '/dicts', title: '字典维护', icon: 'Collection', perms: [PERM.DICT_VIEW] },
  {
    path: '/org',
    title: '组织人员',
    icon: 'OfficeBuilding',
    perms: [PERM.ORG_VIEW],
    children: [
      { path: '/org/departments', title: '科室管理', icon: 'Grid', perms: [PERM.ORG_VIEW] },
      { path: '/org/users', title: '用户管理', icon: 'Avatar', perms: [PERM.ORG_VIEW] },
    ],
  },
  { path: '/screen-config', title: '大屏配置', icon: 'Monitor', perms: [PERM.SCREEN_CONFIG_VIEW] },
  {
    path: '/reports',
    title: '报表统计',
    icon: 'TrendCharts',
    perms: [PERM.REPORT_VIEW],
    children: [
      { path: '/reports/green-channel', title: '绿道报表', icon: 'Histogram', perms: [PERM.REPORT_VIEW] },
      { path: '/reports/kpi', title: '质控 KPI', icon: 'DataAnalysis', perms: [PERM.REPORT_VIEW] },
    ],
  },
  { path: '/audit/logs', title: '审计日志', icon: 'Document', perms: [PERM.AUDIT_VIEW] },
]
