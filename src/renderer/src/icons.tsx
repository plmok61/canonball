function Icon({
  size = 16,
  children
}: {
  size?: number
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}

export function ChevronRight({ size }: { size?: number }): React.JSX.Element {
  return (
    <Icon size={size}>
      <path d="M6 3.5 10.5 8 6 12.5" />
    </Icon>
  )
}

export function ChevronDown({ size }: { size?: number }): React.JSX.Element {
  return (
    <Icon size={size}>
      <path d="M3.5 6 8 10.5 12.5 6" />
    </Icon>
  )
}

export function Gear({ size }: { size?: number }): React.JSX.Element {
  return (
    <Icon size={size}>
      <circle cx="8" cy="8" r="2.25" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" />
    </Icon>
  )
}
