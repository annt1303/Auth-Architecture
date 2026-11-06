import { Body, Controller, Get, Header, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { ApiError, parseInput } from '../../common/api-error.js';
import { Public } from '../../authz/decorators.js';
import { DevMockIdp } from './dev-mock-idp.service.js';

const AuthorizeQuery = z.object({
  response_type: z.literal('code'),
  redirect_uri: z.string(),
  state: z.string().min(16),
  nonce: z.string().min(16),
});

const AuthorizeForm = z.object({
  sub: z.string().min(1),
  redirect_uri: z.string(),
  state: z.string().min(16),
  nonce: z.string().min(16),
});

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// Cùng màu và kiểu chữ với app (Clean, Chàm); không dùng chung file vì đây là phía IdP.
const IDP_CSS = `
*{box-sizing:border-box}
body{margin:0;background:#f4f4f6;color:#2c2c2c;font:16px/1.5 Inter,ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:32rem;margin:0 auto;padding:2.5rem 1rem}
h1{margin:0;font-size:1.25rem;font-weight:600}
.note{margin:.5rem 0 1.5rem;font-size:.875rem;color:#707070}
ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.5rem}
button{display:flex;width:100%;align-items:center;gap:.75rem;min-height:3.5rem;padding:.5rem 1rem;border:1px solid #eaeaea;border-radius:1rem;background:#fff;font:inherit;color:inherit;text-align:left;cursor:pointer;transition:background-color .15s}
button:hover{background:#f8f8fa}
button:focus-visible{outline:none;border-color:#4f46e5;box-shadow:0 0 0 3px rgb(79 70 229/.15)}
.avatar{display:inline-flex;flex:none;width:2rem;height:2rem;align-items:center;justify-content:center;border-radius:50%;background:#eef2ff;color:#4338ca;font-size:.75rem;font-weight:600}
.who{display:flex;min-width:0;flex:1;flex-direction:column}
.name,.email{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.name{font-size:.875rem;font-weight:500}
.email{font-size:.75rem;color:#707070}
.tag{flex:none;border-radius:9999px;background:#fffbeb;color:#b45309;padding:.125rem .625rem;font-size:.75rem;font-weight:500}
`;

// Phía "IdP" của dev-mock. Chỉ được nạp khi AUTH_PROVIDER=dev-mock (AuthModule.register).
@Controller('dev-mock-idp')
export class DevMockIdpController {
  constructor(private readonly idp: DevMockIdp) {}

  @Get('authorize')
  @Public()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  authorize(@Query() query: unknown): string {
    const q = parseInput(AuthorizeQuery, query);
    if (!this.idp.isAllowedRedirect(q.redirect_uri)) throw new ApiError('invalid_request');
    const hidden = (name: string, value: string) =>
      `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
    const rows = this.idp.identities
      .map(
        (i) => `<li><form method="post" action="/dev-mock-idp/authorize">
          ${hidden('sub', i.sub)}${hidden('redirect_uri', q.redirect_uri)}${hidden('state', q.state)}${hidden('nonce', q.nonce)}
          <button type="submit">
            <span class="avatar" aria-hidden="true">${escapeHtml(i.name.trim().charAt(0).toLocaleUpperCase('vi'))}</span>
            <span class="who"><span class="name">${escapeHtml(i.name)}</span><span class="email">${escapeHtml(i.email)}</span></span>
            ${i.email_verified ? '' : '<span class="tag">Email chưa xác minh</span>'}
          </button>
        </form></li>`,
      )
      .join('');
    return `<!doctype html><html lang="vi"><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Chọn danh tính · IdP giả lập</title><style>${IDP_CSS}</style></head>
      <body><main>
        <h1>Chọn danh tính để đăng nhập</h1>
        <p class="note">IdP giả lập (dev-mock), chỉ dùng khi phát triển. Mọi danh tính đều là dữ liệu giả.</p>
        <ul>${rows}</ul>
      </main></body></html>`;
  }

  @Post('authorize')
  @Public()
  select(@Body() body: unknown, @Res() res: Response): void {
    const form = parseInput(AuthorizeForm, body);
    const code = this.idp.issueCode(form.sub, form.nonce, form.redirect_uri);
    if (!code) throw new ApiError('invalid_request');
    const target = new URL(form.redirect_uri);
    target.searchParams.set('code', code);
    target.searchParams.set('state', form.state);
    res.redirect(302, target.toString());
  }
}
