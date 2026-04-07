'use client'

import type { FormEvent } from 'react'
import { useEffect } from 'react'
import type { ActivityRunRow } from '@/lib/activity'

const DISTANCE_PRESETS = [
  { label: '5 км', value: '5' },
  { label: '10 км', value: '10' },
  { label: '15 км', value: '15' },
  { label: '21.1 км', value: '21.1' },
  { label: '42.2 км', value: '42.2' },
] as const

type RaceEventFormSheetProps = {
  open: boolean
  editing: boolean
  submitting: boolean
  raceEventName: string
  raceEventDate: string
  distanceInput: string
  resultTimeInput: string
  targetTimeInput: string
  selectedLinkedRunId: string
  workoutOptions: Array<{ id: string; label: string }>
  formCandidateRuns: ActivityRunRow[]
  formSuggestedRunId: string
  formError: string
  getCandidateRunLabel: (run: ActivityRunRow) => string
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onRaceEventNameChange: (value: string) => void
  onRaceEventDateChange: (value: string) => void
  onDistanceInputChange: (value: string) => void
  onResultTimeInputChange: (value: string) => void
  onTargetTimeInputChange: (value: string) => void
  onSelectedLinkedRunIdChange: (value: string) => void
  onFormSuggestedRunIdChange: (value: string) => void
}

