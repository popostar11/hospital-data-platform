import type { DepartmentNode } from '@hospital/shared'

/**
 * 科室树归一化：后端不同接口返回形态不同
 *   - /departments     → 已嵌套的树
 *   - /cases/meta      → 扁平列表（id/parentId，无 children）
 * 这里统一成树，已是树则原样返回，便于 el-tree-select 复用。
 */
export function buildDeptTree(list: DepartmentNode[]): DepartmentNode[] {
  if (!list || list.length === 0) return []
  if (list.some((item) => item.children && item.children.length > 0)) return list

  const nodes = new Map<number, DepartmentNode>()
  for (const item of list) nodes.set(item.id, { ...item, children: [] })

  const roots: DepartmentNode[] = []
  for (const item of list) {
    const node = nodes.get(item.id)
    if (!node) continue
    const parent = item.parentId === null ? undefined : nodes.get(item.parentId)
    if (parent && parent.id !== node.id) parent.children?.push(node)
    else roots.push(node)
  }
  return roots
}
