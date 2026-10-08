<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormItemRule } from 'element-plus'
import { Plus, Search, View } from '@element-plus/icons-vue'
import { GENDER, PERM, formatDate, genderLabel } from '@hospital/shared'
import type { PatientListItem, PatientPlain, PatientSaveRequest } from '@hospital/shared'
import { createPatient, getPatient, getPatientPlain, listPatients, updatePatient } from '@/api/patients'
import { useUserStore } from '@/stores/user'

const store = useUserStore()

const loading = ref(false)
const rows = ref<PatientListItem[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const keyword = ref('')

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

async function load(): Promise<void> {
  loading.value = true
  try {
    const res = await listPatients({ page: page.value, pageSize: pageSize.value, keyword: keyword.value.trim() || undefined })
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
  void load()
})
</script>

<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">患者管理</h2>
        <div class="page-subtitle">列表统一展示脱敏字段，明文查看会写入审计日志</div>
      </div>
      <el-button v-if="store.hasPerm(PERM.PATIENT_UPDATE)" type="primary" :icon="Plus" @click="openCreate">
        新增患者
      </el-button>
    </div>

    <div class="card-block filter-bar">
      <el-form :inline="true" @submit.prevent>
        <el-form-item label="关键字">
          <el-input
            v-model="keyword"
            placeholder="姓名 / 病案号 / 手机号"
            clearable
            style="width: 240px"
            @keyup.enter="handleSearch"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :icon="Search" @click="handleSearch">查询</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="card-block">
      <el-table v-loading="loading" :data="rows" border stripe size="small">
        <el-table-column prop="nameMasked" label="姓名" width="110" />
        <el-table-column prop="genderName" label="性别" width="80" />
        <el-table-column label="年龄" width="80">
          <template #default="{ row }">{{ row.age === null ? '—' : `${row.age} 岁` }}</template>
        </el-table-column>
        <el-table-column prop="mrn" label="病案号" width="140" />
        <el-table-column prop="phoneMasked" label="手机号" width="140" />
        <el-table-column prop="idCardMasked" label="身份证号" min-width="180" />
        <el-table-column prop="visitCount" label="就诊次数" width="100" />
        <el-table-column label="建档时间" width="170">
          <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button v-if="store.hasPerm(PERM.PATIENT_UPDATE)" link type="primary" @click="openEdit(row)">
              编辑
            </el-button>
            <el-button v-if="store.hasPerm(PERM.PATIENT_PLAIN)" link type="warning" @click="viewPlain(row)">
              明文
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
</style>
