export function projectInput(name: string, brand: string, description: string) {
  const cleanName = name.trim();
  if (!cleanName || cleanName.length > 200) throw new Error('项目名称需填写 1–200 个字符。');
  if (brand.trim().length > 120) throw new Error('品牌名称最多填写 120 个字符。');
  if (description.trim().length > 2000) throw new Error('项目说明最多填写 2000 个字符。');
  return { name: cleanName, brand_name: brand.trim() || null, description: description.trim() || null };
}

export function readableError(error: unknown): string {
  const value = error as { code?: string; message?: string } | null;
  if (value?.code === 'invalid_credentials') return '邮箱或密码不正确，请重新输入。';
  if (value?.code === 'email_not_confirmed') return '请先打开邮箱中的确认邮件，完成确认后再登录。';
  if (value?.code === 'over_email_send_rate_limit' || value?.code === 'over_request_rate_limit') return '请求较频繁，请稍后再试。';
  if (value?.code === '42501') return '当前账号没有这项操作权限，请联系工作空间所有者。';
  if (value?.code === 'signup_disabled') return '当前项目暂未开放注册，请联系管理员。';
  if (value?.code === 'user_already_exists') return '这个邮箱已注册，请直接登录。';
  if (value?.code === 'weak_password') return '请使用更强的密码，至少 8 位，并组合字母和数字。';
  if (value?.message?.toLowerCase().includes('fetch')) return '暂时无法连接服务，请检查网络后重试。';
  return value?.message || '操作未完成，请稍后重试。';
}
