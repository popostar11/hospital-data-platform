/**
 * 交互式暂停：双击运行时（stdin 是终端）在退出前等一次回车，
 * 这样窗口不会一闪而过；被脚本/CI 调用时（stdin 被重定向）自动跳过。
 *
 * 之所以放在 Node 而不是批处理里：cmd.exe 按当前代码页解析 .bat，
 * 中文提示会让整个批处理解析失败，所以 .bat 必须保持纯 ASCII。
 */
import { readSync } from 'node:fs'

export function pauseIfInteractive(message = '按回车键关闭本窗口...') {
  if (process.env.NO_PAUSE) return
  // 只在真正的终端里暂停；管道/重定向场景直接跳过，避免卡住自动化流程
  if (!process.stdin.isTTY) return
  try {
    process.stdout.write(`\n  ${message}`)
    const buf = Buffer.alloc(1)
    readSync(0, buf, 0, 1, null)
    process.stdout.write('\n')
  } catch {
    /* 读不到输入就算了，不能因为暂停失败而卡住退出 */
  }
}
