/**
 * 构建时注入的版本信息。
 *
 * 通过环境变量 VITE_COMMIT_SHA / APP_VERSION 覆盖。
 * 如果未设置则使用默认值，确保开发模式下也能工作。
 */
import { APP_VERSION as PROTO_APP_VERSION, PROTOCOL_VERSION } from '@vastworld/protocol'

export const COMMIT_SHA = process.env['COMMIT_SHA'] ?? 'dev-local'
export const APP_VERSION = process.env['APP_VERSION'] ?? PROTO_APP_VERSION

export const serverVersionInfo = {
  protocolVersion: PROTOCOL_VERSION,
  appVersion: APP_VERSION,
  commitSha: COMMIT_SHA,
} as const
