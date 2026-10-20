<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormItemRule } from 'element-plus'
import { Plus, Search } from '@element-plus/icons-vue'
import { PERM, formatDate } from '@hospital/shared'
import type { DepartmentNode, RoleCode, UserListItem, UserSaveRequest } from '@hospital/shared'
import type { RoleItem } from '@/api/org'
import {
  createUser,
  listDepartments,
  listRoles,
  listUsers,
  removeUser,
  resetPassword,
  updateUser,
} from '@/api/org'
import { useUserStore } from '@/stores/user'

const store = useUserStore()

const loading = ref(false)
const rows = ref<UserListItem[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const departments = ref<DepartmentNode[]>([])
const roles = ref<RoleItem[]>([])

/**
 * 角色权限矩阵的行定义：权限点 → 中文名。
 * 顺序即矩阵行序；每一行都对应一个后端真实强制的权限点，
 * 矩阵由 /roles 返回的 perms 实时渲染，不在页面里另写一份权限表。
 */
const PERM_ROWS: { code: string; label: string }[] = [
  { code: PERM.CASE_VIEW, label: '查看病例' },
  { code: PERM.CASE_CREATE, label: '病例录入' },
  { code: PERM.CASE_UPDATE, label: '编辑病例' },
  { code: PERM.CASE_EVENT, label: '补录时间节点' },
  { code: PERM.CASE_DELETE, label: '删除病例' },
  { code: PERM.CASE_EXPORT, label: '病例导出' },
  { code: PERM.PATIENT_VIEW, label: '查看患者' },
  { code: PERM.PATIENT_UPDATE, label: '新增 / 编辑 / 删除患者、批量导入' },
  { code: PERM.PATIENT_PLAIN, label: '查看患者明文（记审计）' },
  { code: PERM.DICT_VIEW, label: '查看字典' },
  { code: PERM.DICT_UPDATE, label: '维护字典' },
  { code: PERM.ORG_VIEW, label: '查看组织人员（只读）' },
  { code: PERM.ORG_UPDATE, label: '管理科室与用户（读写）' },
  { code: PERM.REPORT_VIEW, label: '查看报表与质控指标' },
  { code: PERM.REPORT_EXPORT, label: '报表导出' },
  { code: PERM.SCREEN_CONFIG_VIEW, label: '查看大屏配置' },
  { code: PERM.SCREEN_CONFIG_UPDATE, label: '修改大屏配置' },
  { code: PERM.AUDIT_VIEW, label: '查看审计日志' },
  { code: PERM.INTEGRATION_VIEW, label: '查看接口集成' },
]

/** 角色标识色（浅底深字，保持与全站浅色背景一致） */
const ROLE_COLORS: Record<string, string> = {
  ADMIN: '#d9485f',
  ER_MANAGER: '#c8791a',
  ER_DOCTOR: '#2f6fb0',
  ER_NURSE: '#1f8f6b',
  QC: '#6d5bd0',
  LEADER: '#a8841a',
  SCREEN: '#6b7a90',
}

function roleColor(code: string): string {
  return ROLE_COLORS[code] ?? '#6b7a90'
}

/** 管理员在库里以 '*' 表示全权 */
function roleHas(role: RoleItem, code: string): boolean {
  return role.perms.includes('*') || role.perms.includes(code)
}

const filters = reactive<{ keyword: string; deptId: number | null; enabled: boolean | null }>({
  keyword: '',
  deptId: null,
  enabled: null,
})

const dialogVisible = ref(false)
const saving = ref(false)
const editingId = ref<number | null>(null)
const formRef = ref<FormInstance>()
const form = reactive<{
  username: string
  password: string
  realName: string
  deptId: number | null
  roleCodes: RoleCode[]
  enabled: boolean
}>({
  username: '',
  password: '',
  realName: '',
  deptId: null,
  roleCodes: [],
  enabled: true,
})

const rules: Record<string, FormItemRule[]> = {
  username: [{ required: true, message: '请输入登录账号', trigger: 'blur' }],
  realName: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  roleCodes: [{ required: true, type: 'array', min: 1, message: '请至少选择一个角色', trigger: 'change' }],
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const res = await listUsers({
      page: page.value,
      pageSize: pageSize.value,
      keyword: filters.keyword.trim() || undefined,
      deptId: filters.deptId ?? undefined,
      enabled: filters.enabled ?? undefined,
    })
    rows.value = res.list
    total.value = res.total
  } finally {
    loading.value = false
  }
}

async function loadRefs(): Promise<void> {
  const [deptList, roleList] = await Promise.all([listDepartments(), listRoles()])
  departments.value = deptList
  roles.value = roleList
}

function handleSearch(): void {
  page.value = 1
  void load()
}

