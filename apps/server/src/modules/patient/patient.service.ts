import { Injectable } from '@nestjs/common'
import {
  calcAge,
  formatDate,
  genderLabel,
  maskIdCard,
  maskName,
  maskPhone,
  type GenderCode,
  type PageQuery,
  type Paginated,
  type PatientDetail,
  type PatientListItem,
  type PatientPlain,
  type PatientSaveRequest,
} from '@hospital/shared'
import { InjectDb } from '../../db/db.module'
import { now, type Db, type SqlValue } from '../../db/sqlite'
import { ApiException, orderBy, paging } from '../../common/api'
import { decrypt, encrypt } from '../../common/crypto'
import { optionalDay, optionalString, requiredNumber, requiredString } from '../../common/validate'

interface PatientRow {
  id: number
  mrn: string | null
  nameMasked: string
  gender: number
  birthDate: string | null
  idCardMasked: string | null
  phoneMasked: string | null
  remark: string | null
  visitCount: number
  createdAt: string
}

/**
 * 患者服务。
 * 铁律：姓名/身份证/手机号 只以密文入库；对外只输出脱敏字段；
 * 明文读取单独授权并逐次写审计日志。
 */
@Injectable()
export class PatientService {
  constructor(@InjectDb() private readonly db: Db) {}

  /** 排序白名单：对外字段名 → 带别名的 SQL 表达式 */
  static readonly SORTABLE: Record<string, string> = {
    created_at: 'p.created_at',
    id: 'p.id',
    name_masked: 'p.name_masked',
  }

