// From Overleaf services/web/frontend/js/features/ide-react/components/toolbar/command-dropdown.tsx (AGPL-3.0)
import { Fragment, useMemo } from 'react'
import {
  type Command,
  formatShortcut,
  type Shortcuts,
  useCommandRegistry,
} from '@/features/ide-react/context/command-registry-context'
import {
  MenuBarDropdown,
  NestedMenuBarDropdown,
} from '@/shared/components/menu-bar/menu-bar-dropdown'
import { MenuBarOption } from '@/shared/components/menu-bar/menu-bar-option'
import {
  OLDropdownDivider,
  OLDropdownHeader,
} from '@/shared/components/ol/ol-dropdown-menu'

type CommandId = string
type TaggedCommand = Command & {
  type: 'command'
  shortcuts?: Shortcuts[CommandId]
}
type Entry<T> = T | GroupStructure<T>
type GroupStructure<T> = {
  id: string
  title: string
  children: Array<Entry<T>>
}
export type MenuSectionStructure<T = CommandId> = {
  title?: string
  id: string
  children: Array<Entry<T>>
}
export type MenuStructure<T = CommandId> = Array<MenuSectionStructure<T>>

const CommandDropdown = ({
  menu,
  title,
  id,
}: {
  menu: MenuStructure<CommandId>
  title: string
  id: string
}) => {
  const { registry, shortcuts } = useCommandRegistry()
  const populatedSections = useMemo(
    () =>
      menu
        .map(section => populateSectionOrGroup(section, registry, shortcuts))
        .filter(x => x.children.length > 0),
    [menu, registry, shortcuts]
  )

  if (populatedSections.length === 0) {
    return null
  }

  return (
    <MenuBarDropdown
      title={title}
      id={id}
      className="ide-redesign-toolbar-dropdown-toggle-subdued ide-redesign-toolbar-button-subdued"
    >
      {populatedSections.map((section, index) => (
        <Fragment key={section.id}>
          <CommandSectionContent section={section} includeDivider={index > 0} />
        </Fragment>
      ))}
    </MenuBarDropdown>
  )
}

export const CommandSection = ({
  section: sectionStructure,
  includeDivider = true,
}: {
  section: MenuSectionStructure<CommandId>
  includeDivider?: boolean
}) => {
  const { registry, shortcuts } = useCommandRegistry()
  const section = populateSectionOrGroup(sectionStructure, registry, shortcuts)
  return (
    <CommandSectionContent section={section} includeDivider={includeDivider} />
  )
}

function CommandSectionContent({
  section,
  includeDivider = true,
}: {
  section: MenuSectionStructure<TaggedCommand>
  includeDivider?: boolean
}) {
  if (section.children.length === 0) {
    return null
  }
  return (
    <>
      {includeDivider && <OLDropdownDivider />}
      {section.title && <OLDropdownHeader>{section.title}</OLDropdownHeader>}
      {section.children.map(child => (
        <CommandDropdownChild item={child} key={child.id} />
      ))}
    </>
  )
}

const CommandDropdownChild = ({ item }: { item: Entry<TaggedCommand> }) => {
  if (isTaggedCommand(item)) {
    return (
      <MenuBarOption
        eventKey={item.id}
        key={item.id}
        title={item.menuLabel ?? item.label}
        onClick={() => item.handler?.({ location: 'menu-bar' })}
        href={item.href}
        disabled={item.disabled}
        leadingIcon={item.leadingIcon}
        trailingIcon={
          item.shortcuts && <span>{formatShortcut(item.shortcuts[0])}</span>
        }
      />
    )
  }
  return (
    <NestedMenuBarDropdown title={item.title} id={item.id} key={item.id}>
      {item.children.map(subChild => (
        <CommandDropdownChild item={subChild} key={subChild.id} />
      ))}
    </NestedMenuBarDropdown>
  )
}

export default CommandDropdown

function populateSectionOrGroup<
  T extends { children: Array<Entry<CommandId>> },
>(
  section: T,
  registry: Map<string, Command>,
  shortcuts: Shortcuts
): Omit<T, 'children'> & {
  children: Array<Entry<TaggedCommand>>
} {
  const { children, ...rest } = section
  return {
    ...rest,
    children: children
      .map(child => {
        if (typeof child !== 'string') {
          const populatedChild = populateSectionOrGroup(
            child,
            registry,
            shortcuts
          )
          if (populatedChild.children.length === 0) {
            // Skip empty groups
            return undefined
          }
          return populatedChild
        }
        const command = registry.get(child)
        if (command) {
          return {
            ...command,
            shortcuts: shortcuts[command.id],
            type: 'command' as const,
          }
        }
        return undefined
      })
      .filter(x => x !== undefined),
  }
}

function isTaggedCommand(item: Entry<TaggedCommand>): item is TaggedCommand {
  return 'type' in item && item.type === 'command'
}
