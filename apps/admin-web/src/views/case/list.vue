<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { UploadFile } from 'element-plus'
import { Delete, Download, Plus, Search, Upload } from '@element-plus/icons-vue'
import { formatDate } from '@hospital/shared'
import type { CaseImportRow, CaseListItem, CaseQuery } from '@hospital/shared'
import { PERM } from '@hospital/shared'
import type { CaseMeta } from '@/api/cases'
import { batchDeleteCases, caseMeta, exportCases, importCases, listCases, removeCase } from '@/api/cases'
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
const selected = ref<CaseListItem[]>([])
const selectedIds = computed(() => selected.value.map((r) => r.id))

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

/** 下拉改变即刻生效（与患者管理一致，不用再点查询） */
function handleFilterChange(): void {
  handleSearch()
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

function handleSelectionChange(list: CaseListItem[]): void {
  selected.value = list
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

async function handleBatchDelete(): Promise<void> {
  if (selectedIds.value.length === 0) {
    ElMessage.warning('请先勾选要删除的病例')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认删除选中的 ${selectedIds.value.length} 条病例？删除为软删除，可在数据库追溯。`,
      '批量删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  const res = await batchDeleteCases(selectedIds.value)
  ElMessage.success(`已删除 ${res.deleted} 条`)
  selected.value = []
  await load()
}

async function handleExport(): Promise<void> {
  exporting.value = true
  try {
    const res = await exportCases(query.value)
    const disposition = String(res.headers['content-disposition'] ?? '')
    saveBlob(res.data, parseFileName(disposition, stampedFileName('急救绿道病例')))
    ElMessage.success(`已导出 ${total.value} 条（按当前筛选条件）`)
  } finally {
    exporting.value = false
  }
}

/* ------------------------------------------------------------ 批量导入 */
const importVisible = ref(false)
const importing = ref(false)
const importRows = ref<CaseImportRow[]>([])
const importFileName = ref('')
const importErrors = ref<{ row: number; message: string }[]>([])

const IMPORT_TEMPLATE =
  '\uFEFF姓名,性别,出生日期,疾病,推送方式,创建时间,备注\r\n' +
  '张三,男,1980-01-01,胸痛,院前120,2026-10-20 09:30:00,示例行（可删除）\r\n' +
  '李四,女,1992-05-16,创伤,院内创建,,\r\n'

function downloadTemplate(): void {
  saveBlob(new Blob([IMPORT_TEMPLATE], { type: 'text/csv;charset=utf-8' }), '病例导入模板.csv')
}

/** 逐字符解析 CSV 行，支持双引号包裹与转义 */
function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      cells.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  cells.push(cur)
  return cells.map((c) => c.trim())
}

function parseCsv(text: string): CaseImportRow[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) return []
  const head = lines[0].toLowerCase()
  const hasHeader = head.includes('姓名') || head.includes('name')
  const body = hasHeader ? lines.slice(1) : lines
  return body
    .map((line) => {
      const c = splitCsvLine(line)
      return {
        patientName: (c[0] ?? '').trim(),
        gender: (c[1] ?? '').trim(),
        birthDate: (c[2] ?? '').trim() || null,
        disease: (c[3] ?? '').trim(),
        sourceType: (c[4] ?? '').trim(),
        createdAt: (c[5] ?? '').trim() || null,
        remark: (c[6] ?? '').trim() || null,
      }
    })
    .filter((r) => r.patientName.length > 0)
}

async function onFileChange(file: UploadFile): Promise<void> {
  importErrors.value = []
  importRows.value = []
  importFileName.value = file.name
  const raw = file.raw
  if (!raw) return
  const text = await raw.text()
  const parsed = parseCsv(text)
  if (parsed.length === 0) {
    ElMessage.warning('没有解析到有效数据，请确认第一列是姓名')
    return
  }
  importRows.value = parsed
  ElMessage.success(`已解析 ${parsed.length} 行，确认无误后点「开始导入」`)
}

function openImport(): void {
  importRows.value = []
  importFileName.value = ''
  importErrors.value = []
  importVisible.value = true
}

async function submitImport(): Promise<void> {
  if (importRows.value.length === 0) {
    ElMessage.warning('请先选择 CSV 文件')
    return
  }
  importing.value = true
  try {
    const result = await importCases(importRows.value)
    importErrors.value = result.errors
    if (result.created > 0) {
      ElMessage.success(`导入完成：成功 ${result.created} 条，跳过 ${result.skipped} 条`)
      importVisible.value = false
      handleSearch()
    } else {
      ElMessage.warning(`全部 ${result.total} 行都未导入，请查看下方原因`)
    }
  } finally {
    importing.value = false
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
      <el-button
        v-if="store.hasPerm(PERM.CASE_CREATE)"
        type="primary"
        :icon="Plus"
        @click="$router.push('/cases/new')"
      >
        新增病例
      </el-button>
    </div>

    <!-- 筛选：三个主筛选与患者管理一致（无标签、下拉即生效），后接科室/闭环/日期 -->
    <div class="card-block filter-bar">
      <el-form :inline="true" @submit.prevent>
        <el-form-item>
          <el-select
            v-model="filters.diseaseCode"
            placeholder="全部疾病"
            clearable
            style="width: 150px"
            @change="handleFilterChange"
          >
            <el-option v-for="item in meta.diseases" :key="item.code" :label="item.name" :value="item.code" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-select
            v-model="filters.statusCode"
            placeholder="全部状态"
            clearable
            style="width: 150px"
            @change="handleFilterChange"
          >
            <el-option v-for="item in meta.caseStatuses" :key="item.code" :label="item.name" :value="item.code" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-select
            v-model="filters.sourceType"
            placeholder="全部推送方式"
            clearable
            style="width: 160px"
            @change="handleFilterChange"
          >
            <el-option v-for="item in meta.sourceTypes" :key="item.code" :label="item.name" :value="item.code" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-tree-select
            v-model="filters.deptId"
            :data="deptTree"
            :props="{ label: 'name', children: 'children' }"
            node-key="id"
            check-strictly
            clearable
            placeholder="全部科室"
            style="width: 170px"
            @change="handleFilterChange"
          />
        </el-form-item>
        <el-form-item>
          <el-select
            v-model="filters.isClosed"
            placeholder="全部闭环状态"
            clearable
            style="width: 150px"
            @change="handleFilterChange"
          >
            <el-option label="未闭环" :value="false" />
            <el-option label="已闭环" :value="true" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-date-picker
            v-model="filters.dateRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            unlink-panels
            style="width: 240px"
            @change="handleFilterChange"
          />
        </el-form-item>
        <el-form-item>
          <el-input
            v-model="filters.keyword"
            placeholder="姓名 / 病案号 / 绿道号"
            clearable
            style="width: 190px"
            @keyup.enter="handleSearch"
            @clear="handleSearch"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :icon="Search" @click="handleSearch">查询</el-button>
          <el-button @click="handleReset">重置</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="card-block">
      <!-- 批量操作条 -->
      <div class="toolbar">
        <el-button v-if="store.hasPerm(PERM.CASE_CREATE)" :icon="Upload" @click="openImport">批量导入</el-button>
        <el-button v-if="store.hasPerm(PERM.CASE_EXPORT)" :icon="Download" :loading="exporting" @click="handleExport">
          导出
        </el-button>
        <el-button
          v-if="store.hasPerm(PERM.CASE_DELETE)"
          type="danger"
          plain
          :icon="Delete"
          :disabled="selectedIds.length === 0"
          @click="handleBatchDelete"
        >
          删除选中{{ selectedIds.length ? `（${selectedIds.length}）` : '' }}
        </el-button>
        <span class="toolbar-hint">共 {{ total }} 条</span>
      </div>

      <el-table
        v-loading="loading"
        :data="rows"
        border
        stripe
        size="small"
        @sort-change="handleSortChange"
        @selection-change="handleSelectionChange"
      >
        <el-table-column type="selection" width="46" />
        <el-table-column prop="caseNo" label="绿道号" width="150" />
        <el-table-column label="患者" min-width="150">
          <template #default="{ row }">
            <router-link :to="`/cases/${row.id}`">{{ row.patientName }}</router-link>
            <span class="text-sub">（{{ row.genderName }}<span v-if="row.age !== null">/{{ row.age }}岁</span>）</span>
          </template>
        </el-table-column>
        <el-table-column label="疾病" width="110">
          <template #default="{ row }">
            <ColorTag :color="row.diseaseColor" :text="row.diseaseName" />
          </template>
        </el-table-column>
        <el-table-column prop="sourceTypeName" label="推送方式" width="110" />
        <el-table-column prop="deptName" label="科室" width="130">
          <template #default="{ row }">{{ row.deptName ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <ColorTag :color="row.statusColor" :text="row.statusName" />
          </template>
        </el-table-column>
        <el-table-column label="闭环" width="90">
          <template #default="{ row }">
            <el-tag v-if="row.isClosed" type="success" size="small">已闭环</el-tag>
            <el-tag v-else type="warning" size="small">进行中</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="距离" width="90">
          <template #default="{ row }">
            {{ row.distanceKm === null ? '—' : `${row.distanceKm} km` }}
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="时间" width="160" sortable="custom">
          <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.remark ?? '—' }}</template>
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

    <!-- 批量导入 -->
    <el-dialog v-model="importVisible" title="批量导入病例" width="640px">
      <el-alert type="info" :closable="false" show-icon class="mb-12">
        <template #title>
          CSV 列顺序：姓名, 性别, 出生日期, 疾病, 推送方式, 创建时间, 备注（首行表头可有可无）
        </template>
      </el-alert>
      <el-alert type="warning" :closable="false" show-icon class="mb-12"
        title="疾病与推送方式填「字典里的中文名」或编码；每行会新建一位患者并生成一条病例，不填创建时间则用当前时间" />
      <div class="import-head">
        <el-button link type="primary" :icon="Download" @click="downloadTemplate">下载模板</el-button>
        <span v-if="importFileName" class="dim">已选择：{{ importFileName }}</span>
      </div>
      <el-upload
        drag
        accept=".csv,text/csv"
        :auto-upload="false"
        :limit="1"
        :show-file-list="false"
        :on-change="onFileChange"
      >
        <div class="upload-hint">把 CSV 文件拖到这里，或<em>点击选择</em></div>
        <template #tip>
          <div class="upload-tip">仅支持 .csv；姓名、疾病、推送方式必填，填错字典项会逐行报错</div>
        </template>
      </el-upload>

      <div v-if="importRows.length > 0" class="preview">
        <div class="preview-title">解析结果：{{ importRows.length }} 行（预览前 5 行）</div>
        <el-table :data="importRows.slice(0, 5)" size="small" border>
          <el-table-column prop="patientName" label="姓名" width="90" />
          <el-table-column prop="gender" label="性别" width="60" />
          <el-table-column prop="disease" label="疾病" width="100" />
          <el-table-column prop="sourceType" label="推送方式" width="100" />
          <el-table-column prop="createdAt" label="创建时间" width="150" />
          <el-table-column prop="remark" label="备注" min-width="100" show-overflow-tooltip />
        </el-table>
      </div>

      <el-alert
        v-if="importErrors.length > 0"
        type="warning"
        :closable="false"
        class="mt-12"
        :title="`有 ${importErrors.length} 行未导入`"
      >
        <div v-for="e in importErrors" :key="e.row" class="err-row">第 {{ e.row }} 行：{{ e.message }}</div>
      </el-alert>

      <template #footer>
        <el-button @click="importVisible = false">取消</el-button>
        <el-button type="primary" :loading="importing" :disabled="importRows.length === 0" @click="submitImport">
          开始导入{{ importRows.length ? `（${importRows.length} 行）` : '' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.mb-12 {
  margin-bottom: 12px;
}

.mt-12 {
  margin-top: 12px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.toolbar-hint {
  margin-left: auto;
  font-size: 12px;
  opacity: 0.7;
}

.import-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.import-head .dim {
  font-size: 12px;
  opacity: 0.7;
}

.upload-hint {
  padding: 18px 0;
  font-size: 13px;
}

.upload-hint em {
  font-style: normal;
  color: var(--el-color-primary);
}

.upload-tip {
  margin-top: 6px;
  font-size: 12px;
  opacity: 0.7;
}

.preview {
  margin-top: 14px;
}

.preview-title {
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
}

.err-row {
  font-size: 12px;
  line-height: 1.6;
}
</style>
