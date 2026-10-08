<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Download, Plus, Search } from '@element-plus/icons-vue'
import { formatDate } from '@hospital/shared'
import type { CaseListItem, CaseQuery } from '@hospital/shared'
import { PERM } from '@hospital/shared'
import type { CaseMeta } from '@/api/cases'
import { caseMeta, exportCases, listCases, removeCase } from '@/api/cases'
import ColorTag from '@/components/ColorTag.vue'
import { useUserStore } from '@/stores/user'
import { parseFileName, saveBlob, stampedFileName } from '@/utils/download'
import { buildDeptTree } from '@/utils/tree'

const store = useUserStore()

const loading = ref(false)
const exporting = ref(false)
const rows = ref<CaseListItem[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const sort = ref('created_at:desc')
const meta = ref<CaseMeta>({ diseases: [], sourceTypes: [], caseStatuses: [], eventTypes: [], departments: [] })
/** /cases/meta 返回扁平科室列表，这里转成树供 el-tree-select 使用 */
const deptTree = computed(() => buildDeptTree(meta.value.departments))

const filters = reactive<{
  keyword: string
  diseaseCode: string
  sourceType: string
  statusCode: string
  deptId: number | null
  isClosed: boolean | null
  dateRange: [string, string] | null
}>({
  keyword: '',
  diseaseCode: '',
  sourceType: '',
  statusCode: '',
  deptId: null,
  isClosed: null,
  dateRange: null,
})

/** 组装查询条件：空值不下发，避免后端把空串当成筛选值 */
const query = computed<CaseQuery>(() => {
  const q: CaseQuery = { page: page.value, pageSize: pageSize.value, sort: sort.value }
  if (filters.keyword.trim()) q.keyword = filters.keyword.trim()
  if (filters.diseaseCode) q.diseaseCode = filters.diseaseCode
  if (filters.sourceType) q.sourceType = filters.sourceType
  if (filters.statusCode) q.statusCode = filters.statusCode
  if (filters.deptId !== null) q.deptId = filters.deptId
  if (filters.isClosed !== null) q.isClosed = filters.isClosed
  if (filters.dateRange) {
    q.from = filters.dateRange[0]
    q.to = filters.dateRange[1]
  }
  return q
})

async function loadMeta(): Promise<void> {
  try {
    meta.value = await caseMeta()
  } catch {
    // 元数据失败不阻塞列表（下拉为空）
  }
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const res = await listCases(query.value)
    rows.value = res.list
    total.value = res.total
  } finally {
    loading.value = false
  }
}

function handleSearch(): void {
  page.value = 1
  void load()
}

function handleReset(): void {
  filters.keyword = ''
  filters.diseaseCode = ''
  filters.sourceType = ''
  filters.statusCode = ''
  filters.deptId = null
  filters.isClosed = null
  filters.dateRange = null
  sort.value = 'created_at:desc'
  page.value = 1
  void load()
}

function handleSortChange(payload: { prop: string | null; order: string | null }): void {
  if (payload.prop && payload.order) {
    sort.value = `${payload.prop}:${payload.order === 'ascending' ? 'asc' : 'desc'}`
  } else {
    sort.value = 'created_at:desc'
  }
  void load()
}