function openCreate(): void {
  editingId.value = null
  form.username = ''
  form.password = ''
  form.realName = ''
  form.deptId = null
  form.roleCodes = []
  form.enabled = true
  dialogVisible.value = true
}

function openEdit(row: UserListItem): void {
  editingId.value = row.id
  form.username = row.username
  form.password = ''
  form.realName = row.realName
  form.deptId = row.deptId
  form.roleCodes = row.roles.map((item) => item.code)
  form.enabled = row.enabled
  dialogVisible.value = true
}

async function submit(): Promise<void> {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  if (editingId.value === null && form.password.length < 8) {
    ElMessage.warning('新增用户时请设置不少于 8 位的初始密码')
    return
  }
  const payload: UserSaveRequest = {
    username: form.username.trim(),
    realName: form.realName.trim(),
    deptId: form.deptId,
    roleCodes: form.roleCodes,
    enabled: form.enabled,
  }
  if (form.password) payload.password = form.password

  saving.value = true
  try {
    if (editingId.value === null) {
      await createUser(payload)
      ElMessage.success('用户已新增')
    } else {
      await updateUser(editingId.value, payload)
      ElMessage.success('用户已保存')
    }
    dialogVisible.value = false
    await load()
  } finally {
    saving.value = false
  }
}

/** 启用 / 停用：复用编辑接口，仅翻转 enabled */
async function toggleEnabled(row: UserListItem): Promise<void> {
  const next = !row.enabled
  try {
    await ElMessageBox.confirm(`确认${next ? '启用' : '停用'}用户「${row.realName}」吗？`, '提示', {
      type: 'warning',
      confirmButtonText: '确定',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  await updateUser(row.id, {
    username: row.username,
    realName: row.realName,
    deptId: row.deptId,
    roleCodes: row.roles.map((item) => item.code),
    enabled: next,
  })
  ElMessage.success(next ? '已启用' : '已停用')
  await load()
}

async function handleResetPassword(row: UserListItem): Promise<void> {
  let input: { value: string } | null = null
  try {
    input = (await ElMessageBox.prompt(`为「${row.realName}」设置新密码`, '重置密码', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      inputType: 'password',
      inputPlaceholder: '不少于 8 位',
      inputValidator: (value: string) => (value && value.length >= 8 ? true : '密码长度不少于 8 位'),
    })) as { value: string }
  } catch {
    return
  }
  if (!input?.value) return
  await resetPassword(row.id, input.value)
  ElMessage.success('密码已重置')
}

async function handleDelete(row: UserListItem): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认删除用户「${row.realName}」吗？`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  await removeUser(row.id)
  ElMessage.success('已删除')
  await load()
}

onMounted(() => {
  void loadRefs()
  void load()
})
</script>

<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">用户管理</h2>
        <div class="page-subtitle">角色决定菜单与按钮权限点，科室决定数据范围</div>
      </div>
      <el-button v-if="store.hasPerm(PERM.ORG_UPDATE)" type="primary" :icon="Plus" @click="openCreate">
        新增用户
      </el-button>
    </div>

    <div class="card-block filter-bar">
      <el-form :inline="true" @submit.prevent>
        <el-form-item label="关键字">
          <el-input
            v-model="filters.keyword"
            placeholder="账号 / 姓名"
            clearable
            style="width: 200px"
            @keyup.enter="handleSearch"
          />
        </el-form-item>
        <el-form-item label="科室">
          <el-tree-select
            v-model="filters.deptId"
            :data="departments"
            :props="{ label: 'name', children: 'children' }"
            node-key="id"
            check-strictly
            clearable
            placeholder="全部"
            style="width: 180px"
          />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="filters.enabled" placeholder="全部" clearable style="width: 120px">
            <el-option label="启用" :value="true" />
            <el-option label="停用" :value="false" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :icon="Search" @click="handleSearch">查询</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="card-block">
      <el-table v-loading="loading" :data="rows" border stripe size="small">
        <el-table-column prop="username" label="账号" width="130" />
        <el-table-column prop="realName" label="姓名" width="110" />
        <el-table-column prop="deptName" label="科室" width="140" />
        <el-table-column label="角色" min-width="180">
          <template #default="{ row }">
            <el-tag v-for="role in row.roles" :key="role.code" size="small" class="role-tag">{{ role.name }}</el-tag>
            <span v-if="row.roles.length === 0" class="text-sub">未分配</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="row.enabled ? 'success' : 'info'" size="small">{{ row.enabled ? '启用' : '停用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="最近登录" width="170">
          <template #default="{ row }">{{ row.lastLoginAt ? formatDate(row.lastLoginAt) : '—' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="230" fixed="right">
          <template #default="{ row }">
            <template v-if="store.hasPerm(PERM.ORG_UPDATE)">
              <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
              <el-button link type="primary" @click="toggleEnabled(row)">{{ row.enabled ? '停用' : '启用' }}</el-button>
              <el-button link type="warning" @click="handleResetPassword(row)">重置密码</el-button>
              <el-button link type="danger" @click="handleDelete(row)">删除</el-button>
            </template>
            <span v-else class="text-sub">只读</span>
          </template>
        </el-table-column>
        <template #empty>暂无用户数据</template>
      </el-table>

      <div class="pager">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          background
          @current-change="load"
          @size-change="handleSearch"
        />
      </div>
    </div>

    <!-- 角色权限矩阵：行=权限点，列=角色，数据取自 /roles 的真实 perms -->
    <div class="card-block matrix-block">
      <div class="matrix-head">
        <h3 class="matrix-title">角色权限矩阵</h3>
        <span class="matrix-hint">按数据库中的角色权限点实时生成；✓ 表示该角色具备此权限，— 表示不具备</span>
      </div>

      <div class="matrix-scroll">
        <table class="perm-matrix">
          <thead>
            <tr>
              <th class="col-perm">权限 \ 角色</th>
              <th v-for="role in roles" :key="role.code" class="col-role">
                <span class="role-pill" :style="{ color: roleColor(role.code), borderColor: roleColor(role.code) }">
                  {{ role.name }}
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in PERM_ROWS" :key="row.code">
              <td class="col-perm">{{ row.label }}</td>
              <td v-for="role in roles" :key="role.code" class="col-mark">
                <span v-if="roleHas(role, row.code)" class="mark-yes">✓</span>
                <span v-else class="mark-no">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="matrix-legend">
        <div v-for="role in roles" :key="role.code" class="legend-line">
          <span class="legend-role" :style="{ color: roleColor(role.code) }">{{ role.name }}</span>
          <span class="legend-desc">{{ role.remark }}</span>
        </div>
      </div>
    </div>

    <el-dialog v-model="dialogVisible" :title="editingId === null ? '新增用户' : '编辑用户'" width="520px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="登录账号" prop="username">
          <el-input v-model="form.username" maxlength="32" placeholder="登录用户名" />
        </el-form-item>
        <el-form-item label="姓名" prop="realName">
          <el-input v-model="form.realName" maxlength="32" placeholder="真实姓名" />
        </el-form-item>
        <el-form-item :label="editingId === null ? '初始密码' : '重置密码'">
          <el-input
            v-model="form.password"
            type="password"
            show-password
            :placeholder="editingId === null ? '不少于 8 位' : '留空表示不修改'"
          />
        </el-form-item>
        <el-form-item label="科室">
          <el-tree-select
            v-model="form.deptId"
            :data="departments"
            :props="{ label: 'name', children: 'children' }"
            node-key="id"
            check-strictly
            clearable
            placeholder="请选择科室"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="角色" prop="roleCodes">
          <el-select v-model="form.roleCodes" multiple placeholder="请选择角色" style="width: 100%">
            <el-option v-for="role in roles" :key="role.code" :label="role.name" :value="role.code">
              <span>{{ role.name }}</span>
              <span class="text-sub" style="float: right">{{ role.remark }}</span>
            </el-option>
          </el-select>
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.role-tag {
  margin-right: 4px;
}

/* ---------------------------------------------------- 角色权限矩阵 */
.matrix-block {
  margin-top: 16px;
}

.matrix-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 12px;
}

.matrix-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.matrix-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.matrix-scroll {
  overflow-x: auto;
}

.perm-matrix {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  white-space: nowrap;
}

.perm-matrix th,
.perm-matrix td {
  padding: 9px 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.perm-matrix thead th {
  background: var(--el-fill-color-light);
  border-top: 1px solid var(--el-border-color-lighter);
  font-weight: 600;
}

.perm-matrix tbody tr:hover {
  background: var(--el-fill-color-lighter);
}

.perm-matrix .col-perm {
  text-align: left;
  color: var(--el-text-color-regular);
}

.perm-matrix .col-role,
.perm-matrix .col-mark {
  text-align: center;
  width: 104px;
}

.role-pill {
  display: inline-block;
  padding: 1px 10px;
  border: 1px solid;
  border-radius: 10px;
  background: #fff;
  font-size: 12px;
  font-weight: 600;
}

.mark-yes {
  color: #22a06b;
  font-weight: 700;
}

.mark-no {
  color: #c3cad6;
}

.matrix-legend {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed var(--el-border-color);
  font-size: 12px;
}

.legend-line {
  display: flex;
  gap: 10px;
}

.legend-role {
  flex: 0 0 96px;
  font-weight: 600;
}

.legend-desc {
  color: var(--el-text-color-secondary);
}
</style>
