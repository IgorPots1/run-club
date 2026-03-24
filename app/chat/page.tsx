import ChatSection from '@/components/ChatSection'
import InnerPageHeader from '@/components/InnerPageHeader'

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
        <InnerPageHeader title="Чат клуба" />
        <div className="min-h-0 flex-1">
          <ChatSection showTitle={false} />
        </div>
      </div>
    </main>
  )
}
