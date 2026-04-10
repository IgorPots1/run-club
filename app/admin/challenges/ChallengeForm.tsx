'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import ChallengeBadgeArtwork from '@/components/ChallengeBadgeArtwork'
import { deleteUploadedChallengeBadge, uploadChallengeBadge } from '@/lib/storage/uploadChallengeBadge'

type ChallengePeriodType = 'lifetime' | 'challenge' | 'weekly' | 'monthly'
type ChallengeGoalUnit = 'distance_km' | 'run_count'

export type ChallengeFormValues = {
  recordId?: string
  templateId?: string
  title: string
  description: string
  visibility: 'public' | 'restricted'
  periodType: ChallengePeriodType
  goalUnit: ChallengeGoalUnit
  goalTarget: string
  xpReward: string
  startsAt: string
  endAt: string
  badgeUrl: string
  badgeStoragePath: string
}

export type ChallengeFormTemplateOption = {
  id: string
  title: string
  description: string
  periodType: ChallengePeriodType
  goalUnit: ChallengeGoalUnit
  goalTarget: string
  xpReward: string
  startsAt: string
  endAt: string
  badgeUrl: string
}

type ChallengeFormProps = {
  entityType?: 'challenge' | 'template'
  mode: 'create' | 'edit'
  action: (formData: FormData) => void | Promise<void>
  cancelHref: string
  currentUserId: string
  initialValues: ChallengeFormValues
  availableTemplates?: ChallengeFormTemplateOption[]
}

const PERIOD_TYPE_OPTIONS: Array<{ value: ChallengePeriodType; label: string; help: string }> = [
  {
    value: 'lifetime',
    label: 'Пожизненный',
    help: 'Одна награда за весь накопленный прогресс пользователя.',
  },
  {
    value: 'challenge',
    label: 'По расписанию',
    help: 'Считается только внутри заданного окна начала и окончания.',
  },
  {
    value: 'weekly',
    label: 'Еженедельный',
    help: 'Повторяется каждую ISO-неделю и может быть выполнен заново.',
  },
  {
    value: 'monthly',
    label: 'Ежемесячный',
    help: 'Повторяется каждый календарный месяц и может быть выполнен заново.',
  },
]

const GOAL_UNIT_OPTIONS: Array<{ value: ChallengeGoalUnit; label: string; suffix: string; step: string }> = [
  {
    value: 'distance_km',
    label: 'Дистанция',
    suffix: 'км',
    step: '0.01',
  },
  {
    value: 'run_count',
    label: 'Количество тренировок',
    suffix: 'тренировок',
    step: '1',
  },
]

function formatPeriodType(periodType: ChallengePeriodType) {
  return PERIOD_TYPE_OPTIONS.find((item) => item.value === periodType)?.label ?? 'Не выбран'
}

function formatGoalLabel(goalUnit: ChallengeGoalUnit, goalTarget: string) {
  const trimmedTarget = goalTarget.trim()

  if (!trimmedTarget) {
    return 'Не задана'
  }

  const option = GOAL_UNIT_OPTIONS.find((item) => item.value === goalUnit)
  return `${trimmedTarget} ${option?.suffix ?? ''}`.trim()
}

function toDateTimeLocalValue(value: string) {
  const trimmed = value.trim()

  if (!trimmed) {
    return ''
  }

  const parsed = new Date(trimmed)

  if (Number.isNaN(parsed.getTime())) {
    return ''
  }

  const offsetMs = parsed.getTimezoneOffset() * 60 * 1000
  return new Date(parsed.getTime() - offsetMs).toISOString().slice(0, 16)
}

