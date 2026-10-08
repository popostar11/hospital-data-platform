<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Monitor, Refresh } from '@element-plus/icons-vue'
import type { DictItem, ScreenConfigItem, ScreenConfigSaveRequest } from '@hospital/shared'
import { listDicts } from '@/api/dicts'
import { listScreenConfigs, saveScreenConfig } from '@/api/screenConfig'
import { useUserStore } from '@/stores/user'
import { DEFAULT_HOSPITAL_NAME, DEFAULT_SYSTEM_NAME, PERM } from '@hospital/shared'

/** 表单状态：由 shared 的 ScreenConfigItem 派生（去掉服务端维护的 id / updatedAt） */
type ConfigFormState = Omit<ScreenConfigItem, 'id' | 'updatedAt'>

const store = useUserStore()
const loading = ref(false)
const saving = ref(false)
const configs = ref<ScreenConfigItem[]>([])
const diseases = ref<DictItem[]>([])

const form = reactive<ConfigFormState>({
  screenCode: 'main',
  hospitalName: DEFAULT_HOSPITAL_NAME,
  systemName: DEFAULT_SYSTEM_NAME,
  refreshInterval: 30,
  scrollSpeed: 40,
  visibleRows: 4,
  maskEnabled: true,
  pieDiseaseCode: null,
  monthBarMode: 'CREATED_AT',
  theme: 'dark',
})

const THEME_OPTIONS = [
  { value: 'dark', label: '深色（推荐）' },
  { value: 'light', label: '浅色' },
]

function applyConfig(item: ScreenConfigItem): void {
  form.screenCode = item.screenCode
  form.hospitalName = item.hospitalName
  form.systemName = item.systemName
  form.refreshInterval = item.refreshInterval
  form.scrollSpeed = item.scrollSpeed
  form.visibleRows = item.visibleRows
  form.maskEnabled = item.maskEnabled
  form.pieDiseaseCode = item.pieDiseaseCode
  form.monthBarMode = item.monthBarMode
  form.theme = item.theme
}

async function load(): Promise<void> {
  loading.value = true
  try {
    configs.value = await listScreenConfigs()
    const first = configs.value[0]
    if (first) applyConfig(first)
  } finally {
    loading.value = false
  }
}

function handleScreenChange(screenCode: string): void {
  const target = configs.value.find((item) => item.screenCode === screenCode)
  if (target) applyConfig(target)
}

async function save(): Promise<void> {
  const payload: ScreenConfigSaveRequest = { ...form, screenCode: form.screenCode }
  saving.value = true
  try {
    const updated = await saveScreenConfig(form.screenCode, payload)
    ElMessage.success('保存成功，大屏将在下个刷新周期生效')
    const index = configs.value.findIndex((item) => item.screenCode === updated.screenCode)
    if (index >= 0) configs.value[index] = updated
    else configs.value.push(updated)
  } finally {
    saving.value = false
  }
}

/** 大屏页面挂在根路径 /screen/ 下（与后端同源托管） */
function openPreview(): void {
  window.open('/screen/', '_blank')
}

onMounted(() => {
  void load()
  // /dicts 需要 dict:view 权限；院领导等只读角色没有该权限，此处降级为不加载疾病选项
  if (store.hasPerm(PERM.DICT_VIEW)) {
    void listDicts('disease').then((list) => {
      diseases.value = list
    })
  }
})
</script>

<template>
  <div class="page" v-loading="loading">
    <div class="page-header">
      <div>
        <h2 class="page-title">大屏配置</h2>
        <div class="page-subtitle">标题、刷新与滚动参数保存后由大屏端按时拉取生效</div>
      </div>
      <div class="gap-8">
        <el-button :icon="Monitor" @click="openPreview">打开大屏预览</el-button>
        <el-button v-if="store.hasPerm(PERM.SCREEN_CONFIG_UPDATE)" type="primary" :loading="saving" @click="save">
          保存配置
        </el-button>
      </div>
    </div>

    <div class="card-block">
      <h3 class="block-title">基础信息</h3>
      <el-form label-width="140px" style="max-width: 720px">
        <el-form-item label="大屏标识">
          <el-select v-model="form.screenCode" style="width: 240px" @change="handleScreenChange">
            <el-option v-for="item in configs" :key="item.screenCode" :label="item.screenCode" :value="item.screenCode" />
            <el-option v-if="configs.length === 0" label="main" value="main" />
          </el-select>
          <span class="text-sub" style="margin-left: 8px">对应 /screen/ 的 screenCode</span>
        </el-form-item>
        <el-form-item label="医院名称">
          <el-input v-model="form.hospitalName" maxlength="40" placeholder="如 示例市第二人民医院" />
        </el-form-item>
        <el-form-item label="系统名称">
          <el-input v-model="form.systemName" maxlength="20" placeholder="如 动态速览" />
        </el-form-item>
        <el-form-item label="主题">
          <el-select v-model="form.theme" style="width: 240px">
            <el-option v-for="item in THEME_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
      </el-form>
    </div>

    <div class="card-block">
      <h3 class="block-title">刷新与展示</h3>
      <el-form label-width="140px" style="max-width: 720px">
        <el-form-item label="轮询兜底间隔">
          <el-input-number v-model="form.refreshInterval" :min="5" :max="600" controls-position="right" />
          <span class="text-sub" style="margin-left: 8px">秒（SSE 不可用时按此间隔刷新）</span>
        </el-form-item>
        <el-form-item label="表格滚动速度">
          <el-input-number v-model="form.scrollSpeed" :min="10" :max="200" controls-position="right" />
          <span class="text-sub" style="margin-left: 8px">px/s</span>
        </el-form-item>
        <el-form-item label="表格可见行数">
          <el-input-number v-model="form.visibleRows" :min="3" :max="20" controls-position="right" />
        </el-form-item>
        <el-form-item label="患者姓名脱敏">
          <el-switch v-model="form.maskEnabled" />
          <span class="text-sub" style="margin-left: 8px">关闭仅对授权账号生效</span>
        </el-form-item>
        <el-form-item label="饼图聚焦疾病">
          <el-select v-model="form.pieDiseaseCode" clearable placeholder="全部疾病" style="width: 240px">
            <el-option v-for="item in diseases" :key="item.code" :label="item.name" :value="item.code" />
          </el-select>
        </el-form-item>
        <el-form-item label="12 个月柱状口径">
          <el-radio-group v-model="form.monthBarMode">
            <el-radio-button value="CREATED_AT">按创建时间</el-radio-button>
            <el-radio-button value="ARRIVE_AT">按到院时间</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item>
          <el-alert
            type="info"
            :closable="false"
            show-icon
            title="保存后提示「大屏将在下个刷新周期生效」，大屏端无需重启"
          />
        </el-form-item>
        <el-form-item>
          <el-button v-if="store.hasPerm(PERM.SCREEN_CONFIG_UPDATE)" type="primary" :loading="saving" :icon="Refresh" @click="save">
            保存配置
          </el-button>
          <el-button @click="load">重新载入</el-button>
        </el-form-item>
      </el-form>
    </div>
  </div>
</template>
