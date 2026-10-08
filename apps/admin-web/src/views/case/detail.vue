<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormItemRule } from 'element-plus'
import { ArrowLeft, CircleCheck, Clock, View } from '@element-plus/icons-vue'
import { PERM, formatDate, formatMinutes } from '@hospital/shared'
import type { CaseDetail, CaseEventItem, EventCode, PatientPlain } from '@hospital/shared'
import type { CaseMeta } from '@/api/cases'
import { addCaseEvent, caseMeta, closeCase, getCase } from '@/api/cases'
import { getPatientPlain } from '@/api/patients'
import ColorTag from '@/components/ColorTag.vue'
import { useUserStore } from '@/stores/user'

const route = useRoute()
const router = useRouter()
const store = useUserStore()

const caseId = computed<number>(() => Number(route.params.id))
const loading = ref(false)
const detail = ref<CaseDetail | null>(null)
const meta = ref<CaseMeta>({ diseases: [], sourceTypes: [], caseStatuses: [], eventTypes: [], departments: [] })

/** 时间轴按节点时间升序（后端可能按录入顺序返回） */
const events = computed<CaseEventItem[]>(() => {
  const list = detail.value?.events ?? []
  return [...list].sort((a, b) => String(a.eventAt).localeCompare(String(b.eventAt)))
})

async function load(): Promise<void> {
  loading.value = true
  try {
    detail.value = await getCase(caseId.value)
  } finally {
    loading.value = false
  }
}

/* -------------------------------------------------------- 患者明文查看 */
const plainVisible = ref(false)
const plain = ref<PatientPlain | null>(null)

async function viewPlain(): Promise<void> {
  const patientId = detail.value?.patientId
  if (!patientId) return
  try {
    plain.value = await getPatientPlain(patientId)
    plainVisible.value = true
  } catch {
    ElMessage.warning('无权限查看患者明文信息，请联系系统管理员')
  }
}

/* ---------------------------------------------------------- 补录节点 */
const eventVisible = ref(false)
const eventFormRef = ref<FormInstance>()
const eventForm = reactive<{ eventCode: string; eventAt: string; remark: string }>({
  eventCode: '',
  eventAt: '',
  remark: '',
})
const eventRules: Record<string, FormItemRule[]> = {
  eventCode: [{ required: true, message: '请选择时间节点', trigger: 'change' }],
  eventAt: [{ required: true, message: '请选择节点时间', trigger: 'change' }],
}

function openEventDialog(): void {
  eventForm.eventCode = ''
  eventForm.eventAt = formatDate(new Date())
  eventForm.remark = ''
  eventVisible.value = true
}

async function submitEvent(): Promise<void> {
  const valid = await eventFormRef.value?.validate().catch(() => false)
  if (!valid) return
  await addCaseEvent(caseId.value, {
    eventCode: eventForm.eventCode as EventCode,
    eventAt: eventForm.eventAt,
    remark: eventForm.remark.trim() || null,
  })
  ElMessage.success('时间节点已补录')
  eventVisible.value = false
  await load()
}

/* ------------------------------------------------------------ 闭环 */
async function handleClose(): Promise<void> {
  let input: { value: string } | null = null
  try {
    input = (await ElMessageBox.prompt('确认将该病例闭环？可填写闭环备注。', '病例闭环', {
      confirmButtonText: '确认闭环',
      cancelButtonText: '取消',
      inputPlaceholder: '如：质控通过，无超时',
      inputValue: '',
    })) as { value: string }
  } catch {
    return
  }
  await closeCase(caseId.value, {
    closedAt: formatDate(new Date()),
    remark: input?.value ? input.value : undefined,
  })
  ElMessage.success('病例已闭环')
  await load()
}

onMounted(() => {
  void load()
  void caseMeta().then((res) => {
    meta.value = res
  })
})
</script>

