import { expect, it } from 'vitest'
import { isSafeExternalUrl } from './navigation'

it('allows only http, https and mailto links out to the system', () => {
  expect(isSafeExternalUrl('https://example.com/a?b=c')).toBe(true)
  expect(isSafeExternalUrl('http://example.com')).toBe(true)
  expect(isSafeExternalUrl('mailto:someone@example.com')).toBe(true)
  expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false)
  expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
  expect(isSafeExternalUrl('smb://server/share')).toBe(false)
  expect(isSafeExternalUrl('/Users/me/chapter.md')).toBe(false)
  expect(isSafeExternalUrl('not a url')).toBe(false)
})
