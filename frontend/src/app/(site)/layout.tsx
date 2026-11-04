import { SiteChrome } from '@/components/site/SiteChrome'

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <SiteChrome>{children}</SiteChrome>
}