<template>
  <div class="page" v-loading="loading">
    <div class="page-header">
      <div>
        <h2 class="page-title">
          病例详情
          <span v-if="detail" class="text-sub" style="font-size: 14px; font-weight: 400">
            {{ detail.caseNo }}
          </span>
        </h2>
        <div class="page-subtitle">时间节点、闭环状态与附件归档</div>
      </div>
      <div class="gap-8">
        <el-button :icon="ArrowLeft" @click="router.push('/cases')">返回列表</el-button>
        <el-button v-if="store.hasPerm(PERM.CASE_UPDATE)" @click="router.push(`/cases/${caseId}/edit`)">
          编辑病例
        </el-button>
        <el-button
          v-if="store.hasPerm(PERM.CASE_EVENT)"
          type="primary"
          :icon="Clock"
          @click="openEventDialog"
        >
          补录时间节点
        </el-button>
        <el-button
          v-if="detail && !detail.isClosed && store.hasPerm([PERM.CASE_UPDATE, PERM.CASE_EVENT])"
          type="success"
          :icon="CircleCheck"
          @click="handleClose"
        >
          闭环
        </el-button>
      </div>
    </div>

    <template v-if="detail">
      <div class="card-block">
        <h3 class="block-title">基本信息</h3>
        <el-descriptions :column="3" border size="small">
          <el-descriptions-item label="绿道号">{{ detail.caseNo }}</el-descriptions-item>
          <el-descriptions-item label="疾病">
            <ColorTag :color="detail.diseaseColor" :text="detail.diseaseName" />
          </el-descriptions-item>
          <el-descriptions-item label="推送方式">{{ detail.sourceTypeName }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <ColorTag :color="detail.statusColor" :text="detail.statusName" />
          </el-descriptions-item>
          <el-descriptions-item label="科室">{{ detail.deptName || '—' }}</el-descriptions-item>
          <el-descriptions-item label="转运距离">
            {{ detail.distanceKm === null ? '—' : `${detail.distanceKm} km` }}
          </el-descriptions-item>
          <el-descriptions-item label="创建时间">{{ formatDate(detail.createdAt) }}</el-descriptions-item>
          <el-descriptions-item label="最后更新">{{ formatDate(detail.updatedAt) }}</el-descriptions-item>
          <el-descriptions-item label="呼救→到院">
            {{ formatMinutes(detail.responseMinutes) }}
          </el-descriptions-item>
          <el-descriptions-item label="是否闭环">
            <el-tag v-if="detail.isClosed" type="success" size="small">已闭环</el-tag>
            <el-tag v-else type="warning" size="small">进行中</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="闭环时间">{{ detail.closedAt ? formatDate(detail.closedAt) : '—' }}</el-descriptions-item>
          <el-descriptions-item label="备注">{{ detail.remark || '—' }}</el-descriptions-item>
        </el-descriptions>
      </div>

      <div class="card-block">
        <div class="flex-between mb-12">
          <h3 class="block-title" style="margin-bottom: 0">患者信息</h3>
          <el-button
            v-if="store.hasPerm(PERM.PATIENT_PLAIN)"
            size="small"
            :icon="View"
            @click="viewPlain"
          >
            查看明文
          </el-button>
        </div>
        <el-descriptions :column="3" border size="small">
          <el-descriptions-item label="姓名">{{ detail.patient.nameMasked }}</el-descriptions-item>
          <el-descriptions-item label="性别">{{ detail.patient.genderName }}</el-descriptions-item>
          <el-descriptions-item label="年龄">{{ detail.patient.age === null ? '—' : `${detail.patient.age} 岁` }}</el-descriptions-item>
          <el-descriptions-item label="病案号">{{ detail.patient.mrn || '—' }}</el-descriptions-item>
          <el-descriptions-item label="手机号">{{ detail.patient.phoneMasked || '—' }}</el-descriptions-item>
          <el-descriptions-item label="身份证号">{{ detail.patient.idCardMasked || '—' }}</el-descriptions-item>
        </el-descriptions>
      </div>

      <el-row :gutter="12">
        <el-col :xs="24" :lg="14">
          <div class="card-block">
            <h3 class="block-title">急救时间轴</h3>
            <el-timeline>
              <el-timeline-item
                v-for="(item, index) in events"
                :key="item.id"
                :timestamp="formatDate(item.eventAt)"
                placement="top"
                :color="item.overtime ? '#f56c6c' : '#1f6feb'"
              >
                <div class="timeline-head">
                  <span class="text-strong">{{ item.eventName }}</span>
                  <el-tag v-if="item.overtime" type="danger" size="small" effect="dark">超时</el-tag>
                  <span v-if="index > 0 && item.gapMinutes !== null" class="text-sub">
                    距上一节点 {{ formatMinutes(item.gapMinutes) }}
                  </span>
                </div>
                <div class="text-sub">记录人：{{ item.operatorName || '—' }}</div>
                <div v-if="item.remark" class="text-sub">备注：{{ item.remark }}</div>
              </el-timeline-item>
              <el-timeline-item v-if="events.length === 0" timestamp="—">暂无时间节点，请补录</el-timeline-item>
            </el-timeline>
          </div>
        </el-col>
        <el-col :xs="24" :lg="10">
          <div class="card-block">
            <h3 class="block-title">附件</h3>
            <el-table :data="detail.attachments" size="small" border>
              <el-table-column label="文件名" min-width="160">
                <template #default="{ row }">
                  <a :href="row.url" target="_blank" rel="noopener">{{ row.fileName }}</a>
                </template>
              </el-table-column>
              <el-table-column label="大小" width="100">
                <template #default="{ row }">{{ (row.fileSize / 1024).toFixed(1) }} KB</template>
              </el-table-column>
              <el-table-column label="上传时间" width="160">
                <template #default="{ row }">{{ formatDate(row.uploadedAt) }}</template>
              </el-table-column>
              <template #empty>暂无附件</template>
            </el-table>
          </div>
        </el-col>
      </el-row>
    </template>

    <!-- 患者明文（每次查看后端写审计日志） -->
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

    <!-- 补录时间节点 -->
    <el-dialog v-model="eventVisible" title="补录时间节点" width="440px">
      <el-form ref="eventFormRef" :model="eventForm" :rules="eventRules" label-width="90px">
        <el-form-item label="节点" prop="eventCode">
          <el-select v-model="eventForm.eventCode" placeholder="请选择时间节点" style="width: 100%">
            <el-option v-for="item in meta.eventTypes" :key="item.code" :label="item.name" :value="item.code" />
          </el-select>
        </el-form-item>
        <el-form-item label="节点时间" prop="eventAt">
          <el-date-picker
            v-model="eventForm.eventAt"
            type="datetime"
            value-format="YYYY-MM-DD HH:mm:ss"
            placeholder="选择日期时间"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="eventForm.remark" type="textarea" :rows="2" maxlength="200" show-word-limit />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="eventVisible = false">取消</el-button>
        <el-button type="primary" @click="submitEvent">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.timeline-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
