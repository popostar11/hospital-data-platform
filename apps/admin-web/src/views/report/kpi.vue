<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { formatDate, formatMinutes, formatNumber } from '@hospital/shared'
import type { KpiResult } from '@hospital/shared'
import { kpi } from '@/api/reports'

function defaultRange(): [string, string] {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - 29)
  return [formatDate(from, 'YYYY-MM-DD'), formatDate(to, 'YYYY-MM-DD')]
}

const dateRange = ref<[string, string] | null>(defaultRange())
const loading = ref(false)
const result = ref<KpiResult | null>(null)

const byDisease = computed(() => result.value?.byDisease ?? [])

/** 百分比展示：兼容 0~1 与 0~100 两种口径 */
function formatRate(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return n <= 1 ? `${(n * 100).toFixed(1)}%` : `${n.toFixed(1)}%`
}

async function load(): Promise<void> {
  loading.value = true
  try {
    result.value = await kpi(dateRange.value?.[0], dateRange.value?.[1])
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
        <h2 class="page-title">质控 KPI</h2>
        <div class="page-subtitle">急救绿道关键时效指标与病种分组对比</div>
      </div>
      <el-button :icon="Search" @click="load">刷新</el-button>
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
        <el-form-item>
          <el-button type="primary" :icon="Search" @click="load">查询</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="stat-grid">
      <div class="stat-card is-blue">
        <div class="stat-label">平均响应时长</div>
        <div class="stat-value" style="font-size: 22px">{{ formatMinutes(result?.avgResponseMinutes ?? null) }}</div>
        <div class="stat-extra">呼救 → 到院</div>
      </div>
      <div class="stat-card is-blue">
        <div class="stat-label">平均分诊时长</div>
        <div class="stat-value" style="font-size: 22px">{{ formatMinutes(result?.avgTriageMinutes ?? null) }}</div>
        <div class="stat-extra">到院 → 预检分诊</div>
      </div>
      <div class="stat-card is-orange">
        <div class="stat-label">平均 DNT</div>
        <div class="stat-value" style="font-size: 22px">{{ formatMinutes(result?.avgDntMinutes ?? null) }}</div>
        <div class="stat-extra">入院 → 溶栓/介入</div>
      </div>
      <div class="stat-card is-green">
        <div class="stat-label">闭环率</div>
        <div class="stat-value">{{ formatRate(result?.closedRate) }}</div>
        <div class="stat-extra">已闭环占比</div>
      </div>
      <div class="stat-card is-red">
        <div class="stat-label">超时率</div>
        <div class="stat-value">{{ formatRate(result?.overtimeRate) }}</div>
        <div class="stat-extra">节点超时占比</div>
      </div>
    </div>

    <div class="card-block">
      <h3 class="block-title">
        按疾病分组的平均响应时长
        <span v-if="result" class="text-sub" style="font-size: 12px; font-weight: 400">
          （{{ result.from }} ~ {{ result.to }}，共 {{ formatNumber(byDisease.length) }} 个病种）
        </span>
      </h3>
      <el-table :data="byDisease" border stripe size="small">
        <el-table-column prop="diseaseName" label="疾病" min-width="160" />
        <el-table-column prop="diseaseCode" label="疾病编码" width="160" />
        <el-table-column prop="total" label="病例数" width="120" align="right" />
        <el-table-column label="平均响应时长" width="160" align="right">
          <template #default="{ row }">
            <span :class="{ 'text-danger': row.avgResponseMinutes !== null && row.avgResponseMinutes > 60 }">
              {{ formatMinutes(row.avgResponseMinutes) }}
            </span>
          </template>
        </el-table-column>
        <template #empty>暂无统计数据</template>
      </el-table>
    </div>
  </div>
</template>
