type AuthErrorPageProps = {
  searchParams?: Promise<{
    reason?: string
  }>
}

function getErrorMessage(reason?: string) {
  if (reason === 'profile') {
    return 'Не удалось подготовить профиль. Попробуйте войти еще раз.'
  }

  return 'Не удалось завершить вход. Попробуйте еще раз.'
}

export default async function AuthErrorPage({ searchParams }: AuthErrorPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const reason = resolvedSearchParams?.reason

  return (
    <main className="mx-auto max-w-xl p-6">
      <div className="space-y-3 rounded border p-6">
        <h1 className="text-2xl font-semibold">Ошибка входа</h1>
        <p className="text-sm text-gray-600">{getErrorMessage(reason)}</p>
      </div>
    </main>
  )
}
