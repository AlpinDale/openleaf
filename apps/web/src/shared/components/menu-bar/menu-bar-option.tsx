import DropdownListItem from '@/shared/components/dropdown/dropdown-list-item'
import { OLDropdownItem } from '@/shared/components/ol/ol-dropdown-menu'
import { useNestableDropdown } from '@/shared/hooks/use-nestable-dropdown'
import { MouseEventHandler, ReactNode } from 'react'

type MenuBarOptionProps = {
  title: string
  onClick?: MouseEventHandler
  disabled?: boolean
  leadingIcon?: ReactNode
  trailingIcon?: ReactNode
  href?: string
  target?: string
  rel?: string
  eventKey?: string
}

export const MenuBarOption = ({
  title,
  onClick,
  href,
  disabled,
  leadingIcon,
  trailingIcon,
  target,
  rel,
}: MenuBarOptionProps) => {
  const { setSelected } = useNestableDropdown()
  return (
    <DropdownListItem>
      <OLDropdownItem
        onMouseEnter={() => setSelected(null)}
        onClick={onClick}
        disabled={disabled}
        leadingIcon={leadingIcon}
        trailingIcon={trailingIcon}
        href={href}
        rel={rel}
        target={target}
      >
        {title}
      </OLDropdownItem>
    </DropdownListItem>
  )
}
