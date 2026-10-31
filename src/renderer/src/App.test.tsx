// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import App from './App'

beforeEach(() => {
  ;(window as unknown as { canonball: object }).canonball = {}
})

afterEach(cleanup)

it('renders tree, editor and chat panels', () => {
  render(<App />)
  expect(screen.getByTestId('tree-panel')).toBeInTheDocument()
  expect(screen.getByTestId('editor-panel')).toBeInTheDocument()
  expect(screen.getByTestId('chat-panel')).toHaveTextContent('AI chat arrives in a later phase')
})
