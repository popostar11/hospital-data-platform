import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { config } from '../../config'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'

@Module({
  imports: [
    // global: true —— 让全局 AuthGuard 能直接注入 JwtService
    JwtModule.register({
      global: true,
      secret: config.jwtSecret,
      signOptions: { expiresIn: config.jwtExpiresIn },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
