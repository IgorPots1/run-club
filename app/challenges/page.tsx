import InnerPageHeader from '@/components/InnerPageHeader'
import ChallengesSection from '@/components/ChallengesSection'

export default function ChallengesPage() {
  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-xl px-4 pt-4 md:p-4">
        <InnerPageHeader title="Челленджи" fallbackHref="/club" sticky />
      </div>
      <ChallengesSection showTitle={false} />
    </main>
  )
}