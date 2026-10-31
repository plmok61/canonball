// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { renderChatMarkdown } from './chatMarkdown'

afterEach(cleanup)

function show(text: string): HTMLElement {
  return render(<div data-testid="md">{renderChatMarkdown(text)}</div>).getByTestId('md')
}

it('renders paragraphs, headings, lists and emphasis without raw syntax', () => {
  const el = show('# Ideas\n\n- **one**\n- _two_\n\nUse `x`.')
  const heading = el.querySelector('h3, h4, h5, h6')
  expect(heading).toHaveTextContent('Ideas')
  expect(el.querySelector('h1, h2')).toBeNull()
  expect(el.querySelectorAll('li')).toHaveLength(2)
  expect(el.querySelector('strong')).toHaveTextContent('one')
  expect(el.querySelector('em')).toHaveTextContent('two')
  expect(el.querySelector('code')).toHaveTextContent('x')
  expect(el.querySelector('p')).toHaveTextContent('Use x.')
  const text = el.textContent ?? ''
  expect(text).not.toContain('**')
  expect(text).not.toContain('#')
  expect(text).not.toContain('`')
})

it('renders ordered lists, asterisk italics and line breaks', () => {
  const el = show('1. first\n2. *second*\n\nline one\nline two')
  expect(el.querySelector('ol')).not.toBeNull()
  expect(el.querySelectorAll('ol > li')).toHaveLength(2)
  expect(el.querySelector('em')).toHaveTextContent('second')
  expect(el.querySelector('p br')).not.toBeNull()
})

it('leaves underscores inside words alone', () => {
  const el = show('a snake_case_name here')
  expect(el.querySelector('em')).toBeNull()
  expect(el).toHaveTextContent('a snake_case_name here')
})

it('never injects HTML', () => {
  const el = show('<img src=x onerror=alert(1)>')
  expect(el.querySelector('img')).toBeNull()
  expect(el).toHaveTextContent('<img src=x onerror=alert(1)>')
})
