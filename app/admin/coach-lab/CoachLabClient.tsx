'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { analyzeCoachLab } from './actions'
import type { CoachLabAiOutput, CoachLabState, CoachLabUserOption } from './types'

type CoachLabClientProps = {
  users: CoachLabUserOption[]
}

function getDefaultWeekStart() {
  const now = new Date()
  const utcDay = now.getUTCDay()
  const diff = utcDay === 0 ? -6 : 1 - utcDay
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diff))
  return monday.toISOString().slice(0, 10)
}

function formatDateTime(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatDayLabel(value: string) {
  if (!value) {
    return '-'
  }

  return value.charAt(0).toUpperCase() + value.slice(1)
}

function formatNumber(value: number | null | undefined, digits = 1) {
  if (!Number.isFinite(value)) {
    return '-'
  }

  return new Intl.NumberFormat('en-GB', {
    maximumFractionDigits: digits,
  }).format(Number(value))
}

function formatDurationMinutes(value: number | null | undefined) {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) {
    return '-'
  }

  const totalMinutes = Math.round(Number(value))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours <= 0) {
    return `${minutes} min`
  }

  if (minutes === 0) {
    return `${hours} h`
  }

  return `${hours} h ${minutes} min`
}

function buildInitialState(users: CoachLabUserOption[]): CoachLabState {
  return {
    form: {
      userId: users[0]?.id ?? '',
      weekStart: getDefaultWeekStart(),
      planText: '',
    },
    result: null,
    error: null,
  }
}

function SubmitButton() {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      className="app-button-primary inline-flex min-h-11 items-center justify-center rounded-2xl px-5 py-3 text-sm font-semibold shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? 'Analyzing...' : 'Analyze'}
    </button>
  )
}

