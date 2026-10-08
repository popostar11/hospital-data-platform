<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { EChartsOption } from 'echarts'
import { ElMessage } from 'element-plus'
import { Download, Search } from '@element-plus/icons-vue'
import { PERM, formatDate, formatMinutes, formatNumber } from '@hospital/shared'
import type { ReportBucket, ReportResult } from '@hospital/shared'
import type { ReportGroupBy } from '@/api/reports'
import { exportReport, greenChannel } from '@/api/reports'
import { useUserStore } from '@/stores/user'
import { parseFileName, saveBlob, stampedFileName } from '@/utils/download'
import { useChart } from '@/utils/echarts'

const store = useUserStore()

const GROUP_OPTIONS: { value: ReportGroupBy; label: string }[] = [
  { value: 'day', label: '按日' },
  { value: 'month', label: '按月' },
  { value: 'dept', label: '按科室' },
  { value: 'disease', label: '按疾病' },
  { value: 'source', label: '按来源' },
]

function defaultRange(): [string, string] {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - 29)
  return [formatDate(from, 'YYYY-MM-DD'), formatDate(to, 'YYYY-MM-DD')]
}

const dateRange = ref<[string, string] | null>(defaultRange())
const groupBy = ref<ReportGroupBy>('day')
const loading = ref(false)
const exporting = ref(false)
const result = ref<ReportResult | null>(null)

const buckets = computed<ReportBucket[]>(() => result.value?.buckets ?? [])

/** 百分比展示：后端返回 0~1 或 0~100 都能正确显示 */
function formatRate(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return n <= 1 ? `${(n * 100).toFixed(1)}%` : `${n.toFixed(1)}%`
}

const chartOption = computed<EChartsOption>(() => {
  const labels = buckets.value.map((item) => item.label)
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['病例总量', '闭环数', '平均响应时长'], top: 0 },
    grid: { left: 52, right: 56, top: 44, bottom: 48 },
    xAxis: { type: 'category', data: labels, axisLabel: { interval: 0, rotate: labels.length > 10 ? 30 : 0 } },
    yAxis: [
      { type: 'value', name: '例', minInterval: 1 },
      { type: 'value', name: '分钟' },
    ],
    series: [
      { name: '病例总量', type: 'bar', barMaxWidth: 32, data: buckets.value.map((item) => item.total), itemStyle: { color: '#3f8bff' } },
      { name: '闭环数', type: 'bar', barMaxWidth: 32, data: buckets.value.map((item) => item.closed), itemStyle: { color: '#22c58b' } },
      {
        name: '平均响应时长',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        data: buckets.value.map((item) => item.avgResponseMinutes),
        itemStyle: { color: '#f5a623' },
      },
    ],
  }
})

const { chartEl } = useChart(chartOption)

async function load(): Promise<void> {
  loading.value = true
  try {
    result.value = await greenChannel({
      from: dateRange.value?.[0],
      to: dateRange.value?.[1],
      groupBy: groupBy.value,
    })
  } finally {
    loading.value = false
  }
}

async function handleExport(): Promise<void> {
  exporting.value = true
  try {
    const res = await exportReport({
      from: dateRange.value?.[0],
      to: dateRange.value?.[1],
      groupBy: groupBy.value,
    })
    const disposition = String(res.headers['content-disposition'] ?? '')
    saveBlob(res.data, parseFileName(disposition, stampedFileName('急救绿道报表')))
    ElMessage.success('导出文件已开始下载')
  } finally {
    exporting.value = false
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
        <h2 class="page-title">绿道报表</h2>
        <div class="page-subtitle">按时间与维度统计病例量、闭环率、平均响应时长与超时率</div>
      </div>
      <el-button
        v-if="store.hasPerm(PERM.REPORT_EXPORT)"
        :icon="Download"
        :loading="exporting"
        @click="handleExport"
      >
        导出 Excel
      </el-button>
    </div>

    <div class="card-block filter-bar">
      <el-form :inline="true" @submit.prevent>
        <el-form-item label="统计日期">
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            unlink-panels
            style="width: 260px"
          />
        </el-form-item>
        <el-form-item label="统计维度">
          <el-radio-group v-model="groupBy">
            <el-radio-button v-for="item in GROUP_OPTIONS" :key="item.value" :value="item.value">
              {{ item.label }}
            </el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :icon="Search" @click="load">查询</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="stat-grid">
      <div class="stat-card is-blue">
        <div class="stat-label">病例总量</div>
        <div class="stat-value">{{ formatNumber(result?.summary.total ?? 0) }}</div>
        <div class="stat-extra">{{ result ? `${result.from} ~ ${result.to}` : '—' }}</div>
      </div>
      <div class="stat-card is-green">
        <div class="stat-label">闭环率</div>
        <div class="stat-value">{{ formatRate(result?.summary.closedRate) }}</div>
        <div class="stat-extra">已闭环 {{ formatNumber(result?.summary.closed ?? 0) }} 例</div>
      </div>
      <div class="stat-card is-orange">
        <div class="stat-label">平均响应时长</div>
        <div class="stat-value" style="font-size: 22px">
          {{ formatMinutes(result?.summary.avgResponseMinutes ?? null) }}
        </div>
        <div class="stat-extra">呼救 → 到院</div>
      </div>
      <div class="stat-card is-red">
        <div class="stat-label">超时率</div>
        <div class="stat-value">{{ formatRate(result?.summary.overtimeRate) }}</div>
        <div class="stat-extra">未闭环 {{ formatNumber(result?.summary.openCount ?? 0) }} 例</div>
      </div>
    </div>

    <div class="card-block">
      <h3 class="block-title">趋势与对比</h3>
      <div ref="chartEl" class="chart-box" />
    </div>

    <div class="card-block">
      <h3 class="block-title">明细数据</h3>
      <el-table :data="buckets" border stripe size="small">
        <el-table-column prop="label" label="分组" min-width="160" />
        <el-table-column prop="total" label="病例总量" width="110" align="right" />
        <el-table-column prop="closed" label="已闭环" width="110" align="right" />
        <el-table-column prop="openCount" label="未闭环" width="110" align="right" />
        <el-table-column label="平均响应时长" width="140" align="right">
          <template #default="{ row }">{{ formatMinutes(row.avgResponseMinutes) }}</template>
        </el-table-column>
        <el-table-column prop="overtimeCount" label="超时节点数" width="120" align="right" />
        <template #empty>暂无统计数据</template>
      </el-table>
    </div>
  </div>
</template>