  page(query: PageQuery & { keyword?: string }): Paginated<PatientListItem> {
    const { page, pageSize, offset } = paging(query)
    const where: string[] = ['p.deleted_at IS NULL']
    const params: SqlValue[] = []
    if (query.keyword) {
      // 支持脱敏姓名、病案号检索；明文检索需通过专用接口
      where.push('(p.name_masked LIKE ? OR p.mrn LIKE ?)')
      params.push(`%${query.keyword}%`, `%${query.keyword}%`)
    }
    const clause = where.join(' AND ')
    const total =
      this.db.scalar<number>(`SELECT COUNT(*) FROM patient p WHERE ${clause}`, params) ?? 0
    const order = orderBy(query.sort, PatientService.SORTABLE, 'p.created_at DESC')
    const rows = this.db.all<PatientRow>(
      `SELECT p.id, p.mrn, p.name_masked AS nameMasked, p.gender, p.birth_date AS birthDate,
              p.id_card_masked AS idCardMasked, p.phone_masked AS phoneMasked, p.remark,
              p.created_at AS createdAt,
              (SELECT COUNT(*) FROM green_channel_case c WHERE c.patient_id = p.id AND c.deleted_at IS NULL) AS visitCount
         FROM patient p WHERE ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    )
    return { list: rows.map(toListItem), total, page, pageSize }
  }

  /** 病例表单的远程搜索 */
  search(keyword: string, limit = 20): PatientListItem[] {
    const kw = (keyword ?? '').trim()
    const params: SqlValue[] = []
    let clause = 'p.deleted_at IS NULL'
    if (kw) {
      clause += ' AND (p.name_masked LIKE ? OR p.mrn LIKE ?)'
      params.push(`%${kw}%`, `%${kw}%`)
    }
    const rows = this.db.all<PatientRow>(
      `SELECT p.id, p.mrn, p.name_masked AS nameMasked, p.gender, p.birth_date AS birthDate,
              p.id_card_masked AS idCardMasked, p.phone_masked AS phoneMasked, p.remark, p.created_at AS createdAt, 0 AS visitCount
         FROM patient p WHERE ${clause} ORDER BY p.id DESC LIMIT ?`,
      [...params, Math.min(50, limit)],
    )
    return rows.map(toListItem)
  }

  detail(id: number): PatientDetail {
    const row = this.db.get<PatientRow>(
      `SELECT p.id, p.mrn, p.name_masked AS nameMasked, p.gender, p.birth_date AS birthDate,
              p.id_card_masked AS idCardMasked, p.phone_masked AS phoneMasked, p.remark, p.created_at AS createdAt,
              (SELECT COUNT(*) FROM green_channel_case c WHERE c.patient_id = p.id AND c.deleted_at IS NULL) AS visitCount
         FROM patient p WHERE p.id = ? AND p.deleted_at IS NULL`,
      [id],
    )
    if (!row) throw ApiException.notFound('患者')
    return { ...toListItem(row), birthDate: row.birthDate, remark: row.remark }
  }

  /** 明文查看：需 patient:plain 权限，调用方负责写审计日志 */
  plain(id: number): PatientPlain {
    const row = this.db.get<{ id: number; nameCipher: string; idCardCipher: string | null; phoneCipher: string | null }>(
      'SELECT id, name_cipher AS nameCipher, id_card_cipher AS idCardCipher, phone_cipher AS phoneCipher FROM patient WHERE id = ? AND deleted_at IS NULL',
      [id],
    )
    if (!row) throw ApiException.notFound('患者')
    return { id: row.id, name: decrypt(row.nameCipher) ?? '—', idCard: decrypt(row.idCardCipher), phone: decrypt(row.phoneCipher) }
  }

  create(body: PatientSaveRequest): number {
    const name = requiredString(body.name, '姓名', 32)
    const gender = requiredNumber(body.gender, '性别', 1, 9) as GenderCode
    const mrn = optionalString(body.mrn, '病案号', 32)
    if (mrn) {
      const dup = this.db.get<{ id: number }>('SELECT id FROM patient WHERE mrn = ? AND deleted_at IS NULL', [mrn])
      if (dup) throw ApiException.conflict(`病案号 ${mrn} 已存在`)
    }
    const idCard = optionalString(body.idCard, '身份证号', 32)
    const phone = optionalString(body.phone, '手机号', 32)
    const ts = now()
    return this.db.insert('patient', {
      mrn,
      name_cipher: encrypt(name)!,
      name_masked: maskName(name),
      gender,
      birth_date: optionalDay(body.birthDate, '出生日期'),
      id_card_cipher: encrypt(idCard),
      id_card_masked: maskIdCard(idCard),
      phone_cipher: encrypt(phone),
      phone_masked: maskPhone(phone),
      remark: optionalString(body.remark, '备注', 200),
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    })
  }

  update(id: number, body: PatientSaveRequest): void {
    const exists = this.db.get<{ id: number }>('SELECT id FROM patient WHERE id = ? AND deleted_at IS NULL', [id])
    if (!exists) throw ApiException.notFound('患者')
    const data: Record<string, SqlValue> = { updated_at: now() }
    if (body.name !== undefined) {
      const name = requiredString(body.name, '姓名', 32)
      data.name_cipher = encrypt(name)
      data.name_masked = maskName(name)
    }
    if (body.gender !== undefined) data.gender = requiredNumber(body.gender, '性别', 1, 9)
    if (body.birthDate !== undefined) data.birth_date = optionalDay(body.birthDate, '出生日期')
    if (body.mrn !== undefined) data.mrn = optionalString(body.mrn, '病案号', 32)
    if (body.idCard !== undefined) {
      const idCard = optionalString(body.idCard, '身份证号', 32)
      data.id_card_cipher = encrypt(idCard)
      data.id_card_masked = maskIdCard(idCard)
    }
    if (body.phone !== undefined) {
      const phone = optionalString(body.phone, '手机号', 32)
      data.phone_cipher = encrypt(phone)
      data.phone_masked = maskPhone(phone)
    }
    if (body.remark !== undefined) data.remark = optionalString(body.remark, '备注', 200)
    this.db.update('patient', id, data)
  }

  /** 供病例模块使用：存在即返回，否则新建 */
  ensurePatient(body: PatientSaveRequest): number {
    return this.create(body)
  }

  exists(id: number): boolean {
    return !!this.db.get('SELECT id FROM patient WHERE id = ? AND deleted_at IS NULL', [id])
  }

  remove(id: number): void {
    const used = this.db.scalar<number>('SELECT COUNT(*) FROM green_channel_case WHERE patient_id = ? AND deleted_at IS NULL', [id]) ?? 0
    if (used > 0) throw ApiException.conflict(`该患者已关联 ${used} 条绿道病例，无法删除`)
    this.db.update('patient', id, { deleted_at: now() })
  }
}

function toListItem(row: PatientRow): PatientListItem {
  return {
    id: row.id,
    mrn: row.mrn,
    nameMasked: row.nameMasked,
    gender: row.gender as GenderCode,
    genderName: genderLabel(row.gender),
    age: calcAge(row.birthDate),
    phoneMasked: row.phoneMasked,
    idCardMasked: row.idCardMasked,
    visitCount: row.visitCount ?? 0,
    createdAt: formatDate(row.createdAt),
  }
}
