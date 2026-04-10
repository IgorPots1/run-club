import InnerPageHeader from '@/components/InnerPageHeader'
import ChallengesSection from '@/components/ChallengesSection'

export default function ChallengesPage() {
  return (
    <main className="min-h-screen">
      <div className="pointer-events-none fixed inset-x-0 top-0 z-30">
        <div className="pointer-events-auto mx-auto max-w-xl px-4 md:px-4">
          <InnerPageHeader title="Челленджи" fallbackHref="/club" />
        </div>
      </div>
      <div className="pb-4 pt-4 md:p-4">
        <div className="mx-auto max-w-xl px-4 md:px-4">
          <div aria-hidden="true" className="invisible">
            <InnerPageHeader title="Челленджи" fallbackHref="/club" />
          </div>
        </div>
        <ChallengesSection showTitle={false} />
      </div>
    </main>
  )
}