'use client'

type WheelPickerSheetProps = {
  title: string
  open: boolean
  onCancel: () => void
  onDone: () => void
  children: React.ReactNode
}

export default function WheelPickerSheet({
  title,
  open,
  onCancel,
  onDone,
  children,
}: WheelPickerSheetProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 md:items-center md:justify-center md:p-4">
      <div
        className="absolute inset-0"
        aria-hidden="true"
        onClick={onCancel}
      />
      <div className="app-card relative w-full rounded-t-3xl px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 shadow-xl md:max-w-md md:rounded-3xl">
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-gray-200 dark:bg-gray-700 md:hidden" />
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="app-text-secondary min-h-11 rounded-lg px-3 py-2 text-sm"
          >
            Отмена
          </button>
          <h2 className="app-text-primary text-base font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onDone}
            className="app-text-primary min-h-11 rounded-lg px-3 py-2 text-sm font-medium"
          >
            Готово
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  )
}