export function ChallengeForm({
  entityType = 'challenge',
  mode,
  action,
  cancelHref,
  currentUserId,
  initialValues,
  availableTemplates = [],
}: ChallengeFormProps) {
  const [templateId, setTemplateId] = useState(initialValues.templateId ?? '')
  const [title, setTitle] = useState(initialValues.title)
  const [description, setDescription] = useState(initialValues.description)
  const [visibility, setVisibility] = useState<'public' | 'restricted'>(initialValues.visibility)
  const [periodType, setPeriodType] = useState<ChallengePeriodType>(initialValues.periodType)
  const [goalUnit, setGoalUnit] = useState<ChallengeGoalUnit>(initialValues.goalUnit)
  const [goalTarget, setGoalTarget] = useState(initialValues.goalTarget)
  const [xpReward, setXpReward] = useState(initialValues.xpReward)
  const [startsAt, setStartsAt] = useState(toDateTimeLocalValue(initialValues.startsAt))
  const [endAt, setEndAt] = useState(toDateTimeLocalValue(initialValues.endAt))
  const [badgeUrl, setBadgeUrl] = useState(initialValues.badgeUrl)
  const [badgeStoragePath, setBadgeStoragePath] = useState(initialValues.badgeStoragePath)
  const [clientError, setClientError] = useState('')
  const [isUploadingBadge, setIsUploadingBadge] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const selectedTemplate = useMemo(
    () => availableTemplates.find((item) => item.id === templateId) ?? null,
    [availableTemplates, templateId]
  )
  const selectedGoalUnit = useMemo(
    () => GOAL_UNIT_OPTIONS.find((item) => item.value === goalUnit) ?? GOAL_UNIT_OPTIONS[0],
    [goalUnit]
  )

  const isChallengeForm = entityType === 'challenge'
  const showTemplateSelector = isChallengeForm && mode === 'create' && availableTemplates.length > 0
  const showScheduleSection = periodType === 'challenge'
  const previewReward = xpReward.trim() ? `${xpReward.trim()} XP` : '0 XP'
  const previewGoal = formatGoalLabel(goalUnit, goalTarget)
  const submitLabel = entityType === 'template'
    ? mode === 'create'
      ? 'Создать шаблон'
      : 'Сохранить шаблон'
    : mode === 'create'
      ? 'Создать челлендж'
      : 'Сохранить изменения'

  function applyTemplate(nextTemplateId: string) {
    setTemplateId(nextTemplateId)

    const nextTemplate = availableTemplates.find((item) => item.id === nextTemplateId) ?? null

    if (!nextTemplate) {
      return
    }

    setTitle(nextTemplate.title)
    setDescription(nextTemplate.description)
    setPeriodType(nextTemplate.periodType)
    setGoalUnit(nextTemplate.goalUnit)
    setGoalTarget(nextTemplate.goalTarget)
    setXpReward(nextTemplate.xpReward)
    setStartsAt(toDateTimeLocalValue(nextTemplate.startsAt))
    setEndAt(toDateTimeLocalValue(nextTemplate.endAt))
    setBadgeUrl(nextTemplate.badgeUrl)
    setBadgeStoragePath('')
    setClientError('')
  }

  async function handleBadgeChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null

    if (!file) {
      return
    }

    setClientError('')
    setIsUploadingBadge(true)

    try {
      const previousStoragePath = badgeStoragePath
      const uploadResult = await uploadChallengeBadge({
        file,
        userId: currentUserId,
      })

      setBadgeUrl(uploadResult.publicUrl)
      setBadgeStoragePath(uploadResult.storagePath)

      if (previousStoragePath && previousStoragePath !== uploadResult.storagePath) {
        void deleteUploadedChallengeBadge(previousStoragePath).catch((error) => {
          console.error('Failed to delete replaced challenge badge', error)
        })
      }
    } catch (error) {
      console.error('Failed to upload challenge badge', error)
      setClientError('Не удалось загрузить бейдж. Попробуйте другой файл изображения.')
      event.currentTarget.value = ''
    } finally {
      setIsUploadingBadge(false)
    }
  }

  function handleRemoveBadge() {
    const previousStoragePath = badgeStoragePath

    setBadgeUrl('')
    setBadgeStoragePath('')
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }

    if (previousStoragePath) {
      void deleteUploadedChallengeBadge(previousStoragePath).catch((error) => {
        console.error('Failed to delete removed challenge badge', error)
      })
    }
  }

  function validateBeforeSubmit() {
    const normalizedGoalTarget = Number(goalTarget.trim())
    const normalizedReward = Number(xpReward.trim() || '0')

    if (!title.trim()) {
      return 'Укажите название челленджа.'
    }

    if (!Number.isFinite(normalizedGoalTarget) || normalizedGoalTarget <= 0) {
      return 'Цель должна быть больше 0.'
    }

    if (goalUnit === 'run_count' && !Number.isInteger(normalizedGoalTarget)) {
      return 'Для цели по тренировкам укажите целое число.'
    }

    if (!Number.isFinite(normalizedReward) || normalizedReward < 0) {
      return 'Награда XP должна быть неотрицательным числом.'
    }

    if (showScheduleSection) {
      if (!startsAt || !endAt) {
        return 'Для челленджа с расписанием укажите дату начала и окончания.'
      }

      if (new Date(startsAt).getTime() >= new Date(endAt).getTime()) {
        return 'Дата начала должна быть раньше даты окончания.'
      }
    }

    return ''
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const validationError = validateBeforeSubmit()

    if (validationError) {
      event.preventDefault()
      setClientError(validationError)
      return
    }

    setClientError('')
  }

  return (
    <form action={action} onSubmit={handleSubmit} className="space-y-6">
      {initialValues.recordId ? (
        <input type="hidden" name={isChallengeForm ? 'challenge_id' : 'template_id'} value={initialValues.recordId} />
      ) : null}
      {isChallengeForm ? <input type="hidden" name="template_id" value={templateId} /> : null}
      <input type="hidden" name="badge_url" value={badgeUrl} />
      <input type="hidden" name="badge_storage_path" value={badgeStoragePath} />

      {clientError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {clientError}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <section className="app-card space-y-4 rounded-2xl border p-4 shadow-sm">
            <div className="space-y-1">
              <h2 className="app-text-primary text-lg font-semibold">Basics</h2>
              <p className="app-text-secondary text-sm">
                {isChallengeForm
                  ? 'Основные настройки челленджа и доступность для участников.'
                  : 'Основные настройки шаблона, который можно быстро применить при создании челленджа.'}
              </p>
            </div>

            {showTemplateSelector ? (
              <div className="space-y-1">
                <label htmlFor="template_selector" className="app-text-secondary block text-sm">
                  Использовать шаблон
                </label>
                <select
                  id="template_selector"
                  value={templateId}
                  onChange={(event) => applyTemplate(event.currentTarget.value)}
                  className="app-input w-full rounded-2xl border px-3 py-2"
                >
                  <option value="">Без шаблона</option>
                  {availableTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.title}
                    </option>
                  ))}
                </select>
                <p className="app-text-secondary text-sm">
                  {selectedTemplate
                    ? 'Поля ниже заполнены данными выбранного шаблона и их можно изменить перед сохранением.'
                    : 'Шаблон подставит название, цель, награду, окно и бейдж.'}
                </p>
              </div>
            ) : null}

            <div className="space-y-1">
              <label htmlFor="title" className="app-text-secondary block text-sm">
                Название
              </label>
              <input
                id="title"
                name="title"
                type="text"
                required
                value={title}
                onChange={(event) => setTitle(event.currentTarget.value)}
                className="app-input w-full rounded-2xl border px-3 py-2"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="description" className="app-text-secondary block text-sm">
                Описание
              </label>
              <textarea
                id="description"
                name="description"
                rows={4}
                value={description}
                onChange={(event) => setDescription(event.currentTarget.value)}
                className="app-input w-full rounded-2xl border px-3 py-2"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {isChallengeForm ? (
                <div className="space-y-1">
                  <label htmlFor="visibility" className="app-text-secondary block text-sm">
                    Видимость
                  </label>
                  <select
                    id="visibility"
                    name="visibility"
                    value={visibility}
                    onChange={(event) => setVisibility(event.currentTarget.value === 'restricted' ? 'restricted' : 'public')}
                    className="app-input w-full rounded-2xl border px-3 py-2"
                  >
                    <option value="public">Открытый</option>
                    <option value="restricted">По доступу</option>
                  </select>
                </div>
              ) : null}

              <div className="space-y-1">
                <label htmlFor="period_type" className="app-text-secondary block text-sm">
                  Тип челленджа
                </label>
                <select
                  id="period_type"
                  name="period_type"
                  value={periodType}
                  onChange={(event) => setPeriodType(event.currentTarget.value as ChallengePeriodType)}
                  className="app-input w-full rounded-2xl border px-3 py-2"
                >
                  {PERIOD_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="app-text-secondary text-sm">
                  {PERIOD_TYPE_OPTIONS.find((option) => option.value === periodType)?.help}
                </p>
              </div>
            </div>
          </section>

          <section className="app-card space-y-4 rounded-2xl border p-4 shadow-sm">
            <div className="space-y-1">
              <h2 className="app-text-primary text-lg font-semibold">Goal</h2>
              <p className="app-text-secondary text-sm">
                Выберите одну цель. Форма не позволит смешивать дистанцию и количество тренировок.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor="goal_unit" className="app-text-secondary block text-sm">
                  Тип цели
                </label>
                <select
                  id="goal_unit"
                  name="goal_unit"
                  value={goalUnit}
                  onChange={(event) => setGoalUnit(event.currentTarget.value as ChallengeGoalUnit)}
                  className="app-input w-full rounded-2xl border px-3 py-2"
                >
                  {GOAL_UNIT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="goal_target" className="app-text-secondary block text-sm">
                  Целевое значение
                </label>
                <input
                  id="goal_target"
                  name="goal_target"
                  type="number"
                  min="0"
                  step={selectedGoalUnit.step}
                  required
                  value={goalTarget}
                  onChange={(event) => setGoalTarget(event.currentTarget.value)}
                  className="app-input w-full rounded-2xl border px-3 py-2"
                />
                <p className="app-text-secondary text-sm">
                  Единица измерения: {selectedGoalUnit.suffix}
                </p>
              </div>
            </div>
          </section>

          <section className="app-card space-y-4 rounded-2xl border p-4 shadow-sm">
            <div className="space-y-1">
              <h2 className="app-text-primary text-lg font-semibold">Reward</h2>
              <p className="app-text-secondary text-sm">
                Укажите награду за выполнение. Значение сохраняется как часть completion snapshot.
              </p>
            </div>

            <div className="space-y-1">
              <label htmlFor="xp_reward" className="app-text-secondary block text-sm">
                Награда XP
              </label>
              <input
                id="xp_reward"
                name="xp_reward"
                type="number"
                min="0"
                step="1"
                value={xpReward}
                onChange={(event) => setXpReward(event.currentTarget.value)}
                className="app-input w-full rounded-2xl border px-3 py-2"
              />
            </div>
          </section>

          {showScheduleSection ? (
            <section className="app-card space-y-4 rounded-2xl border p-4 shadow-sm">
              <div className="space-y-1">
                <h2 className="app-text-primary text-lg font-semibold">Schedule</h2>
                <p className="app-text-secondary text-sm">
                  Только для челленджей с фиксированным окном. За пределами этого окна прогресс не считается.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <label htmlFor="starts_at" className="app-text-secondary block text-sm">
                    Дата начала
                  </label>
                  <input
                    id="starts_at"
                    name="starts_at"
                    type="datetime-local"
                    required={showScheduleSection}
                    value={startsAt}
                    onChange={(event) => setStartsAt(event.currentTarget.value)}
                    className="app-input w-full rounded-2xl border px-3 py-2"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="end_at" className="app-text-secondary block text-sm">
                    Дата окончания
                  </label>
                  <input
                    id="end_at"
                    name="end_at"
                    type="datetime-local"
                    required={showScheduleSection}
                    value={endAt}
                    onChange={(event) => setEndAt(event.currentTarget.value)}
                    className="app-input w-full rounded-2xl border px-3 py-2"
                  />
                </div>
              </div>
            </section>
          ) : null}

          <section className="app-card space-y-4 rounded-2xl border p-4 shadow-sm">
            <div className="space-y-1">
              <h2 className="app-text-primary text-lg font-semibold">Badge</h2>
              <p className="app-text-secondary text-sm">
                Бейдж необязателен. Если изображение не загружено, в интерфейсе будет показан аккуратный плейсхолдер.
              </p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={(event) => void handleBadgeChange(event)}
              className="hidden"
            />

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploadingBadge}
                className="app-button-secondary rounded-2xl border px-4 py-2 text-sm font-medium shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isUploadingBadge ? 'Загрузка бейджа...' : badgeUrl ? 'Заменить бейдж' : 'Загрузить бейдж'}
              </button>

              {badgeUrl ? (
                <button
                  type="button"
                  onClick={handleRemoveBadge}
                  className="app-text-secondary text-sm transition-opacity hover:opacity-70"
                >
                  Удалить текущий бейдж
                </button>
              ) : null}
            </div>

            <div className="flex items-center gap-4 rounded-2xl border border-black/[0.06] p-3 dark:border-white/[0.08]">
              <ChallengeBadgeArtwork
                badgeUrl={badgeUrl}
                title={title}
                className="h-20 w-20 rounded-2xl"
                placeholderLabel="Нет бейджа"
              />
              <div className="min-w-0">
                <p className="app-text-primary text-sm font-medium">
                  {badgeUrl ? 'Бейдж загружен' : 'Будет использован плейсхолдер'}
                </p>
                <p className="app-text-secondary truncate text-xs">
                  {badgeStoragePath || 'Изображение можно добавить позже.'}
                </p>
              </div>
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <section className="app-card sticky top-4 space-y-4 rounded-2xl border p-4 shadow-sm">
            <div className="space-y-1">
              <h2 className="app-text-primary text-lg font-semibold">Preview</h2>
              <p className="app-text-secondary text-sm">
                Быстрая проверка того, как админ настроил челлендж.
              </p>
            </div>

            <div className="space-y-3 rounded-2xl border border-black/[0.06] p-4 dark:border-white/[0.08]">
              <div className="flex items-center gap-3">
                <ChallengeBadgeArtwork
                  badgeUrl={badgeUrl}
                  title={title}
                  className="h-14 w-14 rounded-2xl"
                  placeholderLabel="Badge"
                />
                <div className="min-w-0">
                  <p className="app-text-primary truncate font-semibold">
                    {title.trim() || 'Название челленджа'}
                  </p>
                  <p className="app-text-secondary text-sm">{formatPeriodType(periodType)}</p>
                </div>
              </div>

              <dl className="space-y-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="app-text-secondary">Цель</dt>
                  <dd className="app-text-primary text-right font-medium">{previewGoal}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="app-text-secondary">Награда</dt>
                  <dd className="app-text-primary text-right font-medium">{previewReward}</dd>
                </div>
                {isChallengeForm ? (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="app-text-secondary">Видимость</dt>
                    <dd className="app-text-primary text-right font-medium">
                      {visibility === 'restricted' ? 'По доступу' : 'Открытый'}
                    </dd>
                  </div>
                ) : null}
                {showScheduleSection ? (
                  <div className="flex items-start justify-between gap-3">
                    <dt className="app-text-secondary">Окно</dt>
                    <dd className="app-text-primary text-right font-medium">
                      {startsAt && endAt ? `${startsAt.replace('T', ' ')} - ${endAt.replace('T', ' ')}` : 'Не задано'}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </div>
          </section>
        </aside>
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" className="app-button-primary rounded-2xl border px-4 py-2 text-sm font-medium shadow-sm">
          {submitLabel}
        </button>
        <Link
          href={cancelHref}
          className="app-text-secondary text-sm transition-opacity hover:opacity-70"
        >
          Отмена
        </Link>
      </div>
    </form>
  )
}