function ConfidenceBadge({ confidence }: { confidence: CoachLabAiOutput['confidence'] }) {
  const className =
    confidence === 'high'
      ? 'border-emerald-300/70 bg-emerald-100/80 text-emerald-700 dark:border-emerald-300/20 dark:bg-emerald-300/10 dark:text-emerald-100'
      : confidence === 'medium'
        ? 'border-amber-300/70 bg-amber-100/80 text-amber-700 dark:border-amber-300/20 dark:bg-amber-300/10 dark:text-amber-100'
        : 'border-rose-300/70 bg-rose-100/80 text-rose-700 dark:border-rose-300/20 dark:bg-rose-300/10 dark:text-rose-100'

  return (
    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] ${className}`}>
      {confidence} confidence
    </span>
  )
}

export default function CoachLabClient({ users }: CoachLabClientProps) {
  const [state, formAction] = useActionState(analyzeCoachLab, buildInitialState(users))
  const selectedUserId = state.form.userId || users[0]?.id || ''

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="inline-flex rounded-full border border-amber-300/70 bg-amber-100/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-amber-700 dark:border-amber-300/20 dark:bg-amber-300/10 dark:text-amber-100">
          Internal lab tool
        </div>
        <h1 className="app-text-primary text-2xl font-bold">AI Workout Analysis Lab</h1>
        <p className="app-text-secondary max-w-3xl text-sm">
          Compare a pasted weekly plan against imported workouts for one user. This page is isolated from the main product flow and is intended for debugging and prompt iteration.
        </p>
      </div>

      <div className="app-card rounded-2xl border p-4 shadow-sm">
        <form action={formAction} className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <label className="space-y-2">
              <span className="app-text-primary text-sm font-medium">User</span>
              <select
                name="user_id"
                defaultValue={selectedUserId}
                className="app-surface-muted min-h-11 w-full rounded-2xl border px-3 py-2 text-sm"
              >
                {users.length === 0 ? <option value="">No users found</option> : null}
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.label}
                    {user.appAccessStatus === 'blocked' ? ' (blocked)' : ''}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2">
              <span className="app-text-primary text-sm font-medium">Week start</span>
              <input
                type="date"
                name="week_start"
                defaultValue={state.form.weekStart}
                className="app-surface-muted min-h-11 w-full rounded-2xl border px-3 py-2 text-sm"
              />
              <p className="app-text-secondary text-xs">The tool analyzes the 7-day range starting from this date.</p>
            </label>
          </div>

          <label className="space-y-2">
            <span className="app-text-primary text-sm font-medium">Training plan</span>
            <textarea
              name="plan_text"
              rows={10}
              defaultValue={state.form.planText}
              placeholder={'Mon - easy 8 km\nTue - intervals 6x800m\nWed - rest\nThu - tempo 40 min\nSat - long run 18 km'}
              className="app-surface-muted min-h-[220px] w-full rounded-2xl border px-3 py-3 text-sm"
            />
            <p className="app-text-secondary text-xs">Paste raw coach notes or a simple line-by-line weekly plan. Parsing is intentionally best-effort.</p>
          </label>

          <div className="flex items-center justify-between gap-3">
            <p className="app-text-secondary text-xs">Uses existing `profiles` and `runs` data only. No writebacks, no new sync logic, no athlete-facing sending.</p>
            <SubmitButton />
          </div>
        </form>
      </div>

      {state.error ? (
        <div className="app-card rounded-2xl border border-rose-300/70 p-4 shadow-sm">
          <p className="text-sm text-rose-700 dark:text-rose-200">{state.error}</p>
        </div>
      ) : null}

      {state.result ? (
        <>
          <div className="app-card rounded-2xl border p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="app-text-primary text-lg font-semibold">Analysis Context</h2>
                <p className="app-text-secondary mt-1 text-sm">
                  {state.result.userLabel} | {state.result.weekStart} to {state.result.weekEndExclusive}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <div>
                  <p className="app-text-secondary text-xs uppercase tracking-[0.08em]">Runs</p>
                  <p className="app-text-primary font-semibold">{state.result.weeklySummary.actual_runs_count}</p>
                </div>
                <div>
                  <p className="app-text-secondary text-xs uppercase tracking-[0.08em]">Distance</p>
                  <p className="app-text-primary font-semibold">{formatNumber(state.result.weeklySummary.actual_distance_km)} km</p>
                </div>
                <div>
                  <p className="app-text-secondary text-xs uppercase tracking-[0.08em]">Active days</p>
                  <p className="app-text-primary font-semibold">{state.result.weeklySummary.actual_active_days_count}</p>
                </div>
              </div>
            </div>
            {state.result.analysisError ? (
              <div className="mt-4 rounded-2xl border border-rose-300/70 bg-rose-50/80 p-3 text-sm text-rose-700 dark:border-rose-300/20 dark:bg-rose-300/10 dark:text-rose-100">
                AI analysis failed honestly: {state.result.analysisError}
              </div>
            ) : null}
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <section className="app-card rounded-2xl border p-4 shadow-sm">
              <div className="mb-4">
                <h2 className="app-text-primary text-lg font-semibold">Parsed plan</h2>
                <p className="app-text-secondary mt-1 text-sm">Best-effort extraction from the pasted plan text.</p>
              </div>

              {state.result.parsedPlanDays.length === 0 ? (
                <p className="app-text-secondary text-sm">No plan lines were parsed.</p>
              ) : (
                <div className="space-y-3">
                  {state.result.parsedPlanDays.map((day) => (
                    <div key={`${day.line_number}-${day.source_text}`} className="app-surface-muted rounded-2xl border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="app-text-primary text-sm font-semibold">
                          {day.day_label ?? `Line ${day.line_number}`}
                        </span>
                        {day.workout_type ? (
                          <span className="rounded-full border px-2 py-0.5 text-xs font-medium">{day.workout_type}</span>
                        ) : null}
                        {day.intensity ? (
                          <span className="rounded-full border px-2 py-0.5 text-xs font-medium">{day.intensity}</span>
                        ) : null}
                      </div>
                      <p className="app-text-primary mt-2 text-sm">{day.source_text}</p>
                      <div className="app-text-secondary mt-2 flex flex-wrap gap-4 text-xs">
                        <span>Target distance: {formatNumber(day.target_distance_km)} km</span>
                        <span>Target duration: {formatDurationMinutes(day.target_duration_minutes)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="app-card rounded-2xl border p-4 shadow-sm">
              <div className="mb-4">
                <h2 className="app-text-primary text-lg font-semibold">Found workouts</h2>
                <p className="app-text-secondary mt-1 text-sm">Runs loaded from the existing database for the selected week.</p>
              </div>

              {state.result.actualRuns.length === 0 ? (
                <p className="app-text-secondary text-sm">No runs found for this user in the selected range.</p>
              ) : (
                <div className="space-y-3">
                  {state.result.actualRuns.map((run) => (
                    <div key={run.id} className="app-surface-muted rounded-2xl border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="app-text-primary text-sm font-semibold">{run.title}</h3>
                        <span className="app-text-secondary text-xs">{formatDateTime(run.created_at)}</span>
                      </div>
                      <div className="app-text-secondary mt-2 flex flex-wrap gap-4 text-xs">
                        <span>Day: {formatDayLabel(run.day_of_week)}</span>
                        <span>{formatNumber(run.distance_km, 2)} km</span>
                        <span>{formatDurationMinutes(run.duration_minutes)}</span>
                        <span>{run.elevation_gain_meters ? `${run.elevation_gain_meters} m gain` : 'No elevation data'}</span>
                        <span>Source: {run.external_source ?? 'manual/unknown'}</span>
                      </div>
                      {run.description ? <p className="app-text-secondary mt-2 text-sm">{run.description}</p> : null}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <section className="app-card rounded-2xl border p-4 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="app-text-primary text-lg font-semibold">AI feedback</h2>
                <p className="app-text-secondary mt-1 text-sm">Structured JSON rendered into a coach-style review.</p>
              </div>
              {state.result.aiOutput ? <ConfidenceBadge confidence={state.result.aiOutput.confidence} /> : null}
            </div>

            {state.result.aiOutput ? (
              <div className="space-y-5">
                <div>
                  <h3 className="app-text-primary text-sm font-semibold uppercase tracking-[0.08em]">Summary</h3>
                  <p className="app-text-primary mt-2 text-sm leading-6">{state.result.aiOutput.summary}</p>
                </div>

                <div>
                  <h3 className="app-text-primary text-sm font-semibold uppercase tracking-[0.08em]">Matched workouts</h3>
                  {state.result.aiOutput.matched_workouts.length === 0 ? (
                    <p className="app-text-secondary mt-2 text-sm">No confident matches called out.</p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {state.result.aiOutput.matched_workouts.map((item, index) => (
                        <div key={`${item.day}-${index}`} className="app-surface-muted rounded-2xl border p-3 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="app-text-primary font-medium">{formatDayLabel(item.day)}</p>
                            <span className="rounded-full border px-2 py-0.5 text-xs font-medium">{item.status}</span>
                          </div>
                          <p className="app-text-primary mt-2">{item.comment}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <h3 className="app-text-primary text-sm font-semibold uppercase tracking-[0.08em]">Missed or changed workouts</h3>
                  {state.result.aiOutput.missed_or_changed_workouts.length === 0 ? (
                    <p className="app-text-secondary mt-2 text-sm">No missed or materially changed sessions were identified.</p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {state.result.aiOutput.missed_or_changed_workouts.map((item, index) => (
                        <div key={`${item.day}-${index}`} className="app-surface-muted rounded-2xl border p-3 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="app-text-primary font-medium">{formatDayLabel(item.day)}</p>
                            <span className="rounded-full border px-2 py-0.5 text-xs font-medium">{item.issue}</span>
                          </div>
                          <p className="app-text-primary mt-2">{item.comment}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid gap-5 lg:grid-cols-2">
                  <div>
                    <h3 className="app-text-primary text-sm font-semibold uppercase tracking-[0.08em]">Load observations</h3>
                    {state.result.aiOutput.load_observations.length === 0 ? (
                      <p className="app-text-secondary mt-2 text-sm">No load observations returned.</p>
                    ) : (
                      <ul className="mt-2 space-y-2 text-sm">
                        {state.result.aiOutput.load_observations.map((item, index) => (
                          <li key={`${item}-${index}`} className="app-surface-muted rounded-2xl border p-3">
                            {item}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="space-y-5">
                    <div>
                      <h3 className="app-text-primary text-sm font-semibold uppercase tracking-[0.08em]">Ready to send feedback</h3>
                      {state.result.aiOutput.ready_to_send_feedback.length === 0 ? (
                        <p className="app-text-secondary mt-2 text-sm">No ready-to-send feedback returned.</p>
                      ) : (
                        <p className="app-surface-muted mt-2 rounded-2xl border p-3 text-sm">
                          {state.result.aiOutput.ready_to_send_feedback}
                        </p>
                      )}
                    </div>

                    <div>
                      <h3 className="app-text-primary text-sm font-semibold uppercase tracking-[0.08em]">Athlete feedback</h3>
                      {state.result.aiOutput.athlete_feedback.length === 0 ? (
                        <p className="app-text-secondary mt-2 text-sm">No athlete feedback returned.</p>
                      ) : (
                        <p className="app-surface-muted mt-2 rounded-2xl border p-3 text-sm">
                          {state.result.aiOutput.athlete_feedback}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="app-text-primary text-sm font-semibold uppercase tracking-[0.08em]">Coach note</h3>
                  <p className="app-text-primary mt-2 text-sm leading-6">{state.result.aiOutput.coach_note}</p>
                </div>

                <div>
                  <h3 className="app-text-primary text-sm font-semibold uppercase tracking-[0.08em]">Warnings</h3>
                  {state.result.aiOutput.warnings.length === 0 ? (
                    <p className="app-text-secondary mt-2 text-sm">No explicit warnings returned.</p>
                  ) : (
                    <ul className="mt-2 space-y-2 text-sm">
                      {state.result.aiOutput.warnings.map((item, index) => (
                        <li key={`${item}-${index}`} className="rounded-2xl border border-amber-300/70 bg-amber-50/80 p-3 dark:border-amber-300/20 dark:bg-amber-300/10">
                          {item}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : (
              <p className="app-text-secondary text-sm">
                No AI feedback available. Check the visible error above and the debug payload below.
              </p>
            )}
          </section>

          <section className="app-card rounded-2xl border p-4 shadow-sm">
            <div className="mb-4">
              <h2 className="app-text-primary text-lg font-semibold">Debug payload sent to the model</h2>
              <p className="app-text-secondary mt-1 text-sm">Raw normalized input for prompt inspection and iteration.</p>
            </div>
            <pre className="app-surface-muted overflow-x-auto whitespace-pre-wrap break-words rounded-2xl border p-4 text-xs leading-6">
              {JSON.stringify(state.result.debugPayload, null, 2)}
            </pre>
          </section>
        </>
      ) : null}
    </div>
  )
}
