<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { PERM } from '@hospital/shared'
import type { DictItem, DictSaveRequest, DictType } from '@hospital/shared'
import { createDict, listDicts, removeDict, updateDict } from '@/api/dicts'
import { useUserStore } from '@/stores/user'

/** 可在后台维护的字典类型（科室走组织树，不在字典页维护） */
type DictTabType = Extract<DictType, 'disease' | 'sourceType' | 'caseStatus' | 'eventType'>

interface DictTab {
  type: DictTabType
  label: string
}

const TABS: DictTab[] = [
  { type: 'disease', label: '疾病' },
  { type: 'sourceType', label: '推送方式' },
  { type: 'caseStatus', label: '病例状态' },
  { type: 'eventType', label: '事件类型' },
]

/** 表格行 = 字典项 + 本地编辑态 */
interface DictRow extends DictItem {
  isNew: boolean
}

const store = useUserStore()
const activeTab = ref<DictTabType>('disease')
const loading = ref(false)
const rows = ref<DictRow[]>([])

async function load(): Promise<void> {
  loading.value = true
  try {
    const list = await listDicts(activeTab.value)
    rows.value = list.map((item) => ({ ...item, isNew: false }))
  } finally {
    loading.value = false
  }
}

function handleTabChange(): void {
  rows.value = []
  void load()
}

function addRow(): void {
  rows.value.unshift({
    id: 0,
    type: activeTab.value,
    code: '',
    name: '',
    color: null,
    sortNo: rows.value.length + 1,
    enabled: true,
    remark: null,
    isNew: true,
  })
}

async function saveRow(row: DictRow): Promise<void> {
  if (!row.code.trim()) {
    ElMessage.warning('请填写字典编码')
    return
  }
  if (!row.name.trim()) {
    ElMessage.warning('请填写字典名称')
    return
  }
  const payload: DictSaveRequest = {
    type: activeTab.value,
    code: row.code.trim(),
    name: row.name.trim(),
    color: row.color,
    sortNo: row.sortNo,
    enabled: row.enabled,
    remark: row.remark,
  }
  if (row.isNew) await createDict(payload)
  else await updateDict(row.id, payload)
  ElMessage.success('已保存')
  await load()
}

async function removeRow(row: DictRow): Promise<void> {
  if (row.isNew) {
    rows.value = rows.value.filter((item) => item !== row)
    return
  }
  const tip = row.refCount ? `该字典项已被 ${row.refCount} 条数据引用，删除后可能导致展示缺失。` : ''
  try {
    await ElMessageBox.confirm(`${tip}确认删除「${row.name}」吗？`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  await removeDict(row.id)
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
        <h2 class="page-title">字典维护</h2>
        <div class="page-subtitle">颜色由字典下发，直接决定大屏与后台标签配色；新增病种无需改前端</div>
      </div>
      <el-button v-if="store.hasPerm(PERM.DICT_UPDATE)" type="primary" :icon="Plus" @click="addRow">
        新增字典项
      </el-button>
    </div>

    <div class="card-block">
      <el-tabs v-model="activeTab" @tab-change="handleTabChange">
        <el-tab-pane v-for="tab in TABS" :key="tab.type" :label="tab.label" :name="tab.type" />
      </el-tabs>

      <el-table v-loading="loading" :data="rows" border stripe size="small">
        <el-table-column label="编码" width="170">
          <template #default="{ row }">
            <el-input v-model="row.code" size="small" :disabled="!row.isNew" placeholder="唯一编码" />
          </template>
        </el-table-column>
        <el-table-column label="名称" width="170">
          <template #default="{ row }">
            <el-input v-model="row.name" size="small" placeholder="展示名称" />
          </template>
        </el-table-column>
        <el-table-column label="颜色" width="110" align="center">
          <template #default="{ row }">
            <el-color-picker v-model="row.color" size="small" />
          </template>
        </el-table-column>
        <el-table-column label="排序" width="110">
          <template #default="{ row }">
            <el-input-number v-model="row.sortNo" size="small" :min="0" :max="999" controls-position="right" />
          </template>
        </el-table-column>
        <el-table-column label="启用" width="90" align="center">
          <template #default="{ row }">
            <el-switch v-model="row.enabled" />
          </template>
        </el-table-column>
        <el-table-column label="备注" min-width="180">
          <template #default="{ row }">
            <el-input v-model="row.remark" size="small" placeholder="可选" />
          </template>
        </el-table-column>
        <el-table-column label="引用数" width="90" align="center">
          <template #default="{ row }">
            <span class="text-sub">{{ row.refCount ?? '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <template v-if="store.hasPerm(PERM.DICT_UPDATE)">
              <el-button link type="primary" @click="saveRow(row)">保存</el-button>
              <el-button link type="danger" @click="removeRow(row)">删除</el-button>
            </template>
            <span v-else class="text-sub">只读</span>
          </template>
        </el-table-column>
        <template #empty>暂无字典项</template>
      </el-table>
    </div>
  </div>
</template>