async function handleDelete(row: CaseListItem): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认删除绿道病例「${row.caseNo}」吗？`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  await removeCase(row.id)
  ElMessage.success('已删除')
  await load()
}

async function handleExport(): Promise<void> {
  exporting.value = true
  try {
    const res = await exportCases(query.value)
    const disposition = String(res.headers['content-disposition'] ?? '')
    saveBlob(res.data, parseFileName(disposition, stampedFileName('急救绿道病例')))
    ElMessage.success('导出文件已开始下载')
  } finally {
    exporting.value = false
  }
}

onMounted(() => {
  void loadMeta()
  void load()
})
</script>

<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">病例列表</h2>
        <div class="page-subtitle">急救绿道病例登记、时间节点补录与闭环质控</div>
      </div>
      <div class="gap-8">
        <el-button
          v-if="store.hasPerm(PERM.CASE_EXPORT)"
          :icon="Download"
          :loading="exporting"
          @click="handleExport"
        >
          导出
        </el-button>
        <el-button v-if="store.hasPerm(PERM.CASE_CREATE)" type="primary" :icon="Plus" @click="$router.push('/cases/new')">
          新增病例
        </el-button>
      </div>
    </div>

    <div class="card-block filter-bar">
      <el-form :inline="true" @submit.prevent>
        <el-form-item label="关键字">
          <el-input
            v-model="filters.keyword"
            placeholder="姓名 / 病案号 / 绿道号"
            clearable
            style="width: 200px"
            @keyup.enter="handleSearch"
          />
        </el-form-item>
        <el-form-item label="疾病">
          <el-select v-model="filters.diseaseCode" placeholder="全部" clearable style="width: 140px">
            <el-option v-for="item in meta.diseases" :key="item.code" :label="item.name" :value="item.code" />
          </el-select>
        </el-form-item>
        <el-form-item label="推送方式">
          <el-select v-model="filters.sourceType" placeholder="全部" clearable style="width: 140px">
            <el-option v-for="item in meta.sourceTypes" :key="item.code" :label="item.name" :value="item.code" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="filters.statusCode" placeholder="全部" clearable style="width: 140px">
            <el-option v-for="item in meta.caseStatuses" :key="item.code" :label="item.name" :value="item.code" />
          </el-select>
        </el-form-item>
        <el-form-item label="科室">
          <el-tree-select
            v-model="filters.deptId"
            :data="deptTree"
            :props="{ label: 'name', children: 'children' }"
            node-key="id"
            check-strictly
            clearable
            placeholder="全部"
            style="width: 180px"
          />
        </el-form-item>
        <el-form-item label="闭环">
          <el-select v-model="filters.isClosed" placeholder="全部" clearable style="width: 120px">
            <el-option label="未闭环" :value="false" />
            <el-option label="已闭环" :value="true" />
          </el-select>
        </el-form-item>
        <el-form-item label="创建时间">
          <el-date-picker
            v-model="filters.dateRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            unlink-panels
            style="width: 240px"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :icon="Search" @click="handleSearch">查询</el-button>
          <el-button @click="handleReset">重置</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="card-block">
      <el-table v-loading="loading" :data="rows" border stripe size="small" @sort-change="handleSortChange">
        <el-table-column prop="caseNo" label="绿道号" width="150" fixed />
        <el-table-column label="患者" min-width="140">
          <template #default="{ row }">
            <router-link :to="`/cases/${row.id}`">{{ row.patientName }}</router-link>
            <span class="text-sub">（{{ row.genderName }}<span v-if="row.age !== null">/{{ row.age }}岁</span>）</span>
          </template>
        </el-table-column>
        <el-table-column label="疾病" width="120">
          <template #default="{ row }">
            <ColorTag :color="row.diseaseColor" :text="row.diseaseName" />
          </template>
        </el-table-column>
        <el-table-column prop="sourceTypeName" label="推送方式" width="110" />
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <ColorTag :color="row.statusColor" :text="row.statusName" />
          </template>
        </el-table-column>
        <el-table-column prop="deptName" label="科室" width="140" />
        <el-table-column label="距离" width="100">
          <template #default="{ row }">
            {{ row.distanceKm === null ? '—' : `${row.distanceKm} km` }}
          </template>
        </el-table-column>
        <el-table-column label="闭环" width="90">
          <template #default="{ row }">
            <el-tag v-if="row.isClosed" type="success" size="small">已闭环</el-tag>
            <el-tag v-else type="warning" size="small">进行中</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="创建时间" width="170" sortable="custom">
          <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="170" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="$router.push(`/cases/${row.id}`)">详情</el-button>
            <el-button
              v-if="store.hasPerm(PERM.CASE_UPDATE)"
              link
              type="primary"
              @click="$router.push(`/cases/${row.id}/edit`)"
            >
              编辑
            </el-button>
            <el-button v-if="store.hasPerm(PERM.CASE_DELETE)" link type="danger" @click="handleDelete(row)">
              删除
            </el-button>
          </template>
        </el-table-column>
        <template #empty>暂无病例数据</template>
      </el-table>

      <div class="pager">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next, jumper"
          background
          @current-change="load"
          @size-change="handleSearch"
        />
      </div>
    </div>
  </div>
</template>
