import type { ReactNode } from 'react'

export interface DocSection {
  id: string
  title: string
  body: ReactNode
}

export interface Doc {
  slug: string
  title: string
  lede: string
  sections: DocSection[]
}
