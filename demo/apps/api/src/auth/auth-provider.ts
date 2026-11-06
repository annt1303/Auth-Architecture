// Interface chung cho mọi IdP (SPEC §5.1). Phần còn lại của app chỉ thấy IdpIdentity,
// nên đổi dev-mock sang OIDC thật không ảnh hưởng tới phân quyền.
export const AUTH_PROVIDER = Symbol('AUTH_PROVIDER');

export type IdpIdentity = {
  provider: string;
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
};

// Giá trị ngẫu nhiên của một lần đăng nhập. codeChallenge là S256 của codeVerifier (PKCE, RFC 7636);
// dev-mock bỏ qua, OIDC thật bắt buộc.
export type LoginStart = { state: string; nonce: string; codeChallenge: string };

export interface AuthProvider {
  readonly name: string;
  startLogin(start: LoginStart): URL | Promise<URL>;
  /** Đổi code lấy danh tính. Trả null nếu code sai, hết hạn, đã dùng hoặc token không hợp lệ. */
  handleCallback(params: { code?: string; nonce: string; codeVerifier: string }): Promise<IdpIdentity | null>;
}
