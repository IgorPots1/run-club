import ChatSection from '@/components/ChatSection'

export default function ChatPage() {
  return (
    <main
      data-chat-isolated-route="true"
      className="h-[100dvh] overflow-hidden pt-[env(safe-area-inset-top)] md:min-h-screen md:h-auto md:overflow-visible md:pt-0"
    >
      <ChatSection showBackLink />
    </main>
  )
}
