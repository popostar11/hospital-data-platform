<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormItemRule } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { PERM } from '@hospital/shared'
import type { DepartmentNode } from '@hospital/shared'
import type { DepartmentSaveRequest } from '@/api/org'
import { createDepartment, listDepartments, removeDepartment, updateDepartment } from '@/api/org'
import { useUserStore } from '@/stores/user'

const store = useUserStore()

const loading = ref(false)
const tree = ref<DepartmentNode[]>([])
const dialogVisible = ref(false)
const saving = ref(false)
const editingId = ref<number | null>(null)
const formRef = ref<FormInstance>()

const form = reactive<DepartmentSaveRequest>({
  parentId: null,
  code: '',
  name: '',
  sortNo: 1,
  enabled: true,
})

const rules: Record<string, FormItemRule[]> = {
  code: [{ required: true, message: '请输入科室编码', trigger: 'blur' }],
  name: [{ required: true, message: '请输入科室名称', trigger: 'blur' }],
}

async function load(): Promise<void> {
  loading.value = true
  try {
    tree.value = await listDepartments()
  } finally {
    loading.value = false
  }
}

function openCreate(parent: DepartmentNode | null): void {
  editingId.value = null
  form.parentId = parent ? parent.id : null
  form.code = ''
  form.name = ''
  form.sortNo = 1
  form.enabled = true
  dialogVisible.value = true
}

function openEdit(node: DepartmentNode): void {
  editingId.value = node.id
  form.parentId = node.parentId
  form.code = node.code
  form.name = node.name
  form.sortNo = node.sortNo
  form.enabled = node.enabled
  dialogVisible.value = true
}

async function submit(): Promise<void> {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  const payload: DepartmentSaveRequest = {
    parentId: form.parentId,
    code: form.code.trim(),
    name: form.name.trim(),
    sortNo: form.sortNo,
    enabled: form.enabled,
  }
  saving.value = true
  try {
    if (editingId.value === null) await createDepartment(payload)
    else await updateDepartment(editingId.value, payload)
    ElMessage.success('科室已保存')
    dialogVisible.value = false
    await load()
  } finally {
    saving.value = false
  }
}

async function remove(node: DepartmentNode): Promise<void> {
  const hasChildren = (node.children?.length ?? 0) > 0
  try {
    await ElMessageBox.confirm(
      hasChildren ? `「${node.name}」下仍有子科室，确认一并删除吗？` : `确认删除科室「${node.name}」吗？`,
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  await removeDepartment(node.id)
  ElMessage.success('已删除')
  await load()
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">科室管理</h2>
        <div class="page-subtitle">科室树用于病例归属与数据权限范围</div>
      </div>
      <el-button v-if="store.hasPerm(PERM.ORG_UPDATE)" type="primary" :icon="Plus" @click="openCreate(null)">
        新增顶级科室
      </el-button>
    </div>

    <div class="card-block" v-loading="loading">
      <el-tree
        :data="tree"
        :props="{ label: 'name', children: 'children' }"
        node-key="id"
        default-expand-all
        :expand-on-click-node="false"
        empty-text="暂无科室数据"
      >
        <template #default="{ data }">
          <div class="tree-node">
            <span class="tree-label">
              {{ data.name }}
              <span class="text-sub">（{{ data.code }}）</span>
              <el-tag v-if="!data.enabled" type="info" size="small" class="tree-tag">已停用</el-tag>
            </span>
            <span v-if="store.hasPerm(PERM.ORG_UPDATE)" class="tree-actions">
              <el-button link type="primary" @click.stop="openCreate(data)">新增下级</el-button>
              <el-button link type="primary" @click.stop="openEdit(data)">编辑</el-button>
              <el-button link type="danger" @click.stop="remove(data)">删除</el-button>
            </span>
          </div>
        </template>
      </el-tree>
    </div>

    <el-dialog v-model="dialogVisible" :title="editingId === null ? '新增科室' : '编辑科室'" width="440px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="上级科室">
          <span class="text-sub">{{ form.parentId === null ? '顶级科室' : `上级 ID：${form.parentId}` }}</span>
        </el-form-item>
        <el-form-item label="科室编码" prop="code">
          <el-input v-model="form.code" maxlength="32" placeholder="如 ER、ER_TRAUMA" />
        </el-form-item>
        <el-form-item label="科室名称" prop="name">
          <el-input v-model="form.name" maxlength="32" placeholder="如 急诊科" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.sortNo" :min="0" :max="9999" controls-position="right" />
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
.tree-node {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding-right: 12px;
}

.tree-label {
  font-size: 14px;
}

.tree-tag {
  margin-left: 6px;
}

.tree-actions {
  opacity: 0.85;
}
</style>
