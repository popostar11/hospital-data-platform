<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormItemRule } from 'element-plus'
import { ArrowLeft, Search } from '@element-plus/icons-vue'
import { GENDER, genderLabel } from '@hospital/shared'
import type {
  CaseSaveRequest,
  CaseStatusCode,
  DiseaseCode,
  PatientListItem,
  PatientSaveRequest,
  SourceType,
} from '@hospital/shared'
import type { CaseMeta } from '@/api/cases'
import { caseMeta, createCase, getCase, updateCase } from '@/api/cases'
import { searchPatients } from '@/api/patients'
import { buildDeptTree } from '@/utils/tree'

const route = useRoute()
const router = useRouter()

/** 新增与编辑共用本页面，靠路由名区分 */
const isEdit = computed<boolean>(() => route.name === 'case-edit')
const caseId = computed<number>(() => (isEdit.value ? Number(route.params.id) : 0))

const loading = ref(false)
const saving = ref(false)
const formRef = ref<FormInstance>()
const meta = ref<CaseMeta>({ diseases: [], sourceTypes: [], caseStatuses: [], eventTypes: [], departments: [] })
/** /cases/meta 返回扁平科室列表，这里转成树供 el-tree-select 使用 */
const deptTree = computed(() => buildDeptTree(meta.value.departments))

const base = reactive<{
  diseaseCode: string
  sourceType: string
  statusCode: string
  deptId: number | null
  distanceKm: number | null
  onsetAt: string
  createdAt: string
  remark: string
}>({
  diseaseCode: '',
  sourceType: '',
  statusCode: '',
  deptId: null,
  distanceKm: null,
  onsetAt: '',
  createdAt: '',
  remark: '',
})

const rules: Record<string, FormItemRule[]> = {
  diseaseCode: [{ required: true, message: '请选择疾病类型', trigger: 'change' }],
  sourceType: [{ required: true, message: '请选择推送方式', trigger: 'change' }],
}

/* ------------------------------------------------------------ 患者选择 */
const patientMode = ref<'existing' | 'new'>('existing')
const patientId = ref<number | null>(null)
const patientOptions = ref<PatientListItem[]>([])
const patientSearching = ref(false)
const newPatient = reactive<PatientSaveRequest>({
  name: '',
  gender: GENDER.MALE,
  birthDate: null,
  mrn: null,
  idCard: null,
  phone: null,
  remark: null,
})

async function searchPatient(keyword: string): Promise<void> {
  const text = keyword.trim()
  if (!text) {
    patientOptions.value = []
    return
  }
  patientSearching.value = true
  try {
    patientOptions.value = await searchPatients(text)
  } finally {
    patientSearching.value = false
  }
}

function patientLabel(item: PatientListItem): string {
  const age = item.age === null ? '年龄未知' : `${item.age}岁`
  return `${item.nameMasked} / ${item.genderName} / ${age} / ${item.mrn ?? '无病案号'}`
}

/* ---------------------------------------------------------------- 载入 */
async function loadMeta(): Promise<void> {
  meta.value = await caseMeta()
}

async function loadDetail(): Promise<void> {
  if (!isEdit.value) {
    base.createdAt = ''
    return
  }
  loading.value = true
  try {
    const detail = await getCase(caseId.value)
    base.diseaseCode = detail.diseaseCode
    base.sourceType = detail.sourceType
    base.statusCode = detail.statusCode
    base.deptId = detail.deptId
    base.distanceKm = detail.distanceKm
    base.remark = detail.remark ?? ''
    patientMode.value = 'existing'
    patientId.value = detail.patientId
    // 把已有患者放进选项里，保证下拉能显示当前患者
    patientOptions.value = [detail.patient]
  } finally {
    loading.value = false
  }
}

/* ---------------------------------------------------------------- 提交 */
async function submit(): Promise<void> {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  const payload: CaseSaveRequest = {
    diseaseCode: base.diseaseCode as DiseaseCode,
    sourceType: base.sourceType as SourceType,
    deptId: base.deptId,
    distanceKm: base.distanceKm,
    onsetAt: base.onsetAt || null,
    createdAt: base.createdAt || null,
    remark: base.remark.trim() || null,
  }
  if (base.statusCode) payload.statusCode = base.statusCode as CaseStatusCode

  if (patientMode.value === 'existing') {
    if (!patientId.value) {
      ElMessage.warning('请选择患者')
      return
    }
    payload.patientId = patientId.value
  } else {
    if (!newPatient.name.trim()) {
      ElMessage.warning('请填写患者姓名')
      return
    }
    payload.patient = {
      name: newPatient.name.trim(),
      gender: newPatient.gender,
      birthDate: newPatient.birthDate || null,
      mrn: newPatient.mrn || null,
      idCard: newPatient.idCard || null,
      phone: newPatient.phone || null,
      remark: newPatient.remark || null,
    }
  }

  saving.value = true
  try {
    if (isEdit.value) {
      await updateCase(caseId.value, payload)
      ElMessage.success('病例已保存')
      await router.push(`/cases/${caseId.value}`)
    } else {
      const res = await createCase(payload)
      ElMessage.success('病例已创建')
      await router.push(`/cases/${res.id}`)
    }
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  void loadMeta()
  void loadDetail()
})
</script>

