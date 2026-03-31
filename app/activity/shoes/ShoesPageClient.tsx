'use client'

import { Footprints, LoaderCircle, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import {
  createUserShoe,
  loadUserShoes,
  searchShoeModels,
  type ShoeModel,
  type UserShoeRecord,
} from '@/lib/shoes-client'

type ShoesPageClientProps = {
  initialShoes: UserShoeRecord[]
  initialPopularModels: ShoeModel[]
}

function toNullableTrimmedText(value: string) {
  const trimmedValue = value.trim()
  return trimmedValue.length > 0 ? trimmedValue : null
}

function parseDistanceKmInput(rawValue: string) {
  const normalizedValue = rawValue.trim().replace(',', '.')

  if (!normalizedValue) {
    return 0
  }

  if (!/^\d*([.]\d{0,2})?$/.test(normalizedValue)) {
    return null
  }

  const parsedValue = Number(normalizedValue)

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return null
  }

  return Number(parsedValue.toFixed(2))
}

function formatDistanceKmValue(value: number) {
  return value.toFixed(2).replace(/\.?0+$/, '')
}

function formatDistanceMetersAsKm(value: number) {
  return formatDistanceKmValue(Math.max(0, value) / 1000)
}

function getInitials(label: string) {
  const parts = label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)

  if (parts.length === 0) {
    return 'RC'
  }

  return parts.map((part) => part.charAt(0).toUpperCase()).join('')
}

