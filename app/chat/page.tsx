import ChatSection from '@/components/ChatSection'

export default function ChatPage() {
  return (
    <main className="min-h-screen pt-[env(safe-area-inset-top)] pb-[calc(96px+env(safe-area-inset-bottom))] md:pt-0 md:pb-0">
      <ChatSection showBackLink />
    </main>
  )
}