export default function RaceEventFormSheet({
  open,
  editing,
  submitting,
  raceEventName,
  raceEventDate,
  distanceInput,
  resultTimeInput,
  targetTimeInput,
  selectedLinkedRunId,
  workoutOptions,
  formCandidateRuns,
  formSuggestedRunId,
  formError,
  getCandidateRunLabel,
  onClose,
  onSubmit,
  onRaceEventNameChange,
  onRaceEventDateChange,
  onDistanceInputChange,
  onResultTimeInputChange,
  onTargetTimeInputChange,
  onSelectedLinkedRunIdChange,
  onFormSuggestedRunIdChange,
}: RaceEventFormSheetProps) {
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

  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 md:items-center md:justify-center md:p-4">
      <button
        type="button"
        aria-label="Закрыть форму старта"
        className="absolute inset-0"
        onClick={onClose}
        disabled={submitting}
      />
      <section className="app-card relative flex max-h-[min(88svh,48rem)] w-full min-w-0 flex-col overflow-hidden rounded-t-3xl shadow-xl md:max-w-lg md:rounded-3xl">
        <div className="flex shrink-0 flex-col px-4 pt-4">
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-gray-200 dark:bg-gray-700 md:hidden" />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="app-text-primary text-lg font-semibold">
              {editing ? 'Редактировать старт' : 'Добавить старт'}
            </h2>
            <p className="app-text-secondary mt-1 text-sm">
              {editing
                ? 'Обновите данные старта и связь с тренировкой.'
                : 'Добавьте старт, цель и при необходимости привяжите тренировку.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="app-text-secondary min-h-10 shrink-0 rounded-xl px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
          >
            Закрыть
          </button>
        </div>
        </div>

        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-4 pt-4">
          <div className="space-y-4">
            <div>
              <label htmlFor="race-event-name" className="app-text-secondary mb-1 block text-sm">
                Название старта
              </label>
              <input
                id="race-event-name"
                type="text"
                value={raceEventName}
                onChange={(event) => onRaceEventNameChange(event.target.value)}
                placeholder="Например: Московский марафон"
                disabled={submitting}
                className="app-input min-h-11 w-full rounded-xl border px-3 py-2"
              />
            </div>

            <div>
              <label htmlFor="race-event-date" className="app-text-secondary mb-1 block text-sm">
                Дата старта
              </label>
              <input
                id="race-event-date"
                type="date"
                value={raceEventDate}
                onChange={(event) => onRaceEventDateChange(event.target.value)}
                disabled={submitting}
                className="app-input min-h-11 w-full rounded-xl border px-3 py-2"
              />
            </div>

            <div>
              <label htmlFor="race-event-distance" className="app-text-secondary mb-1 block text-sm">
                Дистанция
              </label>
              <div className="mb-2 flex flex-wrap gap-2">
                {DISTANCE_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => onDistanceInputChange(preset.value)}
                    disabled={submitting}
                    className={`inline-flex min-h-9 items-center justify-center rounded-full border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                      distanceInput === preset.value
                        ? 'app-button-primary'
                        : 'app-button-secondary'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <input
                id="race-event-distance"
                type="text"
                inputMode="decimal"
                value={distanceInput}
                onChange={(event) => onDistanceInputChange(event.target.value)}
                placeholder="Например: 7.5"
                disabled={submitting}
                className="app-input min-h-11 w-full rounded-xl border px-3 py-2"
              />
              <p className="app-text-secondary mt-2 text-xs">
                Если привязана тренировка, на карточке будет показана дистанция из нее.
              </p>
            </div>

            <div>
              <label htmlFor="race-event-target-time" className="app-text-secondary mb-1 block text-sm">
                Цель на старт
              </label>
              <input
                id="race-event-target-time"
                type="text"
                inputMode="numeric"
                value={targetTimeInput}
                onChange={(event) => onTargetTimeInputChange(event.target.value)}
                placeholder="чч:мм:сс"
                autoComplete="off"
                disabled={submitting}
                className="app-input min-h-11 w-full rounded-xl border px-3 py-2"
              />
              <p className="app-text-secondary mt-2 text-xs">
                Необязательно. Для будущих стартов покажем это время как цель.
              </p>
            </div>

            <div>
              <label htmlFor="race-event-result-time" className="app-text-secondary mb-1 block text-sm">
                Результат
              </label>
              <input
                id="race-event-result-time"
                type="text"
                inputMode="numeric"
                value={resultTimeInput}
                onChange={(event) => onResultTimeInputChange(event.target.value)}
                placeholder="чч:мм:сс"
                autoComplete="off"
                disabled={submitting}
                className="app-input min-h-11 w-full rounded-xl border px-3 py-2"
              />
              <p className="app-text-secondary mt-2 text-xs">
                Формат: чч:мм:сс. Если привязана тренировка, на карточке будет показано время из нее.
              </p>
            </div>

            <div>
              <label htmlFor="race-event-linked-run" className="app-text-secondary mb-1 block text-sm">
                Привязать тренировку
              </label>
              <select
                id="race-event-linked-run"
                value={selectedLinkedRunId}
                onChange={(event) => onSelectedLinkedRunIdChange(event.target.value)}
                disabled={submitting}
                className="app-input min-h-11 w-full rounded-xl border px-3 py-2"
              >
                <option value="">Без привязанной тренировки</option>
                {workoutOptions.map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.label}
                  </option>
                ))}
              </select>
            </div>

            {!selectedLinkedRunId && formCandidateRuns.length > 0 ? (
              <div className="rounded-2xl border border-amber-300/60 bg-amber-50/70 px-4 py-3 dark:border-amber-300/20 dark:bg-amber-300/10">
                <p className="app-text-primary text-sm font-medium">Похоже, это был забег - привязать?</p>
                <p className="app-text-secondary mt-1 text-sm">
                  {formCandidateRuns.length === 1
                    ? getCandidateRunLabel(formCandidateRuns[0])
                    : 'Найдено несколько тренировок рядом с датой старта.'}
                </p>
                {formCandidateRuns.length > 1 ? (
                  <select
                    value={formSuggestedRunId}
                    onChange={(event) => onFormSuggestedRunIdChange(event.target.value)}
                    className="app-input mt-3 min-h-11 w-full rounded-xl border px-3 py-2"
                  >
                    {formCandidateRuns.map((run) => (
                      <option key={run.id} value={run.id}>
                        {getCandidateRunLabel(run)}
                      </option>
                    ))}
                  </select>
                ) : null}
                <button
                  type="button"
                  onClick={() => onSelectedLinkedRunIdChange(formSuggestedRunId || formCandidateRuns[0]?.id || '')}
                  className="app-button-secondary mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-xl border px-4 py-2 text-sm font-medium"
                >
                  Привязать выбранную тренировку
                </button>
              </div>
            ) : null}

            {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
          </div>
          </div>

          <div className="shrink-0 border-t border-black/5 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 dark:border-white/10 md:pb-4">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="app-button-secondary inline-flex min-h-11 items-center justify-center rounded-xl border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="app-button-primary inline-flex min-h-11 items-center justify-center rounded-xl border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting
                ? (editing ? 'Сохраняем старт...' : 'Создаем старт...')
                : (editing ? 'Сохранить старт' : 'Добавить старт')}
            </button>
          </div>
          </div>
        </form>
      </section>
    </div>
  )
}
