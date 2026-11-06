import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import type { Config } from '../config/config.js';
import { SessionModule } from '../session/session.module.js';
import { AUTH_PROVIDER } from './auth-provider.js';
import { AuthController } from './auth.controller.js';
import { DevMockIdpController } from './dev-mock/dev-mock-idp.controller.js';
import { DevMockIdp } from './dev-mock/dev-mock-idp.service.js';
import { LoginGate } from './login-gate.service.js';
import { OidcAuthProvider } from './oidc/oidc-auth.provider.js';

@Module({})
export class AuthModule {
  // IdP giả lập chỉ được nạp khi AUTH_PROVIDER=dev-mock; loadConfig() đã chặn dev-mock ở production.
  // Với oidc, loadConfig() đã bảo đảm đủ OIDC_*; không có controller IdP nào được mở.
  static register(config: Config): DynamicModule {
    const devMock = config.AUTH_PROVIDER === 'dev-mock';
    const providers: Provider[] = devMock
      ? [DevMockIdp, { provide: AUTH_PROVIDER, useExisting: DevMockIdp }]
      : [
          {
            provide: AUTH_PROVIDER,
            useValue: new OidcAuthProvider({
              issuerUrl: config.OIDC_ISSUER_URL!,
              clientId: config.OIDC_CLIENT_ID!,
              clientSecret: config.OIDC_CLIENT_SECRET!,
              redirectUri: config.OIDC_REDIRECT_URI!,
              scopes: config.OIDC_SCOPES,
            }),
          },
        ];
    return {
      module: AuthModule,
      imports: [SessionModule],
      controllers: devMock ? [AuthController, DevMockIdpController] : [AuthController],
      providers: [LoginGate, ...providers],
    };
  }
}