<template>
  <div class="page" v-loading="loading">
    <div class="page-header">
      <div>
        <h2 class="page-title">{{ isEdit ? '编辑病例' : '新增病例' }}</h2>
        <div class="page-subtitle">疾病、推送方式、科室与时间信息将用于绿道质控统计</div>
      </div>
      <el-button :icon="ArrowLeft" @click="router.back()">返回</el-button>
    </div>

    <el-form ref="formRef" :model="base" :rules="rules" label-width="110px">
      <div class="card-block">
        <h3 class="block-title">患者信息</h3>
        <el-radio-group v-model="patientMode" class="mb-12">
          <el-radio-button value="existing">选择已有患者</el-radio-button>
          <el-radio-button value="new">新建患者</el-radio-button>
        </el-radio-group>

        <el-row v-if="patientMode === 'existing'" :gutter="16">
          <el-col :xs="24" :md="12">
            <el-form-item label="患者">
              <el-select
                v-model="patientId"
                filterable
                remote
                clearable
                reserve-keyword
                :remote-method="searchPatient"
                :loading="patientSearching"
                placeholder="输入姓名 / 病案号 / 手机号搜索"
                style="width: 100%"
              >
                <template #prefix>
                  <el-icon><Search /></el-icon>
                </template>
                <el-option
                  v-for="item in patientOptions"
                  :key="item.id"
                  :label="patientLabel(item)"
                  :value="item.id"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :xs="24" :md="12">
            <el-form-item label="就诊次数">
              <span class="text-sub">
                {{ patientOptions.find((item) => item.id === patientId)?.visitCount ?? '—' }}
              </span>
            </el-form-item>
          </el-col>
        </el-row>

        <el-row v-else :gutter="16">
          <el-col :xs="24" :md="8">
            <el-form-item label="姓名">
              <el-input v-model="newPatient.name" placeholder="患者姓名" maxlength="32" />
            </el-form-item>
          </el-col>
          <el-col :xs="24" :md="8">
            <el-form-item label="性别">
              <el-select v-model="newPatient.gender" style="width: 100%">
                <el-option :value="GENDER.MALE" :label="genderLabel(GENDER.MALE)" />
                <el-option :value="GENDER.FEMALE" :label="genderLabel(GENDER.FEMALE)" />
                <el-option :value="GENDER.UNKNOWN" :label="genderLabel(GENDER.UNKNOWN)" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :xs="24" :md="8">
            <el-form-item label="出生日期">
              <el-date-picker
                v-model="newPatient.birthDate"
                type="date"
                value-format="YYYY-MM-DD"
                placeholder="选择日期"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :xs="24" :md="8">
            <el-form-item label="病案号">
              <el-input v-model="newPatient.mrn" placeholder="住院/病案号" maxlength="32" />
            </el-form-item>
          </el-col>
          <el-col :xs="24" :md="8">
            <el-form-item label="身份证号">
              <el-input v-model="newPatient.idCard" placeholder="18 位身份证号" maxlength="18" />
            </el-form-item>
          </el-col>
          <el-col :xs="24" :md="8">
            <el-form-item label="手机号">
              <el-input v-model="newPatient.phone" placeholder="11 位手机号" maxlength="11" />
            </el-form-item>
          </el-col>
        </el-row>
      </div>

      <div class="card-block">
        <h3 class="block-title">绿道信息</h3>
        <el-row :gutter="16">
          <el-col :xs="24" :md="8">
            <el-form-item label="疾病" prop="diseaseCode">
              <el-select v-model="base.diseaseCode" placeholder="请选择疾病" style="width: 100%">
                <el-option v-for="item in meta.diseases" :key="item.code" :label="item.name" :value="item.code" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :xs="24" :md="8">
            <el-form-item label="推送方式" prop="sourceType">
              <el-select v-model="base.sourceType" placeholder="请选择推送方式" style="width: 100%">
                <el-option v-for="item in meta.sourceTypes" :key="item.code" :label="item.name" :value="item.code" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :xs="24" :md="8">
            <el-form-item label="状态">
              <el-select v-model="base.statusCode" placeholder="默认按后端规则" clearable style="width: 100%">
                <el-option v-for="item in meta.caseStatuses" :key="item.code" :label="item.name" :value="item.code" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :xs="24" :md="8">
            <el-form-item label="接诊科室">
              <el-tree-select
                v-model="base.deptId"
                :data="deptTree"
                :props="{ label: 'name', children: 'children' }"
                node-key="id"
                check-strictly
                clearable
                placeholder="请选择科室"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :xs="24" :md="8">
            <el-form-item label="转运距离">
              <el-input-number v-model="base.distanceKm" :min="0" :max="9999" :precision="2" :step="0.5" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :xs="24" :md="8">
            <el-form-item label="发病时间">
              <el-date-picker
                v-model="base.onsetAt"
                type="datetime"
                value-format="YYYY-MM-DD HH:mm:ss"
                placeholder="选择发病时间"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :xs="24" :md="8">
            <el-form-item label="呼救时间">
              <el-date-picker
                v-model="base.createdAt"
                type="datetime"
                value-format="YYYY-MM-DD HH:mm:ss"
                placeholder="默认取当前时间"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="备注">
              <el-input v-model="base.remark" type="textarea" :rows="3" maxlength="500" show-word-limit />
            </el-form-item>
          </el-col>
        </el-row>
      </div>

      <div class="card-block form-actions">
        <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
        <el-button @click="router.back()">取消</el-button>
      </div>
    </el-form>
  </div>
</template>

<style scoped>
.form-actions {
  display: flex;
  justify-content: flex-end;
}
</style>
