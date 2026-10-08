<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { EChartsOption } from 'echarts'
import { formatDate } from '@hospital/shared'
import type { DashboardOverview } from '@hospital/shared'
import { overview as fetchOverview } from '@/api/dashboard'
import ColorTag from '@/components/ColorTag.vue'
import { useChart } from '@/utils/echarts'

const loading = ref(false)
const data = ref<DashboardOverview | null>(null)

const trendOption = computed<EChartsOption>(() => {
  const trend = data.value?.trend ?? []
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['新增病例', '闭环病例'], right: 0 },
    grid: { left: 44, right: 20, top: 44, bottom: 32 },
    xAxis: { type: 'category', boundaryGap: false, data: trend.map((item) => item.label) },
    yAxis: { type: 'value', minInterval: 1 },
    series: [
      {
        name: '新增病例',
        type: 'line',
        smooth: true,
        symbolSize: 6,
        data: trend.map((item) => item.total),
        itemStyle: { color: '#3f8bff' },
        areaStyle: { color: 'rgba(63, 139, 255, 0.14)' },
      },
      {
        name: '闭环病例',
        type: 'line',
        smooth: true,
        symbolSize: 6,
        data: trend.map((item) => item.closed),
        itemStyle: { color: '#22c58b' },
      },
    ],
  }
})

const diseaseOption = computed<EChartsOption>(() => {
  const items = data.value?.byDisease ?? []
  return {
    tooltip: { trigger: 'item', formatter: '{b}：{c} 例（{d}%）' },
    legend: { bottom: 0, type: 'scroll' },
    series: [
      {
        name: '疾病分布',
        type: 'pie',
        radius: ['46%', '68%'],
        center: ['50%', '45%'],
        avoidLabelOverlap: true,
        label: { formatter: '{b} {c}' },
        data: items.map((item) => ({
          name: item.name,
          value: item.total,
          itemStyle: { color: item.color },
        })),
      },
    ],
  }
})

const { chartEl: trendEl } = useChart(trendOption)
const { chartEl: diseaseEl } = useChart(diseaseOption)

/** 与昨日对比：正数表示增加 */
const yesterdayDiff = computed<number>(() => {
  const current = data.value
  if (!current) return 0
  return current.todayTotal - current.yesterdayTotal
})

const yesterdayText = computed<string>(() => {
  const current = data.value
  if (!current) return '—'
  const diff = yesterdayDiff.value
  const sign = diff > 0 ? '+' : ''
  return `昨日 ${current.yesterdayTotal} 例（${sign}${diff}）`
})

async function load(): Promise<void> {
  loading.value = true
  try {
    data.value = await fetchOverview()
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="page" v-loading="loading">
    <div class="page-header">
      <div>
        <h2 class="page-title">工作台</h2>
        <div class="page-subtitle">急救绿道运行概览 · 数据实时来自病例库</div>
      </div>
      <el-button :icon="'Refresh'" @click="load">刷新</el-button>
    </div>

    <div class="stat-grid">
      <div class="stat-card is-blue">
        <div class="stat-label">今日新增</div>
        <div class="stat-value">{{ data?.todayTotal ?? '—' }}</div>
        <div class="stat-extra">{{ yesterdayText }}</div>
      </div>
      <div class="stat-card is-green">
        <div class="stat-label">今日闭环</div>
        <div class="stat-value">{{ data?.todayClosed ?? '—' }}</div>
        <div class="stat-extra">已闭环 / 已作废</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">在绿道中</div>
        <div class="stat-value">{{ data?.openCount ?? '—' }}</div>
        <div class="stat-extra">未闭环病例数</div>
      </div>
      <div class="stat-card is-red">
        <div class="stat-label">超时预警</div>
        <div class="stat-value">{{ data?.overtimeCount ?? '—' }}</div>
        <div class="stat-extra">节点质控时限超出</div>
      </div>
      <div class="stat-card is-orange">
        <div class="stat-label">昨日新增</div>
        <div class="stat-value">{{ data?.yesterdayTotal ?? '—' }}</div>
        <div class="stat-extra">用于环比对照</div>
      </div>
    </div>

    <el-row :gutter="12">
      <el-col :xs="24" :lg="15">
        <div class="card-block">
          <h3 class="block-title">近 7 日趋势</h3>
          <div ref="trendEl" class="chart-box" />
        </div>
      </el-col>
      <el-col :xs="24" :lg="9">
        <div class="card-block">
          <h3 class="block-title">按疾病分布</h3>
          <div ref="diseaseEl" class="chart-box" />
        </div>
      </el-col>
    </el-row>

    <div class="card-block">
      <div class="flex-between mb-12">
        <h3 class="block-title" style="margin-bottom: 0">最新病例</h3>
        <router-link to="/cases">查看全部 →</router-link>
      </div>
      <el-table :data="data?.latest ?? []" size="small" border stripe>
        <el-table-column prop="caseNo" label="绿道号" width="150" />
        <el-table-column label="患者" min-width="120">
          <template #default="{ row }">
            {{ row.patientName }}（{{ row.genderName }}<span v-if="row.age !== null">/{{ row.age }}岁</span>）
          </template>
        </el-table-column>
        <el-table-column label="疾病" width="110">
          <template #default="{ row }">
            <ColorTag :color="row.diseaseColor" :text="row.diseaseName" />
          </template>
        </el-table-column>
        <el-table-column prop="sourceTypeName" label="推送方式" width="110" />
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <ColorTag :color="row.statusColor" :text="row.statusName" />
          </template>
        </el-table-column>
        <el-table-column prop="deptName" label="科室" width="130" />
        <el-table-column label="创建时间" width="160">
          <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
        </el-table-column>
        <template #empty>暂无病例数据</template>
      </el-table>
    </div>
  </div>
</template>