function ActiveSwitch({
  checked,
  onCheckedChange,
  disabled = false,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className={`relative inline-flex shrink-0 items-center ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(event) => {
          onCheckedChange(event.target.checked)
        }}
        disabled={disabled}
        aria-label="Активная пара кроссовок"
        role="switch"
      />
      <span className="h-7 w-12 rounded-full bg-[var(--surface-interactive)] transition-colors duration-200 peer-checked:bg-[var(--accent-strong)] peer-disabled:bg-[var(--surface-interactive)]" />
      <span className="pointer-events-none absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition-transform duration-200 peer-checked:translate-x-5" />
    </label>
  )
}

function ShoeModelOption({
  model,
  selected,
  onSelect,
}: {
  model: ShoeModel
  selected: boolean
  onSelect: (model: ShoeModel) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(model)}
      className={`w-full rounded-2xl border p-3 text-left transition-colors ${
        selected ? 'app-button-primary shadow-sm' : 'app-card app-surface-muted'
      }`}
    >
      <p className="text-sm font-semibold">{model.fullName}</p>
      <p className={`mt-1 text-xs ${selected ? 'text-white/85' : 'app-text-secondary'}`}>
        {model.brand}
        {model.category ? ` • ${model.category}` : ''}
      </p>
    </button>
  )
}

function ShoeImage({ label, imageUrl }: { label: string; imageUrl: string | null }) {
  if (imageUrl) {
    return (
      <div
        className="h-16 w-16 shrink-0 rounded-2xl border border-black/5 bg-cover bg-center shadow-sm dark:border-white/10"
        style={{ backgroundImage: `url("${imageUrl}")` }}
        aria-hidden="true"
      />
    )
  }

  return (
    <div className="app-surface-muted flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-black/5 dark:border-white/10">
      <div className="flex flex-col items-center justify-center">
        <Footprints className="h-5 w-5" strokeWidth={1.9} />
        <span className="mt-1 text-[10px] font-semibold uppercase tracking-wide">{getInitials(label)}</span>
      </div>
    </div>
  )
}

export default function ShoesPageClient({
  initialShoes,
  initialPopularModels,
}: ShoesPageClientProps) {
  const [modelQuery, setModelQuery] = useState('')
  const [modelResults, setModelResults] = useState<ShoeModel[]>(initialPopularModels)
  const [loadingModelResults, setLoadingModelResults] = useState(false)
  const [selectedModel, setSelectedModel] = useState<ShoeModel | null>(null)
  const [customName, setCustomName] = useState('')
  const [nickname, setNickname] = useState('')
  const [distanceKmInput, setDistanceKmInput] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [searchError, setSearchError] = useState('')
  const trimmedQuery = modelQuery.trim()
  const parsedDistanceKm = parseDistanceKmInput(distanceKmInput)
  const canSubmit =
    !submitting &&
    parsedDistanceKm !== null &&
    parsedDistanceKm >= 0 &&
    (Boolean(selectedModel) || Boolean(toNullableTrimmedText(customName)))

  const {
    data: shoes,
    error: shoesError,
    mutate,
  } = useSWR('user-shoes', loadUserShoes, {
    fallbackData: initialShoes,
    revalidateOnMount: false,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    keepPreviousData: true,
    dedupingInterval: 15000,
    focusThrottleInterval: 15000,
  })

  useEffect(() => {
    let isActiveRequest = true

    if (!trimmedQuery) {
      setLoadingModelResults(false)
      setSearchError('')
      setModelResults(initialPopularModels)
      return () => {
        isActiveRequest = false
      }
    }

    setLoadingModelResults(true)
    setSearchError('')

    const timeoutId = window.setTimeout(() => {
      void searchShoeModels(trimmedQuery)
        .then((models) => {
          if (!isActiveRequest) {
            return
          }

          setModelResults(models)
        })
        .catch(() => {
          if (!isActiveRequest) {
            return
          }

          setSearchError('Не удалось загрузить модели')
          setModelResults([])
        })
        .finally(() => {
          if (isActiveRequest) {
            setLoadingModelResults(false)
          }
        })
    }, 250)

    return () => {
      isActiveRequest = false
      window.clearTimeout(timeoutId)
    }
  }, [initialPopularModels, trimmedQuery])

  const selectedModeLabel = useMemo(() => {
    if (selectedModel) {
      return `Выбрана модель: ${selectedModel.fullName}`
    }

    if (toNullableTrimmedText(customName)) {
      return 'Сохранится как своя пара'
    }

    return 'Выбери модель или укажи свое название'
  }, [customName, selectedModel])

  function handleDistanceInputChange(nextValue: string) {
    const normalizedValue = nextValue.replace(',', '.')

    if (!/^\d*([.]\d{0,2})?$/.test(normalizedValue)) {
      return
    }

    setDistanceKmInput(normalizedValue)
  }

  async function handleCreateShoe(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (submitting) {
      return
    }

    const normalizedCustomName = toNullableTrimmedText(customName)

    if (!selectedModel && !normalizedCustomName) {
      setFormError('Выбери модель или укажи свое название')
      return
    }

    if (parsedDistanceKm === null || parsedDistanceKm < 0) {
      setFormError('Укажи корректную дистанцию в километрах')
      return
    }

    setSubmitting(true)
    setFormError('')

    try {
      const createdShoe = await createUserShoe({
        shoeModelId: selectedModel?.id ?? null,
        customName: selectedModel ? null : normalizedCustomName,
        nickname: toNullableTrimmedText(nickname),
        currentDistanceMeters: Math.round(parsedDistanceKm * 1000),
        isActive,
      })

      await mutate(
        (currentShoes) => [createdShoe, ...(currentShoes ?? [])],
        { revalidate: false }
      )

      setSelectedModel(null)
      setModelQuery('')
      setModelResults(initialPopularModels)
      setCustomName('')
      setNickname('')
      setDistanceKmInput('')
      setIsActive(true)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Не удалось сохранить кроссовки')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <form onSubmit={handleCreateShoe} className="app-card mt-4 space-y-4 rounded-2xl border p-4 shadow-sm">
        <div>
          <h2 className="app-text-primary text-lg font-semibold">Добавить пару</h2>
          <p className="app-text-secondary mt-1 text-sm">
            Выбери популярную модель или задай свое название вручную.
          </p>
        </div>

        <div>
          <label htmlFor="shoe-model-search" className="app-text-secondary mb-1 block text-sm">
            Поиск модели
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 app-text-secondary" strokeWidth={1.9} />
            <input
              id="shoe-model-search"
              type="text"
              placeholder="Например: Pegasus, Boston, Novablast"
              value={modelQuery}
              onChange={(event) => {
                setModelQuery(event.target.value)
              }}
              disabled={submitting}
              className="app-input min-h-11 w-full rounded-xl border py-2 pl-10 pr-3"
            />
          </div>
          <p className="app-text-secondary mt-2 text-xs">{selectedModeLabel}</p>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="app-text-secondary text-sm">
              {trimmedQuery ? 'Результаты поиска' : 'Популярные модели'}
            </p>
            {loadingModelResults ? (
              <span className="app-text-secondary inline-flex items-center gap-1 text-xs">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" strokeWidth={1.9} />
                Поиск...
              </span>
            ) : null}
          </div>
          {searchError ? (
            <p className="text-sm text-red-600">{searchError}</p>
          ) : modelResults.length === 0 ? (
            <div className="app-surface-muted rounded-2xl border border-dashed p-4 text-sm app-text-secondary">
              Ничего не найдено. Можно ввести свое название ниже.
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {modelResults.map((model) => (
                <ShoeModelOption
                  key={model.id}
                  model={model}
                  selected={selectedModel?.id === model.id}
                  onSelect={(nextModel) => {
                    setSelectedModel(nextModel)
                    setCustomName('')
                    setFormError('')
                  }}
                />
              ))}
            </div>
          )}
        </div>

        <div className="app-surface-muted rounded-2xl border border-dashed p-4">
          <label htmlFor="shoe-custom-name" className="app-text-secondary mb-1 block text-sm">
            Свое название
          </label>
          <input
            id="shoe-custom-name"
            type="text"
            placeholder="Например: Старые темповые"
            value={customName}
            onChange={(event) => {
              setCustomName(event.target.value)
              if (event.target.value.trim()) {
                setSelectedModel(null)
              }
            }}
            disabled={submitting}
            className="app-input min-h-11 w-full rounded-xl border px-3 py-2"
          />
          <p className="app-text-secondary mt-2 text-xs">
            Используй это поле, если пары нет в списке моделей.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="shoe-nickname" className="app-text-secondary mb-1 block text-sm">
              Никнейм пары
            </label>
            <input
              id="shoe-nickname"
              type="text"
              placeholder="Необязательно"
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              disabled={submitting}
              className="app-input min-h-11 w-full rounded-xl border px-3 py-2"
            />
          </div>

          <div>
            <label htmlFor="shoe-distance-km" className="app-text-secondary mb-1 block text-sm">
              Пробег, км
            </label>
            <input
              id="shoe-distance-km"
              type="text"
              inputMode="decimal"
              placeholder="0"
              value={distanceKmInput}
              onChange={(event) => handleDistanceInputChange(event.target.value)}
              disabled={submitting}
              className="app-input min-h-11 w-full rounded-xl border px-3 py-2"
            />
            <p className="app-text-secondary mt-2 text-xs">
              Можно вводить дробные значения, например 42.2.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-2xl border px-4 py-3">
          <div>
            <p className="app-text-primary text-sm font-medium">Активная пара</p>
            <p className="app-text-secondary mt-1 text-xs">Показываем статус сразу на карточке.</p>
          </div>
          <ActiveSwitch checked={isActive} onCheckedChange={setIsActive} disabled={submitting} />
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          className={`min-h-11 w-full rounded-xl border px-4 py-2 text-sm font-medium transition-colors sm:w-auto ${
            canSubmit ? 'app-button-primary shadow-sm' : 'app-button-secondary text-[var(--text-muted)]'
          }`}
        >
          {submitting ? 'Сохраняем...' : 'Добавить кроссовки'}
        </button>

        {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
      </form>

      <section className="mt-5 md:mt-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="app-text-primary text-lg font-semibold">Мои кроссовки</h2>
          <p className="app-text-secondary text-sm">{shoes?.length ?? 0} пар</p>
        </div>

        {shoesError ? (
          <div className="app-card rounded-2xl border p-4 shadow-sm">
            <p className="text-sm text-red-600">Не удалось загрузить список кроссовок</p>
          </div>
        ) : !shoes || shoes.length === 0 ? (
          <div className="app-card rounded-2xl border p-5 text-center shadow-sm md:p-6">
            <p className="app-text-primary text-base font-semibold">Пока нет кроссовок</p>
            <p className="app-text-secondary mt-2 text-sm">
              Добавь первую пару выше, чтобы отслеживать ее пробег.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {shoes.map((shoe) => (
              <div key={shoe.id} className="app-card flex items-start gap-3 rounded-2xl border p-4 shadow-sm">
                <ShoeImage label={shoe.displayName} imageUrl={shoe.model?.imageUrl ?? null} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="app-text-primary break-words text-base font-semibold">
                        {shoe.displayName}
                      </p>
                      {shoe.nickname ? (
                        <p className="app-text-secondary mt-1 text-sm">{shoe.nickname}</p>
                      ) : null}
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                        shoe.isActive
                          ? 'border border-emerald-300/70 bg-emerald-100/80 text-emerald-700 dark:border-emerald-300/20 dark:bg-emerald-300/10 dark:text-emerald-100'
                          : 'border border-black/[0.07] bg-black/[0.04] text-black/70 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-white/75'
                      }`}
                    >
                      {shoe.isActive ? 'Активные' : 'Неактивные'}
                    </span>
                  </div>

                  <div className="app-text-secondary mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                    <p>{formatDistanceMetersAsKm(shoe.currentDistanceMeters)} км</p>
                    {shoe.model?.brand ? <p>• {shoe.model.brand}</p> : null}
                    {shoe.model?.category ? <p>• {shoe.model.category}</p> : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  )
}
