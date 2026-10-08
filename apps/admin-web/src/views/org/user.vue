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
</style>
