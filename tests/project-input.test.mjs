import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectInput, readableError } from '../src/lib/project-input.ts';

test('project names are trimmed and empty optional fields remain NULL', () => {
  assert.deepEqual(projectInput('  月度复盘  ', ' ', ''), { name: '月度复盘', brand_name: null, description: null });
});
test('blank names and oversized fields are rejected before a database write', () => {
  assert.throws(() => projectInput('  ', '', ''), /项目名称/);
  assert.throws(() => projectInput('a'.repeat(201), '', ''), /项目名称/);
  assert.throws(() => projectInput('valid', 'a'.repeat(121), ''), /品牌名称/);
  assert.throws(() => projectInput('valid', '', 'a'.repeat(2001)), /项目说明/);
});
test('login errors do not reveal whether an account exists', () => {
  assert.equal(readableError({ code: 'invalid_credentials', message: 'internal' }), '邮箱或密码不正确，请重新输入。');
});
test('permission and unconfirmed-email errors explain the next step', () => {
  assert.match(readableError({ code: '42501' }), /没有.*权限/);
  assert.match(readableError({ code: 'email_not_confirmed' }), /邮箱.*确认/);
});
