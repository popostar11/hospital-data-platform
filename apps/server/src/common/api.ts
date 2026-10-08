import { DatabaseSync } from 'node:sqlite'
import { ERROR_CODE, ERROR_MESSAGES } from '@hospital/shared'
import type { ApiResponse } from '@hospital/shared'
import type { ArgumentsHost, CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import { Catch, ExceptionFilter, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common'
import type { Request, Response } from 'express'
import { randomBytes } from 'node:crypto'
import { map, type Observable } from 'rxjs'

/** 业务异常：只带 code，文案由 ERROR_MESSAGES 兜底、前端 i18n 覆盖 */
export class ApiException extends Error {
  constructor(
    readonly code: number,
    message?: string,
    readonly detail?: unknown,
  ) {
    super(message ?? ERROR_MESSAGES[code] ?? 'error')
  }

  static notFound(what = '数据') {
    return new ApiException(ERROR_CODE.NOT_FOUND, `${what}不存在或已被删除`)
  }
  static forbidden(detail?: string) {
    return new ApiException(ERROR_CODE.FORBIDDEN, detail)
  }
  static param(detail?: string) {
    return new ApiException(ERROR_CODE.PARAM_INVALID, detail)
  }
  static conflict(detail?: string) {
    return new ApiException(ERROR_CODE.CONFLICT, detail)
  }
}

export function newTraceId(): string {
  return randomBytes(8).toString('hex')
}

export interface RequestWithUser extends Request {
  user?: { id: number; username: string; realName: string; deptId: number | null; roles: string[]; perms: string[] }
  traceId?: string
}

/** 统一响应包装：{ code, message, data, traceId } */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<RequestWithUser>()
    const traceId = req.traceId ?? newTraceId()
    return next.handle().pipe(
      map((data) => {
        // 大屏 SSE 等非 JSON 响应直接透传
        const res = context.switchToHttp().getResponse<Response>()
        if (res.getHeader('x-raw-response')) return data
        const body: ApiResponse<unknown> = { code: ERROR_CODE.OK, message: 'ok', data: data ?? null, traceId }
        return body
      }),
    )
  }
}

/** 异常统一出口 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception')

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const res = ctx.getResponse<Response>()
    const req = ctx.getRequest<RequestWithUser>()
    const traceId = req.traceId ?? newTraceId()

    let httpStatus = HttpStatus.OK // 业务错误统一 200，用 code 区分（方案 §6.1）
    let code: number = ERROR_CODE.INTERNAL_ERROR
    let message: string = ERROR_MESSAGES[ERROR_CODE.INTERNAL_ERROR]!

    if (exception instanceof ApiException) {
      code = exception.code
      message = exception.message
    } else if (exception instanceof HttpException) {
      const status = exception.getStatus()
      httpStatus = status === HttpStatus.UNAUTHORIZED ? HttpStatus.OK : status
      code =
        status === HttpStatus.UNAUTHORIZED
          ? ERROR_CODE.UNAUTHORIZED
          : status === HttpStatus.FORBIDDEN
            ? ERROR_CODE.FORBIDDEN
            : status === HttpStatus.NOT_FOUND
              ? ERROR_CODE.NOT_FOUND
              : status === HttpStatus.TOO_MANY_REQUESTS
                ? ERROR_CODE.TOO_MANY_REQUESTS
                : status === HttpStatus.BAD_REQUEST
                  ? ERROR_CODE.PARAM_INVALID
                  : ERROR_CODE.INTERNAL_ERROR
      const resp = exception.getResponse()
      message =
        typeof resp === 'string'
          ? resp
          : ((resp as { message?: string | string[] }).message as string) || exception.message
      if (Array.isArray(message)) message = message.join('；')
    } else {
      const err = exception as Error
      this.logger.error(`${req.method} ${req.url} :: ${err?.message}`, err?.stack)
    }

    if (httpStatus === HttpStatus.OK || httpStatus === HttpStatus.BAD_REQUEST) {
      res.status(200).json({ code, message, data: null, traceId })
      return
    }
    res.status(httpStatus).json({ code, message, data: null, traceId })
  }
}

/** 常用分页参数归一化 */
export function paging(query: { page?: unknown; pageSize?: unknown }): { page: number; pageSize: number; offset: number } {
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 20))
  return { page, pageSize, offset: (page - 1) * pageSize }
}

/**
 * 排序白名单。
 *
 * 入参形如 `created_at:desc`；`allowed` 是「对外字段名 → 带表别名的 SQL 表达式」映射。
 * 必须带别名：多表 JOIN 后同名列（如 patient.created_at 与 case.created_at）会导致
 * SQLite 报 ambiguous column name。
 */
export function orderBy(sort: unknown, allowed: Record<string, string>, fallback: string): string {
  const raw = String(sort ?? '')
  const [field, dir] = raw.split(':')
  const expr = field ? allowed[field] : undefined
  if (!expr) return fallback
  const direction = String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC'
  return `${expr} ${direction}`
}

export { DatabaseSync }
