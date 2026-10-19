<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormItemRule, UploadFile } from 'element-plus'
import { Delete, Download, Plus, Search, Upload } from '@element-plus/icons-vue'
import { GENDER, PERM, genderLabel } from '@hospital/shared'
import type { DictItem, PatientImportRow, PatientListItem, PatientPlain, PatientSaveRequest } from '@hospital/shared'
import {
  batchDeletePatients,
  createPatient,
  exportPatients,
  getPatient,
  getPatientPlain,
  importPatients,
  listPatients,
  removePatient,
  updatePatient,
} from '@/api/patients'
import { listDicts } from '@/api/dicts'
import ColorTag from '@/components/ColorTag.vue'
import { useUserStore } from '@/stores/user'
import { parseFileName, saveBlob, stampedFileName } from '@/utils/download'

const store = useUserStore()

/* ------------------------------------------------------------ 列表与筛选 */
const loading = ref(false)
const rows = ref<PatientListItem[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const selected = ref<PatientListItem[]>([])

/** 三个下拉筛选；空字符串表示「全部」 */
const filters = reactive({ keyword: '', diseaseCode: '', statusCode: '', sourceType: '' })

const diseases = ref<DictItem[]>([])
const statuses = ref<DictItem[]>([])
const sources = ref<DictItem[]>([])

const selectedIds = computed(() => selected.value.map((r) => r.id))

async function loadDicts(): Promise<void> {
  const [d, s, src] = await Promise.all([listDicts('disease'), listDicts('caseStatus'), listDicts('sourceType')])
  diseases.value = d
  statuses.value = s
  sources.value = src
}

function buildQuery(pageNo = page.value) {
  return {
    page: pageNo,
    pageSize: pageSize.value,
    // 一个框同时搜 姓名 / 病案号 / 绿道号
    keyword: filters.keyword.trim() || undefined,
    diseaseCode: filters.diseaseCode || undefined,
    statusCode: filters.statusCode || undefined,
    sourceType: filters.sourceType || undefined,
  }
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const res = await listPatients(buildQuery())
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
  filters.statusCode = ''
  filters.sourceType = ''
  handleSearch()
}

/** 下拉改变即刻生效（不用再点查询，符合截图里的使用习惯） */
function handleFilterChange(): void {
  handleSearch()
}

function handleSelectionChange(list: PatientListItem[]): void {
  selected.value = list
}

/* ---------------------------------------------------------------- 导出 */
const exporting = ref(false)

async function handleExport(): Promise<void> {
  exporting.value = true
  try {
    const res = await exportPatients(buildQuery())
    const name = parseFileName(String(res.headers['content-disposition'] ?? ''), stampedFileName('患者列表', 'csv'))
    saveBlob(new Blob([res.data], { type: 'text/csv;charset=utf-8' }), name)
    ElMessage.success(`已导出 ${total.value} 条（按当前筛选条件）`)
  } finally {
    exporting.value = false
  }
}

/* ------------------------------------------------------------ 批量导入 */
const importVisible = ref(false)
const importing = ref(false)
const importRows = ref<PatientImportRow[]>([])
const importFileName = ref('')
const importErrors = ref<{ row: number; message: string }[]>([])

const IMPORT_TEMPLATE =
  '\uFEFF姓名,性别,出生日期,病案号,身份证号,手机号,备注\r\n' +
  '张三,男,1980-01-01,MRN9001,,13800000000,示例行（可删除）\r\n' +
  '李四,女,1992-05-16,MRN9002,,13900000000,\r\n'

function downloadTemplate(): void {
  saveBlob(new Blob([IMPORT_TEMPLATE], { type: 'text/csv;charset=utf-8' }), '患者导入模板.csv')
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

function parseCsv(text: string): PatientImportRow[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) return []
  const head = lines[0].toLowerCase()
  const hasHeader = head.includes('姓名') || head.includes('name')
  const body = hasHeader ? lines.slice(1) : lines
  return body
    .map((line) => {
      const c = splitCsvLine(line)
      return {
        name: (c[0] ?? '').trim(),
        gender: (c[1] ?? '').trim(),
        birthDate: (c[2] ?? '').trim() || null,
        mrn: (c[3] ?? '').trim() || null,
        idCard: (c[4] ?? '').trim() || null,
        phone: (c[5] ?? '').trim() || null,
        remark: (c[6] ?? '').trim() || null,
      }
    })
    .filter((r) => r.name.length > 0)
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
    const result = await importPatients(importRows.value)
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

/* ------------------------------------------------------------ 删除 */
async function handleDelete(row: PatientListItem): Promise<void> {
  const tip = row.visitCount > 0 ? `该患者关联 ${row.visitCount} 条绿道病例，将一并删除。` : ''
  try {
    await ElMessageBox.confirm(`确认删除患者「${row.nameMasked}」？${tip}`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  await removePatient(row.id)
  ElMessage.success('已删除')
  await load()
}

async function handleBatchDelete(): Promise<void> {
  if (selectedIds.value.length === 0) {
    ElMessage.warning('请先勾选要删除的患者')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认删除选中的 ${selectedIds.value.length} 条患者？其关联病例会一并删除（软删除，可追溯）。`,
      '批量删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  const res = await batchDeletePatients(selectedIds.value)
  ElMessage.success(`已删除 ${res.deleted} 条`)
  selected.value = []
  await load()
}

/* ------------------------------------------------------------ 新增 / 编辑 */
const dialogVisible = ref(false)
const saving = ref(false)
const editingId = ref<number | null>(null)
const formRef = ref<FormInstance>()
const form = reactive<PatientSaveRequest>({
  name: '',
  gender: GENDER.MALE,
  birthDate: null,
  mrn: null,
  idCard: null,
  phone: null,
  remark: null,
})

const rules: Record<string, FormItemRule[]> = {
  name: [{ required: true, message: '请输入患者姓名', trigger: 'blur' }],
  gender: [{ required: true, message: '请选择性别', trigger: 'change' }],
}

const plainVisible = ref(false)
const plain = ref<PatientPlain | null>(null)
/** 编辑时是否只能看到脱敏值（无 patient:plain 权限） */
const maskedEdit = ref(false)

function resetForm(): void {
  form.name = ''
  form.gender = GENDER.MALE
  form.birthDate = null
  form.mrn = null
  form.idCard = null
  form.phone = null
  form.remark = null
}

function openCreate(): void {
  editingId.value = null
  resetForm()
  dialogVisible.value = true
}

async function openEdit(row: PatientListItem): Promise<void> {
  editingId.value = row.id
  resetForm()
  const detail = await getPatient(row.id)
  form.gender = detail.gender
  form.birthDate = detail.birthDate
  form.mrn = detail.mrn
  form.remark = detail.remark
  maskedEdit.value = true
  // 有明文权限时优先回填明文，避免把脱敏值写回数据库
  if (store.hasPerm(PERM.PATIENT_PLAIN)) {
    try {
      const real = await getPatientPlain(row.id)
      form.name = real.name
      form.idCard = real.idCard
      form.phone = real.phone
      maskedEdit.value = false
    } catch {
      fillMasked(detail)
    }
  } else {
    fillMasked(detail)
  }
  dialogVisible.value = true
}

/** 无明文权限时的兜底回填：只填脱敏值，保存前由用户确认 */
function fillMasked(detail: PatientListItem): void {
  form.name = detail.nameMasked
  form.idCard = detail.idCardMasked
  form.phone = detail.phoneMasked
}

async function submit(): Promise<void> {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  const payload: PatientSaveRequest = {
    name: form.name.trim(),
    gender: form.gender,
    birthDate: form.birthDate || null,
    mrn: form.mrn || null,
    idCard: form.idCard || null,
    phone: form.phone || null,
    remark: form.remark || null,
  }
  saving.value = true
  try {
    if (editingId.value === null) {
      await createPatient(payload)
      ElMessage.success('患者已新增')
    } else {
      await updatePatient(editingId.value, payload)
      ElMessage.success('患者已保存')
    }
    dialogVisible.value = false
    await load()
  } finally {
    saving.value = false
  }
}

async function viewPlain(row: PatientListItem): Promise<void> {
  try {
    plain.value = await getPatientPlain(row.id)
    plainVisible.value = true
  } catch {
    ElMessage.warning('无权限查看患者明文信息，请联系系统管理员')
  }
}

onMounted(() => {
  void loadDicts()
  void load()
})
</script>

<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">患者管理</h2>
        <div class="page-subtitle">列表展示脱敏字段 + 最近一次绿道病例；明文查看会写入审计日志</div>
      </div>
      <el-button v-if="store.hasPerm(PERM.PATIENT_UPDATE)" type="primary" :icon="Plus" @click="openCreate">
        新增患者
      </el-button>
    </div>

    <!-- 筛选：疾病 / 状态 / 推送方式 + 关键字 -->
    <div class="card-block filter-bar">
      <el-form :inline="true" @submit.prevent>
        <el-form-item>
          <el-select
            v-model="filters.diseaseCode"
            placeholder="全部疾病"
            clearable
            style="width: 160px"
            @change="handleFilterChange"
          >
            <el-option v-for="d in diseases" :key="d.code" :label="d.name" :value="d.code" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-select
            v-model="filters.statusCode"
            placeholder="全部状态"
            clearable
            style="width: 160px"
            @change="handleFilterChange"
          >
            <el-option v-for="s in statuses" :key="s.code" :label="s.name" :value="s.code" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-select
            v-model="filters.sourceType"
            placeholder="全部推送方式"
            clearable
            style="width: 170px"
            @change="handleFilterChange"
          >
            <el-option v-for="s in sources" :key="s.code" :label="s.name" :value="s.code" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-input
            v-model="filters.keyword"
            placeholder="姓名 / 病案号 / 绿道号"
            clearable
            style="width: 230px"
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
        <el-button v-if="store.hasPerm(PERM.PATIENT_UPDATE)" :icon="Upload" @click="openImport">
          批量导入
        </el-button>
        <el-button :icon="Download" :loading="exporting" @click="handleExport">导出 CSV</el-button>
        <el-button
          v-if="store.hasPerm(PERM.PATIENT_UPDATE)"
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
        @selection-change="handleSelectionChange"
      >
        <el-table-column type="selection" width="46" />
        <el-table-column label="绿道号" width="150">
          <template #default="{ row }">{{ row.lastCaseNo ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="患者" min-width="150">
          <template #default="{ row }">
            <router-link v-if="row.lastCaseId" :to="`/cases/${row.lastCaseId}`">{{ row.nameMasked }}</router-link>
            <span v-else>{{ row.nameMasked }}</span>
            <span class="text-sub">（{{ row.genderName }}<span v-if="row.age !== null">/{{ row.age }}岁</span>）</span>
          </template>
        </el-table-column>
        <el-table-column label="疾病" width="110">
          <template #default="{ row }">
            <ColorTag :color="row.diseaseColor" :text="row.diseaseName" />
          </template>
        </el-table-column>
        <el-table-column label="科室" width="120">
          <template #default="{ row }">{{ row.deptName ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="推送方式" width="110">
          <template #default="{ row }">{{ row.sourceTypeName ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="手机号" width="130">
          <template #default="{ row }">{{ row.phoneMasked ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <ColorTag :color="row.statusColor" :text="row.statusName" />
          </template>
        </el-table-column>
        <el-table-column label="时间" width="160">
          <template #default="{ row }">{{ row.lastVisitAt ?? row.createdAt }}</template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.remark ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button v-if="store.hasPerm(PERM.PATIENT_UPDATE)" link type="primary" @click="openEdit(row)">
              编辑
            </el-button>
            <el-button v-if="store.hasPerm(PERM.PATIENT_PLAIN)" link type="warning" @click="viewPlain(row)">
              明文
            </el-button>
            <el-button v-if="store.hasPerm(PERM.PATIENT_UPDATE)" link type="danger" @click="handleDelete(row)">
              删除
            </el-button>
          </template>
        </el-table-column>
        <template #empty>暂无患者数据</template>
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

    <!-- 批量导入 -->
    <el-dialog v-model="importVisible" title="批量导入患者" width="620px">
      <el-alert type="info" :closable="false" show-icon class="mb-12">
        <template #title>
          CSV 列顺序：姓名, 性别, 出生日期, 病案号, 身份证号, 手机号, 备注（首行表头可有可无）
        </template>
      </el-alert>
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
          <div class="upload-tip">仅支持 .csv；姓名列必填，性别填「男/女」，重复病案号会被跳过</div>
        </template>
      </el-upload>

      <div v-if="importRows.length > 0" class="preview">
        <div class="preview-title">解析结果：{{ importRows.length }} 行（预览前 5 行）</div>
        <el-table :data="importRows.slice(0, 5)" size="small" border>
          <el-table-column prop="name" label="姓名" width="90" />
          <el-table-column prop="gender" label="性别" width="70" />
          <el-table-column prop="birthDate" label="出生日期" width="110" />
          <el-table-column prop="mrn" label="病案号" width="100" />
          <el-table-column prop="phone" label="手机号" width="120" />
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

    <!-- 新增 / 编辑 -->
    <el-dialog v-model="dialogVisible" :title="editingId === null ? '新增患者' : '编辑患者'" width="560px">
      <el-alert
        v-if="editingId !== null && maskedEdit"
        class="mb-12"
        type="warning"
        :closable="false"
        show-icon
        title="当前账号无明文权限：姓名 / 身份证 / 手机号为脱敏值，保存前请重新填写完整信息"
      />
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="姓名" prop="name">
              <el-input v-model="form.name" maxlength="32" placeholder="患者姓名" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="性别" prop="gender">
              <el-select v-model="form.gender" style="width: 100%">
                <el-option :value="GENDER.MALE" :label="genderLabel(GENDER.MALE)" />
                <el-option :value="GENDER.FEMALE" :label="genderLabel(GENDER.FEMALE)" />
                <el-option :value="GENDER.UNKNOWN" :label="genderLabel(GENDER.UNKNOWN)" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="出生日期">
              <el-date-picker
                v-model="form.birthDate"
                type="date"
                value-format="YYYY-MM-DD"
                placeholder="选择日期"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="病案号">
              <el-input v-model="form.mrn" maxlength="32" placeholder="住院/病案号" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="身份证号">
              <el-input v-model="form.idCard" maxlength="18" placeholder="18 位身份证号" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="手机号">
              <el-input v-model="form.phone" maxlength="11" placeholder="11 位手机号" />
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="备注">
              <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="200" show-word-limit />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
      </template>
    </el-dialog>

    <!-- 明文 -->
    <el-dialog v-model="plainVisible" title="患者明文信息" width="420px">
      <el-alert type="warning" :closable="false" show-icon title="明文查看已记录审计日志" class="mb-12" />
      <el-descriptions :column="1" border size="small">
        <el-descriptions-item label="姓名">{{ plain?.name || '—' }}</el-descriptions-item>
        <el-descriptions-item label="身份证号">{{ plain?.idCard || '—' }}</el-descriptions-item>
        <el-descriptions-item label="手机号">{{ plain?.phone || '—' }}</el-descriptions-item>
      </el-descriptions>
      <template #footer>
        <el-button type="primary" @click="plainVisible = false">关闭</el-button>
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
