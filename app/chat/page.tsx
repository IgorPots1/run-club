import ChatSection from '@/components/ChatSection'
import MobileBackHeader from '@/components/MobileBackHeader'

export default function ChatPage() {
  return (
    <main
      data-chat-isolated-route="true"
      className="flex flex-col overflow-hidden"
      style={{
        height: 'var(--chat-app-height, 100dvh)',
        minHeight: 'var(--chat-app-height, 100dvh)',
      }}
    >
      <div className="mx-auto flex h-full min-h-0 w-full max-w-xl flex-col">
        <MobileBackHeader title="Чат клуба" className="mb-0 shrink-0" />
        <div className="min-h-0 flex-1">
          <ChatSection showTitle={false} isolatedLayout />
        </div>
      </div>
    </main>
  )
}
