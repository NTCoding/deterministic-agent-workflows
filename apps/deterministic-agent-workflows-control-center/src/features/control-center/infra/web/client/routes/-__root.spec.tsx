import {
  describe, it, expect 
} from 'vitest'
import {
  render, screen 
} from '@testing-library/react'
import { RootLayout } from './-root-layout'

describe('RootLayout', () => {
  it('renders a skip-link that targets the main content region', () => {
    render(<RootLayout><p>child</p></RootLayout>)

    const skipLink = screen.getByRole('link', { name: /skip to main content/i })
    expect(skipLink).toHaveAttribute('href', '#main-content')
  })

  it('renders a main landmark with id main-content', () => {
    render(<RootLayout><p>child</p></RootLayout>)

    const main = screen.getByRole('main')
    expect(main).toHaveAttribute('id', 'main-content')
  })

  it('renders a navigation landmark with Sessions and Analytics links', () => {
    render(<RootLayout><p>child</p></RootLayout>)

    const nav = screen.getByRole('navigation', { name: /primary/i })
    const sessionsLink = screen.getByRole('link', { name: 'Sessions' })
    const analyticsLink = screen.getByRole('link', { name: 'Analytics' })
    expect(nav).toContainElement(sessionsLink)
    expect(nav).toContainElement(analyticsLink)
  })

  it('renders children inside the main region', () => {
    render(<RootLayout><p>child content</p></RootLayout>)

    const main = screen.getByRole('main')
    expect(main).toHaveTextContent('child content')
  })
})
