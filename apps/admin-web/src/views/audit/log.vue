<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { formatDate } from '@hospital/shared'
import type { AuditLogItem, LoginLogItem } from '@hospital/shared'
import { listAuditLogs, listLoginLogs } from '@/api/audit'

/** 常见模块名（允许手工输入其它模块） */
const MODULE_OPTIONS = ['auth', 'case', 'patient', 'dict', 'org', 'user', 'screen-config', 'report', 'audit']

const activeTab = ref<'operation' | 'login'>('operation')

/* ------------------------------------------------------------ 操作日志 */
const auditLoading = ref(false)
const auditRows = ref<AuditLogItem[]>([])
const auditTotal = ref(0)
const auditPage = ref(1)
const auditPageSize = ref(20)
const auditFilters = reactive<{ keyword: string; module: string; dateRange: [string, string] | null }>({
  keyword: '',
  module: '',
  dateRange: null,
})

async function loadAuditLogs(): Promise<void> {
  auditLoading.value = true
  try {
    const res = await listAuditLogs({
      page: auditPage.value,
      pageSize: auditPageSize.value,
      keyword: auditFilters.keyword.trim() || undefined,
      module: auditFilters.module || undefined,
      from: auditFilters.dateRange?.[0],
      to: auditFilters.dateRange?.[1],
    })
    auditRows.value = res.list
    auditTotal.value = res.total
  } finally {
    auditLoading.value = false
  }
}

function searchAuditLogs(): void {
  auditPage.value = 1
  void loadAuditLogs()
}

/* ------------------------------------------------------------ 登录日志 */
const loginLoading = ref(false)
const loginRows = ref<LoginLogItem[]>([])
const loginTotal = ref(0)
const loginPage = ref(1)
const loginPageSize = ref(20)
const loginFilters = reactive<{ keyword: string; success: boolean | null; dateRange: [string, string] | null }>({
  keyword: '',
  success: null,
  dateRange: null,
})

async function loadLoginLogs(): Promise<void> {
  loginLoading.value = true
  try {
    const res = await listLoginLogs({
      page: loginPage.value,
      pageSize: loginPageSize.value,
      keyword: loginFilters.keyword.trim() || undefined,
      success: loginFilters.success ?? undefined,
      from: loginFilters.dateRange?.[0],
      to: loginFilters.dateRange?.[1],
    })
    loginRows.value = res.list
    loginTotal.value = res.total
  } finally {
    loginLoading.value = false
  }
}

function searchLoginLogs(): void {
  loginPage.value = 1
  void loadLoginLogs()
}

function handleTabChange(): void {
  if (activeTab.value === 'operation') void loadAuditLogs()
  else void loadLoginLogs()
}

onMounted(() => {
  void loadAuditLogs()
})
</script>

<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">审计日志</h2>
        <div class="page-subtitle">操作留痕与登录记录，用于安全审计与问题追溯</div>
      </div>
    </div>

    <div class="card-block">
      <el-tabs v-model="activeTab" @tab-change="handleTabChange">
        <el-tab-pane label="操作日志" name="operation">
          <el-form :inline="true" class="filter-bar" @submit.prevent>
            <el-form-item label="关键字">
              <el-input
                v-model="auditFilters.keyword"
                placeholder="操作人 / 动作 / 对象"
                clearable
                style="width: 200px"
                @keyup.enter="searchAuditLogs"
              />
            </el-form-item>
            <el-form-item label="模块">
              <el-select
                v-model="auditFilters.module"
                filterable
                allow-create
                default-first-option
                clearable
                placeholder="全部模块"
                style="width: 160px"
              >
                <el-option v-for="item in MODULE_OPTIONS" :key="item" :label="item" :value="item" />
              </el-select>
            </el-form-item>
            <el-form-item label="时间">
              <el-date-picker
                v-model="auditFilters.dateRange"
                type="daterange"
                value-format="YYYY-MM-DD"
                start-placeholder="开始日期"
                end-placeholder="结束日期"
                unlink-panels
                style="width: 240px"
              />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :icon="Search" @click="searchAuditLogs">查询</el-button>
            </el-form-item>
          </el-form>

          <el-table v-loading="auditLoading" :data="auditRows" border stripe size="small">
            <el-table-column label="时间" width="170">
              <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
            </el-table-column>
            <el-table-column prop="userName" label="操作人" width="120" />
            <el-table-column prop="module" label="模块" width="120" />
            <el-table-column prop="action" label="动作" width="140" />
            <el-table-column label="对象" width="180">
              <template #default="{ row }">
                <span class="text-sub">{{ row.targetType || '—' }} / {{ row.targetId || '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="detail" label="详情" min-width="220" show-overflow-tooltip />
            <el-table-column prop="ip" label="IP" width="140" />
            <template #empty>暂无操作日志</template>
          </el-table>

          <div class="pager">
            <el-pagination
              v-model:current-page="auditPage"
              v-model:page-size="auditPageSize"
              :total="auditTotal"
              :page-sizes="[10, 20, 50, 100]"
              layout="total, sizes, prev, pager, next"
              background
              @current-change="loadAuditLogs"
              @size-change="searchAuditLogs"
            />
          </div>
        </el-tab-pane>

        <el-tab-pane label="登录日志" name="login">
          <el-form :inline="true" class="filter-bar" @submit.prevent>
            <el-form-item label="关键字">
              <el-input
                v-model="loginFilters.keyword"
                placeholder="账号 / IP"
                clearable
                style="width: 200px"
                @keyup.enter="searchLoginLogs"
              />
            </el-form-item>
            <el-form-item label="结果">
              <el-select v-model="loginFilters.success" clearable placeholder="全部" style="width: 120px">
                <el-option label="成功" :value="true" />
                <el-option label="失败" :value="false" />
              </el-select>
            </el-form-item>
            <el-form-item label="时间">
              <el-date-picker
                v-model="loginFilters.dateRange"
                type="daterange"
                value-format="YYYY-MM-DD"
                start-placeholder="开始日期"
                end-placeholder="结束日期"
                unlink-panels
                style="width: 240px"
              />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :icon="Search" @click="searchLoginLogs">查询</el-button>
            </el-form-item>
          </el-form>

          <el-table v-loading="loginLoading" :data="loginRows" border stripe size="small">
            <el-table-column label="时间" width="170">
              <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
            </el-table-column>
            <el-table-column prop="username" label="账号" width="140" />
            <el-table-column label="结果" width="100" align="center">
              <template #default="{ row }">
                <el-tag :type="row.success ? 'success' : 'danger'" size="small">
                  {{ row.success ? '成功' : '失败' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="message" label="说明" min-width="200" show-overflow-tooltip />
            <el-table-column prop="ip" label="IP" width="140" />
            <el-table-column prop="userAgent" label="User-Agent" min-width="220" show-overflow-tooltip />
            <template #empty>暂无登录日志</template>
          </el-table>

          <div class="pager">
            <el-pagination
              v-model:current-page="loginPage"
              v-model:page-size="loginPageSize"
              :total="loginTotal"
              :page-sizes="[10, 20, 50, 100]"
              layout="total, sizes, prev, pager, next"
              background
              @current-change="loadLoginLogs"
              @size-change="searchLoginLogs"
            />
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>
