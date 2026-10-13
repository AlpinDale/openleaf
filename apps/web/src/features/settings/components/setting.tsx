// Adapted from Overleaf services/web/frontend/js/features/ide-settings/components/{setting,settings-section,toggle-setting,dropdown-setting}.tsx (AGPL-3.0).
import classNames from 'classnames'
import type { ChangeEvent, ReactNode } from 'react'
import OLFormSelect from '@/shared/components/ol/ol-form-select'
import OLFormSwitch from '@/shared/components/ol/ol-form-switch'

export function SettingsSection({
  title,
  children,
}: {
  title?: string
  children: ReactNode
}) {
  return (
    <div className="ide-settings-section">
      {title && <div className="ide-settings-section-title">{title}</div>}
      {children}
    </div>
  )
}

export function Setting({
  label,
  controlId,
  description,
  children,
}: {
  label: ReactNode
  controlId: string
  description?: ReactNode
  children: ReactNode
}) {
  return (
    <div id={`setting-${controlId}`} className="ide-setting">
      <div>
        <label htmlFor={controlId} className="ide-setting-title">
          {label}
        </label>
        {description && (
          <div className="ide-setting-description">{description}</div>
        )}
      </div>
      <div className="ide-setting-input">{children}</div>
    </div>
  )
}

export function ToggleSetting({
  id,
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  id: string
  label: string
  description?: ReactNode
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}) {
  return (
    <Setting controlId={id} label={label} description={description}>
      <OLFormSwitch
        id={id}
        onChange={() => onChange(!checked)}
        checked={checked}
        label={label}
        disabled={disabled}
        data-testid={`setting-${id}`}
      />
    </Setting>
  )
}

type PossibleValue = string | number

export type Option<T extends PossibleValue = string> = {
  value: T
  label: string
  disabled?: boolean
}

export type Optgroup<T extends PossibleValue = string> = {
  label: string
  options: Option<T>[]
}

export function DropdownSetting<T extends PossibleValue = string>({
  id,
  label,
  description,
  options,
  optgroups,
  value,
  onChange,
  disabled = false,
  width = 'default',
  translateOptions,
}: {
  id: string
  label: string
  description?: ReactNode
  options?: Option<T>[]
  optgroups?: Optgroup<T>[]
  value: T
  onChange: (value: T) => void
  disabled?: boolean
  width?: 'default' | 'wide'
  translateOptions?: 'yes' | 'no'
}) {
  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const selected = event.target.value
    onChange(
      (typeof value === 'number'
        ? Number.parseInt(selected, 10)
        : selected) as T
    )
  }

  const renderOption = (option: Option<T>) => (
    <option
      key={String(option.value)}
      value={String(option.value)}
      disabled={option.disabled}
    >
      {option.label}
    </option>
  )

  return (
    <Setting controlId={id} label={label} description={description}>
      <OLFormSelect
        id={id}
        className={classNames('ide-dropdown-setting', {
          'ide-dropdown-setting-wide': width === 'wide',
        })}
        size="sm"
        onChange={handleChange}
        value={String(value)}
        disabled={disabled}
        translate={translateOptions}
        data-testid={`setting-${id}`}
      >
        {options?.map(renderOption)}
        {optgroups?.map(group => (
          <optgroup label={group.label} key={group.label}>
            {group.options.map(renderOption)}
          </optgroup>
        ))}
      </OLFormSelect>
    </Setting>
  )
}
