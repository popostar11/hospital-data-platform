import { Injectable, type NestMiddleware } from '@nestjs/common'
import type { NextFunction, Response } from 'express'
import { newTraceId, type RequestWithUser } from './api'

/** 为每个请求生成 traceId，便于日志串联（响应体与异常体都会带上） */
@Injectable()
export class TraceMiddleware implements NestMiddleware {
  use(req: RequestWithUser, res: Response, next: NextFunction): void {
    const traceId = (req.headers['x-trace-id'] as string) || newTraceId()
    req.traceId = traceId
    res.setHeader('X-Trace-Id', traceId)
    next()
  }
}
