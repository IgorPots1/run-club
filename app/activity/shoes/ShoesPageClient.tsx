'use client'

import type { FormEvent } from 'react'
import { Footprints, PencilLine, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { formatShoeDistanceMetersAsKm, getShoeWearUi } from '@/lib/shoe-wear-ui'
import {
  createUserShoe,
  loadUserShoes,
  updateUserShoe,
  type ShoeCatalogBrand,
  type ShoeCatalogModel,
  type ShoeCatalogVersion,
  type UserShoeRecord,
} from '@/lib/shoes-client'

type ShoesPageClientProps = {
  initialShoes: UserShoeRecord[]
  initialCatalog: ShoeCatalogBrand[]
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

function getWearProgressFillPercent(usagePercent: number) {
  if (!Number.isFinite(usagePercent)) {
    return 0
  }

  return Math.min(100, Math.max(0, usagePercent))
}

function getWearBarClassName(wearStatus: 'fresh' | 'warning' | 'critical') {
  if (wearStatus === 'fresh') {
    return 'from-emerald-500 to-emerald-400'
  }

  if (wearStatus === 'warning') {
    return 'from-amber-500 to-orange-400'
  }

  return 'from-rose-500 to-red-500'
}

function getWearBadgeClassName(wearStatus: 'fresh' | 'warning' | 'critical') {
  if (wearStatus === 'fresh') {
    return 'border border-emerald-300/70 bg-emerald-100/85 text-emerald-700 dark:border-emerald-300/20 dark:bg-emerald-300/10 dark:text-emerald-100'
  }

  if (wearStatus === 'warning') {
    return 'border border-amber-300/70 bg-amber-100/85 text-amber-700 dark:border-amber-300/20 dark:bg-amber-300/10 dark:text-amber-100'
  }

  return 'border border-rose-300/70 bg-rose-100/85 text-rose-700 dark:border-rose-300/20 dark:bg-rose-300/10 dark:text-rose-100'
}

function getShoeCardClassName(wearStatus: 'fresh' | 'warning' | 'critical') {
  if (wearStatus === 'critical') {
    return 'app-card border border-rose-300/40 shadow-sm ring-1 ring-rose-300/20 dark:border-rose-300/15 dark:ring-rose-300/10'
  }

  return 'app-card border border-black/[0.05] shadow-sm ring-1 ring-black/5 dark:border-white/[0.08] dark:ring-white/10'
}

function getPairsLabel(count: number) {
  const absoluteCount = Math.abs(count)
  const mod10 = absoluteCount % 10
  const mod100 = absoluteCount % 100

  if (mod10 === 1 && mod100 !== 11) {
    return 'пара'
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return 'пары'
  }

  return 'пар'
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

function normalizeCatalogSearchText(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

type CatalogSearchResult = {
  brandId: string
  brandName: string
  modelId: string
  modelName: string
  versionId: string
  versionName: string
  fullName: string
  isCurrent: boolean
  searchText: string
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

function CatalogSelectField({
  id,
  label,
  value,
  placeholder,
  options,
  disabled = false,
  onChange,
}: {
  id: string
  label: string
  value: string
  placeholder: string
  options: Array<{ value: string; label: string }>
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <div>
      <label htmlFor={id} className="app-text-secondary mb-1 block text-sm">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="app-input min-h-11 w-full rounded-xl border px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
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

function ShoeFormSheet({
  open,
  editing,
  submitting,
  canSubmit,
  catalogBrands,
  selectedBrandId,
  selectedModelId,
  selectedVersionId,
  selectedBrand,
  selectedCatalogModel,
  selectedVersion,
  selectedLegacyModelLabel,
  customName,
  nickname,
  distanceKmInput,
  maxDistanceKmInput,
  isActive,
  formError,
  onClose,
  onSubmit,
  onBrandChange,
  onCatalogModelChange,
  onCatalogSearchSelect,
  onVersionChange,
  onCustomNameChange,
  onNicknameChange,
  onDistanceChange,
  onMaxDistanceChange,
  onActiveChange,
}: {
  open: boolean
  editing: boolean
  submitting: boolean
  canSubmit: boolean
  catalogBrands: ShoeCatalogBrand[]
  selectedBrandId: string
  selectedModelId: string
  selectedVersionId: string
  selectedBrand: ShoeCatalogBrand | null
  selectedCatalogModel: ShoeCatalogModel | null
  selectedVersion: ShoeCatalogVersion | null
  selectedLegacyModelLabel: string | null
  customName: string
  nickname: string
  distanceKmInput: string
  maxDistanceKmInput: string
  isActive: boolean
  formError: string
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onBrandChange: (value: string) => void
  onCatalogModelChange: (value: string) => void
  onCatalogSearchSelect: (value: { brandId: string; modelId: string; versionId: string }) => void
  onVersionChange: (value: string) => void
  onCustomNameChange: (value: string) => void
  onNicknameChange: (value: string) => void
  onDistanceChange: (value: string) => void
  onMaxDistanceChange: (value: string) => void
  onActiveChange: (value: boolean) => void
}) {
  const brandOptions = useMemo(
    () =>
      catalogBrands.map((brand) => ({
        value: brand.id,
        label: brand.name,
      })),
    [catalogBrands]
  )
  const modelOptions = useMemo(
    () =>
      (selectedBrand?.models ?? []).map((model) => ({
        value: model.id,
        label: model.name,
      })),
    [selectedBrand]
  )
  const versionOptions = useMemo(
    () =>
      (selectedCatalogModel?.versions ?? []).map((version) => ({
        value: version.id,
        label: version.fullName,
      })),
    [selectedCatalogModel]
  )
  const [catalogSearchInput, setCatalogSearchInput] = useState('')
  const [debouncedCatalogSearchInput, setDebouncedCatalogSearchInput] = useState('')
  const normalizedCustomName = toNullableTrimmedText(customName)
  const hasSelectedCatalogShoe = Boolean(selectedVersion)
  const hasLegacySelectedShoe = Boolean(selectedLegacyModelLabel && !selectedVersion)
  const selectedShoeName = selectedVersion?.fullName ?? selectedLegacyModelLabel ?? ''
  const [selectionMode, setSelectionMode] = useState<'search' | 'browse' | 'manual'>(() =>
    normalizedCustomName && !hasSelectedCatalogShoe && !hasLegacySelectedShoe ? 'manual' : 'search'
  )
  const [showAdditional, setShowAdditional] = useState(false)
  const catalogSearchResults = useMemo<CatalogSearchResult[]>(
    () =>
      catalogBrands.flatMap((brand) =>
        brand.models.flatMap((model) =>
          model.versions.map((version) => ({
            brandId: brand.id,
            brandName: brand.name,
            modelId: model.id,
            modelName: model.name,
            versionId: version.id,
            versionName: version.version,
            fullName: version.fullName,
            isCurrent: version.isCurrent,
            searchText: normalizeCatalogSearchText(
              [brand.name, model.name, version.version, version.fullName].filter(Boolean).join(' ')
            ),
          }))
        )
      ),
    [catalogBrands]
  )
  const normalizedCatalogSearchQuery = useMemo(
    () => normalizeCatalogSearchText(debouncedCatalogSearchInput),
    [debouncedCatalogSearchInput]
  )
  const isCatalogSearchPending =
    normalizeCatalogSearchText(catalogSearchInput) !== normalizedCatalogSearchQuery
  const filteredCatalogSearchResults = useMemo(() => {
    if (!normalizedCatalogSearchQuery) {
      return []
    }

    return catalogSearchResults.filter((result) => result.searchText.includes(normalizedCatalogSearchQuery))
  }, [catalogSearchResults, normalizedCatalogSearchQuery])
  const isManualFlow = selectionMode === 'manual'
  const isSelectionStep = !isManualFlow && !hasSelectedCatalogShoe && !hasLegacySelectedShoe
  const isSearchStep = isSelectionStep && selectionMode === 'search'
  const isBrowseStep = isSelectionStep && selectionMode === 'browse'

  useEffect(() => {
    if (!open) {
      return
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !submitting) {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, open, submitting])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedCatalogSearchInput(catalogSearchInput)
    }, 180)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [catalogSearchInput])

  if (!open) {
    return null
  }

  function resetToSearchSelection() {
    onBrandChange('')
    setCatalogSearchInput('')
    setDebouncedCatalogSearchInput('')
    setSelectionMode('search')
  }

  function startBrowseFlow() {
    onBrandChange('')
    setCatalogSearchInput('')
    setDebouncedCatalogSearchInput('')
    setSelectionMode('browse')
  }

  function startManualFlow() {
    onBrandChange('')
    setCatalogSearchInput('')
    setDebouncedCatalogSearchInput('')
    setSelectionMode('manual')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 md:items-center md:justify-center md:p-4">
      <button
        type="button"
        aria-label="Закрыть форму кроссовок"
        className="absolute inset-0"
        onClick={onClose}
        disabled={submitting}
      />
      <section className="app-card relative flex max-h-[min(88svh,48rem)] w-full flex-col overflow-hidden rounded-t-3xl px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 shadow-xl md:max-w-2xl md:rounded-3xl md:pb-4">
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-gray-200 dark:bg-gray-700 md:hidden" />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="app-text-primary text-lg font-semibold">
              {editing ? 'Редактировать пару' : 'Добавить пару'}
            </h2>
            <p className="app-text-secondary mt-1 text-sm">
              {isManualFlow
                ? 'Добавь пару вручную и укажи текущий пробег.'
                : isSelectionStep
                  ? 'Сначала найди пару, затем укажи пробег и сохрани.'
                  : 'Проверь выбранную пару, укажи пробег и сохрани.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="app-button-secondary inline-flex min-h-10 min-w-10 items-center justify-center rounded-xl border px-2 py-2 disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </div>

        <form onSubmit={onSubmit} className="mt-4 min-h-0 flex-1 overflow-y-auto pb-1">
          <div className="space-y-4">
            {isSearchStep ? (
              <div className="space-y-4">
                <div className="rounded-2xl border p-4">
                  <label htmlFor="shoe-catalog-search" className="app-text-secondary mb-1 block text-sm">
                    Найти модель
                  </label>
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 app-text-secondary"
                      strokeWidth={1.9}
                    />
                    <input
                      id="shoe-catalog-search"
                      type="text"
                      value={catalogSearchInput}
                      onChange={(event) => setCatalogSearchInput(event.target.value)}
                      placeholder="Например: Nike Pegasus 40"
                      disabled={submitting}
                      className="app-input min-h-11 w-full rounded-xl border py-2 pl-10 pr-10"
                    />
                    {catalogSearchInput ? (
                      <button
                        type="button"
                        onClick={() => {
                          setCatalogSearchInput('')
                          setDebouncedCatalogSearchInput('')
                        }}
                        disabled={submitting}
                        className="app-text-secondary absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Сбросить
                      </button>
                    ) : null}
                  </div>
                  <p className="app-text-secondary mt-2 text-xs">
                    Ищи по бренду, модели или версии.
                  </p>
                </div>

                {normalizedCatalogSearchQuery ? (
                  <div className="overflow-hidden rounded-2xl border">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
                      <p className="app-text-primary text-sm font-medium">Результаты</p>
                      <p className="app-text-secondary text-xs">
                        {isCatalogSearchPending ? 'Ищем...' : `${filteredCatalogSearchResults.length} вариантов`}
                      </p>
                    </div>

                    {isCatalogSearchPending ? (
                      <div className="app-surface-muted px-4 py-4 text-sm app-text-secondary">
                        Обновляем результаты...
                      </div>
                    ) : filteredCatalogSearchResults.length > 0 ? (
                      <div className="max-h-72 overflow-y-auto">
                        {filteredCatalogSearchResults.map((result, index) => (
                          <button
                            key={result.versionId}
                            type="button"
                            onClick={() => {
                              onCatalogSearchSelect({
                                brandId: result.brandId,
                                modelId: result.modelId,
                                versionId: result.versionId,
                              })
                              setCatalogSearchInput('')
                              setDebouncedCatalogSearchInput('')
                            }}
                            disabled={submitting}
                            className={`w-full px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                              index > 0 ? 'border-t border-black/[0.05] dark:border-white/[0.08]' : ''
                            } hover:bg-black/[0.03] dark:hover:bg-white/[0.03]`}
                          >
                            <p className="app-text-primary text-sm font-medium">{result.fullName}</p>
                            <p className="app-text-secondary mt-1 text-xs">
                              {result.brandName} · {result.modelName}
                              {result.versionName ? ` · ${result.versionName}` : ''}
                            </p>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="app-surface-muted px-4 py-4 text-sm app-text-secondary">
                        Ничего не нашли. Попробуй другой запрос или выбери модель вручную.
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="app-surface-muted rounded-2xl border border-dashed px-4 py-4 text-sm app-text-secondary">
                    Начни вводить название модели, чтобы увидеть подходящие варианты.
                  </div>
                )}

                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={startBrowseFlow}
                    disabled={submitting}
                    className="app-button-secondary inline-flex min-h-11 w-full items-center justify-center rounded-xl border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Выбрать вручную
                  </button>
                  <button
                    type="button"
                    onClick={startManualFlow}
                    disabled={submitting}
                    className="app-text-secondary inline-flex min-h-10 w-full items-center justify-center rounded-xl px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Не нашли? Добавить вручную
                  </button>
                </div>
              </div>
            ) : null}

            {isBrowseStep ? (
              <div className="space-y-4">
                <div className="rounded-2xl border p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="app-text-primary text-sm font-medium">Выбор вручную</p>
                      <p className="app-text-secondary mt-1 text-xs">
                        Выбери бренд, модель и версию по шагам.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={resetToSearchSelection}
                      disabled={submitting}
                      className="app-text-secondary text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Назад
                    </button>
                  </div>
                </div>

                <CatalogSelectField
                  id="shoe-brand-select"
                  label="Бренд"
                  value={selectedBrandId}
                  placeholder="Выбери бренд"
                  options={brandOptions}
                  disabled={submitting}
                  onChange={onBrandChange}
                />

                <CatalogSelectField
                  id="shoe-model-select"
                  label="Модель"
                  value={selectedModelId}
                  placeholder={selectedBrand ? 'Выбери модель' : 'Сначала выбери бренд'}
                  options={modelOptions}
                  disabled={submitting || !selectedBrand}
                  onChange={onCatalogModelChange}
                />

                <CatalogSelectField
                  id="shoe-version-select"
                  label="Версия"
                  value={selectedVersionId}
                  placeholder={selectedCatalogModel ? 'Выбери версию' : 'Сначала выбери модель'}
                  options={versionOptions}
                  disabled={submitting || !selectedCatalogModel}
                  onChange={onVersionChange}
                />

                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={startManualFlow}
                    disabled={submitting}
                    className="app-text-secondary inline-flex min-h-10 w-full items-center justify-center rounded-xl px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Не нашли? Добавить вручную
                  </button>
                </div>
              </div>
            ) : null}

            {!isSelectionStep && !isManualFlow ? (
              <>
                <div className="rounded-2xl border p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="app-text-secondary text-xs font-medium uppercase tracking-wide">Выбрана пара</p>
                      <p className="app-text-primary mt-1 break-words text-base font-semibold">{selectedShoeName}</p>
                      {hasLegacySelectedShoe ? (
                        <p className="app-text-secondary mt-2 text-xs">
                          Старая запись без версии каталога. При желании можно выбрать пару заново.
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={resetToSearchSelection}
                      disabled={submitting}
                      className="app-text-secondary text-left text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 sm:text-right"
                    >
                      Изменить
                    </button>
                  </div>
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
                    onChange={(event) => onDistanceChange(event.target.value)}
                    disabled={submitting}
                    className="app-input min-h-11 w-full rounded-xl border px-3 py-2"
                  />
                </div>
              </>
            ) : null}

            {isManualFlow ? (
              <>
                <div className="rounded-2xl border p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="app-text-primary text-sm font-medium">Добавить вручную</p>
                      <p className="app-text-secondary mt-1 text-xs">
                        Укажи название пары и текущий пробег.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={resetToSearchSelection}
                      disabled={submitting}
                      className="app-text-secondary text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Назад
                    </button>
                  </div>
                </div>

                <div>
                  <label htmlFor="shoe-custom-name" className="app-text-secondary mb-1 block text-sm">
                    Название
                  </label>
                  <input
                    id="shoe-custom-name"
                    type="text"
                    placeholder="Например: Старые темповые"
                    value={customName}
                    onChange={(event) => {
                      setSelectionMode('manual')
                      onCustomNameChange(event.target.value)
                    }}
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
                    onChange={(event) => onDistanceChange(event.target.value)}
                    disabled={submitting}
                    className="app-input min-h-11 w-full rounded-xl border px-3 py-2"
                  />
                </div>
              </>
            ) : null}

            {!isSelectionStep ? (
              <div className="overflow-hidden rounded-2xl border">
                <button
                  type="button"
                  onClick={() => setShowAdditional((currentValue) => !currentValue)}
                  className="flex w-full flex-col gap-2 px-4 py-3 text-left sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="app-text-primary text-sm font-medium">Дополнительно</p>
                    <p className="app-text-secondary mt-1 text-xs">
                      Никнейм, ресурс пары и статус активности
                    </p>
                  </div>
                  <span className="app-text-secondary text-sm font-medium">
                    {showAdditional ? 'Скрыть' : 'Показать'}
                  </span>
                </button>

                {showAdditional ? (
                  <div className="space-y-4 border-t px-4 py-4">
                    <div>
                      <label htmlFor="shoe-nickname" className="app-text-secondary mb-1 block text-sm">
                        Никнейм пары
                      </label>
                      <input
                        id="shoe-nickname"
                        type="text"
                        placeholder="Необязательно"
                        value={nickname}
                        onChange={(event) => onNicknameChange(event.target.value)}
                        disabled={submitting}
                        className="app-input min-h-11 w-full rounded-xl border px-3 py-2"
                      />
                    </div>

                    <div>
                      <label htmlFor="shoe-max-distance-km" className="app-text-secondary mb-1 block text-sm">
                        Ресурс пары, км
                      </label>
                      <input
                        id="shoe-max-distance-km"
                        type="text"
                        inputMode="decimal"
                        placeholder="800"
                        value={maxDistanceKmInput}
                        onChange={(event) => onMaxDistanceChange(event.target.value)}
                        disabled={submitting}
                        className="app-input min-h-11 w-full rounded-xl border px-3 py-2"
                      />
                      <p className="app-text-secondary mt-2 text-xs">
                        Если не указывать отдельно, используем стандартные 800 км.
                      </p>
                    </div>

                    <div className="flex flex-col gap-3 rounded-2xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="app-text-primary text-sm font-medium">Активная пара</p>
                        <p className="app-text-secondary mt-1 text-xs">Показываем статус сразу на карточке.</p>
                      </div>
                      <ActiveSwitch checked={isActive} onCheckedChange={onActiveChange} disabled={submitting} />
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
          </div>

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="app-button-secondary inline-flex min-h-11 items-center justify-center rounded-xl border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
            >
              Отмена
            </button>
            {!isSelectionStep ? (
              <button
                type="submit"
                disabled={!canSubmit}
                className={`inline-flex min-h-11 items-center justify-center rounded-xl border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  canSubmit ? 'app-button-primary shadow-sm' : 'app-button-secondary text-[var(--text-muted)]'
                }`}
              >
                {submitting ? 'Сохраняем...' : 'Сохранить'}
              </button>
            ) : null}
          </div>
        </form>
      </section>
    </div>
  )
}

function ShoeGarageCard({
  shoe,
  archived = false,
  submitting,
  statusUpdatingShoeId,
  onEdit,
  onSetArchivedState,
}: {
  shoe: UserShoeRecord
  archived?: boolean
  submitting: boolean
  statusUpdatingShoeId: string | null
  onEdit: (shoe: UserShoeRecord) => void
  onSetArchivedState: (shoe: UserShoeRecord, nextIsActive: boolean) => void
}) {
  const wearUi = getShoeWearUi({
    currentDistanceMeters: shoe.currentDistanceMeters,
    maxDistanceMeters: shoe.maxDistanceMeters,
  })
  const isStatusUpdating = statusUpdatingShoeId === shoe.id
  const remainingDistanceLabel =
    wearUi.usagePercent <= 100
      ? `Осталось ~${formatShoeDistanceMetersAsKm(Math.max(0, wearUi.maxDistanceMeters - wearUi.currentDistanceMeters))} км`
      : 'Пробег превысил ресурс'

  return (
    <div
      className={`${getShoeCardClassName(wearUi.status)} rounded-2xl p-4 ${archived ? 'opacity-90' : ''}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <ShoeImage label={shoe.displayName} imageUrl={shoe.model?.imageUrl ?? null} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="app-text-primary break-words text-base font-semibold">
                {shoe.displayName}
              </p>
              {shoe.nickname ? (
                <p className="app-text-secondary mt-1 text-sm">{shoe.nickname}</p>
              ) : null}
              {archived ? (
                <p className="app-text-muted mt-1 text-xs font-medium">В архиве</p>
              ) : null}
            </div>
            <span
              className={`inline-flex max-w-full break-words rounded-full px-2.5 py-1 text-xs font-semibold ${getWearBadgeClassName(wearUi.status)}`}
            >
              {wearUi.label}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-black/[0.05] bg-black/[0.02] px-3.5 py-3 dark:border-white/[0.07] dark:bg-white/[0.03]">
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
          <p className="app-text-primary min-w-0 text-sm font-medium">{wearUi.distanceLabel}</p>
          <p className="app-text-secondary min-w-0 text-xs sm:text-right">{remainingDistanceLabel}</p>
        </div>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]">
          <div
            className={`h-full rounded-full bg-gradient-to-r transition-[width] duration-300 ${getWearBarClassName(wearUi.status)}`}
            style={{ width: `${getWearProgressFillPercent(wearUi.usagePercent)}%` }}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={() => onSetArchivedState(shoe, archived)}
          disabled={isStatusUpdating || submitting}
          className="app-text-secondary inline-flex min-h-10 w-full items-center justify-center rounded-lg px-1 py-2 text-sm font-medium transition-colors hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:justify-start"
        >
          {isStatusUpdating
            ? archived ? 'Возвращаем...' : 'Переносим...'
            : archived ? 'Вернуть в активные' : 'В архив'}
        </button>
        <button
          type="button"
          onClick={() => onEdit(shoe)}
          disabled={isStatusUpdating}
          className="app-button-secondary inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          <PencilLine className="h-4 w-4" strokeWidth={1.9} />
          Изменить
        </button>
      </div>
    </div>
  )
}

export default function ShoesPageClient({
  initialShoes,
  initialCatalog,
}: ShoesPageClientProps) {
  const [editingShoeId, setEditingShoeId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [selectedLegacyModelLabel, setSelectedLegacyModelLabel] = useState<string | null>(null)
  const [selectedBrandId, setSelectedBrandId] = useState('')
  const [selectedCatalogModelId, setSelectedCatalogModelId] = useState('')
  const [selectedVersionId, setSelectedVersionId] = useState('')
  const [customName, setCustomName] = useState('')
  const [nickname, setNickname] = useState('')
  const [distanceKmInput, setDistanceKmInput] = useState('')
  const [maxDistanceKmInput, setMaxDistanceKmInput] = useState('800')
  const [isActive, setIsActive] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [statusUpdatingShoeId, setStatusUpdatingShoeId] = useState<string | null>(null)
  const [formError, setFormError] = useState('')
  const [listActionError, setListActionError] = useState('')
  const parsedDistanceKm = parseDistanceKmInput(distanceKmInput)
  const parsedMaxDistanceKm = parseDistanceKmInput(maxDistanceKmInput)
  const selectedBrand = useMemo(
    () => initialCatalog.find((brand) => brand.id === selectedBrandId) ?? null,
    [initialCatalog, selectedBrandId]
  )
  const selectedCatalogModel = useMemo(
    () => selectedBrand?.models.find((model) => model.id === selectedCatalogModelId) ?? null,
    [selectedBrand, selectedCatalogModelId]
  )
  const selectedVersion = useMemo(
    () => selectedCatalogModel?.versions.find((version) => version.id === selectedVersionId) ?? null,
    [selectedCatalogModel, selectedVersionId]
  )
  const canSubmit =
    !submitting &&
    parsedDistanceKm !== null &&
    parsedDistanceKm >= 0 &&
    parsedMaxDistanceKm !== null &&
    parsedMaxDistanceKm > 0 &&
    (Boolean(selectedVersion) || Boolean(selectedLegacyModelLabel) || Boolean(toNullableTrimmedText(customName)))

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

  const editingShoe = useMemo(
    () => shoes?.find((shoe) => shoe.id === editingShoeId) ?? null,
    [editingShoeId, shoes]
  )
  const activeShoes = useMemo(
    () => (shoes ?? []).filter((shoe) => shoe.isActive),
    [shoes]
  )
  const archivedShoes = useMemo(
    () => (shoes ?? []).filter((shoe) => !shoe.isActive),
    [shoes]
  )
  const problematicSummaryLines = useMemo(() => {
    const warningCount = activeShoes.filter((shoe) => {
      const wearUi = getShoeWearUi({
        currentDistanceMeters: shoe.currentDistanceMeters,
        maxDistanceMeters: shoe.maxDistanceMeters,
      })
      return wearUi.status === 'warning'
    }).length
    const criticalCount = activeShoes.filter((shoe) => {
      const wearUi = getShoeWearUi({
        currentDistanceMeters: shoe.currentDistanceMeters,
        maxDistanceMeters: shoe.maxDistanceMeters,
      })
      return wearUi.status === 'critical'
    }).length
    const nextLines: string[] = []

    if (warningCount > 0) {
      nextLines.push(`${warningCount} ${getPairsLabel(warningCount)} на исходе`)
    }

    if (criticalCount > 0) {
      nextLines.push(`${criticalCount} ${getPairsLabel(criticalCount)} пора менять`)
    }

    return nextLines
  }, [activeShoes])

  useEffect(() => {
    if (editingShoe && !editingShoe.isActive) {
      setShowArchived(true)
    }
  }, [editingShoe])

  function handleDistanceInputChange(nextValue: string) {
    const normalizedValue = nextValue.replace(',', '.')

    if (!/^\d*([.]\d{0,2})?$/.test(normalizedValue)) {
      return
    }

    setDistanceKmInput(normalizedValue)
  }

  function handleMaxDistanceInputChange(nextValue: string) {
    const normalizedValue = nextValue.replace(',', '.')

    if (!/^\d*([.]\d{0,2})?$/.test(normalizedValue)) {
      return
    }

    setMaxDistanceKmInput(normalizedValue)
  }

  function resetForm() {
    setEditingShoeId(null)
    setFormOpen(false)
    setSelectedLegacyModelLabel(null)
    setSelectedBrandId('')
    setSelectedCatalogModelId('')
    setSelectedVersionId('')
    setCustomName('')
    setNickname('')
    setDistanceKmInput('')
    setMaxDistanceKmInput('800')
    setIsActive(true)
    setFormError('')
  }

  function handleStartEditingShoe(shoe: UserShoeRecord) {
    setFormOpen(true)
    setEditingShoeId(shoe.id)
    setSelectedLegacyModelLabel(shoe.shoeVersionId ? null : shoe.model?.fullName ?? null)
    setSelectedBrandId('')
    setSelectedCatalogModelId('')
    setSelectedVersionId(shoe.shoeVersionId ?? '')
    setCustomName(shoe.customName ?? '')
    setNickname(shoe.nickname ?? '')
    setDistanceKmInput(formatShoeDistanceMetersAsKm(shoe.currentDistanceMeters))
    setMaxDistanceKmInput(formatShoeDistanceMetersAsKm(shoe.maxDistanceMeters))
    setIsActive(shoe.isActive)
    setFormError('')

    if (shoe.shoeVersionId) {
      for (const brand of initialCatalog) {
        const matchingModel = brand.models.find((model) =>
          model.versions.some((version) => version.id === shoe.shoeVersionId)
        )

        if (matchingModel) {
          setSelectedBrandId(brand.id)
          setSelectedCatalogModelId(matchingModel.id)
          break
        }
      }
    }
  }

  async function handleSetArchivedState(shoe: UserShoeRecord, nextIsActive: boolean) {
    if (statusUpdatingShoeId || submitting) {
      return
    }

    setStatusUpdatingShoeId(shoe.id)
    setListActionError('')

    try {
      const updatedShoe = await updateUserShoe(shoe.id, {
        shoeModelId: shoe.shoeVersionId ? null : shoe.shoeModelId,
        shoeVersionId: shoe.shoeVersionId,
        customName: shoe.model ? null : shoe.customName,
        nickname: shoe.nickname,
        currentDistanceMeters: shoe.currentDistanceMeters,
        maxDistanceMeters: shoe.maxDistanceMeters,
        isActive: nextIsActive,
      })

      await mutate(
        (currentShoes) =>
          (currentShoes ?? []).map((currentShoe) => (currentShoe.id === updatedShoe.id ? updatedShoe : currentShoe)),
        { revalidate: false }
      )

      if (shoe.id === editingShoeId) {
        resetForm()
      }
    } catch (error) {
      setListActionError(error instanceof Error ? error.message : 'Не удалось обновить статус пары')
    } finally {
      setStatusUpdatingShoeId(null)
    }
  }

  async function handleCreateShoe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (submitting) {
      return
    }

    const normalizedCustomName = toNullableTrimmedText(customName)

    if (!selectedVersion && !selectedLegacyModelLabel && !normalizedCustomName) {
      setFormError('Выбери версию из каталога или укажи свое название')
      return
    }

    if (parsedDistanceKm === null || parsedDistanceKm < 0) {
      setFormError('Укажи корректную дистанцию в километрах')
      return
    }

    if (parsedMaxDistanceKm === null || parsedMaxDistanceKm <= 0) {
      setFormError('Укажи корректный ресурс пары в километрах')
      return
    }

    setSubmitting(true)
    setFormError('')

    try {
      const payload = {
        shoeModelId: selectedVersion ? null : editingShoe?.shoeVersionId ? null : editingShoe?.shoeModelId ?? null,
        shoeVersionId: selectedVersion?.id ?? null,
        customName: selectedVersion || selectedLegacyModelLabel ? null : normalizedCustomName,
        nickname: toNullableTrimmedText(nickname),
        currentDistanceMeters: Math.round(parsedDistanceKm * 1000),
        maxDistanceMeters: Math.round(parsedMaxDistanceKm * 1000),
        isActive,
      }

      if (editingShoeId) {
        const updatedShoe = await updateUserShoe(editingShoeId, payload)

        await mutate(
          (currentShoes) =>
            (currentShoes ?? []).map((shoe) => (shoe.id === updatedShoe.id ? updatedShoe : shoe)),
          { revalidate: false }
        )
      } else {
        const createdShoe = await createUserShoe(payload)

        await mutate(
          (currentShoes) => [createdShoe, ...(currentShoes ?? [])],
          { revalidate: false }
        )
      }

      resetForm()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Не удалось сохранить кроссовки')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {problematicSummaryLines.length > 0 ? (
        <section className="app-card mt-4 rounded-2xl border border-amber-300/70 bg-amber-50/80 p-4 shadow-sm dark:border-amber-300/20 dark:bg-amber-300/10">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-100">
            Контроль износа
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {problematicSummaryLines.map((line) => (
              <span
                key={line}
                className="rounded-full border border-amber-300/70 bg-white/70 px-3 py-1.5 text-sm font-medium text-amber-800 dark:border-amber-300/20 dark:bg-white/5 dark:text-amber-100"
              >
                {line}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-5 md:mt-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="app-text-primary text-lg font-semibold">Мои кроссовки</h2>
            <p className="app-text-secondary mt-1 text-sm">
              Гараж ваших пар с пробегом и текущим состоянием.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              resetForm()
              setFormOpen(true)
            }}
            className="app-button-primary inline-flex min-h-11 w-full items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium sm:w-auto sm:shrink-0"
          >
            Добавить пару
          </button>
        </div>

        <div className="mb-3 app-surface-muted rounded-2xl border px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="app-text-primary text-sm font-medium">Активные пары</p>
              <p className="app-text-secondary mt-1 text-xs">
                {activeShoes.length} из {shoes?.length ?? 0} {getPairsLabel(shoes?.length ?? 0)}
              </p>
            </div>
            <p className="app-text-secondary min-w-0 break-words text-sm">{activeShoes.length} пар</p>
          </div>
        </div>

        {listActionError ? <p className="mb-3 text-sm text-red-600">{listActionError}</p> : null}

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
          <div className="space-y-4">
            <div>
              {activeShoes.length === 0 ? (
                <div className="app-card rounded-2xl border border-dashed p-4 shadow-sm">
                  <p className="app-text-secondary text-sm">Сейчас нет активных пар. Можно вернуть пару из архива ниже.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {activeShoes.map((shoe) => (
                    <ShoeGarageCard
                      key={shoe.id}
                      shoe={shoe}
                      submitting={submitting}
                      statusUpdatingShoeId={statusUpdatingShoeId}
                      onEdit={handleStartEditingShoe}
                      onSetArchivedState={handleSetArchivedState}
                    />
                  ))}
                </div>
              )}
            </div>

            {archivedShoes.length > 0 ? (
              <div>
                <button
                  type="button"
                  onClick={() => setShowArchived((currentValue) => !currentValue)}
                  className="app-card flex w-full flex-col gap-2 rounded-2xl border px-4 py-3 text-left shadow-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="app-text-primary text-base font-semibold">Архив</span>
                  <span className="app-text-secondary break-words text-sm">
                    {archivedShoes.length} пар {showArchived ? '• скрыть' : '• показать'}
                  </span>
                </button>

                {showArchived ? (
                  <div className="mt-3 space-y-3">
                    {archivedShoes.map((shoe) => (
                      <ShoeGarageCard
                        key={shoe.id}
                        shoe={shoe}
                        archived
                        submitting={submitting}
                        statusUpdatingShoeId={statusUpdatingShoeId}
                        onEdit={handleStartEditingShoe}
                        onSetArchivedState={handleSetArchivedState}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </section>

      <ShoeFormSheet
        key={editingShoeId ?? (formOpen ? 'new' : 'closed')}
        open={formOpen}
        editing={Boolean(editingShoeId)}
        submitting={submitting}
        canSubmit={canSubmit}
        catalogBrands={initialCatalog}
        selectedBrandId={selectedBrandId}
        selectedModelId={selectedCatalogModelId}
        selectedVersionId={selectedVersionId}
        selectedBrand={selectedBrand}
        selectedCatalogModel={selectedCatalogModel}
        selectedVersion={selectedVersion}
        selectedLegacyModelLabel={selectedLegacyModelLabel}
        customName={customName}
        nickname={nickname}
        distanceKmInput={distanceKmInput}
        maxDistanceKmInput={maxDistanceKmInput}
        isActive={isActive}
        formError={formError}
        onClose={resetForm}
        onSubmit={handleCreateShoe}
        onBrandChange={(brandId) => {
          setSelectedBrandId(brandId)
          setSelectedCatalogModelId('')
          setSelectedVersionId('')
          setSelectedLegacyModelLabel(null)
          setCustomName('')
          setFormError('')
        }}
        onCatalogModelChange={(modelId) => {
          setSelectedCatalogModelId(modelId)
          setSelectedVersionId('')
          setSelectedLegacyModelLabel(null)
          setCustomName('')
          setFormError('')
        }}
        onCatalogSearchSelect={({ brandId, modelId, versionId }) => {
          setSelectedBrandId(brandId)
          setSelectedCatalogModelId(modelId)
          setSelectedVersionId(versionId)
          setSelectedLegacyModelLabel(null)
          setCustomName('')
          setFormError('')
        }}
        onVersionChange={(versionId) => {
          setSelectedVersionId(versionId)
          setSelectedLegacyModelLabel(null)
          setCustomName('')
          setFormError('')
        }}
        onCustomNameChange={(value) => {
          setCustomName(value)
          if (value.trim()) {
            setSelectedBrandId('')
            setSelectedCatalogModelId('')
            setSelectedVersionId('')
            setSelectedLegacyModelLabel(null)
          }
        }}
        onNicknameChange={setNickname}
        onDistanceChange={handleDistanceInputChange}
        onMaxDistanceChange={handleMaxDistanceInputChange}
        onActiveChange={setIsActive}
      />
    </>
  )
}
